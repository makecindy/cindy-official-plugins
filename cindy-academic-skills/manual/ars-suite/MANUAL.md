# Academic Research Skills (ARS-Codex) — Cindy 官方综合学术研究工作流套件

> **核心哲学 (Core Philosophy):** AI 是你的副驾驶，不是机长。本系统不会在真空里替你写论文，而是处理文献检索验证、学术诚信防线、逻辑一致性核对与多视角盲审，让人类研究者专注于问题定义、实验洞察与本质推论。

本套件完全复刻 **ARS-Codex (Academic Research Suite v3.24.0)** 的工作流设计与学术规范，专为 Cindy 打造，提供开箱即用、无私有 Key 依赖的端到端科研支撑。

---

## 一、架构总览与能力矩阵

套件整合了 ARS 的四大核心支柱与 10 大阶段：

```text
[Stage 1: 研究探索] ──> [Stage 2: 论文撰写] ──> [Stage 2.5: 审前诚信门禁]
                                                        │
                                                   PASS │ (失败修复 <=3 轮)
                                                        ▼
[Stage 4: 答辩返修] <── (Major/Minor) ── [Stage 3: 五重视角同行评审]
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

### 13 项实体工具索引

1. **`pipeline_stage_orchestrator`**: 10 阶段科研生命周期与材料护照调度。
2. **`socratic_research_guide`**: 苏格拉底式对话引导选题与研究问题（FINER 标准）蓝图构建。
3. **`verify_doi`**: Crossref 官方 REST API 真实文献校验与元数据提取，防范学术幻觉。
4. **`search_crossref`**: Crossref 官方公开学术文献库检索，杜绝虚构文献。
5. **`three_way_lit_scan`**: 3W 文献对比矩阵（Why 背景、How 方法、What 结论）。
6. **`academic_integrity_audit`**: 7 类 AI 科研失败模式阻断门禁（Stage 2.5 / 4.5）。
7. **`claim_citation_alignment`**: 引用三层锚点与主张一致性（L3 Claim-Faithfulness）核查。
8. **`academic_style_audit`**: 风格校准与去 AI 味审计（清除空洞套话与模糊副词）。
9. **`academic_paper_analysis`**: 论文多维结构化拆解与 CER 证据链闭环审查。
10. **`peer_review_evaluation`**: 五视角盲审（主编 + 3 位审稿人 + 魔鬼代言人，0-100 质量量表）。
11. **`rebuttal_matrix_coach`**: 审稿意见条目化拆解与 Point-by-point 答辩矩阵教练。
12. **`author_disclosure_statement`**: CRediT 学术分工标准与 AI 辅助伦理声明生成。
13. **`bibtex_format_converter`**: 标准 BibTeX 与 APA 7.0 引用条目格式转换。

---

## 二、子模块深入参考指南

详细执行规约与专项 SOP 存放在本目录 `references/` 下，Cindy Agent 可通过 `ghost_manual` 随时按需查阅：

- [10 阶段生命周期与状态机规约](references/pipeline-10-stages.md) (`references/pipeline-10-stages.md`)
- [深度研究、苏格拉底引导与 3W 文献扫描](references/deep-research-socratic.md) (`references/deep-research-socratic.md`)
- [论文撰写、CER 论证链与风格校准](references/academic-paper-writing.md) (`references/academic-paper-writing.md`)
- [五视角同行评审与 0-100 质量量表](references/peer-review-rubric.md) (`references/peer-review-rubric.md`)
- [7 大学术诚信失败模式与 L3 引用锚点](references/integrity-failure-modes.md) (`references/integrity-failure-modes.md`)
- [逐点答辩矩阵与修订教练指南](references/rebuttal-and-revision.md) (`references/rebuttal-and-revision.md`)

---

## 三、快速上手路径

- **从零构思：** 告诉 Agent：“帮我引导选题，我想研究少子化对高等教育财务的影响” → 自动触发 `socratic_research_guide`。
- **文献检索与验证：** 检索文献时调用 `search_crossref`，核查文献真实性时调用 `verify_doi`。
- **手稿审查：** 审稿前先运行 `academic_integrity_audit`，再运行 `peer_review_evaluation`。
- **修改与答辩：** 收到 Reviewer 意见后运行 `rebuttal_matrix_coach` 生成逐条修改矩阵。
