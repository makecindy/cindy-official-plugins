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

test('manifest declares Manifest v3 and Crossref host with no credentials', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.id, 'cindy-academic-skills');
  assert.deepEqual(manifest.network.hosts, ['api.crossref.org']);
  assert.equal(manifest.network.secrets, undefined);
  assert.equal(manifest.network.connections, undefined);
  assert.equal(manifest.settingsHtml, undefined);
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.equal(manifest.minCindyVersion, '0.1.64');
  assert.equal(manifest.tools.length, 3);
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

test('academicPaperAnalysisTool produces structured framework and checklist', async () => {
  const plugin = loadPlugin();
  const res = await plugin.academicPaperAnalysisTool({
    title: 'Benchmarking Multi-Agent Systems',
    content: 'We present a rigorous evaluation framework for evaluating agent coordination...',
    focus: 'methodology',
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.metadata.title, 'Benchmarking Multi-Agent Systems');
  assert.ok(res.result.structuredFramework.methodologyDesign);
  assert.ok(Array.isArray(res.result.rigorChecklist));
  assert.equal(res.result.rigorChecklist.length, 6);
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
  assert.ok(res.result.evaluationDimensions.technicalSoundness);
  assert.ok(res.result.reviewTemplate.section3_MajorConcerns);
});
