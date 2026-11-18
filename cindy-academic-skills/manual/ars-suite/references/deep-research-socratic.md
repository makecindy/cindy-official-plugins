# 深度文献探索、苏格拉底选题引导与系统性综述指南

本指南为 Cindy 智能体提供从科研选题孵化、可证伪假说设计到 PRISMA 系统性文献检索与 3W 对比合成的完整规范。配合 `socratic_research_guide`、`search_crossref`、`verify_doi` 与 `three_way_lit_scan` 工具使用。

---

## 一、苏格拉底式三阶选题引导协议 (Socratic Mentoring)

当研究者的初始想法较为宽泛（如“我想研究人工智能在医疗中的应用”）时，智能体不得直接替用户包办结论，而应通过三轮递进式苏格拉底追问协助收拢焦点：

### 第一阶：现象聚焦与核心悖论 (From Topic to Puzzle)
- **目标:** 将宏大的学科领域收敛为具体的“反常现象”或“未解悖论”。
- **引导提问模板:**
  1. “在您关注的这一领域中，目前主流做法最常失败的具体场景是什么？”
  2. “哪两组既有文献针对同一问题得出了截然相反的实证结论？”
  3. “如果将研究对象限定在某一特定亚群或极端条件下，传统理论是否依然成立？”

### 第二阶：变量操作化与机制路径 (Operationalization & Mechanism)
- **目标:** 明确核心自变量（Intervention/Exposure）、因变量（Outcome）、中介变量（Mediator）与调节变量（Moderator）。
- **引导提问模板:**
  1. “您计划用什么具体、可观测的定量指标来度量核心概念（避免不可测量的抽象名词）？”
  2. “自变量影响因变量的内在因果链条是什么？是否存在混杂因素（Confounder）同时影响两者？”

### 第三阶：可证伪性检验 (Falsifiability Check)
- **目标:** 确保提出的假说遵循波普尔可证伪性原则（Popperian Falsifiability）。
- **黄金自检:** “什么样的实验结果或数据分布一旦出现，就能够直接推翻（证伪）您的核心假说？”若无论结果如何都能自圆其说，则该问题不具备科学检验价值，必须重构。

---

## 二、四大国际标准研究问题结构化框架

根据学科属性自动匹配最佳问题构建框架：

| 框架名称 | 适用研究类型 | 核心要素拆解 |
| :--- | :--- | :--- |
| **PICOS** | 临床医学、实验干预、农林生物测定 | **P** (Population 研究对象/种群)<br>**I** (Intervention 干预/处理措施)<br>**C** (Comparison 对照组/安慰剂/基线)<br>**O** (Outcome 主要与次要结局指标)<br>**S** (Study Design 实验设计类型) |
| **PECO** | 环境科学、流行病学、观察性队列 | **P** (Population) · **E** (Exposure 暴露因素) · **C** (Comparator 非暴露参照) · **O** (Outcome) |
| **SPIDER** | 质性研究、混合方法、社会与行为科学 | **S** (Sample 样本) · **PI** (Phenomenon of Interest 关注现象) · **D** (Design 设计) · **E** (Evaluation 评估) · **R** (Research type 研究类型) |
| **CIMO** | 管理科学、工程系统、算法与架构设计 | **C** (Context 应用场景) · **I** (Intervention 算法/机制设计) · **M** (Mechanism 作用机理) · **O** (Outcome 性能提升指标) |

---

## 三、FINER 五维量化评估标准

调用 `socratic_research_guide` 时，按以下 5 项标准对候选研究问题逐一打分（1–10 分）：
1. **Feasible (可行性):** 样本量是否充足？实验设备、算力或公开数据集在当前周期内是否可获取？
2. **Interesting (启发性):** 问题是否挑战了直觉常识或触及领域热点痛点？
3. **Novel (创新性):** 是验证性重复、渐进式改进（Incremental），还是开辟了新机制/新方法？
4. **Ethical (伦理性):** 是否符合人类受试者保护（赫尔辛基宣言）、实验动物福利（3R 原则）与数据隐私规范？
5. **Relevant (相关性):** 研究结论能否直接指导临床实践、工程部署、政策制定或后续理论演进？

---

## 四、竞争性假说构建 (Rival Hypotheses Matrix)

为避免确认偏误（Confirmation Bias），每项研究必须同时设立主假说与至少 2 个竞争性假说：
- **$H_0$ (零假说 / Null Hypothesis):** 观测到的差异纯粹由随机抽样误差引起；
- **$H_1$ (主机制假说 / Primary Hypothesis):** 处理因素通过理论预期的路径 A 显著改变结局；
- **$H_{alt1}$ (替代机制假说 / Rival Mechanism):** 结局改变并非由路径 A 引起，而是由于副产物或路径 B 介导；
- **$H_{alt2}$ (混杂偏倚假说 / Confounding Hypothesis):** 表观关联由未受控的批次效应、基线不平衡或测量仪器漂移所致。
- **区分性预测 (Discriminating Prediction):** 设计专门的阳性对照（Positive Control）、阴性对照（Negative Control）或消融实验（Ablation Study）以正面排除 $H_{alt1}$ 与 $H_{alt2}$。

---

## 五、3W 三段式文献对比矩阵 (Three-Way Literature Scan)

调用 `three_way_lit_scan` 对多篇核心文献进行交叉综述时，严禁将文献写成“A 做了什么，B 做了什么，C 做了什么”的流水账，必须按 **Why–How–What** 三维对齐：

1. **Why (问题与理论定位):** 各篇文献切入的科学痛点有何演进关系？前提假设有何分歧？
2. **How (方法学与证据强度):**
   - 对比样本规模、实验设计层级（RCT vs 观察性；体内 vs 体外；真实数据集 vs 合成数据）；
   - 识别方法学缺陷（如未做多重比较校正、缺乏独立外部验证集）。
3. **What (核心结论与边界条件):**
   - 提炼跨文献的一致性规律（Consensus）；
   - 剖析结论冲突的根源（Divergence：是物种差异、剂量窗口不同，还是评价指标定义不一致？）；
   - 导出本研究的立项切入点（Research Niche）。

---

## 六、PRISMA 2020 系统性文献检索与防幻觉纪律

1. **布尔检索式构建:** 结合同义词与截词符构建透明检索策略，例如：`("machine learning" OR "deep learning") AND ("crop pest" OR "plant protection") AND ("acoustic" OR "vibration")`。
2. **四阶段筛选流转 (Identification → Screening → Eligibility → Included):**
   - 明确记录初检命中数、去重后数量、初筛排除理由及全文精读纳入数量。
3. **强制 DOI 真实性核验:**
   - 凡通过 `search_crossref` 检索或用户提供的文献，纳入综述前必须经 `verify_doi` 核实出版商、年份、作者与标题，严禁凭记忆编造引用。
