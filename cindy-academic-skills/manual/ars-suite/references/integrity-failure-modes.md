# 学术诚信七大阻断门禁与引文保真度审查规范

本指南定义投稿前（Stage 2.5）与定稿前（Stage 4.5）必须执行的学术诚信与方法学合规审查标准。配合 `academic_integrity_audit`、`verify_doi` 与 `claim_citation_alignment` 工具使用。

---

## 一、七类高危学术研究失败模式 (Seven Structural Failure Modes)

在人工智能辅助科研与论文撰写过程中，以下 7 类结构性缺陷最易导致撤稿、拒稿或学术不端质疑。`academic_integrity_audit` 工具将对其进行逐项排查：

### Mode 1: 虚构与幻觉引用 (Fabricated or Unverified Citations)
- **风险表现:** 凭空生成看似合法的作者、标题、期刊名或占位符 DOI（如 `10.1000/fake`、`10.xxxx/...`），或引用了根本不存在的幽灵文献。
- **门禁要求:**
  - 正文每一条参考文献必须具备格式合法的真实 DOI；
  - 仅凭文本中包含 DOI 字符串**不得直接判定通过**，必须调用 `verify_doi` 向 Crossref 官方注册库发起实时核验，确认元数据完全一致后方可放行。

### Mode 2: 基准失衡与选择性对比 (Unbalanced Baselines & Cherry-Picking)
- **风险表现:** 在方法或实验对比中，刻意挑选过时的基线模型、省略标准对照组（Negative/Positive Control），或对竞争方法使用未调优的默认参数。
- **门禁要求:** 实验章节必须明示对照组设置、基线选择依据及公平一致的评估协议。

### Mode 3: 实现伪影与数据泄露误判 (Implementation Artifacts & Data Leakage)
- **风险表现:** 将代码 Bug、特征工程中的未来信息泄露（Test-set Leakage）、批次效应（Batch Effect）或仪器基线漂移产生的高指标误判为“科学新发现”。
- **门禁要求:** 必须由作者人工签字确认已完成训练/测试集物理隔离、阴性对照归零校准及异常高指标的代码级复核。

### Mode 4: 缺失阴性对照与混杂失控 (Missing Controls & Uncontrolled Confounders)
- **风险表现:** 观察到处理组表型变化即直接归因于核心自变量，未设立空白对照、溶剂对照（Vehicle Control）或消融实验以排除混杂变量。
- **门禁要求:** 每一个核心因果主张必须配对相应的对照实验或稳健性检验（Robustness Check）。

### Mode 5: 过度宣称与越界外推 (Overclaiming & Unbounded Extrapolation)
- **风险表现:** 基于有限样本、单一物种或特定合成数据集的结果，使用 `undoubtedly proves`、`completely solves`、`彻底证明`、`颠覆性突破` 等绝对化词汇，或将相关性直接表述为因果律。
- **门禁要求:** 自动扫描并拦截绝对化断言词汇，强制在 Discussion 中补充结论适用的样本与环境边界条件。

### Mode 6: 方法学前后不一与 p 值操纵 (Methodological Inconsistency & p-Hacking)
- **风险表现:** 事后随意剔除“离群值”直至 $p < 0.05$、在多项指标中仅报告显著项（Selective Reporting / HARKing），或对多重比较不做显著性水平校正。
- **门禁要求:** 报告精确 $p$ 值、效应量与置信区间；样本剔除标准必须在实验前预先定义并在 Methods 中透明披露。

### Mode 7: 数据与代码不可溯源 (Unverifiable Provenance & Missing Availability)
- **风险表现:** 缺乏数据可用性声明（Data Availability Statement）与代码开源/归档说明，导致研究结果成为无法复核的黑箱。
- **门禁要求:** 必须在文末规范声明原始数据、统计脚本与模型权重的存储仓库（如 Zenodo、Figshare、GitHub、NCBI SRA）或合规获取途径。

---

## 二、引文主张保真度三级核查机制 (Citation-Claim Fidelity)

即使一篇文献的 DOI 真实存在（通过了 Mode 1），仍常出现“张冠李戴”或“曲解原意”的问题。调用 `claim_citation_alignment` 执行三级核查：

### 1. 语义与概念重合度核查 (Conceptual Overlap)
- 兼容中英文分词与 Unicode 学术术语比对，检验正文引述句的核心概念是否真实出现在被引文献的摘要或正文中。

### 2. 极性与方向一致性核查 (Polarity & Directionality Check)
- **核心防线:** 严密检测肯定与否定极性反转。
- 例如：被引文献结论为 *"Treatment X did not significantly improve survival"*，而正文写为 *"Previous studies showed Treatment X improves survival [1]"* —— 尽管关键词高度重合，但极性截然相反，工具将直接判定为 `CONTRADICTION_POLARITY_MISMATCH`（极性矛盾）并予以拦截。
- 同时精准识别英文单词边界（`\b`），确保包含 `no` 字母组合的正常肯定词（如 `novel`, `knowledge`, `canonical`）不会被误判为否定词。

### 3. 证据层级匹配核查 (Evidence Tier Alignment)
- 避免将原作在 Discussion 中的“推测性展望”当作正文中的“既定实证事实”来引用；
- 引用具体数值、公式或阈值时，建议在工作笔记中标注原文献的具体页码、图表号或章节位置。
