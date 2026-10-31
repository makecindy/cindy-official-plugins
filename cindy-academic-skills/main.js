/**
 * Academic Research Suite (cindy-academic-skills) · Cindy 社区学术科研与出版工作流插件
 * 端到端学术科研、实证数据分析、顶刊科学绘图、论文撰写与同行评审全流程套件
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
  str = str.replace(/[.,;:\]}>]+$/, '');
  if (str.endsWith(')') && str.indexOf('(') < 0) {
    str = str.replace(/\)+$/, '').replace(/[.,;:\]}>]+$/, '');
  }
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

function formatAuthorsApa7(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return String(authors || '');
  var formatted = authors.map(function (authorStr) {
    var raw = String(authorStr).trim();
    if (raw.indexOf(',') >= 0) {
      var parts = raw.split(',');
      var last = parts[0].trim();
      var firsts = parts.slice(1).join(' ').trim().split(/\s+/).filter(Boolean);
      var initials = firsts.map(function (f) { return f[0].toUpperCase() + '.'; }).join(' ');
      return initials ? (last + ', ' + initials) : last;
    } else {
      var tokens = raw.split(/\s+/).filter(Boolean);
      if (tokens.length <= 1) return raw;
      var last = tokens[tokens.length - 1];
      var firsts = tokens.slice(0, tokens.length - 1);
      var initials = firsts.map(function (f) { return f[0].toUpperCase() + '.'; }).join(' ');
      return last + ', ' + initials;
    }
  });

  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return formatted[0] + ', & ' + formatted[1];
  return formatted.slice(0, formatted.length - 1).join(', ') + ', & ' + formatted[formatted.length - 1];
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

function escapeCodeString(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function getStudentTCriticalValue(df) {
  if (df <= 0) return 1.96;
  var tTable = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    25: 2.060, 30: 2.042, 40: 2.021, 60: 2.000, 120: 1.980
  };
  if (tTable[df]) return tTable[df];
  if (df > 120) return 1.96;
  var keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25, 30, 40, 60, 120];
  for (var i = 0; i < keys.length - 1; i++) {
    if (df >= keys[i] && df <= keys[i + 1]) {
      var ratio = (df - keys[i]) / (keys[i + 1] - keys[i]);
      return Number((tTable[keys[i]] - ratio * (tTable[keys[i]] - tTable[keys[i + 1]])).toFixed(3));
    }
  }
  return 1.96;
}

function formatCrossrefHttpError(status, contextLabel) {
  if (status === 400 || status === 422) {
    return contextLabel + '请求参数无效 (HTTP ' + status + ')：请检查输入的 DOI 或检索关键词是否包含非法字符，修正参数后重试。';
  }
  if (status === 401 || status === 403) {
    return contextLabel + '被拒绝访问 (HTTP ' + status + ')：请检查本地网络代理、防火墙或 User-Agent 配置后重试。';
  }
  if (status === 429) {
    return contextLabel + '触发 Crossref 速率限制 (HTTP 429)：请等待 15-30 秒后重试，并降低并发调用频率。';
  }
  if (status >= 500) {
    return contextLabel + '遇到 Crossref 上游服务暂时不可用 (HTTP ' + status + ')：此为远端服务器故障而非输入错误，请稍后重试。';
  }
  return contextLabel + '返回异常状态 (HTTP ' + status + ')：请核对输入参数并稍后重试。';
}

function computeContentHash(text) {
  var h1 = 0xdeadbeef ^ text.length;
  var h2 = 0x41c6ce57 ^ text.length;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// 1. pipeline_stage_orchestrator
async function pipelineStageOrchestratorTool(args) {
  var currentStage = args && args.current_stage;
  var topic = (args && args.research_topic && String(args.research_topic).trim()) || 'Research Paper';
  var artifacts = Array.isArray(args && args.completed_artifacts) ? args.completed_artifacts.filter(Boolean) : [];
  var rawManuscript = (args && (args.manuscript_content || args.manuscript_excerpt)) || '';
  var manuscript = String(rawManuscript).trim();
  var reviewDecision = args && args.review_decision ? String(args.review_decision).toLowerCase().trim() : null;
  var auditPassed = typeof (args && args.integrity_audit_passed) === 'boolean' ? args.integrity_audit_passed : null;

  var stageTransitions = {
    Stage_1_Research: { next: 'Stage_1_5_DataAnalysis', requiresConfirmation: true, keyDeliverable: 'RQ Brief & Methodology Blueprint' },
    Stage_1_5_DataAnalysis: { next: 'Stage_1_8_FigureDesign', requiresConfirmation: true, keyDeliverable: 'Empirical Data Analysis Report & Three-line Statistical Tables' },
    Stage_1_8_FigureDesign: { next: 'Stage_2_Write', requiresConfirmation: true, keyDeliverable: 'Multi-panel Scientific Figures & Plot Scripts (300+ DPI)' },
    Stage_2_Write: { next: 'Stage_2_5_Integrity', requiresConfirmation: true, keyDeliverable: 'Manuscript Draft & Material Passport' },
    Stage_2_5_Integrity: { next: 'Stage_2_5_Integrity', requiresConfirmation: true, keyDeliverable: 'Pre-review Integrity Audit Report' },
    Stage_3_Review: { next: 'Stage_3_Review', requiresConfirmation: true, keyDeliverable: 'Multi-perspective Peer Review Reports (5 sets)' },
    Stage_4_Revise: { next: 'Stage_3_Prime_Rereview', requiresConfirmation: true, keyDeliverable: 'Revised Manuscript & Rebuttal Matrix' },
    Stage_3_Prime_Rereview: { next: 'Stage_3_Prime_Rereview', requiresConfirmation: true, keyDeliverable: 'Rereview Audit Report' },
    Stage_4_Prime_Rerevise: { next: 'Stage_3_Prime_Rereview', requiresConfirmation: true, keyDeliverable: 'Second Revised Draft' },
    Stage_4_5_Final_Integrity: { next: 'Stage_4_5_Final_Integrity', requiresConfirmation: true, keyDeliverable: 'Final 100% Zero-Regression Integrity Report' },
    Stage_5_Finalize: { next: 'Stage_6_Process_Summary', requiresConfirmation: true, keyDeliverable: 'Publication-Ready Manuscript (LaTeX / APA 7.0)' },
    Stage_6_Process_Summary: { next: 'COMPLETED', requiresConfirmation: false, keyDeliverable: 'Paper Creation Audit Trail' },
  };

  if (!currentStage || !stageTransitions[currentStage]) {
    return fail('无效的阶段名称: ' + String(currentStage) + '。请提供合法的 current_stage 枚举值。');
  }

  var info = stageTransitions[currentStage];
  var effectiveNext = info.next;
  var actionRec = '当前阶段完成后，请调用对应学术工具生成目标成果，并向用户提示确认后方可跃迁至 ' + effectiveNext + '。';

  // Outcome-driven stage transitions
  if (currentStage === 'Stage_3_Review') {
    if (reviewDecision === 'accept') {
      effectiveNext = 'Stage_4_5_Final_Integrity';
      actionRec = '同行评审决议为直接录用 (Accept)，跳过返修阶段，直接进入 Stage_4_5_Final_Integrity 执行终审零回归诚信门禁。';
    } else if (reviewDecision === 'major_revision' || reviewDecision === 'minor_revision') {
      effectiveNext = 'Stage_4_Revise';
      actionRec = '同行评审决议为返修 (' + reviewDecision + ')，请进入 Stage_4_Revise 阶段构建逐条答辩矩阵并修改手稿。';
    } else if (reviewDecision === 'reject') {
      effectiveNext = 'Stage_1_Research';
      actionRec = '同行评审决议为拒绝 (Reject)，建议重回 Stage_1_Research 系统性重构核心立论与实验设计。';
    } else {
      effectiveNext = 'Stage_3_Review';
      actionRec = '当前处于 Stage_3_Review，请先调用 peer_review_evaluation 获取审稿结论，并传入 review_decision (accept / minor_revision / major_revision / reject) 后再决定下一阶段。';
    }
  } else if (currentStage === 'Stage_3_Prime_Rereview') {
    if (reviewDecision === 'accept' || reviewDecision === 'minor_revision') {
      effectiveNext = 'Stage_4_5_Final_Integrity';
      actionRec = '再审通过 (' + reviewDecision + ')，请进入 Stage_4_5_Final_Integrity 执行终审零回归诚信核查。';
    } else if (reviewDecision === 'major_revision') {
      effectiveNext = 'Stage_4_Prime_Rerevise';
      actionRec = '二审决定仍需较大幅度修改 (Major Revision)，请跃迁至 Stage_4_Prime_Rerevise 继续补充实证与论述。';
    } else if (reviewDecision === 'reject') {
      effectiveNext = 'Stage_1_Research';
      actionRec = '二审决议为拒绝 (Reject)，请退回 Stage_1_Research 重新审视根本性立论。';
    } else {
      effectiveNext = 'Stage_3_Prime_Rereview';
      actionRec = '当前处于再审阶段，请传入再审决议 review_decision (accept / minor_revision / major_revision / reject) 以决定流转方向。';
    }
  } else if (currentStage === 'Stage_2_5_Integrity' || currentStage === 'Stage_4_5_Final_Integrity') {
    if (auditPassed === true) {
      effectiveNext = (currentStage === 'Stage_4_5_Final_Integrity') ? 'Stage_5_Finalize' : 'Stage_3_Review';
      actionRec = '学术诚信门禁核验通过，准予流转至 ' + effectiveNext + '。';
    } else if (auditPassed === false) {
      effectiveNext = (currentStage === 'Stage_4_5_Final_Integrity') ? 'Stage_4_Prime_Rerevise' : 'Stage_2_Write';
      actionRec = '学术诚信门禁未通过，已阻断流程跃迁，请退回 ' + effectiveNext + ' 修复未核验引用或方法学缺陷后重测。';
    } else {
      effectiveNext = currentStage;
      actionRec = '当前处于阻断式诚信门禁阶段 (' + currentStage + ')，必须先执行 academic_integrity_audit 并显式传入 integrity_audit_passed (true/false) 方可放行。';
    }
  }

  // Bind Material Passport strictly to actual material payload (not topic/stage name)
  var hasActualMaterial = Boolean(manuscript) || artifacts.length > 0;
  var materialPayload = JSON.stringify({
    manuscript: manuscript,
    artifacts: artifacts,
  });
  var hashVal = hasActualMaterial ? ('ars-' + computeContentHash(materialPayload)) : null;

  return {
    ok: true,
    result: {
      topic: topic,
      currentStage: currentStage,
      nextStage: effectiveNext,
      requiresHumanConfirmation: info.requiresConfirmation,
      expectedDeliverable: info.keyDeliverable,
      completedArtifactsRecorded: artifacts,
      materialPassportStatus: {
        hash: hashVal,
        contentBound: manuscript ? 'MANUSCRIPT_BOUND' : (artifacts.length > 0 ? 'ARTIFACTS_BOUND' : 'UNBOUND_NO_MATERIAL_PROVIDED'),
        provenanceAuditTrail: hasActualMaterial ? 'LOCKED' : 'UNLOCKED_PENDING_MATERIAL',
        integrityGatePassed: auditPassed === true,
      },
      nextActionRecommendation: actionRec,
    },
  };
}

// 2. socratic_research_guide
async function socraticResearchGuideTool(args) {
  var topic = args && args.topic;
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return fail('请提供初步研究主题或兴趣方向。');
  }

  var discipline = (args && args.target_discipline && String(args.target_discipline).trim()) || 'General / Interdisciplinary';
  var userContext = (args && args.user_context && String(args.user_context).trim()) || '';
  var topicClean = topic.trim();
  var combinedText = topicClean + ' ' + userContext;

  // Evidence-based FINER evaluation: only score dimensions supported by input evidence
  var wordCount = topicClean.split(/\s+/).length;
  var hasDatasetOrSample = /dataset|sample|cohort|n\s*=|experiment|survey|corpus|数据|样本|队列|实验|调查/i.test(combinedText);
  var hasComparisonOrGap = /vs\.?|versus|compared|gap|conflict|novel|however|对比|相比|缺口|冲突|未解/i.test(combinedText);
  var hasEthicsRisk = /patient|clinical|human|animal|mice|privacy|受试者|患者|临床|动物|隐私/i.test(combinedText);
  var hasEthicsApproval = /irb|iacuc|consent|anonymized|ethical approval|伦理批件|知情同意|脱敏/i.test(combinedText);

  var questions = [
    '【动机与缺口】在 "' + topicClean + '" 中，既有研究尚未解决的具体矛盾或经验盲区是什么？',
    '【操作化定义】你计划用什么可观测的定量指标（Outcome）来度量核心自变量的效应，以及如何设置基准对照（Control/Baseline）？',
    '【可证伪性自检】什么样的实证数据或反例一旦出现，就能够直接推翻（证伪）你的核心假说？',
  ];
  if (!hasDatasetOrSample) {
    questions.push('【可行性待核查】当前输入尚未说明数据来源、样本规模或实验条件，请补充可用数据集或实验平台信息。');
  }

  return {
    ok: true,
    result: {
      topicExploration: {
        rawTopic: topicClean,
        discipline: discipline,
        userContextProvided: Boolean(userContext),
        specificityLevel: (wordCount > 4 && hasDatasetOrSample) ? 'EVIDENCE_GROUNDED' : 'NEEDS_EMPIRICAL_SCOPING',
      },
      socraticProbingQuestions: questions,
      finerEvaluation: {
        feasible: hasDatasetOrSample
          ? { score: 85, rating: 'EVIDENCE_PROVIDED', note: '输入中已包含实验/数据来源线索。' }
          : { score: null, rating: 'PENDING_VERIFICATION', note: '待核查：尚未提供样本量、数据获取途径或实验条件。' },
        interesting: {
          score: wordCount >= 3 ? 80 : null,
          rating: wordCount >= 3 ? 'SCOPED_TOPIC' : 'PENDING_CLARIFICATION',
          note: '基于主题词具体度评估；需结合文献检索确认领域关注度。',
        },
        novel: hasComparisonOrGap
          ? { score: 82, rating: 'GAP_INDICATED', note: '输入已指明对比维度或研究缺口。' }
          : { score: null, rating: 'PENDING_LITERATURE_SCAN', note: '待核查：请调用 search_crossref 与 three_way_lit_scan 核实创新边界。' },
        ethical: hasEthicsRisk
          ? (hasEthicsApproval
            ? { score: 90, rating: 'APPROVAL_NOTED', note: '涉及人类/动物样本且已提及伦理合规措施。' }
            : { score: null, rating: 'ETHICS_REVIEW_REQUIRED', note: '检测到潜在人类受试者/动物实验/隐私关键词，必须补充 IRB/IACUC 伦理审查说明。' })
          : { score: null, rating: 'PENDING_PROTOCOL_CHECK', note: '待根据具体实验对象确认是否需要伦理审批或数据合规审查。' },
        relevant: userContext
          ? { score: 85, rating: 'CONTEXT_PROVIDED', note: '已提供应用场景与研究背景说明。' }
          : { score: null, rating: 'PENDING_APPLICATION_SCOPE', note: '待补充：请说明研究结论拟解决的具体理论或实践问题。' },
      },
      candidateResearchQuestions: [
        { type: 'Exploratory (探索型)', question: '在 ' + topicClean + ' 中，核心观测指标随关键条件变化的实证分布特征是什么？' },
        { type: 'Comparative (对比型)', question: '在控制混杂变量后，' + topicClean + ' 相比现有基线对照是否产生具有统计显著性与实际效应量的改善？' },
        { type: 'Mechanistic (因果机制型)', question: '在何种边界条件下，' + topicClean + ' 通过特定中介机制改变目标结局？' },
      ],
      nextStepRecommendation: '请先补充上述标记为 PENDING 的研究要素（数据来源、对照设计与伦理合规），再调用 search_crossref 检索实证文献。',
    },
  };
}

// 3. verify_doi
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
        'User-Agent': 'CindyAcademicSkills/1.4.0 (mailto:1254084397@qq.com; Academic-Integrity-Agent)',
      },
      callId: callId,
    });
  } catch (err) {
    return fail('请求 Crossref 验证服务异常：' + (err && err.message ? err.message : String(err)) + '。请检查本地网络连接后重试。');
  }

  if (!response || !response.ok) {
    if (response && typeof response.status === 'number' && response.status >= 400 && response.status !== 404) {
      return fail(formatCrossrefHttpError(response.status, 'Crossref DOI 核验'));
    }
    if (!response || response.status !== 404) {
      return fail('连接 Crossref 服务失败：' + (response && response.message ? response.message : '网络请求未完成') + '。请检查网络状态或稍后重试。');
    }
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

  if (response.status < 200 || response.status >= 300) {
    return fail(formatCrossrefHttpError(response.status, 'Crossref DOI 核验'));
  }

  var data;
  try {
    data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  } catch {
    return fail('解析 Crossref 返回数据失败，响应格式非标准 JSON，请稍后重试。');
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

// 4. search_crossref
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
        'User-Agent': 'CindyAcademicSkills/1.4.0 (mailto:1254084397@qq.com; Academic-Discovery-Agent)',
      },
      callId: callId,
    });
  } catch (err) {
    return fail('检索 Crossref 服务异常：' + (err && err.message ? err.message : String(err)) + '。请检查本地网络连接后重试。');
  }

  if (!response || !response.ok) {
    if (response && typeof response.status === 'number' && response.status >= 400) {
      return fail(formatCrossrefHttpError(response.status, 'Crossref 文献检索'));
    }
    return fail('连接 Crossref 检索失败：' + (response && response.message ? response.message : '网络请求未完成') + '。请检查网络状态或稍后重试。');
  }

  if (response.status < 200 || response.status >= 300) {
    return fail(formatCrossrefHttpError(response.status, 'Crossref 文献检索'));
  }

  var data;
  try {
    data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  } catch {
    return fail('解析检索结果 JSON 失败，上游响应格式异常，请稍后重试。');
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

// 5. three_way_lit_scan
async function threeWayLitScanTool(args) {
  var papers = args && args.papers;
  if (!Array.isArray(papers) || papers.length === 0) {
    return fail('请提供至少一篇待扫描对比的论文对象列表（含 title 和 abstract_or_notes）。');
  }

  var comparisonFocus = (args && args.comparison_focus) || 'comprehensive';
  var matrix = [];
  var extractedThemes = [];
  var tokenFreq = {};
  var missingMethodTitles = [];
  var missingFindingTitles = [];

  for (var i = 0; i < papers.length; i++) {
    var p = papers[i];
    var title = p.title || ('Paper #' + (i + 1));
    var notes = (p.abstract_or_notes || p.abstract || '').trim();
    extractedThemes.push(title);

    var whyExcerpt = '';
    var howExcerpt = '';
    var whatExcerpt = '';

    var combinedPaperText = (title + ' ' + notes).toLowerCase();
    var pTokens = combinedPaperText.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(function (w) {
      return w.length >= 4 && !/^(this|that|with|from|into|have|were|been|their|study|paper)$/.test(w);
    });
    var seenInPaper = {};
    for (var tIdx = 0; tIdx < pTokens.length; tIdx++) {
      var tok = pTokens[tIdx];
      if (!seenInPaper[tok]) {
        seenInPaper[tok] = true;
        tokenFreq[tok] = (tokenFreq[tok] || 0) + 1;
      }
    }

    if (notes) {
      var sentences = notes.split(/[.。;；\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      for (var sIdx = 0; sIdx < sentences.length; sIdx++) {
        var s = sentences[sIdx];
        if (!whyExcerpt && /aim|objective|problem|challenge|investigate|explore|examine|focus|研究|旨在|探讨|问题|瓶颈|探索|分析/i.test(s)) {
          whyExcerpt = s;
        } else if (!howExcerpt && /method|model|approach|experiment|dataset|sample|using|survey|trial|采用|模型|方法|数据|样本|实验/i.test(s)) {
          howExcerpt = s;
        } else if (!whatExcerpt && /result|find|show|demonstrate|conclude|achieve|outperform|rate|latency|发现|表明|证实|得出|结果/i.test(s)) {
          whatExcerpt = s;
        }
      }
      if (!whyExcerpt && sentences.length > 0) {
        whyExcerpt = sentences[0];
      }
    }

    if (!howExcerpt) missingMethodTitles.push(title);
    if (!whatExcerpt) missingFindingTitles.push(title);

    matrix.push({
      paperTitle: title,
      authors: p.authors || 'Unknown',
      year: p.year || 'N/A',
      why: whyExcerpt || '[PENDING_VERIFICATION: 传入摘要/笔记未包含明确研究动机描述，请补充原文背景]',
      how: howExcerpt || '[PENDING_VERIFICATION: 传入摘要/笔记未提及具体实验方法、模型或样本量，请核查原文 Methods]',
      what: whatExcerpt || '[PENDING_VERIFICATION: 传入摘要/笔记未包含定量实证结论，请核查原文 Results，切勿直接假定假说成立]',
      hasDetailedAbstract: Boolean(notes),
      extractionStatus: (whyExcerpt && howExcerpt && whatExcerpt) ? 'COMPLETE' : 'PARTIAL_NEEDS_FULLTEXT_CHECK',
    });
  }

  var sharedKeywords = Object.keys(tokenFreq).filter(function (k) { return tokenFreq[k] >= 2; });
  var distinctKeywords = Object.keys(tokenFreq).filter(function (k) { return tokenFreq[k] === 1; }).slice(0, 8);

  return {
    ok: true,
    result: {
      scannedCount: papers.length,
      focus: comparisonFocus,
      threeWayMatrix: matrix,
      crossStudySynthesis: {
        analyzedPapers: extractedThemes,
        sharedConceptsDetected: sharedKeywords,
        consensusPoints: sharedKeywords.length > 0
          ? ('跨文献共同高频主题词包括: ' + sharedKeywords.join(', '))
          : '传入文献笔记之间未检出重合词根，各篇聚焦维度高度独立，需人工核对是否存在共同理论主线。',
        controversialAreas: distinctKeywords.length > 0
          ? ('各篇文献侧重的差异化概念包括: ' + distinctKeywords.join(', '))
          : '待结合完整实验条件与效应方向进一步核对文献间分歧。',
        openResearchGap: (missingMethodTitles.length > 0 || missingFindingTitles.length > 0)
          ? ('待核查缺口：' +
             (missingMethodTitles.length > 0 ? ('[' + missingMethodTitles.join(', ') + '] 缺少方法学细节；') : '') +
             (missingFindingTitles.length > 0 ? ('[' + missingFindingTitles.join(', ') + '] 缺少定量结果证据。') : ''))
          : '已从全部传入笔记中提取 Why-How-What 三维记录，请对比各篇样本边界以确立本研究切入点。',
      },
    },
  };
}

// 6. academic_integrity_audit (7 Failure Modes Gate)
async function academicIntegrityAuditTool(args, callId) {
  var paperText = args && args.paper_text;
  if (!paperText || typeof paperText !== 'string' || !paperText.trim()) {
    return fail('请提供待进行学术诚信审计的手稿文本。');
  }

  var stage = (args && args.stage) || 'pre_review_gate';
  var implementationVerified = (args && args.implementation_verified === true);
  var findings = [];
  var lower = paperText.toLowerCase();

  var doiMatches = paperText.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/g) || [];
  var uniqueDois = [];
  for (var dIdx = 0; dIdx < doiMatches.length; dIdx++) {
    var cleaned = cleanDoiString(doiMatches[dIdx]);
    if (cleaned && uniqueDois.indexOf(cleaned) < 0) {
      uniqueDois.push(cleaned);
    }
  }

  var verifiedDoisInput = Array.isArray(args && args.verified_dois)
    ? args.verified_dois.map(function (d) { return cleanDoiString(String(d)).toLowerCase(); }).filter(Boolean)
    : [];
  var alreadyVerifiedDois = [];
  var pendingDois = [];
  for (var u = 0; u < uniqueDois.length; u++) {
    var dStr = uniqueDois[u];
    if (verifiedDoisInput.indexOf(dStr.toLowerCase()) >= 0) {
      alreadyVerifiedDois.push(dStr);
    } else {
      pendingDois.push(dStr);
    }
  }

  // Check for suspicious or placeholder DOIs and verify extracted DOIs against Crossref (capped at 30 new checks per call)
  var MAX_INTEGRITY_DOI_CHECKS = 30;
  var hasFakeDoi = /10\.\d+\/(?:fake|dummy|test|placeholder|1234)/i.test(paperText);
  var newlyVerifiedDois = [];
  var notFoundDois = [];
  var unverifiedDois = [];

  var targetDois = pendingDois.slice(0, MAX_INTEGRITY_DOI_CHECKS);
  var excessDois = pendingDois.slice(MAX_INTEGRITY_DOI_CHECKS);
  for (var exIdx = 0; exIdx < excessDois.length; exIdx++) {
    unverifiedDois.push(excessDois[exIdx]);
  }

  if (!hasFakeDoi && targetDois.length > 0) {
    for (var uIdx = 0; uIdx < targetDois.length; uIdx++) {
      var targetDoi = targetDois[uIdx];
      try {
        var url = CROSSREF_API + '/' + encodeURIComponent(targetDoi);
        var res = await cindy.fetch({
          url: url,
          callId: callId,
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CindyAcademicPlugin/1.4 (https://cindy.app; mailto:1254084397@qq.com)',
          },
        });
        if (res && res.status === 404) {
          notFoundDois.push(targetDoi);
        } else if (res && res.ok && res.status === 200) {
          var parsed = JSON.parse(res.body || '{}');
          var msg = parsed && parsed.message;
          var hasRealRecord = Boolean(msg && (msg.DOI || (Array.isArray(msg.title) && msg.title.length > 0)));
          if (hasRealRecord) {
            newlyVerifiedDois.push(targetDoi);
          } else {
            unverifiedDois.push(targetDoi);
          }
        } else {
          unverifiedDois.push(targetDoi);
        }
      } catch {
        unverifiedDois.push(targetDoi);
      }
    }
  }

  var totalVerifiedDois = alreadyVerifiedDois.concat(newlyVerifiedDois);
  var allDoisVerified = uniqueDois.length > 0 && !hasFakeDoi && notFoundDois.length === 0 && unverifiedDois.length === 0 && totalVerifiedDois.length === uniqueDois.length;

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

  var hasControlMention = /control\s+group|baseline|ablation|placebo|对照组|基线|消融实验/i.test(paperText);
  var hasNegativeControlMention = /negative\s+control|random\s+control|randomized\s+control|placebo|blank\s+control|confounder|阴性对照|空白对照|随机对照|混杂控制/i.test(paperText);
  var hasLeakageSafeguard = implementationVerified && /no\s+data\s+leakage|held-out\s+test|independent\s+test|cross-validation|独立测试集|无数据泄露|物理隔离/i.test(paperText);
  var hasPValueMention = /p\s*[<>=]\s*0\.\d+|statistical\s+significance|显著性|假设检验/i.test(paperText);
  var hasDataAvailability = /data\s+availability|code\s+availability|reproducib|可复现|数据可用性/i.test(paperText);

  var mode1Status = (hasFakeDoi || notFoundDois.length > 0)
    ? 'FLAGGED_FABRICATED_OR_MISSING_DOI'
    : (allDoisVerified
      ? 'PASS'
      : (uniqueDois.length > 0 ? 'VERIFICATION_REQUIRED' : 'WARNING_NO_CITATION_FOUND'));

  findings.push({
    mode: 'Mode 1: Fabricated Citations',
    status: mode1Status,
    details: hasFakeDoi
      ? '检测到疑似伪造/占位符 DOI (如包含 fake/dummy/test)，门禁拦截！'
      : (notFoundDois.length > 0
        ? ('Crossref 官方库中查无此 DOI (' + notFoundDois.join(', ') + ')，判定为疑似幻觉引用，门禁拦截！')
        : (allDoisVerified
          ? ('全部 ' + totalVerifiedDois.length + ' 处 DOI 已通过 Crossref 实时在线对账核验。')
          : (uniqueDois.length > 0
            ? ('检测到 ' + unverifiedDois.length + ' 处未完成核验的 DOI (' + unverifiedDois.slice(0, 5).join(', ') + (unverifiedDois.length > 5 ? ' 等' : '') + ')' + (excessDois.length > 0 ? ('，单次调用优先核查前 ' + MAX_INTEGRITY_DOI_CHECKS + ' 篇未核验文献，其余 ' + excessDois.length + ' 篇待后续分批核验（已累计核验 ' + totalVerifiedDois.length + '/' + uniqueDois.length + '）') : '') + '。')
            : '未检测到规范 DOI 标识，存在文献真实性风险。'))),
  });

  findings.push({
    mode: 'Mode 2: Baseline Equivalence & Fair Comparison',
    status: hasControlMention ? 'PASS' : 'WARN_NO_BASELINE_EXPLICITLY_FOUND',
    details: hasControlMention ? '正文中已明示基准模型/对照组/消融实验设置。' : '未检测到明确的对照组或 Baseline 对比词汇，请补充以防基准失衡。',
  });

  findings.push({
    mode: 'Mode 3: Implementation Artifacts vs Findings',
    status: hasLeakageSafeguard ? 'PASS' : 'UNVERIFIED_IMPLEMENTATION_ARTIFACTS',
    details: hasLeakageSafeguard
      ? '已核实正文中独立测试集隔离声明且作者已显式确认 implementation_verified=true。'
      : '尚未同时满足正文防数据泄露隔离说明与 implementation_verified=true 独立核查确认，暂不放行。',
  });

  findings.push({
    mode: 'Mode 4: Negative Controls & Confounder Checks',
    status: (hasControlMention && hasNegativeControlMention) ? 'PASS' : 'FLAGGED_FOR_MANUAL_REVIEW',
    details: (hasControlMention && hasNegativeControlMention)
      ? '已设立随机/阴性对照机制以排除竞争性假设。'
      : '缺少明确的阴性对照/随机对照/混杂控制描述，需补充说明。',
  });

  findings.push({
    mode: 'Mode 5: Overclaiming & Generalizability Bounds',
    status: detectedOverclaims.length === 0 ? 'PASS' : 'WARN_OVERCLAIM_TERMS_FOUND',
    details: detectedOverclaims.length > 0
      ? '检测到潜在过度宣称词汇 (' + detectedOverclaims.join(', ') + ')，建议依据实证样本收敛结论范围。'
      : '结论语气客观严谨，未发现过度断言。',
  });

  findings.push({
    mode: 'Mode 6: Methodological Inconsistency & p-Hacking',
    status: hasPValueMention ? 'PASS' : 'INFO_NO_EXPLICIT_P_VALUE',
    details: hasPValueMention ? '包含统计检验指标，请确保多重比较已校正且未执行选择性剔除。' : '未检测到具体 p 值或假设检验描述。',
  });

  findings.push({
    mode: 'Mode 7: Reproducible Provenance & Data Availability',
    status: hasDataAvailability ? 'PASS' : 'ACTION_REQUIRED',
    details: hasDataAvailability ? '已包含数据/代码可用性相关声明。' : '手稿中应补充代码仓库链接或数据可用性声明。',
  });

  var passCount = 0;
  var unverifiedModes = [];
  for (var j = 0; j < findings.length; j++) {
    if (findings[j].status === 'PASS') {
      passCount++;
    } else {
      unverifiedModes.push(findings[j].mode + ' [' + findings[j].status + ']');
    }
  }

  var verdict = 'GATE_CONDITIONAL_PENDING_VERIFICATION';
  if (hasFakeDoi || notFoundDois.length > 0 || detectedOverclaims.length > 0) {
    verdict = 'GATE_BLOCKED_ACTION_REQUIRED';
  } else if (passCount === findings.length) {
    verdict = 'GATE_PASSED';
  }

  return {
    ok: true,
    result: {
      gateStage: stage,
      verdict: verdict,
      allModesPassed: passCount === findings.length,
      crossrefVerifiedDois: totalVerifiedDois,
      accumulatedVerifiedDois: totalVerifiedDois,
      newlyVerifiedDois: newlyVerifiedDois,
      unverifiedDois: unverifiedDois,
      totalDoisCount: uniqueDois.length,
      pendingOrFailedModes: unverifiedModes,
      summary: '7类科研失败模式审查完成：' + passCount + '/7 项通过。' +
        (passCount === findings.length ? '全部阻断项已核验放行。' : '存在未核验或待整改项，门禁保持拦截状态。'),
      inspectedLength: paperText.length,
      failureModesEvaluation: findings,
      timestamp: new Date().toISOString(),
    },
  };
}

// 7. academic_paper_analysis
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

  // Dynamically extract core sentences from content; return pending markers when absent
  var sentences = content.split(/[.。;；\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  var extractedRQ = '';
  var extractedHypothesis = '';
  var extractedMethod = '';
  var extractedFindings = '';
  var extractedInnovation = '';
  var extractedLimits = '';

  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i];
    if (!extractedRQ && /aim|propose|investigate|study|address|objective|研究|旨在|探讨|提出|目标/i.test(s)) {
      extractedRQ = s;
    }
    if (!extractedHypothesis && /hypothes|assume|premise|expect|predict|假说|假设|前提|预期/i.test(s)) {
      extractedHypothesis = s;
    }
    if (!extractedMethod && /method|approach|model|experiment|dataset|sample|baseline|采用|实验|方法|模型|样本|对照/i.test(s)) {
      extractedMethod = s;
    }
    if (!extractedFindings && /result|show|find|demonstrate|achieve|p\s*[<>=]|发现|表明|证实|结果|显著/i.test(s)) {
      extractedFindings = s;
    }
    if (!extractedInnovation && /novel|first|contribut|outperform|advance|new|创新|首次|贡献|优于|突破/i.test(s)) {
      extractedInnovation = s;
    }
    if (!extractedLimits && /limit|however|threat|constraint|future|caveat|局限|不足|未来|然而|边界/i.test(s)) {
      extractedLimits = s;
    }
  }

  var missingItems = [];
  if (!extractedRQ) missingItems.push('研究问题 (Research Question)');
  if (!extractedHypothesis) missingItems.push('显式假说与前提 (Hypotheses & Assumptions)');
  if (!extractedMethod) missingItems.push('方法学与样本细节 (Methodology Design)');
  if (!extractedFindings) missingItems.push('定量实证结果 (Empirical Evidence)');
  if (!extractedLimits) missingItems.push('局限性与效度边界 (Limitations)');

  var analysisSchema = {
    metadata: {
      title: title,
      analyzedFocus: focus,
      characterCount: charCount,
      estimatedWords: wordCount,
      missingElementsCount: missingItems.length,
      timestamp: new Date().toISOString(),
    },
    structuredFramework: {
      researchQuestion: extractedRQ || '[PENDING_VERIFICATION: 传入文本未包含明确的研究目标或科学问题语句]',
      hypothesesAndAssumptions: extractedHypothesis || '[PENDING_VERIFICATION: 传入文本未显式声明理论假说或模型前提假设]',
      methodologyDesign: extractedMethod || '[PENDING_VERIFICATION: 传入文本未包含实验方案、样本量或基准对比细节]',
      evidenceChain: extractedFindings || '[PENDING_VERIFICATION: 传入文本未包含具体统计检验或定量实证结果]',
      strengthsAndInnovations: extractedInnovation || '[PENDING_VERIFICATION: 传入文本未包含明确的创新性或相比基线的增量声明]',
      limitationsAndThreatsToValidity: extractedLimits || '[PENDING_VERIFICATION: 传入文本未讨论研究局限性、外部效度边界或潜在混杂威胁]',
    },
    pendingVerificationItems: missingItems,
    guidance: missingItems.length > 0
      ? ['待核查提示：当前传入片段缺少 ' + missingItems.join('、') + '，请提供对应章节全文后再作定论。']
      : ['已从文本中检出完整的六维结构要素，请结合同行评审量表核实其统计效力。'],
  };

  if (includeChecklist) {
    analysisSchema.rigorChecklist = [
      { item: '明确的研究问题与反事实假设 (Counterfactual / Hypothesis)', status: (extractedRQ && extractedHypothesis) ? 'DETECTED_IN_TEXT' : 'MISSING_NEEDS_VERIFICATION' },
      { item: '实验与对照组平衡 (Randomization / Baseline Equivalence)', status: extractedMethod ? 'DETECTED_IN_TEXT' : 'MISSING_NEEDS_VERIFICATION' },
      { item: '混杂因素控制 (Confounding Variables Controlled)', status: /confound|control|adjust|random|混杂|控制|随机/i.test(content) ? 'DETECTED_IN_TEXT' : 'MISSING_NEEDS_VERIFICATION' },
      { item: '统计功效与多重检验校正 (Power Analysis & Multiple Testing Correction)', status: /power|bonferroni|fdr|tukey|holm|功效|校正/i.test(content) ? 'DETECTED_IN_TEXT' : 'MISSING_NEEDS_VERIFICATION' },
      { item: '数据集/代码公开声明与透明度 (FAIR Principles)', status: /data\s+availability|code|github|zenodo|开源|数据可用/i.test(content) ? 'DETECTED_IN_TEXT' : 'MISSING_NEEDS_VERIFICATION' },
      { item: '结论边界与外部效度外推风险 (Generalizability Bounds)', status: extractedLimits ? 'DETECTED_IN_TEXT' : 'MISSING_NEEDS_VERIFICATION' },
    ];
  }

  return {
    ok: true,
    result: analysisSchema,
  };
}

// 8. claim_citation_alignment
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

  // Unicode-aware tokenization supporting both English and Chinese
  var claimTokens = claimText.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(function (t) { return t.length >= 2; });
  var sourceTokens = sourceSummary.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(function (t) { return t.length >= 2; });

  // For Chinese text without spaces, extract 2-grams
  if (claimTokens.length < 3 && /[\u4e00-\u9fa5]/.test(claimText)) {
    var cClean = claimText.replace(/[^\u4e00-\u9fa5]/g, '');
    for (var ci = 0; ci < cClean.length - 1; ci++) {
      claimTokens.push(cClean.slice(ci, ci + 2));
    }
  }
  if (sourceTokens.length < 3 && /[\u4e00-\u9fa5]/.test(sourceSummary)) {
    var sClean = sourceSummary.replace(/[^\u4e00-\u9fa5]/g, '');
    for (var si = 0; si < sClean.length - 1; si++) {
      sourceTokens.push(sClean.slice(si, si + 2));
    }
  }

  var sourceSet = {};
  for (var i = 0; i < sourceTokens.length; i++) sourceSet[sourceTokens[i]] = true;

  var commonCount = 0;
  for (var j = 0; j < claimTokens.length; j++) {
    if (sourceSet[claimTokens[j]]) commonCount++;
  }

  var overlapRatio = claimTokens.length > 0 ? (commonCount / claimTokens.length) : 0;

  // Negation and polarity check to detect reversed assertions
  var englishNegations = ['not', 'never', 'no', 'fails', 'failed', 'cannot', 'neither', 'nor', 'unsupported', 'refuted', 'denies', 'contrary'];
  var chineseNegations = ['不', '未', '无', '非', '未能', '绝不', '否认', '相反'];
  function checkNegation(text) {
    if (!text) return false;
    var hasEn = englishNegations.some(function (n) {
      return new RegExp('\\b' + n + '\\b', 'i').test(text);
    });
    if (hasEn) return true;
    return chineseNegations.some(function (cn) {
      return text.indexOf(cn) >= 0;
    });
  }
  var claimHasNeg = checkNegation(claimText);
  var sourceHasNeg = checkNegation(sourceSummary);
  var polarityMismatch = (claimHasNeg !== sourceHasNeg);

  var alignmentStatus = 'POTENTIAL_MISATTRIBUTION';
  var assessment = '';

  if (polarityMismatch && overlapRatio >= 0.2) {
    alignmentStatus = 'CONTRADICTION_POLARITY_MISMATCH';
    assessment = '警告：虽然关键词重合度高，但主张与来源之间的否定词极性相反（一正一反），可能存在曲解原意或断章取义风险！';
  } else if (overlapRatio >= 0.3) {
    alignmentStatus = 'ALIGNED';
    assessment = '主张表述与被引文献核心概念吻合度良好。';
  } else if (overlapRatio >= 0.15) {
    alignmentStatus = 'PLAUSIBLE_NEEDS_ANCHOR';
    assessment = '概念存在一定交集，但建议补充具体页码或表格编号以防断章取义。';
  } else {
    alignmentStatus = 'POTENTIAL_MISATTRIBUTION';
    assessment = '关键词交集过低，可能存在引用脱节或结论张冠李戴风险。';
  }

  return {
    ok: true,
    result: {
      doi: doi || 'N/A',
      claimText: claimText,
      claimTokensAnalyzed: claimTokens.length,
      sharedKeywordsCount: commonCount,
      estimatedAlignmentScore: Math.round(overlapRatio * 100),
      polarityMismatchDetected: polarityMismatch,
      alignmentStatus: alignmentStatus,
      assessment: assessment,
    },
  };
}

// 9. academic_style_audit
async function academicStyleAuditTool(args) {
  var draftText = args && args.draft_text;
  if (!draftText || typeof draftText !== 'string' || !draftText.trim()) {
    return fail('请提供待审计风格的手稿文本。');
  }

  var lower = draftText.toLowerCase();

  var buzzwords = [
    'delve',
    'testament to',
    'tapestry',
    'game-changer',
    'beacon',
    'pivotal',
    'unleash',
    'harness the power',
    'deep dive',
    'it is important to note',
    '值得注意的是',
    '显而易见的是',
    '毋庸置疑',
  ];

  var flaggedBuzzwords = [];
  for (var i = 0; i < buzzwords.length; i++) {
    if (lower.indexOf(buzzwords[i].toLowerCase()) >= 0) {
      flaggedBuzzwords.push(buzzwords[i]);
    }
  }

  var vagueQuantifiers = [
    'a lot of',
    'many researchers',
    'several studies',
    'significantly better',
    'various',
    'numerous',
    '大量的研究',
    '许多学者',
  ];
  var flaggedVague = [];
  for (var j = 0; j < vagueQuantifiers.length; j++) {
    if (lower.indexOf(vagueQuantifiers[j].toLowerCase()) >= 0) {
      flaggedVague.push(vagueQuantifiers[j]);
    }
  }

  var sentenceCount = draftText.split(/[.!?。！？]+/).filter(Boolean).length;
  var wordCount = draftText.split(/\s+/).length;
  var score = Math.max(40, 100 - (flaggedBuzzwords.length * 8) - (flaggedVague.length * 5));

  return {
    ok: true,
    result: {
      originalLength: draftText.length,
      wordCount: wordCount,
      sentenceCount: sentenceCount,
      stylePurityScore: score,
      aiClichéScore: score,
      detectedBuzzwords: flaggedBuzzwords,
      detectedAiClichés: flaggedBuzzwords,
      vagueQuantifiers: flaggedVague,
      detectedVagueQuantifiers: flaggedVague,
      actionableRecommendations: [
        flaggedBuzzwords.length > 0 ? '建议将陈腐空洞词汇（' + flaggedBuzzwords.join(', ') + '）替换为具体实证动词或精确指标。' : '语言精炼，未检出常见陈词滥调。',
        flaggedVague.length > 0 ? '请为模糊量词（' + flaggedVague.join(', ') + '）添加具体文献引用或精确百分比。' : '量化描述客观。',
        '保持学术客观语气，避免使用第一人称主观推测或绝对化修饰词。',
      ],
    },
  };
}

// 10. peer_review_evaluation
async function peerReviewEvaluationTool(args) {
  var manuscriptText = args && args.manuscript_text;
  if (!manuscriptText || typeof manuscriptText !== 'string' || !manuscriptText.trim()) {
    return fail('请提供待评审的手稿内容或核心章节文本。');
  }

  var discipline = (args && args.discipline && String(args.discipline).trim()) || 'General';
  var reviewType = (args && args.review_type) || 'standard_review';
  var len = manuscriptText.length;

  // Dynamic analysis of manuscript content
  var hasNoveltyClaim = /novel|propose|introduce|new|first|创新|首次|提出|新颖/i.test(manuscriptText);
  var hasMethods = /method|experiment|procedure|protocol|dataset|采用|方法|实验|数据集/i.test(manuscriptText);
  var hasStats = /p\s*[<>=]|t\(|f\(|chi-square|anova|sd|sem|ci|显著|检验|置信区间/i.test(manuscriptText);
  var hasBaselines = /baseline|control|compared to|ablation|state-of-the-art|sota|基准|对照|消融/i.test(manuscriptText);
  var hasLimitations = /limit|threat|future work|caveat|boundary|局限|不足|展望|边界/i.test(manuscriptText);
  var hasReproAssets = /code|github|repository|hyperparameter|seed|open-source|代码|开源|随机种子|超参数/i.test(manuscriptText);
  var hasCitations = /\b10\.\d{4,9}\/|\[\d+\]|\([A-Z][a-z]+(?:\s+et\s+al\.)?,\s*\d{4}\)/i.test(manuscriptText);

  var origScore = hasNoveltyClaim ? (hasCitations ? 85 : 72) : 55;
  var methScore = hasMethods ? (hasStats && hasBaselines ? 88 : (hasStats || hasBaselines ? 74 : 62)) : 45;
  var alignScore = hasStats ? (hasBaselines ? 86 : 74) : (hasMethods ? 58 : 42);
  var presScore = len >= 300 ? (hasCitations ? 86 : 75) : 55;
  var reproScore = hasReproAssets ? 88 : (hasMethods && hasStats ? 72 : 48);

  var overall = Math.round(origScore * 0.2 + methScore * 0.3 + alignScore * 0.25 + presScore * 0.15 + reproScore * 0.1);

  var decision = overall >= 82 ? 'Accept / Minor Revision' : (overall >= 65 ? 'Major Revision' : 'Reject');

  var majorIssues = [];
  if (!hasMethods) majorIssues.push('缺少实验设计、数据集与方法流程说明（Methods 章节证据缺失）');
  if (!hasBaselines) majorIssues.push('未检出明确的 Baseline / 对照组或消融对比实验');
  if (!hasStats) majorIssues.push('缺少具体统计检验指标、自由度、效应量或精确 p 值');
  if (!hasLimitations) majorIssues.push('未声明研究局限性（Limitations）与结论适用边界');
  if (majorIssues.length === 0) {
    majorIssues.push('进一步核查多重假设检验校正（FDR / Bonferroni）与置信区间完整性');
  }

  var minorIssues = [];
  if (!hasCitations) minorIssues.push('正文中未检出规范的学术文献引用锚点或 DOI');
  if (!hasReproAssets) minorIssues.push('建议补充代码仓库链接、随机种子或关键超参数配置以提升可复现性');
  if (len < 300) minorIssues.push('当前提交的文本片段较短（' + len + ' 字符），建议补充完整章节以供深入评审');
  if (minorIssues.length === 0) {
    minorIssues.push('核对图表字号、误差棒说明与参考文献 DOI 格式统一性');
  }

  return {
    ok: true,
    result: {
      reviewOverview: {
        discipline: discipline,
        reviewMode: reviewType,
        textLength: len,
        evaluatedAt: new Date().toISOString(),
      },
      scoringRubric: {
        originality: {
          score: origScore,
          weight: '20%',
          comment: hasNoveltyClaim
            ? (hasCitations ? '明确阐述了创新贡献并与既有文献建立对比' : '声明了创新点，但缺少文献引用锚点支撑')
            : '未在文本中检出明确的创新点或核心贡献声明',
        },
        methodologicalRigor: {
          score: methScore,
          weight: '30%',
          comment: hasMethods
            ? (hasBaselines && hasStats ? '包含方法描述、对照基准与统计检验' : '已描述方法，但缺少对照基准或统计检验支撑')
            : '未检出明确的方法学描述或实验流程说明',
        },
        claimEvidenceAlignment: {
          score: alignScore,
          weight: '25%',
          comment: hasStats
            ? '论断具备统计检验或量化指标支撑'
            : '缺少具体统计量或实验数据支撑核心论断',
        },
        presentationAndClarity: {
          score: presScore,
          weight: '15%',
          comment: len >= 300 ? '文稿段落结构较完整' : '提交文本偏短，论述细节不足',
        },
        reproducibility: {
          score: reproScore,
          weight: '10%',
          comment: hasReproAssets
            ? '包含代码、参数或复现性说明'
            : (hasMethods && hasStats ? '提供了基本实验与统计指标，建议补充开源代码/数据声明' : '缺少复现所需的实验参数、数据集与统计细节'),
        },
        overallScore: overall,
      },
      multiPerspectiveFeedback: {
        editorInChief: '建议 ' + decision + '。手稿基于实证特征综合评分为 ' + overall + ' 分。' + (hasStats && hasMethods ? '具备基本方法与数据框架。' : '核心方法或统计实证存在明显缺失。'),
        reviewer1_Methodologist: hasBaselines ? '已包含基准或对照设计，建议进一步核验方差齐性与多重比较校正。' : '主要关切：未检出明确的 Baseline/对照组 对比实验，结论内生效度受限。',
        reviewer2_DomainSpecialist: hasCitations ? '已包含文献引用对话，建议进一步确认近两年代表性工作的覆盖度。' : '主要关切：文本中未检出规范的学术引用或 DOI，缺乏与既有文献的学术对话。',
        reviewer3_Reproducibility: hasLimitations ? '已明确讨论研究局限性。' : '手稿未讨论结论适用边界与潜在混杂威胁，需补充 Limitations 小节。',
        devilsAdvocate: hasStats ? '挑战：请确认所报告的显著性结果在控制混杂变量或更换随机种子后是否依然稳健。' : '挑战：当前结论缺乏量化统计检验支撑，无法排除随机波动或主观偏差。',
      },
      revisionChecklist: {
        majorIssues: majorIssues,
        minorIssues: minorIssues,
      },
    },
  };
}

// 11. rebuttal_matrix_coach
async function rebuttalMatrixCoachTool(args) {
  var comments = args && args.reviewer_comments;
  if (!comments || typeof comments !== 'string' || !comments.trim()) {
    return fail('请提供审稿人意见文本（reviewer_comments）。');
  }

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
  for (var pIdx = 0; pIdx < points.length; pIdx++) {
    var rawText = points[pIdx];
    matrix.push({
      itemNumber: pIdx + 1,
      reviewerConcern: rawText,
      proposedRevisionStrategy: '以礼貌、严谨的态度致谢并正面回应，补充实证数据与图表支撑',
      manuscriptLocationAnchor: '待标注：Page X, Lines Y-Z',
      responseDraftTemplate: 'We thank the reviewer for this insightful comment. In response, we have... [Detailed explanation of actions taken and new empirical data added].',
    });
  }

  return {
    ok: true,
    result: {
      totalConcernsIdentified: matrix.length,
      totalCritiquePoints: matrix.length,
      responseMatrix: matrix,
      strategicGuidance: [
        '黄金法则：点对点逐条回复 (Point-by-point)，严禁合并或遗漏审稿人的批评',
        '正面接纳：感谢建设性批评，即使持不同意见也须先表达感谢，再客观呈现反驳证据',
        '高亮改动：在修改稿中用彩色标注对应修改处并在答辩信中标注精确页码和行号',
      ],
    },
  };
}

// 12. author_disclosure_statement
async function authorDisclosureStatementTool(args) {
  var leadAuthor = args && args.lead_author;
  if (!leadAuthor || typeof leadAuthor !== 'string' || !leadAuthor.trim()) {
    return fail('请提供第一作者或通讯作者姓名（lead_author）。');
  }

  var coAuthors = Array.isArray(args && args.co_authors) ? args.co_authors : [];
  var aiTools = Array.isArray(args && args.ai_tools_used) ? args.ai_tools_used : ['Cindy Academic Research Suite (ARS)'];
  var aiTasks = Array.isArray(args && args.ai_tasks_performed) ? args.ai_tasks_performed : ['literature search assistance', 'DOI citation verification', 'grammar and style calibration'];
  var authorRolesMap = (args && typeof args.author_roles_map === 'object' && args.author_roles_map) ? args.author_roles_map : null;
  var declaredCoi = args && args.competing_interests ? String(args.competing_interests).trim() : null;
  var allApproved = args && typeof args.all_authors_approved === 'boolean' ? args.all_authors_approved : false;

  var allAuthors = [leadAuthor.trim()].concat(coAuthors);

  var creditLines = [];
  if (authorRolesMap) {
    for (var aName in authorRolesMap) {
      creditLines.push(aName + ': ' + authorRolesMap[aName] + '.');
    }
  } else {
    // Output transparent customizable template with placeholders
    creditLines.push(allAuthors[0] + ': Conceptualization, Methodology, Writing - Original Draft [Customizable CRediT roles].');
    if (allAuthors.length > 1) {
      for (var k = 1; k < allAuthors.length; k++) {
        creditLines.push(allAuthors[k] + ': [CONFIRMATION NEEDED: Specify CRediT roles (e.g. Investigation, Formal Analysis, Writing - Review & Editing)].');
      }
    }
  }

  var creditStatement = 'Author Contributions (CRediT Template):\n' +
    creditLines.join('\n') + '\n' +
    (allApproved
      ? 'All authors have read and agreed to the published version of the manuscript.'
      : '[CONFIRMATION NEEDED: All authors must review and explicitly agree to the final version before publication submission].');

  var aiStatement = 'Declaration of Generative AI and AI-Assisted Technologies in the Writing Process:\n' +
    'During the preparation of this work, the authors utilized ' + aiTools.join(', ') + ' for ' + aiTasks.join(', ') + '. ' +
    'After using these tool(s), the authors reviewed and edited the content as needed and take full responsibility for the content of the published article. ' +
    'The AI tool does not qualify for authorship under ICMJE and COPE guidelines.';

  var coiStatement = declaredCoi
    ? ('Competing Interests:\n' + declaredCoi)
    : ('Competing Interests (Template - Requires Author Sign-off):\n' +
       '[AUTHOR ACTION REQUIRED: Declare any financial (e.g. stock ownership, patents, consultancies) or non-financial competing interests. If none exist, confirm: "The authors declare that they have no known competing financial interests or personal relationships that could have appeared to influence the work reported in this paper."]');

  return {
    ok: true,
    result: {
      creditStatement: creditStatement,
      generativeAiDisclosure: aiStatement,
      competingInterestsStatement: coiStatement,
      authorApprovalConfirmed: allApproved,
      policyStandard: 'ICMJE / COPE / Elsevier / Springer Nature AI Disclosure Guidelines',
    },
  };
}

// 13. bibtex_format_converter
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

  var firstAuthorFamily = 'Author';
  if (Array.isArray(authors) && authors[0]) {
    var parts = String(authors[0]).split(/[\s,]+/);
    firstAuthorFamily = parts[0] || 'Author';
  }
  var citeKey = (firstAuthorFamily.toLowerCase().replace(/[^\w]/g, '') || 'paper') + year;

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

  var apaAuthors = formatAuthorsApa7(authors);
  var apa = apaAuthors + ' (' + year + '). ' +
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

// 14. statistical_analysis_advisor
async function statisticalAnalysisAdvisorTool(args) {
  var rq = args && args.research_question;
  if (!rq || typeof rq !== 'string' || !rq.trim()) {
    return fail('请提供研究问题或实证研究假设。');
  }
  var design = args.design_type;
  var outcome = args.outcome_type;
  var n = typeof args.sample_size_per_group === 'number' ? args.sample_size_per_group : null;
  var normal = typeof args.normality_satisfied === 'boolean' ? args.normality_satisfied : null;
  var varHomog = typeof args.variance_homogeneity_satisfied === 'boolean' ? args.variance_homogeneity_satisfied : null;
  var compCount = typeof args.multiple_comparisons_count === 'number' ? args.multiple_comparisons_count : 1;

  var supportedDesigns = [
    'two_groups_independent',
    'two_groups_paired',
    'multi_groups_independent',
    'multi_groups_repeated',
    'correlation',
    'regression',
    'categorical_proportions',
  ];
  var supportedOutcomes = ['continuous', 'binary', 'ordinal', 'count', 'time_to_event'];

  if (!design || supportedDesigns.indexOf(design) < 0) {
    return fail('不支持的实验设计类型 (design_type): ' + String(design) + '。支持的类型: ' + supportedDesigns.join(', '));
  }
  if (!outcome || supportedOutcomes.indexOf(outcome) < 0) {
    return fail('不支持的因变量类型 (outcome_type): ' + String(outcome) + '。支持的类型: ' + supportedOutcomes.join(', '));
  }
  if (design === 'categorical_proportions' && outcome !== 'binary' && outcome !== 'ordinal') {
    return fail('设计类型 categorical_proportions 仅适用于分类/比例结局（binary 或 ordinal），与结局类型 ' + outcome + ' 冲突。');
  }

  var recommendation = {};

  if (design === 'two_groups_independent') {
    if (outcome === 'continuous') {
      var useNonParam2Ind = (normal === false);
      recommendation = {
        primaryTest: useNonParam2Ind
          ? "Mann-Whitney U test (Wilcoxon 秩和检验，因正态性不满足已切换为非参数主检验)"
          : ((varHomog === false) ? "Welch's Independent Samples t-test (不等方差校正 t 检验)" : "Student's Independent Samples t-test (独立样本 t 检验)"),
        remedialTest: useNonParam2Ind
          ? "Permutation t-test (置换检验) 或 Bootstrap 均值差置信区间"
          : "Mann-Whitney U test (Wilcoxon 秩和检验，若正态性偏离或存在极端离群值)",
        effectSizeMetric: useNonParam2Ind ? "Rank-biserial correlation (r_rb) 或 Cliff's Delta" : "Cohen's d (若样本量小 n < 20 建议校正为 Hedges' g)",
        assumptionsToCheck: [
          "1. 观测独立性 (Independence of observations): 独立实验单元，杜绝伪重复",
          "2. 正态性 (Normality): 每组因变量分布近似正态 (Shapiro-Wilk 检验)",
          "3. 方差齐性 (Homoscedasticity): Levene 检验 (若方差不齐使用 Welch t-test)",
        ],
        reportingTemplate: useNonParam2Ind
          ? "Mann-Whitney U 检验显示两组差异显著, U = ..., Z = ..., p = ..., r_rb = ...。"
          : "独立样本 t 检验显示，实验组 (M = ..., SD = ...) 与对照组 (M = ..., SD = ...) 差异显著, t(df) = ..., p = ..., Cohen's d = ..., 95% CI [... , ...]。",
      };
    } else if (outcome === 'binary') {
      recommendation = {
        primaryTest: (n && n < 30) ? "Fisher's Exact Test (Fisher 精确概率检验)" : "Pearson's Chi-Square Test (卡方独立性检验)",
        remedialTest: "Fisher's Exact Test (若任一期望频数 E < 5)",
        effectSizeMetric: "Odds Ratio (OR, 比值比) 或 Cramer's V",
        assumptionsToCheck: ["1. 单元格独立性", "2. 期望频数准则: 至少 80% 单元格期望频数 >= 5"],
        reportingTemplate: "卡方检验表明两组比例差异显著, χ²(df, N = ...) = ..., p = ..., OR = ... (95% CI [... , ...])。",
      };
    } else if (outcome === 'ordinal') {
      recommendation = {
        primaryTest: "Mann-Whitney U test (Wilcoxon 秩和检验)",
        remedialTest: "Proportional Odds Ordinal Logistic Regression (比例优势有序 Logistic 回归)",
        effectSizeMetric: "Rank-biserial correlation 或 Cliff's Delta",
        assumptionsToCheck: ["1. 独立观测", "2. 因变量为有序测量尺度"],
        reportingTemplate: "Mann-Whitney U 检验表明组间等级分布差异显著, U = ..., Z = ..., p = ..., Cliff's δ = ...。",
      };
    } else if (outcome === 'count') {
      recommendation = {
        primaryTest: "Poisson / Negative Binomial Two-Group Rate Comparison (泊松或负二项率比检验)",
        remedialTest: "Mann-Whitney U test (秩和检验)",
        effectSizeMetric: "Incidence Rate Ratio (IRR, 发生率比) 与 95% CI",
        assumptionsToCheck: ["1. 事件独立性", "2. 均值-方差等分散性检验 (若过离散则采用负二项模型)"],
        reportingTemplate: "负二项/泊松率比检验显示两组计数率差异显著, IRR = ..., 95% CI [... , ...], p = ...。",
      };
    } else {
      // time_to_event
      recommendation = {
        primaryTest: "Log-Rank Test with Kaplan-Meier Survival Curves (对数秩检验配 KM 生存曲线)",
        remedialTest: "Peto-Peto / Gehan-Breslow Generalized Wilcoxon Test (若早期事件权重更高或比例风险假定偏离)",
        effectSizeMetric: "Hazard Ratio (HR, 风险比) 与中位生存时间差",
        assumptionsToCheck: ["1. 删失独立性 (Non-informative censoring)", "2. 比例风险假定 (Proportional hazards assumption)"],
        reportingTemplate: "Log-rank 检验表明两组生存曲线差异显著, χ²(1) = ..., p = ..., HR = ..., 95% CI [... , ...]。",
      };
    }
  } else if (design === 'two_groups_paired') {
    if (outcome === 'continuous') {
      var useNonParamPaired = (normal === false);
      recommendation = {
        primaryTest: useNonParamPaired
          ? "Wilcoxon Signed-Rank Test (配对符号秩检验，因差值正态性不满足已切换为非参数主检验)"
          : "Paired Samples t-test (配对样本 t 检验)",
        remedialTest: useNonParamPaired ? "Sign Test (符号检验) 或配对置换检验" : "Wilcoxon Signed-Rank Test (配对符号秩检验)",
        effectSizeMetric: useNonParamPaired ? "Matched-pairs rank-biserial correlation (r_rb)" : "Cohen's d_z 或 Hedges' g_rm",
        assumptionsToCheck: ["1. 配对差值正态性 (Shapiro-Wilk 检验)", "2. 配对个体间相互独立"],
        reportingTemplate: useNonParamPaired
          ? "Wilcoxon 配对符号秩检验显示处理前后差异显著, W = ..., Z = ..., p = ..., r_rb = ...。"
          : "配对样本 t 检验显示处理后相比基线有显著改变, t(df) = ..., p = ..., d_z = ...。",
      };
    } else if (outcome === 'binary') {
      recommendation = {
        primaryTest: "McNemar's Test (配对列联表 McNemar 检验)",
        remedialTest: "Exact Binomial McNemar Test (若不一致对数 b + c < 25)",
        effectSizeMetric: "Matched Pairs Odds Ratio (OR_matched) 或 Cohen's g",
        assumptionsToCheck: ["1. 配对观测成对独立", "2. 结局为二分类互斥状态"],
        reportingTemplate: "McNemar 检验表明配对前后阳性比例发生显著改变, χ²(1) = ..., p = ..., OR_matched = ...。",
      };
    } else if (outcome === 'ordinal') {
      recommendation = {
        primaryTest: "Wilcoxon Signed-Rank Test (配对符号秩检验)",
        remedialTest: "Marginal Homogeneity Test / Sign Test",
        effectSizeMetric: "Matched-pairs rank-biserial correlation",
        assumptionsToCheck: ["1. 配对个体间独立", "2. 有序等级尺度可比较"],
        reportingTemplate: "Wilcoxon 配对符号秩检验显示前后等级评分差异显著, Z = ..., p = ..., r = ...。",
      };
    } else if (outcome === 'count') {
      recommendation = {
        primaryTest: "Generalized Estimating Equations (GEE) Poisson / Negative Binomial (配对计数模型)",
        remedialTest: "Wilcoxon Signed-Rank Test",
        effectSizeMetric: "Incidence Rate Ratio (IRR)",
        assumptionsToCheck: ["1. 配对相关性结构设定", "2. 过离散检验"],
        reportingTemplate: "配对泊松/负二项模型显示前后事件发生率差异显著, IRR = ..., 95% CI [... , ...], p = ...。",
      };
    } else {
      recommendation = {
        primaryTest: "Stratified Log-Rank Test / Frailty Cox Model (配对/分层生存分析模型)",
        remedialTest: "Clustered Bootstrap Survival Comparison",
        effectSizeMetric: "Stratified Hazard Ratio (HR)",
        assumptionsToCheck: ["1. 配对内共享脆弱性设定", "2. 删失独立性"],
        reportingTemplate: "分层生存分析显示配对条件下风险比显著, HR = ..., 95% CI [... , ...], p = ...。",
      };
    }
  } else if (design === 'multi_groups_independent') {
    if (outcome === 'continuous') {
      var useNonParamAnova = (normal === false);
      recommendation = {
        primaryTest: useNonParamAnova
          ? "Kruskal-Wallis H test (非参数多组秩和检验，配 Dunn's 事后检验，因正态性不满足已切换为主检验)"
          : ((varHomog === false) ? "Welch's ANOVA (不等方差方差分析，配 Games-Howell 事后多重比较)" : "One-Way ANOVA (单因素方差分析，配 Tukey HSD 事后检验)"),
        remedialTest: useNonParamAnova
          ? "Permutation One-Way ANOVA (多组置换检验)"
          : "Kruskal-Wallis H test (配 Dunn's 检验并进行 FDR 校正)",
        effectSizeMetric: useNonParamAnova ? "Epsilon-squared (ε²) 或 Eta-squared based on H (η_H²)" : "Partial Eta Squared (η_p²) 或 Omega Squared (ω²)",
        assumptionsToCheck: ["1. 组间独立性", "2. 残差正态性", "3. 方差齐性 (Levene 检验)"],
        reportingTemplate: useNonParamAnova
          ? "Kruskal-Wallis H 检验表明多组间差异显著, H(df) = ..., p = ..., ε² = ...。Dunn's 事后检验显示组 A 与组 B 差异显著 (p_adj = ...)。"
          : "单因素方差分析表明主效应显著, F(df1, df2) = ..., p = ..., η_p² = ...。Tukey HSD 事后检验显示组 A 与组 B 差异显著 (p_adj = ...)。",
      };
    } else if (outcome === 'binary') {
      recommendation = {
        primaryTest: "R × 2 Pearson's Chi-Square Test (多组二分类卡方检验)",
        remedialTest: "Fisher-Freeman-Halton Exact Test (小样本精确检验)",
        effectSizeMetric: "Cramer's V",
        assumptionsToCheck: ["1. 观测独立性", "2. 期望频数 >= 5 占 80% 以上"],
        reportingTemplate: "多组卡方检验显示组间比例差异显著, χ²(df, N = ...) = ..., p = ..., Cramer's V = ...。",
      };
    } else if (outcome === 'ordinal') {
      recommendation = {
        primaryTest: "Kruskal-Wallis H test (多组非参数秩和检验，配 Dunn's 事后比较)",
        remedialTest: "Proportional Odds Ordinal Logistic Regression",
        effectSizeMetric: "Epsilon-squared (ε²)",
        assumptionsToCheck: ["1. 组间独立性", "2. 有序测量尺度"],
        reportingTemplate: "Kruskal-Wallis H 检验显示多组等级分布差异显著, H(df) = ..., p = ..., ε² = ...。",
      };
    } else if (outcome === 'count') {
      recommendation = {
        primaryTest: "Poisson / Negative Binomial GLM with Omnibus Likelihood Ratio Test (多组计数广义线性模型)",
        remedialTest: "Kruskal-Wallis H test",
        effectSizeMetric: "Incidence Rate Ratio (IRR) 与 Deviance Explained",
        assumptionsToCheck: ["1. 独立观测", "2. 过离散检验"],
        reportingTemplate: "负二项/泊松 GLM 似然比检验显示组别主效应显著, χ²(df) = ..., p = ...。",
      };
    } else {
      recommendation = {
        primaryTest: "Multi-Group Log-Rank Test with Pairwise Holm/FDR Adjusted Survival Comparisons",
        remedialTest: "Cox Proportional Hazards Model with Group Factor",
        effectSizeMetric: "Group-specific Hazard Ratios (HR)",
        assumptionsToCheck: ["1. 删失独立性", "2. 比例风险假定"],
        reportingTemplate: "多组 Log-rank 检验显示生存分布存在显著差异, χ²(df) = ..., p = ...。",
      };
    }
  } else if (design === 'multi_groups_repeated') {
    if (outcome === 'continuous') {
      var useNonParamRM = (normal === false);
      recommendation = {
        primaryTest: useNonParamRM
          ? "Friedman Test (非参数重复测量秩和检验，配 Conover / Nemenyi 事后检验，因正态性不满足已切换为主检验)"
          : "Repeated Measures ANOVA (重复测量方差分析，配 Mauchly 球形度检验) 或 Linear Mixed-Effects Model (LMM)",
        remedialTest: useNonParamRM
          ? "Linear Mixed-Effects Model with Robust SE (稳健标准误混合效应模型)"
          : "Greenhouse-Geisser / Huynh-Feldt 自由度校正 (若球形度违反 ε < 0.75)；或 Friedman 秩和检验",
        effectSizeMetric: useNonParamRM ? "Kendall's W (肯德尔和谐系数)" : "Partial Eta Squared (η_p²) 或 Generalized Eta Squared (η_G²)",
        assumptionsToCheck: ["1. 球形度假设 (Mauchly's test)", "2. 残差各时点正态性", "3. 个体间独立性"],
        reportingTemplate: useNonParamRM
          ? "Friedman 检验显示各测量时点/条件差异显著, χ²(df) = ..., p = ..., Kendall's W = ...。"
          : "重复测量方差分析显示时间主效应显著, F(df_corr1, df_corr2) = ..., p = ..., η_p² = ...。",
      };
    } else if (outcome === 'binary') {
      recommendation = {
        primaryTest: "Cochran's Q Test (多时点/多条件配对二分类检验) 或 Binary GLMM / GEE",
        remedialTest: "Pairwise McNemar Tests with Holm-Bonferroni Adjustment",
        effectSizeMetric: "Chance-corrected effect size (η_Q²) 或 Population-averaged OR",
        assumptionsToCheck: ["1. 受试对象间相互独立", "2. 结局为二分类变量"],
        reportingTemplate: "Cochran's Q 检验显示重复测量条件下阳性率差异显著, Q(df) = ..., p = ...。",
      };
    } else if (outcome === 'ordinal') {
      recommendation = {
        primaryTest: "Friedman Test (重复测量非参数检验)",
        remedialTest: "Cumulative Link Mixed Model (CLMM, 有序混合效应模型)",
        effectSizeMetric: "Kendall's W",
        assumptionsToCheck: ["1. 受试对象独立", "2. 有序等级尺度"],
        reportingTemplate: "Friedman 检验显示重复测量间等级分布差异显著, χ²(df) = ..., p = ..., W = ...。",
      };
    } else if (outcome === 'count') {
      recommendation = {
        primaryTest: "Poisson / Negative Binomial GLMM or GEE (纵向计数混合效应模型/广义估计方程)",
        remedialTest: "Friedman Test on Count Ranks",
        effectSizeMetric: "Incidence Rate Ratio (IRR)",
        assumptionsToCheck: ["1. 个体内自相关结构设定 (AR1 / Exchangeable)", "2. 过离散检验"],
        reportingTemplate: "纵向负二项 GEE 模型显示时间/条件主效应显著, Wald χ²(df) = ..., p = ..., IRR = ...。",
      };
    } else {
      recommendation = {
        primaryTest: "Andersen-Gill / Prentice-Williams-Peterson (PWP) Recurrent Event Cox Model (复发事件生存模型)",
        remedialTest: "Shared Frailty Survival Model (共享脆弱性生存模型)",
        effectSizeMetric: "Recurrent Event Hazard Ratio (HR)",
        assumptionsToCheck: ["1. 个体内事件相关性校正", "2. 比例风险与独立删失假定"],
        reportingTemplate: "复发事件 Cox 模型显示条件效应显著, HR = ..., 95% CI [... , ...], p = ...。",
      };
    }
  } else if (design === 'correlation') {
    var useNonParamCorr = (normal === false || outcome !== 'continuous');
    recommendation = {
      primaryTest: useNonParamCorr
        ? "Spearman Rank Correlation (斯皮尔曼秩相关，因非正态或非连续尺度已切换为主检验)"
        : "Pearson Correlation Coefficient (皮尔逊积差相关)",
      remedialTest: useNonParamCorr
        ? "Kendall's Tau-b (肯德尔等级相关，针对结值较多或小样本场景)"
        : "Spearman Rank Correlation (斯皮尔曼秩相关) 或 Kendall's Tau-b",
      effectSizeMetric: useNonParamCorr ? "ρ (Spearman's rho) 或 τ_b (Kendall's tau-b)" : "r (相关系数本身即为标准化效应量，r² 为决定系数)",
      assumptionsToCheck: ["1. 双变量正态性 (Pearson 要求)", "2. 单调或线性关联 (散点图排查)", "3. 无极端异常值"],
      reportingTemplate: useNonParamCorr
        ? "斯皮尔曼秩相关分析显示两变量存在显著单调关联, r_s(df) = ..., p = ..., 95% CI [... , ...]。"
        : "皮尔逊相关分析显示两个变量之间存在显著线性关联, r(df) = ..., p = ..., 95% CI [... , ...]。",
    };
  } else if (design === 'regression') {
    if (outcome === 'binary') {
      recommendation = {
        primaryTest: "Binary Logistic Regression (二元 Logistic 回归)",
        remedialTest: "Firth's Penalized Logistic Regression (针对小样本或完全分离现象的惩罚似然估计)",
        effectSizeMetric: "Odds Ratio (OR, 比值比) 与 95% 置信区间，Nagelkerke R²",
        assumptionsToCheck: ["1. 无多重共线性 (VIF < 2.5)", "2. 连续自变量与对数发生比线性相关 (Box-Tidwell 检验)", "3. 无极端影响点"],
        reportingTemplate: "Logistic 回归模型整体显著, χ²(df) = ..., p = ..., Nagelkerke R² = ...。自变量显著预测结局发生, OR = ..., 95% CI [... , ...], p = ...。",
      };
    } else if (outcome === 'ordinal') {
      recommendation = {
        primaryTest: "Proportional Odds Ordinal Logistic Regression (比例优势有序 Logistic 回归)",
        remedialTest: "Generalized Ordinal Logit / Multinomial Logistic Regression (若比例优势假定违反)",
        effectSizeMetric: "Proportional Odds Ratio (OR) 与 95% CI，McFadden Pseudo-R²",
        assumptionsToCheck: ["1. 比例优势假定 (Brant test / 平行线检验)", "2. 无多重共线性 (VIF < 2.5)"],
        reportingTemplate: "有序 Logistic 回归显示自变量显著预测结局等级提升, OR = ..., 95% CI [... , ...], p = ...。",
      };
    } else if (outcome === 'count') {
      recommendation = {
        primaryTest: "Poisson Regression / Negative Binomial Regression (泊松或负二项回归)",
        remedialTest: "Zero-Inflated Negative Binomial (ZINB) 或 Hurdle Model (若存在零膨胀)",
        effectSizeMetric: "Incidence Rate Ratio (IRR, 发生率比) 与 95% CI",
        assumptionsToCheck: ["1. 过离散检验 (Cameron-Trivedi test)", "2. 零膨胀检验", "3. 对数线性暴露时间偏移项 (Offset) 设定"],
        reportingTemplate: "负二项/泊松回归表明自变量显著预测事件计数, IRR = ..., 95% CI [... , ...], p = ...。",
      };
    } else if (outcome === 'time_to_event') {
      recommendation = {
        primaryTest: "Multivariable Cox Proportional Hazards Regression (多因素 Cox 比例风险回归)",
        remedialTest: "Accelerated Failure Time (AFT) Model 或 Time-Varying Covariate Cox Model (若 Schoenfeld 残差违反比例风险)",
        effectSizeMetric: "Hazard Ratio (HR, 风险比) 与 95% CI，Harrell's C-index",
        assumptionsToCheck: ["1. 比例风险假定 (Schoenfeld 残差检验)", "2. 删失独立性", "3. 连续协变量线性度 (Martingale 残差)"],
        reportingTemplate: "多因素 Cox 回归显示自变量为独立预后因素, HR = ..., 95% CI [... , ...], p = ..., C-index = ...。",
      };
    } else {
      // continuous
      var useRobustOLS = (normal === false || varHomog === false);
      recommendation = {
        primaryTest: useRobustOLS
          ? "Multiple Linear Regression with HC3 Robust Standard Errors / Quantile Regression (因正态性或齐方差不满足已启用稳健/分位数回归)"
          : "Multiple Linear Regression (多元线性回归，OLS)",
        remedialTest: "Robust Regression (Huber M / MM 估计) 或 Generalized Additive Model (GAM)",
        effectSizeMetric: "R² 与 Adjusted R² (全模型解释率)，标准化回归系数 β 与偏 η²",
        assumptionsToCheck: ["1. 线性度与无多重共线性 (VIF < 5)", "2. 残差独立性 (Durbin-Watson)", "3. 残差齐方差性 (Breusch-Pagan) 与正态性"],
        reportingTemplate: "多元回归模型整体显著, F(df1, df2) = ..., p = ..., R² = ..., Adj. R² = ...。自变量显著预测因变量, β = ..., t = ..., p = ..., 95% CI [... , ...]。",
      };
    }
  } else {
    // categorical_proportions (binary or ordinal validated above)
    recommendation = {
      primaryTest: (n && n < 30) ? "Fisher's Exact Test (精确概率检验)" : (outcome === 'ordinal' ? "Cochran-Armitage Trend Test / Linear-by-Linear Association Test" : "Pearson's Chi-Square Test (卡方独立性检验)"),
      remedialTest: "Fisher's Exact Test (若任一期望频数 < 5)",
      effectSizeMetric: "Cramer's V / Phi 系数 或 Odds Ratio",
      assumptionsToCheck: ["1. 独立观测", "2. 期望频数 >= 5 准则"],
      reportingTemplate: "列联表检验显示组别间比例分布差异显著, χ²(df) = ..., p = ..., Cramer's V = ...。",
    };
  }

  var multCompPlan = null;
  if (compCount > 1) {
    multCompPlan = {
      totalComparisons: compCount,
      nominalAlpha: 0.05,
      bonferroniThreshold: Number((0.05 / compCount).toFixed(4)),
      recommendedMethod: compCount <= 4 ? "Bonferroni 校正 (严控 FWER 族系误差率)" : "Benjamini-Hochberg (BH) FDR 假发现率控制 (兼顾统计效力与假阳性防范)",
      rationale: "执行 " + compCount + " 次检验若不校正，累积一类错误率膨胀至 " + Number((1 - Math.pow(0.95, compCount)).toFixed(3)) + "。",
      cldRankingRule: "显著性字母标记 (Compact Letter Display, CLD) 黄金铁律：所有组别均值严格按从大到小降序排列，数值最大的组标为 'a'，不显著组共享 'a'，显著组依次向下分配 'b', 'c' 等字母。",
      postHocMethods: {
        allPairwise: "Tukey HSD (方差齐) / Games-Howell (方差不齐)",
        controlVsTreatments: "Dunnett's Test",
        conservativeFWER: "Bonferroni (α = " + Number((0.05 / compCount).toFixed(4)) + ")",
        stepDownFWER: "Holm-Bonferroni",
        highThroughputFDR: "Benjamini-Hochberg (BH)",
      },
    };
  }

  return {
    ok: true,
    result: {
      researchQuestion: rq,
      designEvaluated: design,
      outcomeTypeEvaluated: outcome,
      normalityEvaluated: normal,
      varianceHomogeneityEvaluated: varHomog,
      primaryModel: recommendation.primaryTest,
      remedialModel: recommendation.remedialTest,
      effectSizeMetric: recommendation.effectSizeMetric,
      preregistrationStatement: "本研究依据预注册计划采用 " + recommendation.primaryTest + " 检验假设。若关键假设不满足，则自动转为 " + recommendation.remedialTest + "，绝不依据事后 p 值筛选统计检验 (Anti-p-hacking protocol)。",
      assumptionsChecklist: recommendation.assumptionsToCheck,
      multipleComparisonsAdjustment: multCompPlan,
      apaReportingTemplate: recommendation.reportingTemplate,
      replicationIntegrityNotice: "【学术诚信红线】请确保样本量 n 代表完全独立的生物/实验单元，杜绝将技术重复、重复测量或同一细胞系的分裂视作独立样本 (Pseudoreplication 伪重复)！",
    },
  };
}

// Helper: Compute Compact Letter Display (CLD) from pairwise comparisons using Piepho's sweep-and-absorb algorithm
function computeCldLetters(sortedGroups, overallP, pairwise) {
  var k = sortedGroups.length;
  var letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  if (k === 0) return [];
  if (k === 1) return ['a'];
  if (k === 2) {
    var sig2 = overallP < 0.05;
    if (pairwise && pairwise.length > 0) {
      var p0 = typeof pairwise[0].p_adj === 'number' ? pairwise[0].p_adj :
               (typeof pairwise[0].p_value === 'number' ? pairwise[0].p_value : pairwise[0].p);
      if (typeof p0 === 'number') sig2 = p0 < 0.05;
    }
    return sig2 ? ['a', 'b'] : ['a', 'a'];
  }

  // For k > 2, require complete pairwise comparisons for all k*(k-1)/2 pairs
  var sigMatrix = [];
  var observedMatrix = [];
  for (var i = 0; i < k; i++) {
    sigMatrix[i] = [];
    observedMatrix[i] = [];
    for (var j = 0; j < k; j++) {
      sigMatrix[i][j] = false;
      observedMatrix[i][j] = (i === j);
    }
  }

  for (var pIdx = 0; pIdx < pairwise.length; pIdx++) {
    var pw = pairwise[pIdx] || {};
    var g1 = String(pw.group1 || pw.group_a || pw.from || '').trim();
    var g2 = String(pw.group2 || pw.group_b || pw.to || '').trim();
    var pVal = typeof pw.p_adj === 'number' ? pw.p_adj :
               (typeof pw.p_value === 'number' ? pw.p_value :
               (typeof pw.p === 'number' ? pw.p : null));
    if (!g1 || !g2 || pVal === null || Number.isNaN(pVal)) continue;
    var idx1 = -1;
    var idx2 = -1;
    for (var m = 0; m < k; m++) {
      if (sortedGroups[m].name === g1) idx1 = m;
      if (sortedGroups[m].name === g2) idx2 = m;
    }
    if (idx1 >= 0 && idx2 >= 0 && idx1 !== idx2) {
      observedMatrix[idx1][idx2] = true;
      observedMatrix[idx2][idx1] = true;
      if (pVal < 0.05) {
        sigMatrix[idx1][idx2] = true;
        sigMatrix[idx2][idx1] = true;
      } else {
        sigMatrix[idx1][idx2] = false;
        sigMatrix[idx2][idx1] = false;
      }
    }
  }

  // Verify every pair (r, c) was explicitly provided in pairwise_comparisons
  for (var rCheck = 0; rCheck < k; rCheck++) {
    for (var cCheck = rCheck + 1; cCheck < k; cCheck++) {
      if (!observedMatrix[rCheck][cCheck]) {
        return null;
      }
    }
  }

  // Piepho's insert-and-absorb algorithm
  var columns = [];
  var fullCol = [];
  for (var initIdx = 0; initIdx < k; initIdx++) fullCol.push(true);
  columns.push(fullCol);

  for (var r = 0; r < k; r++) {
    for (var c = r + 1; c < k; c++) {
      if (sigMatrix[r][c]) {
        var nextCols = [];
        for (var colIdx = 0; colIdx < columns.length; colIdx++) {
          var col = columns[colIdx];
          if (col[r] && col[c]) {
            var copy1 = col.slice();
            copy1[r] = false;
            var copy2 = col.slice();
            copy2[c] = false;
            nextCols.push(copy1);
            nextCols.push(copy2);
          } else {
            nextCols.push(col);
          }
        }
        // Absorb redundant columns
        var absorbed = [];
        for (var a = 0; a < nextCols.length; a++) {
          var isSubset = false;
          for (var b = 0; b < nextCols.length; b++) {
            if (a === b) continue;
            var subset = true;
            var equal = true;
            for (var x = 0; x < k; x++) {
              if (nextCols[a][x] && !nextCols[b][x]) subset = false;
              if (nextCols[a][x] !== nextCols[b][x]) equal = false;
            }
            if (subset && (!equal || a > b)) {
              isSubset = true;
              break;
            }
          }
          if (!isSubset) absorbed.push(nextCols[a]);
        }
        columns = absorbed;
      }
    }
  }

  // Sort columns by earliest true index so highest mean gets 'a', next gets 'b', etc.
  columns.sort(function (colA, colB) {
    for (var idx = 0; idx < k; idx++) {
      if (colA[idx] !== colB[idx]) return colA[idx] ? -1 : 1;
    }
    return 0;
  });

  var assigned = [];
  for (var gIdx = 0; gIdx < k; gIdx++) {
    var s = '';
    for (var lIdx = 0; lIdx < columns.length; lIdx++) {
      if (columns[lIdx][gIdx]) {
        s += letters[Math.min(letters.length - 1, lIdx)];
      }
    }
    assigned.push(s || letters[Math.min(letters.length - 1, gIdx)]);
  }
  return assigned;
}

// 15. academic_data_summary
async function academicDataSummaryTool(args) {
  var testType = args && args.test_type;
  if (!testType || typeof testType !== 'string') {
    return fail('请指定统计检验类型 (如 independent_t, one_way_anova, chi_square 等)。');
  }
  var stat = typeof args.test_statistic === 'number' ? args.test_statistic : null;
  var df = args && args.df ? String(args.df).trim() : null;
  var p = typeof args.p_value === 'number' ? args.p_value : null;

  if (stat === null || df === null || p === null) {
    return fail('请提供检验统计量数值 (test_statistic)、自由度 (df) 与精确 p 值 (p_value)。');
  }

  var effType = args && args.effect_size_type ? String(args.effect_size_type) : 'none';
  var effVal = typeof args.effect_size_value === 'number' ? args.effect_size_value : null;
  var ci = Array.isArray(args && args.ci_95) && args.ci_95.length === 2 ? args.ci_95 : null;
  var descriptives = Array.isArray(args && args.group_descriptives) ? args.group_descriptives : [];
  var pairwise = Array.isArray(args && args.pairwise_comparisons) ? args.pairwise_comparisons : [];
  var label = (args && args.comparison_label && String(args.comparison_label).trim()) || 'Target outcome';
  var explicitCldArg = args && typeof args.perform_cld_ranking === 'boolean' ? args.perform_cld_ranking : null;
  var multMethod = (args && args.multiple_comparison_method) || 'none';

  if (descriptives.length > 2 && explicitCldArg === true && pairwise.length === 0) {
    return fail('当组别数量大于 2 且要求生成显著性字母标记 (perform_cld_ranking=true) 时，必须提供事后两两比较结果 (pairwise_comparisons)，严禁仅凭总 p 值推导多组字母分组。');
  }

  // Only perform CLD when 2 groups or when pairwise post-hoc data is explicitly provided for >2 groups
  var doCld = explicitCldArg !== false && (
    (descriptives.length === 2) ||
    (descriptives.length > 2 && pairwise.length > 0)
  );

  // Format p-value in APA style
  var pFormatted = '';
  if (p < 0.001) {
    pFormatted = 'p < .001';
  } else {
    var pStr = p.toFixed(3).replace(/^0/, '');
    pFormatted = 'p = ' + pStr;
  }

  // Format statistical statement
  var statSentence = '';
  var effStr = '';
  if (effVal !== null && effType !== 'none') {
    var effName = effType === 'cohens_d' ? 'd' :
                  effType === 'hedges_g' ? 'g' :
                  effType === 'eta_sq_partial' ? 'η_p²' :
                  effType === 'odds_ratio' ? 'OR' :
                  effType === 'r' ? 'r' : effType;
    effStr = ', ' + effName + ' = ' + effVal.toFixed(2);
  }
  var ciStr = ci ? ', 95% CI [' + ci[0].toFixed(2) + ', ' + ci[1].toFixed(2) + ']' : '';

  if (testType === 'independent_t' || testType === 'paired_t') {
    statSentence = 't(' + df + ') = ' + stat.toFixed(2) + ', ' + pFormatted + effStr + ciStr;
  } else if (testType === 'one_way_anova' || testType === 'two_way_anova') {
    statSentence = 'F(' + df + ') = ' + stat.toFixed(2) + ', ' + pFormatted + effStr + ciStr;
  } else if (testType === 'chi_square') {
    statSentence = 'χ²(' + df + ') = ' + stat.toFixed(2) + ', ' + pFormatted + effStr;
  } else if (testType === 'pearson_correlation' || testType === 'spearman_correlation') {
    statSentence = 'r(' + df + ') = ' + stat.toFixed(2) + ', ' + pFormatted + ciStr;
  } else if (testType === 'linear_regression') {
    // Regression reporting without conflating t and beta
    statSentence = 't(' + df + ') = ' + stat.toFixed(2) + ', ' + pFormatted + (effVal !== null ? (', β = ' + effVal.toFixed(2)) : '') + ciStr;
  } else {
    statSentence = 'Stat(' + df + ') = ' + stat.toFixed(2) + ', ' + pFormatted + effStr + ciStr;
  }

  // Sort groups descending by mean (highest mean first)
  var sortedDescriptives = descriptives.slice().sort(function (a, b) {
    return b.mean - a.mean;
  });

  var cldList = [];
  if (sortedDescriptives.length > 0 && doCld) {
    var computedLetters = computeCldLetters(sortedDescriptives, p, pairwise);
    if (!computedLetters) {
      if (explicitCldArg === true) {
        return fail('多组显著性字母标记 (CLD) 计算失败：pairwise_comparisons 未完整覆盖全部 k*(k-1)/2 个组对或组名与 group_descriptives 不匹配。');
      }
      doCld = false;
    } else {
      for (var dIdx = 0; dIdx < sortedDescriptives.length; dIdx++) {
        var item = sortedDescriptives[dIdx];
        cldList.push({
          rank: dIdx + 1,
          name: item.name,
          mean: item.mean,
          sd: item.sd,
          n: item.n,
          cld_letter: computedLetters[dIdx],
        });
      }
    }
  }

  // Generate three-line table (三线表) with exact Student's t critical value for CI
  var tableMd = '';
  if (sortedDescriptives.length > 0) {
    if (doCld && cldList.length > 1) {
      tableMd += '| Rank | Group / Condition | N | Mean ± SD | 95% CI (Student\'s t) | Sig. Letter (CLD) |\n';
      tableMd += '| :---: | :--- | :---: | :---: | :---: | :---: |\n';
      for (var i = 0; i < cldList.length; i++) {
        var g = cldList[i];
        var sem = g.sd / Math.sqrt(g.n);
        var tCrit = (g.n > 1) ? getStudentTCriticalValue(g.n - 1) : 1.96;
        var margin = tCrit * sem;
        var low = (g.mean - margin).toFixed(2);
        var high = (g.mean + margin).toFixed(2);
        tableMd += '| ' + g.rank + ' | ' + g.name + ' | ' + g.n + ' | ' + g.mean.toFixed(2) + ' ± ' + g.sd.toFixed(2) + ' | [' + low + ', ' + high + '] | **' + g.cld_letter + '** |\n';
      }
      var adjustmentDesc = (multMethod && multMethod !== 'none')
        ? ('under ' + multMethod + ' multiple-comparison adjustment')
        : 'based on unadjusted pairwise comparisons';
      tableMd += '\n*Note: Groups are ranked in descending order of sample means (highest = a). Means followed by different lowercase letters differ significantly at p < 0.05 ' + adjustmentDesc + ' (Compact Letter Display).*';
    } else {
      tableMd += '| Group / Condition | N | Mean | SD | 95% CI (Student\'s t) |\n';
      tableMd += '| :--- | :---: | :---: | :---: | :---: |\n';
      for (var j = 0; j < sortedDescriptives.length; j++) {
        var sg = sortedDescriptives[j];
        var semG = sg.sd / Math.sqrt(sg.n);
        var tCritG = (sg.n > 1) ? getStudentTCriticalValue(sg.n - 1) : 1.96;
        var marginG = tCritG * semG;
        var lowG = (sg.mean - marginG).toFixed(2);
        var highG = (sg.mean + marginG).toFixed(2);
        tableMd += '| ' + sg.name + ' | ' + sg.n + ' | ' + sg.mean.toFixed(2) + ' | ' + sg.sd.toFixed(2) + ' | [' + lowG + ', ' + highG + '] |\n';
      }
    }
  }

  var narrativeAPA = (p < 0.05) ?
    '统计检验表明，' + label + '差异具有统计学显著性，' + statSentence + '。' :
    '统计检验表明，' + label + '未达到统计学显著性水平，' + statSentence + '。';

  return {
    ok: true,
    result: {
      comparisonLabel: label,
      apaFormattedString: statSentence,
      narrativeTextAPA7: narrativeAPA,
      threeLineTableMarkdown: tableMd || null,
      compactLetterDisplay: (doCld && cldList.length > 0) ? cldList : null,
      significanceVerdict: p < 0.05 ? 'Statistically Significant (p < .05)' : 'Not Statistically Significant (p >= .05)',
      natureReportingGuidelineCheck: {
        exactPValueProvided: p >= 0.001,
        effectSizePresent: effVal !== null,
        confidenceIntervalPresent: ci !== null,
        degreesOfFreedomDeclared: true,
        cldDescendingOrderVerified: doCld && cldList.length > 0,
        pseudoreplicationAudit: 'Verified: Ensure N reflects independent experimental units.',
      },
    },
  };
}

// 16. scientific_figure_designer
async function scientificFigureDesignerTool(args) {
  var claim = args && args.main_scientific_claim;
  var journal = args && args.target_journal;
  var archetype = args && args.plot_archetype;
  var backend = args && args.backend;

  if (!claim || typeof claim !== 'string' || !journal || typeof journal !== 'string' || !archetype || !backend) {
    return fail('请提供核心科学发现 (main_scientific_claim)、目标期刊 (target_journal)、图表原型 (plot_archetype) 与后端模式 (backend)。');
  }

  var supportedArchetypes = ['multi_panel_composite', 'violin_box_jitter', 'dose_time_response', 'correlation_heatmap', 'volcano_differential_plot'];
  if (supportedArchetypes.indexOf(archetype) < 0) {
    return fail('不支持的图表原型: ' + archetype + '。支持的原型包括: ' + supportedArchetypes.join(', '));
  }

  var supportedBackends = ['python_matplotlib', 'r_ggplot2', 'planning_only', 'spec_only'];
  if (supportedBackends.indexOf(backend) < 0) {
    return fail('不支持的绘图后端模式: ' + backend + '。支持的后端包括: python_matplotlib, r_ggplot2, planning_only');
  }

  var colWidth = args.column_width || 'double_column_180mm';
  var widthMm = colWidth === 'single_column_89mm' ? 89 : (colWidth === 'intermediate_120mm' ? 120 : 180);
  var widthInches = Number((widthMm / 25.4).toFixed(2));
  var bilingualMode = (args && args.bilingual_mode) || 'english_only';
  var isDouble = widthMm >= 150;

  var effectiveXLabel = (args.x_label && String(args.x_label).trim()) || 'Experimental Condition';
  var effectiveYLabel = (args.y_label && String(args.y_label).trim()) || 'Measured Response Value';
  var groupCtrl = 'Control';
  var groupTreat = 'Treatment';

  if (bilingualMode === 'chinese_only') {
    effectiveXLabel = (args.x_label && String(args.x_label).trim()) || '实验处理条件';
    effectiveYLabel = (args.y_label && String(args.y_label).trim()) || '测定响应指标';
    groupCtrl = '对照组';
    groupTreat = '给药处理组';
  } else if (bilingualMode === 'dual_bilingual') {
    effectiveXLabel = (args.x_label && String(args.x_label).trim()) || 'Condition / 实验条件';
    effectiveYLabel = (args.y_label && String(args.y_label).trim()) || 'Response Value / 测定响应指标';
    groupCtrl = 'Control / 对照组';
    groupTreat = 'Treatment / 给药处理组';
  }

  // Safe string escaping for generated scripts
  var safeClaim = escapeCodeString(claim);
  var safeXLabel = escapeCodeString(effectiveXLabel);
  var safeYLabel = escapeCodeString(effectiveYLabel);
  var safeGroupCtrl = escapeCodeString(groupCtrl);
  var safeGroupTreat = escapeCodeString(groupTreat);

  var errorBarType = (args && args.error_bar_type) || 'ci95';
  var errorBandExpr = '1.96 * ctrl_traj.std(axis=0) / np.sqrt(10)';
  var treatBandExpr = '1.96 * treat_traj.std(axis=0) / np.sqrt(10)';
  var rRibbonMult = '1.96';
  var errorCaptionDesc = 'Data are presented as mean with shaded 95% confidence intervals (CI).';
  if (errorBarType === 'sem') {
    errorBandExpr = 'ctrl_traj.std(axis=0) / np.sqrt(10)';
    treatBandExpr = 'treat_traj.std(axis=0) / np.sqrt(10)';
    rRibbonMult = '1.0';
    errorCaptionDesc = 'Data are presented as mean ± s.e.m.';
  } else if (errorBarType === 'sd') {
    errorBandExpr = 'ctrl_traj.std(axis=0)';
    treatBandExpr = 'treat_traj.std(axis=0)';
    rRibbonMult = 'sqrt(10)';
    errorCaptionDesc = 'Data are presented as mean ± s.d.';
  }

  var panelRoles = [];
  var captionDraft = '';

  if (archetype === 'multi_panel_composite') {
    panelRoles = [
      { panel: 'a', role: 'Context / Baseline Distribution', description: '核心处理组与对照组基线与效应分布对比', chartType: 'Boxplot + Jittered biological replicates' },
      { panel: 'b', role: 'Dynamic Kinetics / Dose-Time Trajectory', description: '不同时间点或剂量梯度下的连续动态响应曲线（带误差带）', chartType: 'Line plot with error bands (' + errorBarType.toUpperCase() + ')' },
      { panel: 'c', role: 'Feature Correlation Matrix', description: '关键表型指标与多维特征的相关性矩阵热图', chartType: 'Lower-triangle correlation heatmap' },
      { panel: 'd', role: 'Differential Volcano Overview', description: '全量特征效应量 (log2FC) 与统计显著性 (-log10 P) 火山图', chartType: 'Volcano differential scatter plot' },
    ];
    captionDraft = 'Fig. 1 | ' + safeClaim + '. ' +
      'a, Comparison of target phenotype between conditions (center line, median; box limits, upper and lower quartiles; whiskers, 1.5× IQR; dots represent individual biological replicates, n = 30 per group). ' +
      'b, Time-dependent dynamic response trajectory. ' + errorCaptionDesc + ' ' +
      'c, Pairwise Pearson correlation matrix across key features. ' +
      'd, Volcano plot of differential effect size (log2 fold change) versus statistical significance (-log10 P). Two-tailed tests; *P < 0.05, **P < 0.01, ***P < 0.001.';
  } else if (archetype === 'dose_time_response') {
    panelRoles = [
      { panel: 'a', role: 'Dynamic Kinetics / Dose-Time Response', description: '连续时间点或剂量梯度下的组间动态轨迹与误差带对比', chartType: 'Line plot with shaded error bands (' + errorBarType.toUpperCase() + ')' },
    ];
    captionDraft = 'Fig. 1 | ' + safeClaim + '. ' +
      'a, Dose/time-dependent response trajectory comparing ' + safeGroupCtrl + ' and ' + safeGroupTreat + ' (n = 10 independent biological replicates per time point). ' + errorCaptionDesc + ' Two-tailed repeated-measures comparison.';
  } else if (archetype === 'correlation_heatmap') {
    panelRoles = [
      { panel: 'a', role: 'Multivariate Correlation Matrix', description: '多维核心变量间的成对相关系数矩阵', chartType: 'Annotated correlation heatmap' },
    ];
    captionDraft = 'Fig. 1 | ' + safeClaim + '. ' +
      'a, Pairwise Pearson correlation heatmap across measured variables (n = 50 independent observations). Color scale encodes correlation coefficient r from -1.0 to +1.0.';
  } else if (archetype === 'volcano_differential_plot') {
    panelRoles = [
      { panel: 'a', role: 'Differential Magnitude vs. Significance', description: '效应量 (log2FC) 与多重校正显著性 (-log10 P) 火山分布图', chartType: 'Volcano scatter plot with threshold guides' },
    ];
    captionDraft = 'Fig. 1 | ' + safeClaim + '. ' +
      'a, Volcano plot displaying log2(fold change) against -log10(P value). Dashed lines indicate significance threshold (P = 0.05, -log10 P = 1.30) and magnitude cutoff (|log2FC| = 1.0).';
  } else {
    // violin_box_jitter
    panelRoles = [
      { panel: 'a', role: 'Primary Group Comparison (Distribution + Individual Replicates)', description: '组间中位数、四分位距与个体生物重复散点叠加图', chartType: 'Violin / Boxplot + Jittered individual points' },
    ];
    captionDraft = 'Fig. 1 | ' + safeClaim + '. ' +
      'a, Comparison of ' + safeYLabel + ' across ' + safeXLabel + ' (center line, median; box limits, 25th and 75th percentiles; whiskers, 1.5× IQR; points represent individual biological replicates, n = 30 per group). Two-tailed Student\'s or Welch\'s t-test.';
  }

  var codeSnippet = null;
  var figW = widthInches.toFixed(2);
  var figH = archetype === 'multi_panel_composite'
    ? (isDouble ? '5.6' : '4.8')
    : (isDouble ? '3.5' : (colWidth === 'intermediate_120mm' ? '3.0' : '2.8'));
  var heightMm = archetype === 'multi_panel_composite' ? (isDouble ? 140 : 120) : 75;

  if (backend === 'python_matplotlib') {
    var headerSetup = [
      '# Publication-ready scientific plot script (Nature/Science grade)',
      '# Generated by Cindy Academic Research Suite (ARS)',
      'import matplotlib.pyplot as plt',
      'import seaborn as sns',
      'import numpy as np',
      'import pandas as pd',
      '',
      '# ==========================================================================',
      '# 1. THEME & RC_PARAMS SETUP (CRITICAL ORDER TO PREVENT DPI & FONT SHRINKING)',
      '# --------------------------------------------------------------------------',
      '# [避坑铁律 1] 必须先调用 sns.set_theme()，然后再设置 plt.rcParams！',
      '# 若顺序颠倒，Seaborn 会内部重置所有 rcParams 参数，导致字号变回默认值并被大幅缩放！',
      '# [避坑铁律 2] 画布尺寸必须 1:1 匹配实际栏宽(' + widthMm + 'mm=' + figW + 'in)！',
      '# [避坑铁律 3] 高分辨率(dpi=300)仅在 savefig 中指定，严禁在 plt.figure() 中强设导致布局变形！',
      '# ==========================================================================',
      'sns.set_theme(style="ticks")',
      '',
      '# 跨平台中英文无缝兼容字体栈 + 负号乱码彻底修复',
      'plt.rcParams["font.sans-serif"] = [',
      '    "Arial", "Helvetica", "DejaVu Sans",         # 英文首选（顶刊标准无衬线）',
      '    "Microsoft YaHei", "SimHei",                 # Windows 常见中文字体',
      '    "PingFang SC", "Hiragino Sans GB",           # macOS 苹果中文',
      '    "Source Han Sans SC", "WenQuanYi Micro Hei", # Linux 开源思源/微米黑',
      '    "sans-serif"',
      ']',
      'plt.rcParams["axes.unicode_minus"] = False  # 彻底解决中文字体下坐标轴负号变方块乱码！',
      'plt.rcParams["font.size"] = 7',
      'plt.rcParams["axes.labelsize"] = 7',
      'plt.rcParams["xtick.labelsize"] = 6',
      'plt.rcParams["ytick.labelsize"] = 6',
      'plt.rcParams["legend.fontsize"] = 6',
      'plt.rcParams["axes.linewidth"] = 0.6',
      'plt.rcParams["lines.linewidth"] = 1.0',
      'plt.rcParams["pdf.fonttype"] = 42  # TrueType 嵌入，支持 Adobe Illustrator 无损再编辑',
      'plt.rcParams["ps.fonttype"] = 42',
      '',
      '# 2. Okabe-Ito 色盲友好学术色板 (Colorblind-Friendly Palette)',
      'OKABE_ITO = ["#0072B2", "#D55E00", "#009E73", "#E69F00", "#56B4E9", "#CC79A7"]',
      '',
    ];

    var bodyCode = [];
    if (archetype === 'multi_panel_composite') {
      bodyCode = [
        '# 3. Multi-panel 2x2 canvas setup with 1:1 constrained physical layout (' + widthMm + ' mm)',
        'fig, axes = plt.subplots(2, 2, figsize=(' + figW + ', ' + figH + '), layout="constrained")',
        'ax_a, ax_b, ax_c, ax_d = axes[0, 0], axes[0, 1], axes[1, 0], axes[1, 1]',
        'np.random.seed(42)',
        '',
        '# Panel a: Boxplot + Jittered individual replicates',
        'ctrl = np.random.normal(loc=65.0, scale=8.0, size=30)',
        'treat = np.random.normal(loc=78.0, scale=7.5, size=30)',
        'df_a = pd.DataFrame({"Group": ["' + safeGroupCtrl + '"] * 30 + ["' + safeGroupTreat + '"] * 30, "Value": np.concatenate([ctrl, treat])})',
        'palette = {"' + safeGroupCtrl + '": OKABE_ITO[0], "' + safeGroupTreat + '": OKABE_ITO[1]}',
        'sns.boxplot(data=df_a, x="Group", y="Value", palette=palette, width=0.45, showcaps=True, boxprops=dict(alpha=0.7), ax=ax_a)',
        'sns.stripplot(data=df_a, x="Group", y="Value", color="black", alpha=0.6, size=3.0, jitter=0.18, ax=ax_a)',
        'ax_a.set_xlabel("' + safeXLabel + '", fontweight="bold")',
        'ax_a.set_ylabel("' + safeYLabel + '", fontweight="bold")',
        '',
        '# Panel b: Dose/Time response trajectory with error bands (' + errorBarType.toUpperCase() + ')',
        'time_pts = np.linspace(0, 24, 7)',
        'ctrl_traj = np.sin(time_pts / 5) * 10 + 60 + np.random.normal(0, 2, (10, 7))',
        'treat_traj = np.sin(time_pts / 5) * 25 + 60 + np.random.normal(0, 2.5, (10, 7))',
        'ax_b.plot(time_pts, ctrl_traj.mean(axis=0), color=OKABE_ITO[0], marker="o", label="' + safeGroupCtrl + '")',
        'ax_b.fill_between(time_pts, ctrl_traj.mean(axis=0) - ' + errorBandExpr + ', ctrl_traj.mean(axis=0) + ' + errorBandExpr + ', color=OKABE_ITO[0], alpha=0.2)',
        'ax_b.plot(time_pts, treat_traj.mean(axis=0), color=OKABE_ITO[1], marker="s", label="' + safeGroupTreat + '")',
        'ax_b.fill_between(time_pts, treat_traj.mean(axis=0) - ' + treatBandExpr + ', treat_traj.mean(axis=0) + ' + treatBandExpr + ', color=OKABE_ITO[1], alpha=0.2)',
        'ax_b.set_xlabel("Time (h)", fontweight="bold")',
        'ax_b.set_ylabel("' + safeYLabel + '", fontweight="bold")',
        'ax_b.legend(frameon=False)',
        '',
        '# Panel c: Correlation heatmap',
        'corr = pd.DataFrame(np.random.randn(50, 4), columns=["F1", "F2", "F3", "Out"]).corr()',
        'mask = np.triu(np.ones_like(corr, dtype=bool))',
        'sns.heatmap(corr, mask=mask, cmap="coolwarm", vmin=-1, vmax=1, annot=True, fmt=".2f", cbar=False, square=True, ax=ax_c)',
        '',
        '# Panel d: Volcano differential plot',
        'log2fc = np.random.normal(0, 1.5, 300)',
        'neg_log_p = -np.log10(np.clip(np.random.beta(0.5, 5, 300), 1e-10, 1))',
        'v_colors = [OKABE_ITO[1] if (fc > 1 and p > 1.3) else (OKABE_ITO[0] if (fc < -1 and p > 1.3) else "#999999") for fc, p in zip(log2fc, neg_log_p)]',
        'ax_d.scatter(log2fc, neg_log_p, c=v_colors, s=8, alpha=0.7, edgecolors="none")',
        'ax_d.axhline(1.30, ls="--", color="black", lw=0.5)',
        'ax_d.set_xlabel("log2(Fold Change)", fontweight="bold")',
        'ax_d.set_ylabel("-log10(P value)", fontweight="bold")',
        '',
        '# Format spines and panel tags (a, b, c, d)',
        'for tag, panel_ax in zip(["a", "b", "c", "d"], [ax_a, ax_b, ax_c, ax_d]):',
        '    panel_ax.spines["top"].set_visible(False)',
        '    panel_ax.spines["right"].set_visible(False)',
        '    panel_ax.text(-0.15, 1.08, tag, transform=panel_ax.transAxes, fontsize=9, fontweight="bold", va="top")',
      ];
    } else {
      var singlePlotLines = [];
      if (archetype === 'dose_time_response') {
        singlePlotLines = [
          '# Plotting: Line plot with error bands (' + errorBarType.toUpperCase() + ')',
          'time_pts = np.linspace(0, 24, 7)',
          'np.random.seed(42)',
          'ctrl_traj = np.sin(time_pts / 5) * 10 + 60 + np.random.normal(0, 2, (10, 7))',
          'treat_traj = np.sin(time_pts / 5) * 25 + 60 + np.random.normal(0, 2.5, (10, 7))',
          'ax.plot(time_pts, ctrl_traj.mean(axis=0), color=OKABE_ITO[0], marker="o", label="' + safeGroupCtrl + '")',
          'ax.fill_between(time_pts, ctrl_traj.mean(axis=0) - ' + errorBandExpr + ',',
          '                ctrl_traj.mean(axis=0) + ' + errorBandExpr + ', color=OKABE_ITO[0], alpha=0.2)',
          'ax.plot(time_pts, treat_traj.mean(axis=0), color=OKABE_ITO[1], marker="s", label="' + safeGroupTreat + '")',
          'ax.fill_between(time_pts, treat_traj.mean(axis=0) - ' + treatBandExpr + ',',
          '                treat_traj.mean(axis=0) + ' + treatBandExpr + ', color=OKABE_ITO[1], alpha=0.2)',
          'ax.legend(frameon=False)',
        ];
      } else if (archetype === 'correlation_heatmap') {
        singlePlotLines = [
          '# Plotting: Correlation heatmap with lower-triangle mask',
          'np.random.seed(42)',
          'data = np.random.randn(50, 4)',
          'corr = pd.DataFrame(data, columns=["Feature A", "Feature B", "Feature C", "Outcome"]).corr()',
          'mask = np.triu(np.ones_like(corr, dtype=bool))',
          'sns.heatmap(corr, mask=mask, cmap="coolwarm", vmin=-1, vmax=1, annot=True, fmt=".2f",',
          '            cbar_kws={"label": "Pearson r"}, square=True, ax=ax)',
        ];
      } else if (archetype === 'volcano_differential_plot') {
        singlePlotLines = [
          '# Plotting: Volcano differential scatter plot',
          'np.random.seed(42)',
          'log2fc = np.random.normal(0, 1.5, 500)',
          'pvals = np.random.beta(0.5, 5, 500)',
          'neg_log_p = -np.log10(np.clip(pvals, 1e-10, 1))',
          'colors = [OKABE_ITO[3] if (fc > 1 and p > 1.3) else (OKABE_ITO[0] if (fc < -1 and p > 1.3) else "#999999") for fc, p in zip(log2fc, neg_log_p)]',
          'ax.scatter(log2fc, neg_log_p, c=colors, s=10, alpha=0.7, edgecolors="none")',
          'ax.axhline(1.30, ls="--", color="black", lw=0.6)',
          'ax.axvline(1.0, ls="--", color="black", lw=0.6)',
          'ax.axvline(-1.0, ls="--", color="black", lw=0.6)',
        ];
      } else {
        singlePlotLines = [
          '# Simulated reproducible sample data',
          'np.random.seed(42)',
          'ctrl = np.random.normal(loc=65.0, scale=8.0, size=30)',
          'treat = np.random.normal(loc=78.0, scale=7.5, size=30)',
          'df = pd.DataFrame({',
          '    "Group": ["' + safeGroupCtrl + '"] * 30 + ["' + safeGroupTreat + '"] * 30,',
          '    "Value": np.concatenate([ctrl, treat])',
          '})',
          '',
          '# Plotting: Violin + Boxplot + Jittered individual replicates',
          'palette = {"' + safeGroupCtrl + '": OKABE_ITO[0], "' + safeGroupTreat + '": OKABE_ITO[1]}',
          'sns.violinplot(data=df, x="Group", y="Value", palette=palette, inner=None, alpha=0.25, cut=0, ax=ax)',
          'sns.boxplot(data=df, x="Group", y="Value", palette=palette, width=0.35,',
          '            showcaps=True, boxprops=dict(alpha=0.7), whiskerprops=dict(linewidth=0.8),',
          '            medianprops=dict(color="black", linewidth=1.2), ax=ax)',
          'sns.stripplot(data=df, x="Group", y="Value", color="black", alpha=0.6,',
          '              size=3.5, jitter=0.18, ax=ax)',
        ];
      }

      bodyCode = [
        '# 3. Canvas setup with 1:1 constrained physical layout (' + widthMm + ' mm)',
        'fig, ax = plt.subplots(figsize=(' + figW + ', ' + figH + '), layout="constrained")',
        '',
        singlePlotLines.join('\n'),
        '',
        '# Spines and labels formatting',
        'ax.spines["top"].set_visible(False)',
        'ax.spines["right"].set_visible(False)',
        'ax.set_xlabel("' + safeXLabel + '", fontweight="bold")',
        'ax.set_ylabel("' + safeYLabel + '", fontweight="bold")',
        'ax.text(-0.15, 1.05, "a", transform=ax.transAxes, fontsize=9, fontweight="bold", va="top")',
      ];
    }

    var exportLines = [
      '',
      '# High-resolution export (Vector PDF & 300+ DPI PNG)',
      'plt.savefig("figure_output.pdf", format="pdf", bbox_inches="tight")',
      'plt.savefig("figure_output.png", dpi=300, bbox_inches="tight")',
      'print("Figure exported successfully: figure_output.pdf and figure_output.png")',
    ];

    codeSnippet = headerSetup.concat(bodyCode).concat(exportLines).join('\n');
  } else if (backend === 'r_ggplot2') {
    var rHeader = [
      '# Publication-ready scientific plot script (R ggplot2 - ' + archetype + ')',
      '# Generated by Cindy Academic Research Suite (ARS)',
      'library(ggplot2)',
      'library(patchwork)',
      '',
      '# Okabe-Ito Colorblind-Friendly Palette',
      'okabe_ito <- c("#0072B2", "#D55E00", "#009E73", "#E69F00", "#56B4E9")',
      'set.seed(42)',
      '',
    ];

    var rBody = [];
    if (archetype === 'multi_panel_composite') {
      rBody = [
        '# Panel a: Boxplot + Jittered replicates',
        'df_a <- data.frame(',
        '  Group = factor(rep(c("' + safeGroupCtrl + '", "' + safeGroupTreat + '"), each = 30)),',
        '  Value = c(rnorm(30, mean = 65, sd = 8), rnorm(30, mean = 78, sd = 7.5))',
        ')',
        'p_a <- ggplot(df_a, aes(x = Group, y = Value, fill = Group)) +',
        '  geom_boxplot(width = 0.45, alpha = 0.7, outlier.shape = NA, linewidth = 0.4) +',
        '  geom_jitter(width = 0.15, size = 1.2, alpha = 0.6) +',
        '  scale_fill_manual(values = okabe_ito) +',
        '  labs(x = "' + safeXLabel + '", y = "' + safeYLabel + '") +',
        '  theme_classic(base_size = 7) + theme(legend.position = "none")',
        '',
        '# Panel b: Dose/Time response trajectory (' + errorBarType.toUpperCase() + ')',
        'time_pts <- seq(0, 24, length.out = 7)',
        'df_b <- data.frame(',
        '  Time = rep(time_pts, 2),',
        '  Group = factor(rep(c("' + safeGroupCtrl + '", "' + safeGroupTreat + '"), each = 7)),',
        '  Mean = c(sin(time_pts / 5) * 10 + 60, sin(time_pts / 5) * 25 + 60),',
        '  SE = rep(c(0.8, 1.1), each = 7)',
        ')',
        'df_b$Band <- ' + rRibbonMult + ' * df_b$SE',
        'p_b <- ggplot(df_b, aes(x = Time, y = Mean, color = Group, fill = Group)) +',
        '  geom_ribbon(aes(ymin = Mean - Band, ymax = Mean + Band), alpha = 0.2, color = NA) +',
        '  geom_line(linewidth = 0.7) + geom_point(size = 1.5) +',
        '  scale_color_manual(values = okabe_ito) + scale_fill_manual(values = okabe_ito) +',
        '  labs(x = "Time (h)", y = "' + safeYLabel + '") + theme_classic(base_size = 7)',
        '',
        '# Panel c: Correlation heatmap',
        'vars <- c("F1", "F2", "F3", "Out")',
        'df_c <- expand.grid(Var1 = vars, Var2 = vars)',
        'df_c$r <- c(1.0, 0.62, -0.35, 0.78, 0.62, 1.0, -0.21, 0.54, -0.35, -0.21, 1.0, -0.48, 0.78, 0.54, -0.48, 1.0)',
        'p_c <- ggplot(df_c, aes(x = Var1, y = Var2, fill = r)) +',
        '  geom_tile(color = "white") +',
        '  geom_text(aes(label = sprintf("%.2f", r)), size = 2.0) +',
        '  scale_fill_gradient2(low = okabe_ito[1], mid = "white", high = okabe_ito[2], midpoint = 0, limits = c(-1, 1)) +',
        '  labs(x = NULL, y = NULL) + theme_classic(base_size = 7)',
        '',
        '# Panel d: Volcano plot',
        'df_d <- data.frame(log2FC = rnorm(300, 0, 1.5), negLogP = -log10(rbeta(300, 0.5, 5)))',
        'df_d$Status <- ifelse(df_d$log2FC > 1 & df_d$negLogP > 1.3, "Up", ifelse(df_d$log2FC < -1 & df_d$negLogP > 1.3, "Down", "NS"))',
        'p_d <- ggplot(df_d, aes(x = log2FC, y = negLogP, color = Status)) +',
        '  geom_point(size = 1.0, alpha = 0.7) +',
        '  geom_hline(yintercept = 1.30, linetype = "dashed", linewidth = 0.4) +',
        '  geom_vline(xintercept = c(-1, 1), linetype = "dashed", linewidth = 0.4) +',
        '  scale_color_manual(values = c("Down" = okabe_ito[1], "NS" = "#999999", "Up" = okabe_ito[2])) +',
        '  labs(x = "log2(Fold Change)", y = "-log10(P value)") +',
        '  theme_classic(base_size = 7) + theme(legend.position = "none")',
        '',
        '# Assemble 2x2 composite figure with patchwork tags (a, b, c, d)',
        'p <- (p_a + p_b) / (p_c + p_d) + plot_annotation(tag_levels = "a")',
      ];
    } else if (archetype === 'dose_time_response') {
      rBody = [
        '# Dose/Time response data with error bands (' + errorBarType.toUpperCase() + ')',
        'time_pts <- seq(0, 24, length.out = 7)',
        'df <- data.frame(',
        '  Time = rep(time_pts, 2),',
        '  Group = factor(rep(c("' + safeGroupCtrl + '", "' + safeGroupTreat + '"), each = 7)),',
        '  Mean = c(sin(time_pts / 5) * 10 + 60, sin(time_pts / 5) * 25 + 60),',
        '  SE = rep(c(0.8, 1.1), each = 7)',
        ')',
        'df$Band <- ' + rRibbonMult + ' * df$SE',
        '',
        'p <- ggplot(df, aes(x = Time, y = Mean, color = Group, fill = Group)) +',
        '  geom_ribbon(aes(ymin = Mean - Band, ymax = Mean + Band), alpha = 0.2, color = NA) +',
        '  geom_line(linewidth = 0.8) +',
        '  geom_point(size = 1.8) +',
        '  scale_color_manual(values = okabe_ito) +',
        '  scale_fill_manual(values = okabe_ito) +',
        '  labs(x = "' + safeXLabel + '", y = "' + safeYLabel + '", tag = "a") +',
        '  theme_classic(base_size = 7, base_family = "Helvetica") +',
        '  theme(axis.title = element_text(face = "bold"), plot.tag = element_text(face = "bold", size = 9))',
      ];
    } else if (archetype === 'correlation_heatmap') {
      rBody = [
        '# Correlation matrix heatmap data',
        'vars <- c("Feature A", "Feature B", "Feature C", "Outcome")',
        'df <- expand.grid(Var1 = vars, Var2 = vars)',
        'df$r <- c(1.0, 0.62, -0.35, 0.78, 0.62, 1.0, -0.21, 0.54, -0.35, -0.21, 1.0, -0.48, 0.78, 0.54, -0.48, 1.0)',
        '',
        'p <- ggplot(df, aes(x = Var1, y = Var2, fill = r)) +',
        '  geom_tile(color = "white", linewidth = 0.4) +',
        '  geom_text(aes(label = sprintf("%.2f", r)), size = 2.2) +',
        '  scale_fill_gradient2(low = okabe_ito[1], mid = "white", high = okabe_ito[2], midpoint = 0, limits = c(-1, 1), name = "Pearson r") +',
        '  labs(x = "' + safeXLabel + '", y = "' + safeYLabel + '", tag = "a") +',
        '  coord_fixed() +',
        '  theme_classic(base_size = 7, base_family = "Helvetica") +',
        '  theme(axis.title = element_text(face = "bold"), plot.tag = element_text(face = "bold", size = 9))',
      ];
    } else if (archetype === 'volcano_differential_plot') {
      rBody = [
        '# Volcano differential expression/effect plot data',
        'df <- data.frame(',
        '  log2FC = rnorm(500, mean = 0, sd = 1.5),',
        '  negLogP = -log10(pmax(rbeta(500, 0.5, 5), 1e-10))',
        ')',
        'df$Category <- ifelse(df$log2FC > 1 & df$negLogP > 1.30, "Up",',
        '               ifelse(df$log2FC < -1 & df$negLogP > 1.30, "Down", "NS"))',
        '',
        'p <- ggplot(df, aes(x = log2FC, y = negLogP, color = Category)) +',
        '  geom_point(size = 1.2, alpha = 0.75) +',
        '  geom_hline(yintercept = 1.30, linetype = "dashed", linewidth = 0.4, color = "black") +',
        '  geom_vline(xintercept = c(-1.0, 1.0), linetype = "dashed", linewidth = 0.4, color = "black") +',
        '  scale_color_manual(values = c("Down" = okabe_ito[1], "NS" = "#999999", "Up" = okabe_ito[2])) +',
        '  labs(x = "' + safeXLabel + '", y = "' + safeYLabel + '", tag = "a") +',
        '  theme_classic(base_size = 7, base_family = "Helvetica") +',
        '  theme(axis.title = element_text(face = "bold"), legend.position = "none", plot.tag = element_text(face = "bold", size = 9))',
      ];
    } else {
      // violin_box_jitter
      rBody = [
        '# Violin + Boxplot + Jittered individual biological replicates',
        'df <- data.frame(',
        '  Group = factor(rep(c("' + safeGroupCtrl + '", "' + safeGroupTreat + '"), each = 30)),',
        '  Value = c(rnorm(30, mean = 65, sd = 8), rnorm(30, mean = 78, sd = 7.5))',
        ')',
        '',
        'p <- ggplot(df, aes(x = Group, y = Value, fill = Group)) +',
        '  geom_violin(alpha = 0.25, trim = FALSE, color = NA) +',
        '  geom_boxplot(width = 0.35, alpha = 0.7, outlier.shape = NA, color = "black", linewidth = 0.4) +',
        '  geom_jitter(width = 0.15, size = 1.5, alpha = 0.6, color = "black") +',
        '  scale_fill_manual(values = okabe_ito) +',
        '  labs(x = "' + safeXLabel + '", y = "' + safeYLabel + '", tag = "a") +',
        '  theme_classic(base_size = 7, base_family = "Helvetica") +',
        '  theme(',
        '    axis.title = element_text(face = "bold"),',
        '    axis.line = element_line(linewidth = 0.4),',
        '    legend.position = "none",',
        '    plot.tag = element_text(face = "bold", size = 9)',
        '  )',
      ];
    }

    var rExport = [
      '',
      '# Export exact physical dimensions (' + widthMm + ' mm)',
      'ggsave("figure_output.pdf", plot = p, width = ' + widthMm + ', height = ' + heightMm + ', units = "mm", device = cairo_pdf)',
      'ggsave("figure_output.png", plot = p, width = ' + widthMm + ', height = ' + heightMm + ', units = "mm", dpi = 300)',
      'message("Figure exported successfully.")',
    ];

    codeSnippet = rHeader.concat(rBody).concat(rExport).join('\n');
  }

  return {
    ok: true,
    result: {
      targetJournal: journal,
      coreClaim: claim,
      plotArchetype: archetype,
      backend: backend,
      layoutSpecifications: {
        physicalWidthMm: widthMm,
        physicalWidthInches: widthInches,
        recommendedExportFormat: 'Vector PDF or EPS (TrueType fonts embedded)',
        rasterResolution: '300 DPI for continuous tone, 600-1200 DPI for line art',
        typographyHierarchy: 'Helvetica / Arial sans-serif: Panel labels (a, b, c) bold 8pt; Axis titles 7pt; Tick labels 6pt',
      },
      bilingualModeConfig: {
        activeMode: bilingualMode,
        effectiveXLabel: effectiveXLabel,
        effectiveYLabel: effectiveYLabel,
        unicodeMinusFixed: true,
      },
      dpiAndTypographySafeguards: {
        dpiConflictMechanism: '若在 plt.figure() 中指定 dpi=300，屏幕渲染器会以 300 DPI 缩放元素，并与后续的 tight_layout() 或 constrained 布局发生边距误算与元素错位；正确做法是仅在 plt.savefig(..., dpi=300) 中指定。',
        themeResetTrap: 'Seaborn 的 sns.set_theme() 会在调用时彻底重置所有 Matplotlib rcParams。必须严格确保 sns.set_theme() 在前，自定义 plt.rcParams 在后。',
        bilingualFontSupport: '已启用包含 Arial, Microsoft YaHei, PingFang SC, SimHei 的跨平台字体栈，并显式指定 axes.unicode_minus = False，彻底解决负号方块与中文字符丢失问题。',
      },
      multipanelArchitecture: panelRoles,
      colorAccessibilityGuidance: {
        recommendedPalette: 'Okabe-Ito (Black #000000, Orange #E69F00, Sky Blue #56B4E9, Green #009E73, Yellow #F0E442, Blue #0072B2, Vermilion #D55E00)',
        colorblindCompliance: 'Deuteranopia, Protanopia, and Tritanopia compliant',
        redundantEncodingNotice: '强制使用冗余视觉编码（除颜色外，必须结合不同点形状、虚实线型或纹理区分）',
      },
      figureCaptionTemplate: captionDraft,
      generatedPlotScript: codeSnippet,
      natureChecklistPassed: {
        errorBarDefinitionExplicit: true,
        individualDataPointsShown: archetype === 'multi_panel_composite' || archetype === 'violin_box_jitter' || archetype === 'volcano_differential_plot',
        exactNStated: true,
        twoTailedTestDeclared: true,
      },
    },
  };
}

// Helper: Recursively truncate nested strings, arrays, and objects so serialized JSON is guaranteed <= maxChars
function truncateDeepValue(val, maxStrLen, maxArrLen, depth) {
  if (depth > 6) return '[MAX_DEPTH_TRUNCATED]';
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val.length > maxStrLen ? val.slice(0, maxStrLen) + '... [TRUNCATED]' : val;
  }
  if (typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    var sliced = val.slice(0, maxArrLen);
    var outArr = [];
    for (var i = 0; i < sliced.length; i++) {
      outArr.push(truncateDeepValue(sliced[i], maxStrLen, maxArrLen, depth + 1));
    }
    return outArr;
  }
  var outObj = {};
  var keys = Object.keys(val);
  var maxKeys = Math.min(keys.length, maxArrLen * 4);
  for (var kIdx = 0; kIdx < maxKeys; kIdx++) {
    var k = keys[kIdx];
    outObj[k] = truncateDeepValue(val[k], maxStrLen, maxArrLen, depth + 1);
  }
  return outObj;
}

function enforceResultLimit(payload, maxChars) {
  var limit = typeof maxChars === 'number' && maxChars > 0 ? maxChars : MAX_RESULT_CHARS;
  var jsonStr = JSON.stringify(payload);
  if (!jsonStr || jsonStr.length <= limit) return payload;

  var origLen = jsonStr.length;
  var tiers = [
    { str: 1000, arr: 5 },
    { str: 400, arr: 3 },
    { str: 150, arr: 2 },
  ];

  for (var t = 0; t < tiers.length; t++) {
    var candidate = {
      truncated: true,
      originalLength: origLen,
      notice: '返回内容超过上限 (' + origLen + ' 字符)，已执行递归截断保护。',
      data: truncateDeepValue(payload, tiers[t].str, tiers[t].arr, 0),
    };
    if (JSON.stringify(candidate).length <= limit) {
      return candidate;
    }
  }

  // Final hard-cap fallback guaranteed to stay within limit
  var previewBudget = Math.max(100, limit - 260);
  return {
    truncated: true,
    originalLength: origLen,
    notice: '返回内容超过上限 (' + origLen + ' 字符)，已执行硬上限截断保护。',
    preview: jsonStr.slice(0, previewBudget) + '... [TRUNCATED]',
  };
}

var handlers = {
  pipeline_stage_orchestrator: pipelineStageOrchestratorTool,
  socratic_research_guide: socraticResearchGuideTool,
  verify_doi: verifyDoiTool,
  search_crossref: searchCrossrefTool,
  three_way_lit_scan: threeWayLitScanTool,
  academic_integrity_audit: academicIntegrityAuditTool,
  academic_paper_analysis: academicPaperAnalysisTool,
  claim_citation_alignment: claimCitationAlignmentTool,
  academic_style_audit: academicStyleAuditTool,
  peer_review_evaluation: peerReviewEvaluationTool,
  rebuttal_matrix_coach: rebuttalMatrixCoachTool,
  author_disclosure_statement: authorDisclosureStatementTool,
  bibtex_format_converter: bibtexFormatConverterTool,
  statistical_analysis_advisor: statisticalAnalysisAdvisorTool,
  academic_data_summary: academicDataSummaryTool,
  scientific_figure_designer: scientificFigureDesignerTool,
};

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;
  var handler = handlers[message.tool];
  if (!handler) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: '未知学术工具: ' + message.tool,
    });
    return;
  }

  try {
    var result = await handler(message.args || {}, message.callId);
    if (result && result.ok) {
      var bounded = enforceResultLimit(result.result, MAX_RESULT_CHARS);
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
    formatAuthorsApa7: formatAuthorsApa7,
    extractDate: extractDate,
    getStudentTCriticalValue: getStudentTCriticalValue,
    computeCldLetters: computeCldLetters,
    enforceResultLimit: enforceResultLimit,
    pipelineStageOrchestratorTool: pipelineStageOrchestratorTool,
    socraticResearchGuideTool: socraticResearchGuideTool,
    verifyDoiTool: verifyDoiTool,
    searchCrossrefTool: searchCrossrefTool,
    threeWayLitScanTool: threeWayLitScanTool,
    academicIntegrityAuditTool: academicIntegrityAuditTool,
    academicPaperAnalysisTool: academicPaperAnalysisTool,
    claimCitationAlignmentTool: claimCitationAlignmentTool,
    academicStyleAuditTool: academicStyleAuditTool,
    peerReviewEvaluationTool: peerReviewEvaluationTool,
    rebuttalMatrixCoachTool: rebuttalMatrixCoachTool,
    authorDisclosureStatementTool: authorDisclosureStatementTool,
    bibtexFormatConverterTool: bibtexFormatConverterTool,
    statisticalAnalysisAdvisorTool: statisticalAnalysisAdvisorTool,
    academicDataSummaryTool: academicDataSummaryTool,
    scientificFigureDesignerTool: scientificFigureDesignerTool,
  };
}
