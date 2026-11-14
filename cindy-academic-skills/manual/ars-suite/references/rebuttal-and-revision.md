# 审稿意见拆解、逐点答辩矩阵与论文返修指南

本指南为 Cindy 智能体提供协助研究者处理期刊同行评审意见（Major / Minor Revision）、撰写逐点答辩信（Response to Reviewers）与返修求职信（Revision Cover Letter）的完整规约。配合 `rebuttal_matrix_coach` 与 `academic_integrity_audit` 工具使用。

---

## 一、审稿意见条目化拆解与四大应对策略

收到审稿人意见后，首先调用 `rebuttal_matrix_coach` 将长段评论拆解为独立的编号质询点（Critique Items），严禁遗漏或含糊合并任何小问题。针对每一条意见，匹配以下四类策略之一：

### 1. 完全采纳并修改 (Agree & Revise Text/Analysis)
- **适用场景:** 审稿人指出的表述不清、统计报告不全、文献遗漏或图表排版瑕疵。
- **执行准则:** 100% 虚心接受，立即在正文中落实修改，并在回复中直接贴出修改后的完整段落与精确位置（Page X, Lines Y–Z）。

### 2. 补充实证数据或稳健性检验 (Agree & Add Empirical Evidence)
- **适用场景:** 审稿人质疑样本代表性、混杂变量控制或要求补充敏感性分析/消融实验。
- **执行准则:** 补充相应统计分析或实验图表；不仅将新图表放入正文或 Supplementary Information，还应直接内嵌或摘录核心数据在答辩信对应条目下，让审稿人无需翻阅正文即可一目了然。

### 3. 消除误解与强化阐述 (Clarify & Amplify)
- **适用场景:** 审稿人提出的问题其实在原稿中已有交代，但因位置隐蔽或表述晦涩未被审稿人注意到。
- **黄金心态:** **“审稿人没看懂，永远是作者写得不够清楚。”** 切忌生硬回复 *"As already stated on Page 5..."*，而应致谢审稿人的提醒，承认原稿表述不够突出，并重写该段落以使其更加显眼清晰。

### 4. 有理有据的礼貌抗辩 (Polite, Evidence-Backed Rebuttal)
- **适用场景:** 审稿人要求的补充实验远远超出本研究的科学边界（如属于下一篇独立课题的范畴）、在实验周期或物理条件上不可行，或审稿人存在明显的事实判断偏差。
- **三步抗辩法则:**
  1. **先肯定其学术洞察:** 认可审稿人所提方向的重要科学价值；
  2. **客观陈述边界或反证:** 引用领域权威文献、理论推导或预实验数据，说明为何当前实验设计已足以支撑本文的核心主张；
  3. **做出建设性让步:** 主动在正文 `Discussion - Limitations` 小节中专门新增一段，探讨审稿人提出的这一视角，并将其列为未来工作的重点方向（给审稿人充分的学术尊重与台阶）。

---

## 二、逐点答辩信 (Point-by-Point Response) 四段式黄金模板

每一条审稿意见的回复必须严格遵循以下视觉与逻辑结构：

```markdown
### [Reviewer 1 — Comment 2]
> *"The authors claim that Treatment A outperforms Control, but it is unclear whether baseline covariates were balanced across groups."*

**Response:**
We sincerely thank the Reviewer for this constructive observation. We fully agree that verifying baseline balance is essential for ruling out confounding bias.

**Actions Taken:**
1. We performed independent-samples balance tests across all baseline demographic and physiological covariates and compiled the results into a new **Supplementary Table S1**.
2. Furthermore, we re-estimated the primary treatment effect using ANCOVA adjusting for baseline covariates; the effect of Treatment A remained highly significant ($F(1, 56) = 18.42, p < .001, \eta_p^2 = 0.25$).

**Manuscript Changes (Page 6, Lines 142–150, Section 2.4):**
> *"[Inserted exact revised text quoted verbatim from the manuscript, with newly added sentences highlighted in blue/bold...]"*
```

---

## 三、返修致主编信 (Revision Cover Letter) 规范结构

1. **首段（致谢与总体宣告）:** 感谢主编与审稿人付出的宝贵时间，声明已完成全面修改并逐条回应了所有意见。
2. **中段（核心重大修改亮点，3–4 条 Bullet Points）:** 替主编总结本轮返修含金量最高的工作（例如：*“1. 新增了独立验证集实验（Fig. 3d）；2. 全面补充了 Benjamini-Hochberg FDR 多重比较校正（Table 2）；3. 重写了讨论章节的机制推导”*）。
3. **末段（合规与提交声明）:** 确认所有作者均已审阅并同意修改稿，且无新增利益冲突。

---

## 四、棘手审稿情境应对锦囊

- **当两位审稿人意见截然相反时（Reviewer 1 要求删减某部分，Reviewer 2 要求扩充该部分）:**
  - 在回复中透明引用另一位审稿人的关注点（如 *"In balancing this comment with Reviewer 2's request for additional methodological detail..."*），采取折中方案：在正文保留精炼核心，将详尽细节移至 Supplementary Materials，并在 Cover Letter 中提请主编裁夺。
- **返修定稿前零回归核查:**
  - 提交前再次调用 `academic_integrity_audit`，确保返修新引入的文献均已通过 `verify_doi` 校验，且修改后的正文中无残留的 `[TODO]` 或图表编号错位。
