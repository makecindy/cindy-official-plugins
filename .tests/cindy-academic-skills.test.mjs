import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'cindy-academic-skills');

const loadPlugin = (fetchMock) => {
  globalThis.cindy = {
    onHostMessage() {},
    fetch: fetchMock || (async () => ({ ok: true, status: 200, body: JSON.stringify({ message: {} }) })),
    send: async () => ({ ok: true }),
  };
  const resolved = require.resolve('../cindy-academic-skills/main.js');
  delete require.cache[resolved];
  return require(resolved);
};

test('manifest declares Manifest v3, 13 ARS tools and structured manual', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.id, 'cindy-academic-skills');
  assert.deepEqual(manifest.network.hosts, ['api.crossref.org']);
  assert.equal(manifest.network.secrets, undefined);
  assert.equal(manifest.network.connections, undefined);
  assert.equal(manifest.settingsHtml, undefined);
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.equal(manifest.minCindyVersion, '0.1.64');
  assert.equal(manifest.tools.length, 13);
  assert.ok(manifest.manual && manifest.manual.items && manifest.manual.items.length > 0);
  assert.equal(manifest.manual.items[0].dir, 'manual/ars-suite');
});

test('cleanDoiString and isValidDoi validate standard and URL-formatted DOIs', () => {
  const plugin = loadPlugin();
  assert.equal(plugin.cleanDoiString('https://doi.org/10.1038/s41586-020-2649-2'), '10.1038/s41586-020-2649-2');
  assert.equal(plugin.cleanDoiString('http://dx.doi.org/10.1145/3372278.3390678'), '10.1145/3372278.3390678');
  assert.equal(plugin.cleanDoiString('doi: 10.1016/j.cell.2021.05.001'), '10.1016/j.cell.2021.05.001');

  assert.equal(plugin.isValidDoi('10.1038/s41586-020-2649-2'), true);
  assert.equal(plugin.isValidDoi('10.1101/2020.04.14.040626'), true);
  assert.equal(plugin.isValidDoi('not-a-doi'), false);
  assert.equal(plugin.isValidDoi(''), false);
});

test('stripXmlTags cleans JATS markup from abstract texts', () => {
  const plugin = loadPlugin();
  const raw = '<jats:title>Abstract</jats:title><jats:p>This study demonstrates &lt;b&gt;high-fidelity&lt;/b&gt; verification.</jats:p>';
  assert.equal(plugin.stripXmlTags(raw), 'AbstractThis study demonstrates <b>high-fidelity</b> verification.');
});

test('socraticResearchGuideTool provides FINER scores and candidate RQs', async () => {
  const plugin = loadPlugin();
  const res = await plugin.socraticResearchGuideTool({
    topic: 'Impact of AI on academic peer review',
    target_discipline: 'Computer Science & Higher Education',
  });

  assert.equal(res.ok, true);
  assert.ok(res.result.socraticProbingQuestions.length >= 3);
  assert.ok(res.result.finerEvaluation.feasible);
  assert.ok(res.result.candidateResearchQuestions.length === 3);
});

test('verifyDoiTool returns structured metadata for valid Crossref response', async () => {
  const mockItem = {
    DOI: '10.1038/s41586-020-2649-2',
    title: ['Structure of the SARS-CoV-2 spike protein'],
    author: [
      { given: 'Daniel', family: 'Wrapp' },
      { given: 'Nianshuang', family: 'Wang' },
    ],
    'container-title': ['Nature'],
    publisher: 'Springer Science and Business Media LLC',
    published: { 'date-parts': [[2020, 2, 19]] },
    'is-referenced-by-count': 4200,
    type: 'journal-article',
    abstract: '<jats:p>Detailed structural insight.</jats:p>',
  };

  const plugin = loadPlugin(async (req) => {
    assert.match(req.url, /api\.crossref\.org\/works\/10\.1038%2Fs41586-020-2649-2/);
    assert.equal(req.callId, 'call-123');
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({ message: mockItem }),
    };
  });

  const res = await plugin.verifyDoiTool({ doi: '10.1038/s41586-020-2649-2' }, 'call-123');
  assert.equal(res.ok, true);
  assert.equal(res.result.verified, true);
  assert.equal(res.result.title, 'Structure of the SARS-CoV-2 spike protein');
  assert.deepEqual(res.result.authors, ['Daniel Wrapp', 'Nianshuang Wang']);
  assert.equal(res.result.journal, 'Nature');
  assert.equal(res.result.publishedYear, 2020);
  assert.equal(res.result.citationsCount, 4200);
});

test('verifyDoiTool handles 404 with hallucination warning', async () => {
  const plugin = loadPlugin(async () => ({
    ok: true,
    status: 404,
    body: 'Not found',
  }));

  const res = await plugin.verifyDoiTool({ doi: '10.9999/fake-paper-12345' }, 'call-456');
  assert.equal(res.ok, true);
  assert.equal(res.result.verified, false);
  assert.match(res.result.warning, /未在 Crossref/);
});

test('searchCrossrefTool retrieves structured publication list', async () => {
  const mockResponse = {
    message: {
      'total-results': 1,
      items: [
        {
          DOI: '10.1038/nature123',
          title: ['Foundation Models in Science'],
          author: [{ given: 'Alice', family: 'Smith' }],
          'container-title': ['Nature'],
          published: { 'date-parts': [[2025]] },
          'is-referenced-by-count': 150,
        },
      ],
    },
  };

  const plugin = loadPlugin(async () => ({
    ok: true,
    status: 200,
    body: JSON.stringify(mockResponse),
  }));

  const res = await plugin.searchCrossrefTool({ query: 'Foundation Models', limit: 5 }, 'call-search');
  assert.equal(res.ok, true);
  assert.equal(res.result.count, 1);
  assert.equal(res.result.papers[0].title, 'Foundation Models in Science');
  assert.equal(res.result.papers[0].doi, '10.1038/nature123');
});

test('threeWayLitScanTool builds Why-How-What comparison matrix', async () => {
  const plugin = loadPlugin();
  const res = await plugin.threeWayLitScanTool({
    papers: [
      { title: 'Paper A', abstract_or_notes: 'Explores AI peer review latency' },
      { title: 'Paper B', abstract_or_notes: 'Examines reviewer agreement rates' },
    ],
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.scannedCount, 2);
  assert.ok(res.result.threeWayMatrix[0].why);
  assert.ok(res.result.threeWayMatrix[0].how);
  assert.ok(res.result.threeWayMatrix[0].what);
  assert.ok(res.result.crossStudySynthesis.openResearchGap);
});

test('academicIntegrityAuditTool scans 7 failure modes and reports verdict', async () => {
  const plugin = loadPlugin();
  const samplePaper = `
    Introduction:
    Previous studies (Smith et al., 2024) explored transformer architectures (10.1038/s41586-020-2649-2).
    Methodology:
    We evaluated our model against three baseline models with randomized control group allocations.
    Statistical significance was established at p < 0.01.
    All code and data availability statements are included.
  `;

  const res = await plugin.academicIntegrityAuditTool({ paper_text: samplePaper });
  assert.equal(res.ok, true);
  assert.ok(res.result.failureModesEvaluation.length === 7);
  assert.equal(res.result.verdict, 'GATE_PASSED');
});

test('claimCitationAlignmentTool evaluates token overlap and alignment status', async () => {
  const plugin = loadPlugin();
  const res = await plugin.claimCitationAlignmentTool({
    claim_text: 'Deep learning models achieve superior accuracy on genomic sequence classification.',
    cited_source_summary: 'We demonstrate that deep learning sequence models achieve high accuracy on genomic benchmarks.',
    doi: '10.1038/s41586-020-0001',
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.alignmentStatus, 'ALIGNED');
  assert.ok(res.result.estimatedAlignmentScore > 40);
});

test('academicStyleAuditTool identifies AI clichés and vague quantifiers', async () => {
  const plugin = loadPlugin();
  const textWithCliches = 'In this paper, we delve into the tapestry of methods that serve as a testament to various numerous advances.';

  const res = await plugin.academicStyleAuditTool({ draft_text: textWithCliches, rigor_level: 'strict' });
  assert.equal(res.ok, true);
  assert.ok(res.result.detectedAiClichés.length >= 2);
  assert.ok(res.result.detectedVagueQuantifiers.length >= 2);
  assert.ok(res.result.aiClichéScore < 80);
});

test('peerReviewEvaluationTool provides standard peer-review dimensions', async () => {
  const plugin = loadPlugin();
  const res = await plugin.peerReviewEvaluationTool({
    manuscript_text: 'In this paper we propose a novel transformer architecture with linear complexity...',
    discipline: 'Computer Science',
    review_type: 'standard_review',
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.reviewOverview.discipline, 'Computer Science');
  assert.ok(res.result.scoringRubric.methodologicalRigor);
  assert.ok(res.result.multiPerspectiveFeedback.devilsAdvocate);
});

test('rebuttalMatrixCoachTool structures reviewer critique into response matrix', async () => {
  const plugin = loadPlugin();
  const comments = `
    Point 1: The baseline comparison lacks comparison against BERT.
    Point 2: Please clarify the hyperparameters in Section 3.
  `;

  const res = await plugin.rebuttalMatrixCoachTool({ reviewer_comments: comments });
  assert.equal(res.ok, true);
  assert.equal(res.result.totalCritiquePoints, 2);
  assert.equal(res.result.responseMatrix[0].itemNumber, 1);
  assert.ok(res.result.responseMatrix[0].responseDraftTemplate);
});

test('authorDisclosureStatementTool creates CRediT and AI-assistance disclosures', async () => {
  const plugin = loadPlugin();
  const res = await plugin.authorDisclosureStatementTool({
    lead_author: 'Alice Smith',
    co_authors: ['Bob Jones'],
    ai_tools_used: ['Cindy Academic Skills (ARS-Codex)'],
    ai_tasks_performed: ['DOI citation verification', 'Style calibration'],
  });

  assert.equal(res.ok, true);
  assert.match(res.result.creditStatement, /Alice Smith: Conceptualization/);
  assert.match(res.result.generativeAiDisclosure, /ICMJE and COPE/);
  assert.ok(res.result.competingInterestsStatement);
});

test('pipelineStageOrchestratorTool manages 10-stage transitions', async () => {
  const plugin = loadPlugin();
  const res = await plugin.pipelineStageOrchestratorTool({
    current_stage: 'Stage_1_Research',
    research_topic: 'Multi-Agent Quality Assurance',
    completed_artifacts: ['RQ Brief'],
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.nextStage, 'Stage_2_Write');
  assert.equal(res.result.requiresHumanConfirmation, true);
  assert.ok(res.result.materialPassportStatus.hash);
});

test('bibtexFormatConverterTool outputs valid BibTeX and APA7', async () => {
  const plugin = loadPlugin();
  const res = await plugin.bibtexFormatConverterTool({
    title: 'Attention Is All You Need',
    authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
    year: 2017,
    journal: 'NeurIPS',
    doi: '10.5555/3295222.3295349',
  });

  assert.equal(res.ok, true);
  assert.match(res.result.bibtex, /@article\{vaswani2017/);
  assert.match(res.result.apa7, /Vaswani, Ashish, Shazeer, Noam \(2017\)\. Attention Is All You Need/);
});
