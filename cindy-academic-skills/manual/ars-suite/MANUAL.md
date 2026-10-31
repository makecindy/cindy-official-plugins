# Academic Research Skills (ARS-Codex) — Cindy 官方综合学术研究工作流套件

> **核心哲学 (Core Philosophy):** AI 是你的副驾驶，不是机长。本系统不会在真空里替你写论文，而是处理文献检索验证、学术诚信防线、逻辑一致性核对与多视角盲审，让人类研究者专注于问题定义、实验洞察与本质推论。

本套件完全复刻 **ARS-Codex (Academic Research Suite v3.24.0)** 的工作流设计与学术规范，专为 Cindy 打造，提供开箱即用、无私有 Key 依赖的端到端科研支撑。

---

## 一、架构总览与能力矩阵

套件整合了 ARS 的四大核心支柱与 10 大阶段：

```text
[Stage 1: 研究探索] ──> [Stage 1.5: 实证数据分析] ──> [Stage 1.8: 顶刊配图设计] ──> [Stage 2: 论文撰写]
                                                                                        │
                                                                   PASS │ (失败修复 <=3 轮)
                                                                        ▼
[Stage 4: 答辩返修] <── (Major/Minor) ── [Stage 3: 五重视角同行评审] <── [Stage 2.5: 审前诚信门禁]
       │
       ▼
[Stage 3': 再审验证] ──> (Accept/Minor) ──> [Stage 4.5: 终审零回归诚信门禁]
       │ (Major)                                    │
       ▼                                            ▼ PASS
[Stage 4': 二轮返修] ────────────────────────> [Stage 5: 规范排版定稿]
                                                    │
                                                    ▼
                                               [Stage 6: 人机协作过程记录]
```

### 16 项实体工具索引

1. **`pipeline_stage_orchestrator`**: 10 阶段科研生命周期与材料护照调度。
2. **`socratic_research_guide`**: 苏格拉底式对话引导选题与研究问题（FINER 标准）蓝图构建。
3. **`verify_doi`**: Crossref 官方 REST API 真实文献校验与元数据提取，防范学术幻觉。
4. **`search_crossref`**: Crossref 官方公开学术文献库检索，杜绝虚构文献。
5. **`three_way_lit_scan`**: 3W 文献对比矩阵（Why 背景、How 方法、What 结论）。
6. **`statistical_analysis_advisor`**: 统计检验决策树与假设前提诊断（t检验/ANOVA/非参数/回归，防 p-hacking）。
7. **`academic_data_summary`**: 学术统计量化报告与 APA 7.0 / Nature 级规范三线表生成。
8. **`scientific_figure_designer`**: 顶刊多面板科研配图架构设计与 Python/R 出版级绘图代码生成工作台。
9. **`academic_integrity_audit`**: 7 类 AI 科研失败模式阻断门禁（Stage 2.5 / 4.5）。
10. **`claim_citation_alignment`**: 引用三层锚点与主张一致性（L3 Claim-Faithfulness）核查。
11. **`academic_style_audit`**: 风格校准与去模型化润色（清除空洞套话与模糊副词）。
12. **`academic_paper_analysis`**: 论文多维结构化拆解与 CER 证据链闭环审查。
13. **`peer_review_evaluation`**: 五视角盲审（主编 + 3 位审稿人 + 魔鬼代言人，0-100 质量量表）。
14. **`rebuttal_matrix_coach`**: 审稿意见条目化拆解与 Point-by-point 答辩矩阵教练。
15. **`author_disclosure_statement`**: CRediT 学术分工标准与 AI 辅助伦理声明生成。
16. **`bibtex_format_converter`**: 标准 BibTeX 与 APA 7.0 引用条目格式转换。

---

## 二、完整 Skill 规范与原语规约 (Full Skill Specifications)

本插件完整复刻了 ARS-Codex 及上游的核心 Skill 原文指令与提示词规范，存放在 `skills/` 目录下供 Cindy 智能体按需深层读取：

1. **[academic-research-suite.md](skills/academic-research-suite.md)**: ARS-Codex 统一总调度器规约 (Master Suite Router)，协调 Pipeline、Research、Paper 与 Reviewer 全流程。
2. **[academic-pipeline.md](skills/academic-pipeline.md)**: 10 阶段科研生命周期、状态机、阶段迁移契约（Material Passport）与质量闸门。
3. **[deep-research.md](skills/deep-research.md)**: 13-Agent 深度学术调研团队规约（系统性综述、事实核查、3W 扫描、PRISMA 报告等 8 大模式）。
4. **[academic-paper.md](skills/academic-paper.md)**: 13-Agent 学术论文写作团队规约（IMRaD 结构、认识论主张分级、CER 论证链、去 AI 味风格校准）。
5. **[academic-paper-reviewer.md](skills/academic-paper-reviewer.md)**: 7-Agent 同行评审委员会规约（5 种评审拓扑、0-100 质量量表、魔鬼代言人挑战、逐点答辩矩阵）。

---

## 三、专项 SOP 与细化操作指南 (References)

专项 SOP 存放在本目录 `references/` 下，Cindy Agent 可通过 `ghost_manual` 随时按需查阅：

- [10 阶段生命周期与状态机规约](references/pipeline-10-stages.md) (`references/pipeline-10-stages.md`)
- [深度研究、苏格拉底引导与 3W 文献扫描](references/deep-research-socratic.md) (`references/deep-research-socratic.md`)
- [实证研究与数据分析、统计决策与三线表规范](references/data-analysis-workflow.md) (`references/data-analysis-workflow.md`)
- [顶刊科研配图、多面板证据架构与代码规范](references/scientific-figure-guide.md) (`references/scientific-figure-guide.md`)
- [论文撰写、CER 论证链与风格校准](references/academic-paper-writing.md) (`references/academic-paper-writing.md`)
- [五视角同行评审与 0-100 质量量表](references/peer-review-rubric.md) (`references/peer-review-rubric.md`)
- [7 大学术诚信失败模式与 L3 引用锚点](references/integrity-failure-modes.md) (`references/integrity-failure-modes.md`)
- [逐点答辩矩阵与修订教练指南](references/rebuttal-and-revision.md) (`references/rebuttal-and-revision.md`)

---

## 四、快速上手路径

- **从零构思：** 告诉 Agent：“帮我引导选题，我想研究少子化对高等教育财务的影响” → 自动触发 `socratic_research_guide`。
- **文献检索与验证：** 检索文献时调用 `search_crossref`，核查文献真实性时调用 `verify_doi`。
- **手稿审查：** 审稿前先运行 `academic_integrity_audit`，再运行 `peer_review_evaluation`。
- **修改与答辩：** 收到 Reviewer 意见后运行 `rebuttal_matrix_coach` 生成逐条修改矩阵。
