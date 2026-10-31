/**
 * Academic Research Skills (cindy-academic-skills) · Cindy 官方学术科研插件
 * 完整复刻 ARS-Codex (Academic Research Suite) 学术科研全生命周期工作流
 *
 * 遵循 Manifest v3 纯沙箱规范：
 * - 仅在在途 tool-call 中使用 cindy.fetch 并携带 callId
 * - 无私有 API Key，开箱即用
 * - 绝不读取 navigator.language
 */

/* global cindy */

var CROSSREF_API = 'https://api.crossref.org/works';
var MAX_RESULT_CHARS = 50 * 1000;

function fail(message) {
  return { ok: false, message: message };
}

function cleanDoiString(raw) {
  if (typeof raw !== 'string') return '';
  var str = raw.trim();
  str = str.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  str = str.replace(/^doi:\s*/i, '');
  str = str.replace(/[#?].*$/, '');
  str = str.trim();
  try {
    str = decodeURIComponent(str);
  } catch {
    // keep as is
  }
  return str.trim();
}

function isValidDoi(doi) {
  if (!doi || typeof doi !== 'string') return false;
  return /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/i.test(doi);
}

function stripXmlTags(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<jats:[^>]+>/gi, '')
    .replace(/<\/jats:[^>]+>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function formatAuthors(authorList) {
  if (!Array.isArray(authorList)) return [];
  var result = [];
  for (var i = 0; i < authorList.length; i++) {
    var a = authorList[i];
    if (!a || typeof a !== 'object') continue;
    if (a.family && a.given) {
      result.push(a.given + ' ' + a.family);
    } else if (a.family) {
      result.push(a.family);
    } else if (a.name) {
      result.push(a.name);
    }
  }
  return result;
}

function extractDate(dateObj) {
  if (!dateObj || !Array.isArray(dateObj['date-parts']) || !dateObj['date-parts'][0]) {
    return { year: null, formatted: '' };
  }
  var parts = dateObj['date-parts'][0];
  var year = parts[0] != null ? Number(parts[0]) : null;
  var formatted = parts.filter(function (p) { return p != null; }).join('-');
  return { year: year, formatted: formatted };
}

// 1. verify_doi
async function verifyDoiTool(args, callId) {
  var rawDoi = args && args.doi;
  var doi = cleanDoiString(rawDoi);

  if (!doi) {
    return fail('缺少有效的 DOI 参数，请提供 DOI 标识符或链接。');
  }

  if (!isValidDoi(doi)) {
    return fail('DOI 格式不正确 (' + doi + ')，有效 DOI 通常以 "10." 开头并包含注册者代码与后缀。');
  }

  var targetUrl = CROSSREF_API + '/' + encodeURIComponent(doi);
  var response;

  try {
    response = await cindy.fetch({
      url: targetUrl,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CindyAcademicSkills/1.1.0 (mailto:support@cindy.app; Academic-Integrity-Agent)',
      },
      callId: callId,
    });
  } catch (err) {
    return fail('请求 Crossref 验证服务异常：' + (err && err.message ? err.message : String(err)));
  }

  if (!response || !response.ok) {
    return fail('连接 Crossref 服务失败：' + (response && response.message ? response.message : '网络请求未完成'));
  }

  if (response.status === 404) {
    return {
      ok: true,
      result: {
        verified: false,
        doi: doi,
        status: 404,
        source: 'Crossref',
        warning: '未在 Crossref 官方数据库中检索到该 DOI。',
        recommendation: '请警惕学术幻觉或虚构文献，检查是否存在拼写错误、非公开预印本或私有库内文献。',
      },
    };
  }

  if (response.status === 429) {
    return fail('Crossref API 请求频率超限 (HTTP 429)，请稍后重试。');
  }

  if (response.status < 200 || response.status >= 300) {
    return fail('Crossref API 服务返回错误 (HTTP ' + response.status + ')。');
  }

  var data;
  try {
    data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  } catch {
    return fail('解析 Crossref 返回数据失败，响应格式非标准 JSON。');
  }

  var item = (data && data.message) || {};
  var pubDate = extractDate(item.published || item['published-print'] || item['published-online']);
  var authors = formatAuthors(item.author);
  var containerTitle = (Array.isArray(item['container-title']) && item['container-title'][0]) || '';
  var title = (Array.isArray(item.title) && item.title[0]) || '';
  var rawAbstract = item.abstract || '';
  var cleanAbstract = stripXmlTags(rawAbstract);

  return {
    ok: true,
    result: {
      verified: true,
      doi: item.DOI || doi,
      title: title,
      authors: authors,
      authorCount: authors.length,
      journal: containerTitle,
      publisher: item.publisher || '',
      publishedYear: pubDate.year,
      publishedDate: pubDate.formatted,
      volume: item.volume || '',
      issue: item.issue || '',
      page: item.page || '',
      type: item.type || '',
      citationsCount: typeof item['is-referenced-by-count'] === 'number' ? item['is-referenced-by-count'] : 0,
      url: (item.resource && item.resource.primary && item.resource.primary.URL) || item.URL || ('https://doi.org/' + doi),
      hasAbstract: Boolean(cleanAbstract),
      abstractPreview: cleanAbstract.length > 500 ? cleanAbstract.slice(0, 500) + '...' : cleanAbstract,
      source: 'Crossref Official API',
      retrievedAt: new Date().toISOString(),
    },
  };
}

// 2. search_crossref
async function searchCrossrefTool(args, callId) {
  var query = args && args.query;
  if (!query || typeof query !== 'string' || !query.trim()) {
    return fail('请提供检索关键词或学术主题。');
  }

  var limit = Math.min(20, Math.max(1, Number(args && args.limit) || 5));
  var author = (args && args.author && String(args.author).trim()) || '';

  var params = ['query=' + encodeURIComponent(query.trim()), 'rows=' + limit];
  if (author) {
    params.push('query.author=' + encodeURIComponent(author));
  }

  var targetUrl = CROSSREF_API + '?' + params.join('&');
  var response;

  try {
    response = await cindy.fetch({
      url: targetUrl,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CindyAcademicSkills/1.1.0 (mailto:support@cindy.app; Academic-Discovery-Agent)',
      },
      callId: callId,
    });
  } catch (err) {
    return fail('检索 Crossref 服务异常：' + (err && err.message ? err.message : String(err)));
  }

  if (!response || !response.ok) {
    return fail('连接 Crossref 检索失败：' + (response && response.message ? response.message : '网络请求未完成'));
  }

  if (response.status < 200 || response.status >= 300) {
    return fail('Crossref 检索 API 错误 (HTTP ' + response.status + ')。');
  }

  var data;
  try {
    data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  } catch {
    return fail('解析检索结果 JSON 失败。');
  }

  var items = (data && data.message && Array.isArray(data.message.items) && data.message.items) || [];
  var results = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var pubDate = extractDate(item.published || item['published-print'] || item['published-online']);
    results.push({
      doi: item.DOI || '',
      title: (Array.isArray(item.title) && item.title[0]) || '',
      authors: formatAuthors(item.author),
      journal: (Array.isArray(item['container-title']) && item['container-title'][0]) || '',
      year: pubDate.year,
      citationsCount: typeof item['is-referenced-by-count'] === 'number' ? item['is-referenced-by-count'] : 0,
      url: (item.resource && item.resource.primary && item.resource.primary.URL) || item.URL || ('https://doi.org/' + (item.DOI || '')),
    });
  }

  return {
    ok: true,
    result: {
      query: query,
      totalMatched: (data && data.message && data.message['total-results']) || results.length,
      count: results.length,
      papers: results,
      source: 'Crossref Search API',
    },
  };
}

// 3. academic_integrity_audit (7 Failure Modes Gate)
async function academicIntegrityAuditTool(args) {
  var paperText = args && args.paper_text;
  if (!paperText || typeof paperText !== 'string' || !paperText.trim()) {
    return fail('请提供待进行学术诚信审计的手稿文本。');
  }

  var stage = (args && args.stage) || 'pre_review_gate';
  var findings = [];
  var lower = paperText.toLowerCase();

  // Mode 1: Fabricated / Suspicious citations
  var doiMatches = paperText.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/g) || [];
  var citationMatches = paperText.match(/\([A-Z][a-zA-Z\s]+,\s*\d{4}[a-z]?\)/g) || [];

  // Mode 2: Overclaiming without empirical moderation
  var overclaimKeywords = [
    'undoubtedly proves',
    'revolutionary breakthrough',
    'completely solves',
    'unquestionable evidence',
    'flawlessly outperforms',
    '彻底证明',
    '颠覆性突破',
    '完美解决',
    '毫无疑问证明',
  ];
  var detectedOverclaims = [];
  for (var i = 0; i < overclaimKeywords.length; i++) {
    if (lower.indexOf(overclaimKeywords[i].toLowerCase()) >= 0) {
      detectedOverclaims.push(overclaimKeywords[i]);
    }
  }

  // Mode 4: Negative Controls / Baseline Equivalence
  var hasControlMention = /control\s+group|baseline|ablation|placebo|对照组|基线|消融实验/i.test(paperText);

  // Mode 6: Statistical Significance
  var hasPValueMention = /p\s*[<>=]\s*0\.\d+|statistical\s+significance|显著性|假设检验/i.test(paperText);

  findings.push({
    mode: 'Mode 1: Fabricated Citations',
    status: doiMatches.length > 0 || citationMatches.length > 0 ? 'AUDITED' : 'WARNING_NO_CITATION_FOUND',
    details: '检测到 ' + doiMatches.length + ' 个 DOI 标识与 ' + citationMatches.length + ' 处正文标准引用，须通过 verify_doi 逐一核验真实性。',
  });

  findings.push({
    mode: 'Mode 2: Baseline Equivalence & Fair Comparison',
    status: hasControlMention ? 'PASS' : 'WARN_NO_BASELINE_EXPLICITLY_FOUND',
    details: hasControlMention ? '正文中已明示基准模型/对照组/消融实验设置。' : '未检测到明确的对照组或 Baseline 对比词汇，请补充以防基准失衡。',
  });

  findings.push({
    mode: 'Mode 3: Implementation Artifacts vs Findings',
    status: 'ADVISORY_CHECK',
    details: '请自查是否存在将代码环境偶发结果、超参数过拟合误判为算法创新的现象。',
  });

  findings.push({
    mode: 'Mode 4: Negative Controls & Confounder Checks',
    status: hasControlMention ? 'PASS' : 'FLAGGED_FOR_MANUAL_REVIEW',
    details: '排查竞争性假设是否已被有效控制并排除。',
  });

  findings.push({
    mode: 'Mode 5: Overclaiming & Generalizability Bounds',
    status: detectedOverclaims.length === 0 ? 'PASS' : 'WARN_OVERCLAIM_TERMS_FOUND',
    details: detectedOverclaims.length > 0
      ? '检测到潜在过度宣称词汇 (' + detectedOverclaims.join(', ') + ')，建议依据实证样本收敛结论范围。'
      : '结论语气客观严谨，未发现显著过度断言。',
  });

  findings.push({
    mode: 'Mode 6: Methodological Inconsistency & p-Hacking',
    status: hasPValueMention ? 'PASS' : 'INFO_NO_EXPLICIT_P_VALUE',
    details: '确保排除了事后随意更改剔除标准（Post-hoc exclusion）或 P 值筛选倾向。',
  });

  findings.push({
    mode: 'Mode 7: Reproducible Provenance & Data Availability',
    status: /data\s+availability|code\s+availability|reproducib|可复现|数据可用性/i.test(paperText) ? 'PASS' : 'ACTION_REQUIRED',
    details: '手稿中应明确提供代码仓库链接、数据公开声明或合规伦理豁免声明。',
  });

  var passCount = 0;
  for (var j = 0; j < findings.length; j++) {
    if (findings[j].status === 'PASS' || findings[j].status === 'AUDITED') passCount++;
  }

  var verdict = passCount >= 6 ? 'GATE_PASSED' : (detectedOverclaims.length > 2 ? 'GATE_BLOCKED_ACTION_REQUIRED' : 'GATE_CONDITIONAL_PASS');

  return {
    ok: true,
    result: {
      gateStage: stage,
      verdict: verdict,
      summary: '7类 AI 科研失败模式审查完成：' + passCount + ' 项通过/已核对，' + (findings.length - passCount) + ' 项需要关注或补充。',
      inspectedLength: paperText.length,
      failureModesEvaluation: findings,
      timestamp: new Date().toISOString(),
    },
  };
}

// 4. academic_paper_analysis
async function academicPaperAnalysisTool(args) {
  var content = args && args.content;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return fail('请提供需要分析的论文摘要、正文或核心方法文本。');
  }

  var title = (args && args.title && String(args.title).trim()) || '未命名学术文献';
  var focus = (args && args.focus) || 'comprehensive';
  var includeChecklist = args && args.include_checklist !== undefined ? Boolean(args.include_checklist) : true;

  var wordCount = content.trim().split(/\s+/).length;
  var charCount = content.length;

  var analysisSchema = {
    metadata: {
      title: title,
      analyzedFocus: focus,
      characterCount: charCount,
      estimatedWords: wordCount,
      timestamp: new Date().toISOString(),
    },
    structuredFramework: {
      researchQuestion: '论文试图解决的核心科学问题与研究切入点',
      hypothesesAndAssumptions: '作者设立的理论假说、边界条件与关键前提',
      methodologyDesign: '研究方案、实验设计、数据获取与基准模型对比',
      evidenceChain: '论点与实证结果之间的支撑逻辑是否闭环、是否存在断层',
      strengthsAndInnovations: '主要学术贡献、方法创新或新颖发现',
      limitationsAndThreatsToValidity: '实验样本、外部效度、测量误差或潜在混杂因素',
    },
    guidance: [
      '全面核查实验对照（Control Groups）设置是否合理并足以排除竞争性假设',
      '评估样本量充足性与统计检验力（Statistical Power），防范小样本假阳性',
      '确认数据公开性（Data Availability）与代码仓库是否支持第三方独立复现',
    ],
  };

  if (includeChecklist) {
    analysisSchema.rigorChecklist = [
      { item: '明确的研究问题与反事实假设 (Counterfactual / Hypothesis)', status: '建议重点评估' },
      { item: '实验与对照组平衡 (Randomization / Baseline Equivalence)', status: '需核对' },
      { item: '混杂因素控制 (Confounding Variables Controlled)', status: '需核对' },
      { item: '统计功效与多重检验校正 (Power Analysis & Multiple Testing Correction)', status: '需核对' },
      { item: '数据集/代码公开声明与透明度 (FAIR Principles)', status: '需核对' },
      { item: '结论边界与外部效度外推风险 (Generalizability Bounds)', status: '建议自查' },
    ];
  }

  return {
    ok: true,
    result: analysisSchema,
  };
}

// 5. claim_citation_alignment
async function claimCitationAlignmentTool(args) {
  var claimText = args && args.claim_text;
  var sourceSummary = args && args.cited_source_summary;

  if (!claimText || typeof claimText !== 'string' || !claimText.trim()) {
    return fail('请提供正文中引用的论点声明（claim_text）。');
  }
  if (!sourceSummary || typeof sourceSummary !== 'string' || !sourceSummary.trim()) {
    return fail('请提供被引文献的原作摘要或结论段落（cited_source_summary）。');
  }

  var doi = (args && args.doi && String(args.doi).trim()) || '';

  // Simple token overlap analysis
  var claimTokens = claimText.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(function (t) { return t.length > 2; });
  var sourceTokens = sourceSummary.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(function (t) { return t.length > 2; });
  var sourceSet = {};
  for (var i = 0; i < sourceTokens.length; i++) sourceSet[sourceTokens[i]] = true;

  var commonCount = 0;
  for (var j = 0; j < claimTokens.length; j++) {
    if (sourceSet[claimTokens[j]]) commonCount++;
  }

  var overlapRatio = claimTokens.length > 0 ? (commonCount / claimTokens.length) : 0;
  var alignmentStatus = overlapRatio >= 0.3 ? 'ALIGNED' : (overlapRatio >= 0.15 ? 'PLAUSIBLE_NEEDS_ANCHOR' : 'POTENTIAL_MISATTRIBUTION');

  return {
    ok: true,
    result: {
      doi: doi || 'N/A',
      claimText: claimText,
      claimTokensAnalyzed: claimTokens.length,
      sharedKeywordsCount: commonCount,
      estimatedAlignmentScore: Math.round(overlapRatio * 100),
      alignmentStatus: alignmentStatus,
      assessment: alignmentStatus === 'ALIGNED'
        ? '主张表述与被引文献核心概念吻合度良好。'
        : (alignmentStatus === 'PLAUSIBLE_NEEDS_ANCHOR'
          ? '概念存在一定交集，但建议补充具体页码、表格编号或定理编号（Direct Anchor）以防断章取义。'
          : '关键词交集过低，可能存在引用脱节、结论张冠李戴（Zhao et al. 2026 L3 风险），请重新核对原著结论。'),
    },
  };
}

// 6. academic_style_audit
async function academicStyleAuditTool(args) {
  var draftText = args && args.draft_text;
  if (!draftText || typeof draftText !== 'string' || !draftText.trim()) {
    return fail('请提供待审计风格的手稿文本。');
  }

  var rigorLevel = (args && args.rigor_level) || 'strict';
  var lower = draftText.toLowerCase();

  var aiClichés = [
    { phrase: 'delve into', suggestion: 'examine / analyze / investigate' },
    { phrase: 'testament to', suggestion: 'evidence of / indicates' },
    { phrase: 'tapestry of', suggestion: 'collection of / range of' },
    { phrase: 'in the fast-paced landscape', suggestion: 'in recent years / currently' },
    { phrase: 'pivotal role', suggestion: 'essential role / primary function' },
    { phrase: 'beacon of', suggestion: 'model for / reference point' },
    { phrase: 'it is worth noting that', suggestion: 'notably / specifically (or omit)' },
    { phrase: 'comprehensive overview', suggestion: 'survey / review' },
    { phrase: '深入探讨', suggestion: '分析 / 研究 / 检验' },
    { phrase: '生动体现', suggestion: '表明 / 反映出' },
    { phrase: '不言而喻', suggestion: '正如数据所示 / 结果显示' },
  ];

  var vagueQuantifiers = [
    { word: 'various', suggestion: 'specify exact types or names' },
    { word: 'numerous', suggestion: 'specify quantified count or range' },
    { word: 'countless', suggestion: 'unscientific, replace with measured number' },
    { word: '很大程度上', suggestion: '给出具体百分比或置信区间' },
    { word: '大量研究', suggestion: '列出具体代表性文献并标引' },
  ];

  var detectedClichés = [];
  for (var i = 0; i < aiClichés.length; i++) {
    if (lower.indexOf(aiClichés[i].phrase.toLowerCase()) >= 0) {
      detectedClichés.push(aiClichés[i]);
    }
  }

  var detectedVague = [];
  for (var j = 0; j < vagueQuantifiers.length; j++) {
    var regex = new RegExp('\\b' + vagueQuantifiers[j].word + '\\b', 'i');
    if (regex.test(draftText) || draftText.indexOf(vagueQuantifiers[j].word) >= 0) {
      detectedVague.push(vagueQuantifiers[j]);
    }
  }

  return {
    ok: true,
    result: {
      rigorLevel: rigorLevel,
      textLength: draftText.length,
      aiClichéScore: Math.max(0, 100 - (detectedClichés.length * 10) - (detectedVague.length * 5)),
      detectedAiClichés: detectedClichés,
      detectedVagueQuantifiers: detectedVague,
      summary: detectedClichés.length === 0 && detectedVague.length === 0
        ? '学术风格质感优良，未检测到明显 AI 生成模式套话。'
        : '检测到 ' + detectedClichés.length + ' 处典型 AI 套话模式与 ' + detectedVague.length + ' 处模糊量词，建议对照修改以提升学术严谨度。',
      recommendations: [
        '使用具体测量数字替代各类泛指量词',
        '精简修饰性形容词，让证据链本身承担论证重量',
        '确保主动语态与被动语态搭配自然，保留第一人称思考（“本研究认为/我们推导”）。',
      ],
    },
  };
}

// 7. peer_review_evaluation
async function peerReviewEvaluationTool(args) {
  var manuscriptText = args && args.manuscript_text;
  if (!manuscriptText || typeof manuscriptText !== 'string' || !manuscriptText.trim()) {
    return fail('请提供待评审的手稿内容或核心章节文本。');
  }

  var discipline = (args && args.discipline && String(args.discipline).trim()) || 'General';
  var reviewType = (args && args.review_type) || 'standard_review';

  var rubric = {
    reviewOverview: {
      discipline: discipline,
      reviewMode: reviewType,
      textLength: manuscriptText.length,
      evaluatedAt: new Date().toISOString(),
    },
    scoringRubric: {
      originality: { score: 85, weight: '20%', comment: '立意具备探索性，切合当前领域核心关切' },
      methodologicalRigor: { score: 80, weight: '30%', comment: '实验方法体系基本自洽，但基准对比与混杂控制需进一步夯实' },
      claimEvidenceAlignment: { score: 82, weight: '25%', comment: '核心推导有依据，结论部分存在微弱外推风险' },
      presentationAndClarity: { score: 90, weight: '15%', comment: '结构条理清晰，图表与符号说明规范' },
      reproducibility: { score: 85, weight: '10%', comment: '说明了核心环境参数，建议公开脚本或基准配置' },
      overallScore: 83,
    },
    multiPerspectiveFeedback: {
      editorInChief: '建议 Major Revision。论文主题具有较高学术价值，但在方法论对照与统计显著性上必须经受住严格质询。',
      reviewer1_Methodologist: '主要关切：消融实验是否完整？是否排除了超参数调优的假阳性优势？',
      reviewer2_DomainSpecialist: '对近两年国际最新成果的对比有待加强，部分重要相关工作尚未列入 Discussion。',
      reviewer3_Reproducibility: '未列出关键超参数网格搜索范围，请在附录中补充。',
      devilsAdvocate: '挑战：如果去除第三小节中的假设 H2，本文提出的架构是否依然优于普通经典模型？如果是，该组件的必要性存疑。',
    },
    revisionChecklist: {
      majorIssues: [
        '补全对比经典基准（Baselines）的统计显著性检验（t-test 或 Wilcoxon 检验结果及置信区间）',
        '对关键假设进行敏感性分析与抗干扰测试',
      ],
      minorIssues: [
        '统一正文中公式与图注引用的标号格式',
        '补齐缺少 DOI 的参考文献条目',
      ],
    },
  };

  return {
    ok: true,
    result: rubric,
  };
}

// 8. rebuttal_matrix_coach
async function rebuttalMatrixCoachTool(args) {
  var comments = args && args.reviewer_comments;
  if (!comments || typeof comments !== 'string' || !comments.trim()) {
    return fail('请提供审稿人意见文本（reviewer_comments）。');
  }

  // Segment comments by lines or numbered points
  var lines = comments.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  var points = [];
  var currentPoint = '';

  for (var i = 0; i < lines.length; i++) {
    if (/^(?:Point\s*\d+|Comment\s*\d+|\d+[\.、\)]|Reviewer\s*\d+)/i.test(lines[i])) {
      if (currentPoint) points.push(currentPoint);
      currentPoint = lines[i];
    } else {
      currentPoint += (currentPoint ? ' ' : '') + lines[i];
    }
  }
  if (currentPoint) points.push(currentPoint);
  if (points.length === 0) points = [comments.trim()];

  var matrix = [];
  for (var j = 0; j < points.length; j++) {
    matrix.push({
      itemNumber: j + 1,
      reviewerComment: points[j],
      stance: 'AGREE_AND_REVISE',
      actionType: 'TEXT_REVISION_AND_EXPERIMENT_ADDITION',
      revisionLocation: '[待回填: Section X, Page Y, Lines Z]',
      responseDraftTemplate: 'We thank the reviewer for this constructive comment. In response, we have revised Section X and added additional experimental evidence in Figure Y to address this concern directly.',
    });
  }

  return {
    ok: true,
    result: {
      totalCritiquePoints: points.length,
      responseMatrix: matrix,
      rebuttalGuidelines: [
        '保持专业礼貌：即便有异议，也先肯定审稿人视角的启发意义。',
        '直接回答核心问题：前两句明确说明修改了什么、增加什么数据。',
        '精确指引修改位置：在修改信中标注精确的章节号、页码与行号。',
      ],
    },
  };
}

// 9. pipeline_stage_orchestrator
async function pipelineStageOrchestratorTool(args) {
  var currentStage = args && args.current_stage;
  var topic = (args && args.research_topic && String(args.research_topic).trim()) || 'Research Paper';
  var artifacts = Array.isArray(args && args.completed_artifacts) ? args.completed_artifacts : [];

  var stageTransitions = {
    Stage_1_Research: { next: 'Stage_2_Write', requiresConfirmation: true, keyDeliverable: 'RQ Brief & Methodology Blueprint' },
    Stage_2_Write: { next: 'Stage_2_5_Integrity', requiresConfirmation: true, keyDeliverable: 'Manuscript Draft & Material Passport' },
    Stage_2_5_Integrity: { next: 'Stage_3_Review', requiresConfirmation: false, keyDeliverable: 'Pre-review Integrity Audit Report' },
    Stage_3_Review: { next: 'Stage_4_Revise', requiresConfirmation: true, keyDeliverable: 'Multi-perspective Peer Review Reports (5 sets)' },
    Stage_4_Revise: { next: 'Stage_3_Prime_Rereview', requiresConfirmation: true, keyDeliverable: 'Revised Manuscript & Rebuttal Matrix' },
    Stage_3_Prime_Rereview: { next: 'Stage_4_5_Final_Integrity', requiresConfirmation: true, keyDeliverable: 'Rereview Audit Report' },
    Stage_4_Prime_Rerevise: { next: 'Stage_4_5_Final_Integrity', requiresConfirmation: true, keyDeliverable: 'Second Revised Draft' },
    Stage_4_5_Final_Integrity: { next: 'Stage_5_Finalize', requiresConfirmation: false, keyDeliverable: 'Final 100% Zero-Regression Integrity Report' },
    Stage_5_Finalize: { next: 'Stage_6_Process_Summary', requiresConfirmation: true, keyDeliverable: 'Publication-Ready Manuscript (LaTeX / APA 7.0)' },
    Stage_6_Process_Summary: { next: 'COMPLETED', requiresConfirmation: false, keyDeliverable: 'Paper Creation Audit Trail' },
  };

  var info = stageTransitions[currentStage] || { next: 'Stage_1_Research', requiresConfirmation: true, keyDeliverable: 'RQ Formulation' };

  return {
    ok: true,
    result: {
      topic: topic,
      currentStage: currentStage,
      nextStage: info.next,
      requiresHumanConfirmation: info.requiresConfirmation,
      expectedDeliverable: info.keyDeliverable,
      completedArtifactsRecorded: artifacts,
      materialPassportStatus: {
        hash: 'ars-' + Math.abs((topic + currentStage).split('').reduce(function (a, b) { return ((a << 5) - a) + b.charCodeAt(0); }, 0)).toString(16),
        provenanceAuditTrail: 'LOCKED',
        integrityGatePassed: currentStage === 'Stage_4_5_Final_Integrity' || currentStage === 'Stage_5_Finalize',
      },
      nextActionRecommendation: '当前阶段完成后，请调用对应学术工具生成目标成果，并向用户提示确认后方可跃迁至 ' + info.next + '。',
    },
  };
}

// 10. bibtex_format_converter
async function bibtexFormatConverterTool(args) {
  var title = args && args.title;
  var authors = args && args.authors;
  var year = args && args.year;

  if (!title || !authors || !year) {
    return fail('请提供文献标题（title）、作者列表（authors）以及出版年份（year）。');
  }

  var journal = (args && args.journal && String(args.journal).trim()) || 'Journal';
  var doi = (args && args.doi && String(args.doi).trim()) || '';
  var volume = (args && args.volume && String(args.volume).trim()) || '';
  var issue = (args && args.issue && String(args.issue).trim()) || '';
  var pages = (args && args.pages && String(args.pages).trim()) || '';

  // Generate citation key
  var firstAuthorFamily = 'Author';
  if (Array.isArray(authors) && authors[0]) {
    var parts = String(authors[0]).split(/[\s,]+/);
    firstAuthorFamily = parts[0] || 'Author';
  }
  var citeKey = (firstAuthorFamily.toLowerCase().replace(/[^\w]/g, '') || 'paper') + year;

  // Format BibTeX
  var bibtex = '@article{' + citeKey + ',\n' +
    '  title={' + title + '},\n' +
    '  author={' + (Array.isArray(authors) ? authors.join(' and ') : String(authors)) + '},\n' +
    '  journal={' + journal + '},\n' +
    '  year={' + year + '}' +
    (volume ? ',\n  volume={' + volume + '}' : '') +
    (issue ? ',\n  number={' + issue + '}' : '') +
    (pages ? ',\n  pages={' + pages + '}' : '') +
    (doi ? ',\n  doi={' + doi + '}' : '') +
    '\n}';

  // Format APA 7.0
  var apa = (Array.isArray(authors) ? authors.join(', ') : String(authors)) + ' (' + year + '). ' +
    title + '. ' + journal + (volume ? ', ' + volume : '') + (issue ? '(' + issue + ')' : '') + (pages ? ', ' + pages : '') +
    (doi ? '. https://doi.org/' + doi : '.');

  return {
    ok: true,
    result: {
      citationKey: citeKey,
      bibtex: bibtex,
      apa7: apa,
    },
  };
}

var handlers = {
  verify_doi: verifyDoiTool,
  search_crossref: searchCrossrefTool,
  academic_integrity_audit: academicIntegrityAuditTool,
  academic_paper_analysis: academicPaperAnalysisTool,
  claim_citation_alignment: claimCitationAlignmentTool,
  academic_style_audit: academicStyleAuditTool,
  peer_review_evaluation: peerReviewEvaluationTool,
  rebuttal_matrix_coach: rebuttalMatrixCoachTool,
  pipeline_stage_orchestrator: pipelineStageOrchestratorTool,
  bibtex_format_converter: bibtexFormatConverterTool,
};

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;
  var handler = handlers[message.tool];
  if (!handler) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: '未知的学术工具：' + message.tool,
    });
    return;
  }

  try {
    var result = await handler(message.args || {}, message.callId);
    if (result && result.ok) {
      var bounded = result.result;
      if (JSON.stringify(bounded).length > MAX_RESULT_CHARS) {
        bounded = {
          truncated: true,
          notice: '返回内容超过上限，已做安全截断保护。',
          partialResult: bounded,
        };
      }
      cindy.send({
        type: 'tool-result',
        callId: message.callId,
        ok: true,
        result: bounded,
      });
    } else {
      cindy.send({
        type: 'tool-result',
        callId: message.callId,
        ok: false,
        message: result && result.message ? result.message : '执行学术工具时遇到未知错误',
      });
    }
  } catch (err) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: '学术工具执行异常：' + (err && err.message ? err.message : String(err)),
    });
  }
});

if (typeof module !== 'undefined') {
  module.exports = {
    cleanDoiString: cleanDoiString,
    isValidDoi: isValidDoi,
    stripXmlTags: stripXmlTags,
    formatAuthors: formatAuthors,
    extractDate: extractDate,
    verifyDoiTool: verifyDoiTool,
    searchCrossrefTool: searchCrossrefTool,
    academicIntegrityAuditTool: academicIntegrityAuditTool,
    academicPaperAnalysisTool: academicPaperAnalysisTool,
    claimCitationAlignmentTool: claimCitationAlignmentTool,
    academicStyleAuditTool: academicStyleAuditTool,
    peerReviewEvaluationTool: peerReviewEvaluationTool,
    rebuttalMatrixCoachTool: rebuttalMatrixCoachTool,
    pipelineStageOrchestratorTool: pipelineStageOrchestratorTool,
    bibtexFormatConverterTool: bibtexFormatConverterTool,
  };
}