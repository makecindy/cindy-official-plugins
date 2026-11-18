# 学术论文结构化写作、IMRaD 规范与文风校准指南

本指南为 Cindy 智能体提供从章节蓝图规划、段落论证构建到顶刊文风润色的完整执行准则。配合 `academic_paper_analysis`、`academic_style_audit`、`author_disclosure_statement` 与 `bibtex_format_converter` 工具使用。

---

## 一、IMRaD 各章节顶刊写作规范

### 1. 标题与摘要 (Title & Abstract)
- **标题 (Title):** 控制在 12–18 个英文词（或 25 个汉字）以内；优先采用**结论驱动型标题**（Declarative Title，直接点明核心发现）或**方法-对象型标题**，避免使用 `A Study of...`、`Investigation into...` 等冗余开头。
- **结构化摘要 (150–250 词，严守五句法):**
  1. **Context (1–2 句):** 领域宏观背景与重要性；
  2. **Gap (1 句):** 现有研究尚未解决的核心瓶颈（通常以 `However,` 引导）；
  3. **Approach (1–2 句):** 本文提出的实验设计、样本规模或算法架构（`Here we show...` / `In this study, we...`）；
  4. **Results (2–3 句):** 最核心的定量发现，必须包含具体效应量、提升幅度或置信区间，拒绝空洞定性描述；
  5. **Impact (1 句):** 研究发现对理论推进或实际应用的实质意义。

### 2. 引言：三段式倒金字塔漏斗 (Introduction Funnel)
- **第一层：已知共识 (What is known):** 从具体的研究问题切入（切忌从过于宽泛的教科书常识讲起），梳理近 3–5 年的代表性文献。
- **第二层：未知缺口与矛盾 (Knowledge Gap):** 明确指出现有文献的三类局限之一：
  - *经验缺口:* 缺乏特定人群、极端工况或长期追踪的实证数据；
  - *方法缺口:* 既有测量手段或基线模型存在混杂偏倚、高计算复杂度或高方差；
  - *理论冲突:* 既往研究得出了相互矛盾的结论，亟需机制层面的调和。
- **第三层：本文方案与核心贡献 (Our Contribution):** 清晰列出本文的实验路径与 2–3 条可验证的核心贡献（避免夸张吹嘘，使用客观动词如 `demonstrate`、`quantify`、`establish`）。

### 3. 方法：可复现性闭环 (Methods & Reproducibility)
方法章节必须让同行无需联系作者即可独立复现：
- **实验对象与样本量依据:** 交代样本来源、纳入/排除标准（Inclusion/Exclusion Criteria）、伦理审批编号（IRB/IACUC）及样本量功效计算依据（Power Analysis）。
- **实验设计与随机盲法:** 明确生物学重复（Biological Replicates）与技术重复（Technical Replicates）的区分、随机分组策略与盲法执行情况。
- **模型、仪器与试剂:** 硬件型号、试剂批号、软件版本号、随机种子（Random Seed）、超参数搜索空间及训练停止准则。
- **统计分析小节:** 必须单独设立 `Statistical Analysis` 小节，声明双侧/单侧检验、正态性与方差齐性诊断方法、多重比较校正策略及显著性阈值（如 $\alpha = 0.05$）。

### 4. 结果：图表驱动的证据链 (Results)
- **客观陈述，严禁越界议论:** Results 仅陈述“实验观察到了什么”，切勿在此处大篇幅展开与文献的对比或机制推测（留给 Discussion）。
- **段落四步结构:**
  1. **小节动机:** 一句话说明为了验证哪个子假说而开展了本组实验；
  2. **实验设置简述:** 简要交代关键分组与测定指标（引导读者看某张图，如 `(Fig. 2a)`）；
  3. **定量对比呈现:** 按核心趋势报告均值、离散度、效应量与精确 $p$ 值（调用 `academic_data_summary` 生成规范语句）；
  4. **局部小结:** 一句话总结本实验得出的直接证据结论。

### 5. 讨论：正金字塔理论升华 (Discussion)
- **第一段：核心发现重申:** 直接回答 Introduction 提出的研究问题，概括最核心的实证发现（不重复枯燥数字）。
- **中间段：文献对话与机制解释:** 将本文发现与既有文献对比（为何一致或为何不同？），阐明背后的物理、生物或社会学机制。
- **倒数第二段：研究局限性 (Limitations):** 坦诚交代样本范围、横断面设计、残余混杂或计算假设的边界条件，并将局限性转化为未来的具体研究方向。
- **末段：总结陈词 (Conclusion):** 精炼收束全文核心信息，重申实证边界内的科学价值。

---

## 二、CER 段落级论证架构与语气校准

### 1. CER (Claim-Evidence-Reasoning) 段落自检
正文每一个论述段落必须满足：
- **Claim (主张):** 段首主题句明确提出本段唯一论点；
- **Evidence (证据):** 紧随具体的实验数据、图表索引或已通过 `verify_doi` 核验的文献引用；
- **Reasoning (推理):** 解释证据为何能支撑主张，并主动排除至少一种替代性解释（Alternative Explanation）。

### 2. 认识论语气分级 (Epistemic Hedging)
根据研究设计类型严格区分因果词与相关词：
- **随机对照试验 (RCT) / 严格受控干预实验:** 可使用因果动词（`causes`, `induces`, `leads to`, `drives`, `显著提升了`）。
- **观察性研究 / 横断面调查 / 相关性分析:** 严禁使用因果动词！必须使用关联性表述（`is associated with`, `correlates with`, `covaries with`, `predicts`, `与……呈显著正相关`）。
- **机制假说推演:** 必须加上模态限定词（`may be attributed to`, `plausibly stems from`, `suggests a potential role of`, `可能归因于`）。

---

## 三、去模型化（De-AI-ification）高频替换对照表

配合 `academic_style_audit` 工具，在润色时强制执行以下替换：

| 禁用 AI 套话 / 模糊词 | 顶刊规范替代表达 |
| :--- | :--- |
| `delve into` / `deep dive into` | `examine`, `investigate`, `analyze`, `quantify` |
| `tapestry of` / `mosaic of` | `collection of`, `set of`, `spectrum of` |
| `testament to` / `beacon of` | `evidence of`, `indicator of`, `demonstrates` |
| `pivotal` / `crucial` / `paramount` | 删去空洞形容词，直接用效应量或百分比数据说话 |
| `it is important to note that` | 直接删去引导壳，陈述核心分句 |
| `various` / `numerous` / `a lot of` | 写出确切数量（如 `across 4 cohorts`）或具体分类 |
| `significantly better` (无统计检验时) | `substantially higher`, `improved by 14.2%`（仅在 $p < \alpha$ 时用 `statistically significant`） |
| `undoubtedly proves` / `彻底证明` | `provides empirical support for`, `is consistent with`, `实证数据支持` |
| `revolutionary breakthrough` / `颠覆性突破` | `measurable advance`, `improves upon prior baselines by...` |

---

## 四、CRediT 14 项作者贡献分类标准

配合 `author_disclosure_statement` 工具生成作者贡献声明时，严格对应国际标准 CRediT 14 角色：
1. **Conceptualization (概念构思):** 提出研究想法与总体目标；
2. **Methodology (方法论):** 设计实验方案或建立模型；
3. **Software (软件开发):** 编写代码、算法实现与测试；
4. **Validation (验证核实):** 实验结果的独立复现与核验；
5. **Formal Analysis (正式分析):** 运用统计学或数学工具分析数据；
6. **Investigation (调查实验):** 执行具体实验操作或数据采集；
7. **Resources (资源提供):** 提供实验材料、菌株、临床样本或算力设备；
8. **Data Curation (数据管理):** 清洗、注释与维护研究数据集；
9. **Writing – Original Draft (初稿撰写):** 撰写论文核心初稿；
10. **Writing – Review & Editing (审阅与编辑):** 批判性修改、润色与定稿；
11. **Visualization (可视化):** 设计与绘制出版级科研图表；
12. **Supervision (监督指导):** 课题统筹管理与学术指导；
13. **Project Administration (项目管理):** 协调研究进度与合规事务；
14. **Funding Acquisition (经费获取):** 申请并获得支撑本研究的科研基金。
