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

test('manifest declares Manifest v3, 16 ARS tools and structured manual', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.id, 'cindy-academic-skills');
  assert.deepEqual(manifest.network.hosts, ['api.crossref.org']);
  assert.equal(manifest.network.secrets, undefined);
  assert.equal(manifest.network.connections, undefined);
  assert.equal(manifest.settingsHtml, undefined);
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.equal(manifest.minCindyVersion, '0.1.64');
  assert.equal(manifest.tools.length, 16);
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
  const samplePaper = `
    Introduction:
    Previous studies (Smith et al., 2024) explored transformer architectures (10.1038/s41586-020-2649-2).
    Methodology:
    We evaluated our model against three baseline models with randomized control group and negative control allocations.
    Train-test split was strictly isolated with no data leakage.
    Statistical significance was established at p < 0.01 (t(58) = 3.42, 95% CI [1.2, 4.5]).
    Limitations and boundary conditions of this study are discussed in Section 5.
    All code and data availability statements are included.
  `;

  // 1. Default mock returns empty message {} -> Mode 1 stays VERIFICATION_REQUIRED and verdict is conditional
  const pluginUnverified = loadPlugin();
  const resPending = await pluginUnverified.academicIntegrityAuditTool({ paper_text: samplePaper });
  assert.equal(resPending.ok, true);
  assert.equal(resPending.result.failureModesEvaluation.length, 7);
  assert.equal(resPending.result.verdict, 'GATE_CONDITIONAL_PENDING_VERIFICATION');

  // 2. When Crossref returns 404 for a non-existent DOI, verdict is GATE_BLOCKED_ACTION_REQUIRED
  const plugin404 = loadPlugin(async () => ({ ok: false, status: 404, body: 'Not Found' }));
  const resBlocked = await plugin404.academicIntegrityAuditTool({
    paper_text: samplePaper,
    implementation_verified: true,
  });
  assert.equal(resBlocked.ok, true);
  assert.equal(resBlocked.result.verdict, 'GATE_BLOCKED_ACTION_REQUIRED');

  // 3. When Crossref returns valid metadata and implementation_verified is true, all 7 modes PASS
  let capturedReq = null;
  const pluginVerified = loadPlugin(async (req) => {
    capturedReq = req;
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({
        message: {
          DOI: '10.1038/s41586-020-2649-2',
          title: ['Array programming with NumPy'],
        },
      }),
    };
  });
  const resPassed = await pluginVerified.academicIntegrityAuditTool(
    {
      paper_text: samplePaper,
      implementation_verified: true,
    },
    'call-audit-1',
  );
  assert.equal(resPassed.ok, true);
  assert.equal(capturedReq.callId, 'call-audit-1');
  assert.match(capturedReq.url, /10\.1038%2Fs41586-020-2649-2/);
  assert.equal(resPassed.result.allModesPassed, true);
  assert.equal(resPassed.result.verdict, 'GATE_PASSED');

  // 4. Cap DOI checking at 30 per call for manuscripts with many citations
  const manyDois = Array.from({ length: 35 }, (_, i) => `10.1038/s41586-020-${1000 + i}`).join(' ');
  const paperWithManyDois = samplePaper + '\n' + manyDois;
  let fetchCallCount = 0;
  const pluginCapped = loadPlugin(async () => {
    fetchCallCount++;
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({ message: { DOI: '10.1038/s41586-020-0000', title: ['Paper'] } }),
    };
  });
  const resCapped = await pluginCapped.academicIntegrityAuditTool({
    paper_text: paperWithManyDois,
    implementation_verified: true,
  });
  assert.equal(resCapped.ok, true);
  assert.equal(fetchCallCount, 30);
  assert.equal(resCapped.result.verdict, 'GATE_CONDITIONAL_PENDING_VERIFICATION');
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

  // Affirmative statement with 'novel' must not trigger false negation/contradiction
  const resAffirmative = await plugin.claimCitationAlignmentTool({
    claim_text: 'A novel treatment improves survival in clinical trials.',
    cited_source_summary: 'The treatment improves survival in clinical trials.',
    doi: '10.1038/s41586-020-0002',
  });
  assert.equal(resAffirmative.ok, true);
  assert.equal(resAffirmative.result.alignmentStatus, 'ALIGNED');
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
    ai_tools_used: ['Cindy Academic Research Suite (ARS)'],
    ai_tasks_performed: ['DOI citation verification', 'Style calibration'],
  });

  assert.equal(res.ok, true);
  assert.match(res.result.creditStatement, /Alice Smith: Conceptualization/);
  assert.match(res.result.generativeAiDisclosure, /ICMJE and COPE/);
  assert.ok(res.result.competingInterestsStatement);
});

test('pipelineStageOrchestratorTool manages 10-stage transitions and enforces integrity/review gates', async () => {
  const plugin = loadPlugin();
  const res1 = await plugin.pipelineStageOrchestratorTool({
    current_stage: 'Stage_1_Research',
    research_topic: 'Multi-Agent Quality Assurance',
    completed_artifacts: ['RQ Brief'],
  });

  assert.equal(res1.ok, true);
  assert.equal(res1.result.nextStage, 'Stage_1_5_DataAnalysis');
  assert.equal(res1.result.requiresHumanConfirmation, true);
  assert.equal(res1.result.materialPassportStatus.provenanceAuditTrail, 'LOCKED');
  assert.ok(res1.result.materialPassportStatus.hash);

  // Without completed_artifacts or manuscript, Material Passport stays UNLOCKED_PENDING_MATERIAL with null hash
  const resEmpty = await plugin.pipelineStageOrchestratorTool({
    current_stage: 'Stage_1_Research',
    research_topic: 'Multi-Agent Quality Assurance',
  });
  assert.equal(resEmpty.result.materialPassportStatus.provenanceAuditTrail, 'UNLOCKED_PENDING_MATERIAL');
  assert.equal(resEmpty.result.materialPassportStatus.hash, null);

  // Changing manuscript_content produces distinct Material Passport hashes
  const resDraftV1 = await plugin.pipelineStageOrchestratorTool({
    current_stage: 'Stage_2_Write',
    research_topic: 'Multi-Agent Quality Assurance',
    manuscript_content: 'Draft version 1 with initial results.',
  });
  const resDraftV2 = await plugin.pipelineStageOrchestratorTool({
    current_stage: 'Stage_2_Write',
    research_topic: 'Multi-Agent Quality Assurance',
    manuscript_content: 'Draft version 2 with updated statistical tables.',
  });
  assert.ok(resDraftV1.result.materialPassportStatus.hash);
  assert.notEqual(resDraftV1.result.materialPassportStatus.hash, resDraftV2.result.materialPassportStatus.hash);

  // Stage_2_5_Integrity holds when integrity_audit_passed is omitted, advances only when true
  const resHold = await plugin.pipelineStageOrchestratorTool({
    current_stage: 'Stage_2_5_Integrity',
    research_topic: 'Multi-Agent Quality Assurance',
  });
  assert.equal(resHold.result.nextStage, 'Stage_2_5_Integrity');
  assert.equal(resHold.result.materialPassportStatus.integrityGatePassed, false);

  const resPass = await plugin.pipelineStageOrchestratorTool({
    current_stage: 'Stage_2_5_Integrity',
    research_topic: 'Multi-Agent Quality Assurance',
    integrity_audit_passed: true,
    completed_artifacts: ['Integrity Audit Pass'],
  });
  assert.equal(resPass.result.nextStage, 'Stage_3_Review');
  assert.equal(resPass.result.materialPassportStatus.integrityGatePassed, true);

  // Stage_3_Review with accept advances directly to Stage_4_5_Final_Integrity
  const resAccept = await plugin.pipelineStageOrchestratorTool({
    current_stage: 'Stage_3_Review',
    research_topic: 'Multi-Agent Quality Assurance',
    review_decision: 'accept',
    completed_artifacts: ['Review Report'],
  });
  assert.equal(resAccept.result.nextStage, 'Stage_4_5_Final_Integrity');
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
  assert.match(res.result.apa7, /Vaswani, A\., & Shazeer, N\. \(2017\)\. Attention Is All You Need/);
});

test('statisticalAnalysisAdvisorTool recommends optimal models and assumption checks', async () => {
  const plugin = loadPlugin();
  const res = await plugin.statisticalAnalysisAdvisorTool({
    research_question: 'Does the intervention significantly improve test scores compared to control?',
    design_type: 'two_groups_independent',
    outcome_type: 'continuous',
    variance_homogeneity_satisfied: false,
    multiple_comparisons_count: 5,
  });

  assert.equal(res.ok, true);
  assert.match(res.result.primaryModel, /Welch's Independent Samples t-test/);
  assert.match(res.result.remedialModel, /Mann-Whitney U/);
  assert.equal(res.result.multipleComparisonsAdjustment.totalComparisons, 5);
  assert.match(res.result.multipleComparisonsAdjustment.recommendedMethod, /Benjamini-Hochberg/);
  assert.ok(res.result.replicationIntegrityNotice);

  // When normality_satisfied is false, switches primaryModel to non-parametric test
  const resNonNormal = await plugin.statisticalAnalysisAdvisorTool({
    research_question: 'Does the intervention improve skewed recovery time?',
    design_type: 'multi_groups_independent',
    outcome_type: 'continuous',
    normality_satisfied: false,
  });
  assert.equal(resNonNormal.ok, true);
  assert.match(resNonNormal.result.primaryModel, /Kruskal-Wallis H test/);

  // Contradictory design and outcome returns fail
  const resInvalid = await plugin.statisticalAnalysisAdvisorTool({
    research_question: 'Invalid combination check',
    design_type: 'categorical_proportions',
    outcome_type: 'continuous',
  });
  assert.equal(resInvalid.ok, false);
});

test('academicDataSummaryTool formats APA7 sentences and three-line tables', async () => {
  const plugin = loadPlugin();
  const res = await plugin.academicDataSummaryTool({
    test_type: 'independent_t',
    test_statistic: 5.92,
    df: '58',
    p_value: 0.0003,
    effect_size_type: 'cohens_d',
    effect_size_value: 1.53,
    ci_95: [10.81, 15.79],
    comparison_label: '干预组后测得分',
    group_descriptives: [
      { name: 'Control', mean: 65.10, sd: 9.10, n: 30 },
      { name: 'Intervention', mean: 78.40, sd: 8.25, n: 30 },
    ],
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.apaFormattedString, 't(58) = 5.92, p < .001, d = 1.53, 95% CI [10.81, 15.79]');
  assert.match(res.result.threeLineTableMarkdown, /Group \/ Condition/);
  assert.match(res.result.threeLineTableMarkdown, /Intervention/);
  assert.equal(res.result.compactLetterDisplay[0].name, 'Intervention'); // highest mean ranked first
  assert.equal(res.result.compactLetterDisplay[0].cld_letter, 'a');
  assert.equal(res.result.compactLetterDisplay[1].name, 'Control');
  assert.equal(res.result.compactLetterDisplay[1].cld_letter, 'b');
  assert.equal(res.result.natureReportingGuidelineCheck.effectSizePresent, true);
  assert.equal(res.result.natureReportingGuidelineCheck.confidenceIntervalPresent, true);
  assert.equal(res.result.natureReportingGuidelineCheck.cldDescendingOrderVerified, true);

  // For >2 groups with pairwise_comparisons, computes exact CLD letters ('a', 'b', 'c')
  const res3Groups = await plugin.academicDataSummaryTool({
    test_type: 'one_way_anova',
    test_statistic: 18.4,
    df: '2, 87',
    p_value: 0.0001,
    multiple_comparison_method: 'tukey_hsd',
    group_descriptives: [
      { name: 'HighDose', mean: 85.0, sd: 5.0, n: 30 },
      { name: 'LowDose', mean: 72.0, sd: 5.5, n: 30 },
      { name: 'Control', mean: 60.0, sd: 6.0, n: 30 },
    ],
    pairwise_comparisons: [
      { group1: 'HighDose', group2: 'LowDose', p_adj: 0.002 },
      { group1: 'HighDose', group2: 'Control', p_adj: 0.0001 },
      { group1: 'LowDose', group2: 'Control', p_adj: 0.004 },
    ],
  });
  assert.equal(res3Groups.ok, true);
  assert.deepEqual(
    res3Groups.result.compactLetterDisplay.map((x) => x.cld_letter),
    ['a', 'b', 'c'],
  );
});

test('scientificFigureDesignerTool plans multi-panel layouts and generates plot scripts', async () => {
  const plugin = loadPlugin();

  // Test Python Matplotlib single-panel violin_box_jitter with bilingual mode
  const resPy = await plugin.scientificFigureDesignerTool({
    main_scientific_claim: 'Targeted inhibition of Protein X reverses cognitive decline in mouse models',
    target_journal: 'Nature',
    plot_archetype: 'violin_box_jitter',
    backend: 'python_matplotlib',
    column_width: 'double_column_180mm',
    bilingual_mode: 'dual_bilingual',
    x_label: 'Treatment Group',
    y_label: 'Cognitive Score',
  });

  assert.equal(resPy.ok, true);
  assert.equal(resPy.result.targetJournal, 'Nature');
  assert.equal(resPy.result.layoutSpecifications.physicalWidthMm, 180);
  assert.equal(resPy.result.multipanelArchitecture.length, 1);
  assert.equal(resPy.result.bilingualModeConfig.activeMode, 'dual_bilingual');
  assert.ok(resPy.result.dpiAndTypographySafeguards);
  assert.match(resPy.result.dpiAndTypographySafeguards.dpiConflictMechanism, /plt\.figure/);
  assert.match(resPy.result.dpiAndTypographySafeguards.themeResetTrap, /sns\.set_theme/);
  assert.match(resPy.result.figureCaptionTemplate, /Fig\. 1 \| Targeted inhibition/);
  assert.match(resPy.result.generatedPlotScript, /sns\.set_theme\(style="ticks"\)/);
  assert.match(resPy.result.generatedPlotScript, /plt\.rcParams\["axes\.unicode_minus"\] = False/);
  assert.match(resPy.result.generatedPlotScript, /plt\.rcParams\["pdf\.fonttype"\] = 42/);
  assert.match(resPy.result.generatedPlotScript, /OKABE_ITO/);

  // Test R ggplot2 generation for multi_panel_composite (4 panels)
  const resR = await plugin.scientificFigureDesignerTool({
    main_scientific_claim: 'Targeted inhibition of Protein X reverses cognitive decline in mouse models',
    target_journal: 'Nature',
    plot_archetype: 'multi_panel_composite',
    backend: 'r_ggplot2',
    column_width: 'single_column_89mm',
  });

  assert.equal(resR.ok, true);
  assert.equal(resR.result.layoutSpecifications.physicalWidthMm, 89);
  assert.equal(resR.result.multipanelArchitecture.length, 4);
  assert.match(resR.result.generatedPlotScript, /library\(ggplot2\)/);
  assert.match(resR.result.generatedPlotScript, /plot_annotation\(tag_levels = "a"\)/);
  assert.match(resR.result.generatedPlotScript, /cairo_pdf/);

  // Test planning_only mode
  const resPlan = await plugin.scientificFigureDesignerTool({
    main_scientific_claim: 'Targeted inhibition of Protein X reverses cognitive decline in mouse models',
    target_journal: 'Science',
    plot_archetype: 'multi_panel_composite',
    backend: 'planning_only',
  });

  assert.equal(resPlan.ok, true);
  assert.equal(resPlan.result.multipanelArchitecture.length, 4);
  assert.equal(resPlan.result.generatedPlotScript, null);
  assert.equal(resPlan.result.natureChecklistPassed.individualDataPointsShown, true);
});

test('enforceResultLimit recursively truncates nested payloads within maxChars', () => {
  const plugin = loadPlugin();
  const nestedHuge = {
    meta: {
      deepText: 'A'.repeat(25000),
      deepArray: Array.from({ length: 30 }, (_, i) => ({ idx: i, body: 'B'.repeat(2000) })),
    },
  };
  const bounded = plugin.enforceResultLimit(nestedHuge, 8000);
  assert.equal(bounded.truncated, true);
  assert.ok(JSON.stringify(bounded).length <= 8000);
});
