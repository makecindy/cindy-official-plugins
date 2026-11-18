# 科研全生命周期 10 阶段调度与材料凭证管理规范

本指南定义从研究立项、数据分析、配图设计、论文撰写、同行评审到返修定稿的 10 阶段状态机流转规则。配合 `pipeline_stage_orchestrator` 工具使用。

---

## 一、10 阶段科研生命周期与准入/准出契约

系统将复杂的实证科学研究拆解为 10 个逻辑严密的阶段，严禁跨阶段跳跃而遗漏前置质量验证：

| 阶段代号 | 阶段名称 | 核心任务与调用工具 | 准出交付物 (Exit Deliverables) |
| :--- | :--- | :--- | :--- |
| **Stage 1** | **研究探索与立项**<br>`Stage_1_Research` | 运用 `socratic_research_guide` 聚焦科学问题，通过 `search_crossref`、`verify_doi` 与 `three_way_lit_scan` 构建文献证据库 | 经 FINER 评估的《研究问题与竞争性假说简报》及核验完毕的 DOI 文献表 |
| **Stage 1.5** | **实证数据分析**<br>`Stage_1_5_DataAnalysis` | 调用 `statistical_analysis_advisor` 诊断数据分布与假设前提，使用 `academic_data_summary` 生成三线表与 CLD 显著性标记 | 包含精确检验统计量、自由度、$p$ 值、效应量与 95% CI 的统计结果汇总 |
| **Stage 1.8** | **出版级科研配图**<br>`Stage_1_8_FigureDesign` | 调用 `scientific_figure_designer` 规划多面板叙事架构（a–d），生成防字体缩水、色盲友好的 Python/R 绘图脚本 | 矢量图脚本（PDF/SVG + 300 DPI PNG）与规范图注（Figure Legends） |
| **Stage 2** | **手稿结构化起草**<br>`Stage_2_Write` | 遵循 IMRaD 与 CER 论证链撰写初稿，调用 `claim_citation_alignment` 与 `academic_style_audit` 校准文风 | 逻辑闭环、去 AI 套话的完整论文初稿（Manuscript Draft） |
| **Stage 2.5** | **审前诚信阻断门禁**<br>`Stage_2_5_Integrity` | 调用 `academic_integrity_audit` 排查 7 类失败模式（未核验 DOI、缺对照、过度宣称、p-hacking 等） | **阻断式门禁：** 仅当 `integrity_audit_passed = true` 时放行至 Stage 3；否则退回 Stage 2 修复 |
| **Stage 3** | **多视角同行评审**<br>`Stage_3_Review` | 调用 `peer_review_evaluation` 从主编、方法学、小同行、可复现性及魔鬼代言人五视角盲审打分 | 审稿意见书与明确决议（`accept` / `minor_revision` / `major_revision` / `reject`） |
| **Stage 4** | **逐点答辩与返修**<br>`Stage_4_Revise` | 调用 `rebuttal_matrix_coach` 拆解审稿人批评，补充实验或稳健性分析，撰写 Point-by-point 答辩信 | 高亮标记的修改稿（Revised Manuscript）与逐点答辩矩阵 |
| **Stage 3' & 4'** | **验证性再审与二轮返修**<br>`Stage_3_Prime_Rereview` / `Stage_4_Prime_Rerevise` | 核验作者是否实质性解决了 Stage 3 提出的方法学与统计关切 | 若仍需大修则转入 `Stage_4_Prime_Rerevise`；若达标则转入终审门禁 `Stage_4_5_Final_Integrity` |
| **Stage 4.5** | **终审零回归门禁**<br>`Stage_4_5_Final_Integrity` | 对返修稿再次执行 `academic_integrity_audit`，确保补实验与新增引用未引入任何新缺陷 | 终审合规放行凭证（Final Gate Pass） |
| **Stage 5 & 6** | **排版定稿与归档**<br>`Stage_5_Finalize` / `Stage_6_Process_Summary` | 调用 `author_disclosure_statement` 与 `bibtex_format_converter` 生成 CRediT 贡献声明、利益冲突披露与标准参考文献 | 具备完整可溯源记录的待投稿定稿包（Submission-Ready Package） |

---

## 二、内容绑定型材料护照 (Content-Bound Material Passport)

为防止跨阶段流转时出现“文不对题”或“材料被静默篡改”，`pipeline_stage_orchestrator` 会为当前会话生成唯一的**材料护照（Material Passport）**：

1. **真实内容哈希指纹 (Content Fingerprint):**
   - 护照哈希值（`ARS-PASS-...`）由**课题名称 + 当前阶段 + 手稿实际内容（`manuscript_content`）+ 已完成交付物清单**共同计算生成；
   - 任何对正文数据、结论或附件清单的修改都会立即改变哈希指纹，确保审计版本严格对齐。
2. **动态锁定状态:**
   - 仅当研究者实际传入了手稿内容或阶段成果物时，凭证状态才标记为 `LOCKED_TO_CONTENT`；若尚未传入实体内容，则诚实标记为 `PENDING_CONTENT_ATTACHMENT`。

---

## 三、人机协同关键决策点 (Human-in-the-Loop Checkpoints)

AI 辅助科研严禁“全自动黑箱跑完”。在以下 4 个关键节点，智能体必须暂停并呈交人类研究者拍板确认：
1. **立项确认点 (Stage 1 结束):** 人类研究者确认最终选定的研究问题（RQ）与实验对照设计；
2. **统计与图表确认点 (Stage 1.5 / 1.8 结束):** 人类研究者核实原始数据统计检验结果与图表真实性；
3. **诚信签字点 (Stage 2.5 / 4.5):** 人类研究者确认无数据泄露、无未披露的样本剔除，并核实所有 DOI 校验结果；
4. **返修提交点 (Stage 4 / 5):** 人类研究者审阅答辩信措辞，确认并填写 CRediT 具体作者姓名与基金编号。
