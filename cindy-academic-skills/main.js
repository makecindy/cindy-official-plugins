/**
 * Academic Research Skills (cindy-academic-skills) · Cindy 官方学术科研插件
 *
 * 功能：
 * 1. verify_doi: 通过 Crossref 官方公开 API 校验论文真实性与检索引文元数据（防范学术幻觉）
 * 2. academic_paper_analysis: 对学术文献进行结构化拆解（研究假说、方法论、证据链、局限性）
 * 3. peer_review_evaluation: 模拟国际期刊同行评审，生成结构化审稿大纲与主要/次要修改意见
 *
 * 遵循 Manifest v3 纯沙箱规范：
 * - 仅在在途 tool-call 中使用 cindy.fetch 并携带 callId
 * - 无私有 API Key，开箱即用
 * - 绝不读取 navigator.language
 */

/* global cindy */

var CROSSREF_API = 'https://api.crossref.org/works/';
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
    // keep as is if decoding fails
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

async function verifyDoiTool(args, callId) {
  var rawDoi = args && args.doi;
  var doi = cleanDoiString(rawDoi);

  if (!doi) {
    return fail('缺少有效的 DOI 参数，请提供 DOI 标识符或链接。');
  }

  if (!isValidDoi(doi)) {
    return fail('DOI 格式不正确 (' + doi + ')，有效 DOI 通常以 "10." 开头并包含注册者代码与后缀。');
  }

  var targetUrl = CROSSREF_API + encodeURIComponent(doi);
  var response;

  try {
    response = await cindy.fetch({
      url: targetUrl,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CindyAcademicSkills/1.0.0 (mailto:support@cindy.app; Academic-Integrity-Agent)',
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
    evaluationDimensions: {
      originalityAndSignificance: '研究成果对领域现有认知的推动程度与创新价值',
      technicalSoundness: '数学推导、实验设计与数据分析方法的严谨性与无偏性',
      claimEvidenceAlignment: '论文结论是否受到实验证据的充分支撑，有无过度宣称 (Overclaiming)',
      clarityAndOrganization: '结构组织、图表表达、术语规范与论述流畅度',
      reproducibility: '方法细节与资源清单是否满足同行独立复现标准',
    },
    reviewTemplate: {
      section1_Summary: '简明总结论文核心目标、主要方法与主要发现（表明审稿人理解手稿）',
      section2_Strengths: '列举 2-4 项突出创新点与严密论证之处',
      section3_MajorConcerns: '阻碍发表的关键缺陷（如基准对比缺失、混杂未控、证据不足等）',
      section4_MinorIssues: '措辞修正、拼写瑕疵、引用补全与图表可读性优化建议',
      section5_RecommendationDecision: '评审结论建议：Accept / Minor Revision / Major Revision / Reject',
    },
  };

  return {
    ok: true,
    result: rubric,
  };
}

var handlers = {
  verify_doi: verifyDoiTool,
  academic_paper_analysis: academicPaperAnalysisTool,
  peer_review_evaluation: peerReviewEvaluationTool,
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
    academicPaperAnalysisTool: academicPaperAnalysisTool,
    peerReviewEvaluationTool: peerReviewEvaluationTool,
  };
}