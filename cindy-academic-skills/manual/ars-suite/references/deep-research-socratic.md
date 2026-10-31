# 深度研究、苏格拉底式引导与 3W 文献扫描

## 1. 苏格拉底式对话引导 (Socratic Dialogue)

当用户意图表现为选题模糊、需要启发或缺少明确假说时，优先启动苏格拉底模式：
- **第一层 (Clarification):** 探寻研究兴趣的核心动机，将宏泛主题聚焦为具体的经验事实。
- **第二层 (Delineation & Boundaries):** 设立研究范围边界，明确研究对象、时空约束与理论视角。
- **第三层 (FINER 评价体系):**
  - **F (Feasible):** 可行性（数据与方法是否可获取）
  - **I (Interesting):** 启发性（是否具备现实或学术趣味）
  - **N (Novel):** 创新性（是否填补未解盲区）
  - **E (Ethical):** 伦理性（是否符合学术规范）
  - **R (Relevant):** 相关性（对学科发展或政策制定的意义）

## 2. 3W 三段式文献扫描 (Three-Way Literature Scan)

在快速文献对比与综述撰写时，采用 3W 矩阵对代表性文献进行结构化提取：
- **Why (为什么做):** 作者提出的核心研究痛点与理论缺口是什么？
- **How (如何做):** 采用的方法论、数据样本量、对照组设置与分析工具是什么？
- **What (得到了什么):** 经验发现、主要实证结论及该结论的有效性边界（边界条件）。

## 3. PRISMA 系统性文献检索纪律

严格遵循 PRISMA (Preferred Reporting Items for Systematic Reviews and Meta-Analyses) 标准流程：
1. **Identification:** 使用 `search_crossref` 构建布尔搜索式，记录检索条目数；
2. **Screening:** 初筛标题与摘要，排除无关学科文献；
3. **Eligibility:** 全文通读或深读方法章节，依据纳入/排除标准审查；
4. **Included:** 纳入最终文献库，并使用 `verify_doi` 锁定出版元数据。
