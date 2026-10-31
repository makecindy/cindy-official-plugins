# ARS 10 阶段全流程调度规约 (Pipeline Orchestration)

## 1. 状态机流转与严格的人机确认检查点

ARS 坚持在每个阶段完成时主动提示用户确认，严禁未经确认连跳多个大阶段：

- **Stage 1 (RESEARCH):** 产出《研究问题简报 (RQ Brief)》与《研究设计蓝图 (Methodology Blueprint)》。必须经用户确认后进入 Stage 2。
- **Stage 2 (WRITE):** 产出论文完整初稿《Paper Draft》及《材料护照 (Material Passport)》。
- **Stage 2.5 (INTEGRITY):** 审前学术诚信门禁（阻断式）。必须 100% 通过 7 类失败模式扫描，方可进入同行评审；若未通过，必须在 Stage 2 修订后重测（最多 3 轮）。
- **Stage 3 (REVIEW):** 主编 + 3 位专业审稿人 + 魔鬼代言人输出 5 份独立评审报告及决策信。若决策为 Major/Minor Revision 则进入 Stage 4；若 Reject 则退回 Stage 2 或终止。
- **Stage 4 (REVISE):** 产出《修改稿 (Revised Draft)》与《逐点答辩信 (Response to Reviewers)》。
- **Stage 3' (RE-REVIEW):** 针对修改稿与答辩信进行验证性再审，核对修改落实度与新引入缺陷。
- **Stage 4' (RE-REVISE):** 若再审仍有 Major 争议，进行二轮聚焦修订。
- **Stage 4.5 (FINAL INTEGRITY):** 终审学术诚信门禁，核查全引用锚点与主张一致性，确保零回归。必须 100% 通过方可排版。
- **Stage 5 (FINALIZE):** 规范输出排版（APA 7.0、LaTeX 源码与 DOCX 转换）、CRediT 分工声明与 AI 使用披露。
- **Stage 6 (PROCESS SUMMARY):** 自动生成人机协作全流程过程记录（Creation Process Audit Trail）。

## 2. 材料护照 (Material Passport)

材料护照记录论文在各阶段的哈希校验值、已使用数据与实验凭证来源：
- 保证论文各章节逻辑关联具有不可篡改的可溯源性；
- 记录 `claim_intent_manifest`，明确正文各项经验性主张的实证对应点；
- 作为跨会话任务续接与审计对账的唯一上下文凭证。
