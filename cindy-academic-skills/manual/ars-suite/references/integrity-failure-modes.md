# 七大学术诚信失败模式与 L3 引用锚点规约

## 1. 七大 AI 科研结构性失败模式 (Lu et al., Nature 2026)

根据国际顶尖自主 AI 科研系统实证研究，AI 在协助科研时极易产生以下 7 种伪装极深的缺陷，ARS 在 Stage 2.5 和 Stage 4.5 设立阻断式门禁强制排查：

1. **虚构/幻觉引用 (Fabricated Citations):** 凭空捏造合法格式的 DOI、论文名或作者名，或将某观点安插在未曾提及该观点的真实文献上。
2. **挑选有利基准 (Cherry-Picked Baselines):** 选用弱化、过时或未调优的基线算法，人为制造本文方法的显著超越假象。
3. **将实现 Bug 包装为科研发现 (Implementation Errors as Findings):** 实际上是数据泄露（Data Leakage）或代码错误，却被误判并吹嘘为“意外的全新发现”。
4. **缺失负对照与基准等价性 (Missing Negative Controls):** 未设立有效对照组，无法排除安慰剂效应或自然增长趋势等竞争性解释。
5. **过度宣称与无边界外推 (Overclaimed Generalizability):** 在狭窄的玩具数据集上取得成绩，却宣称“彻底解决了该领域的根本难题”。
6. **方法论自相矛盾与 p-Hacking (Methodological Inconsistency):** 随心所欲增减异常样本剔除标准，直至 P 值显著。
7. **不可复现的凭证污染 (Contaminated Provenance):** 依赖未公开、不可核验的私有脚本或已污染外部数据。

## 2. L3 主张保真度与引用三层锚点 (Zhao et al. 2026)

Zhao 等人在 250 万篇论文中发现数以万计的真实引用被用来支撑该论文根本没有提出的主张（即 L3 引用脱节问题）。ARS 规范要求：
- **Direct Anchor (直接锚点):** 引用具体命题或数据时，明确引证原著的具体章节、表格或定理编号；
- **Synthesized Anchor (综述锚点):** 概述文献流派时，确保被引文献的主题与正文概括范围一致；
- **核查判定:**
  - `ALIGNED`: 声明与被引文献内容高度吻合；
  - `PLAUSIBLE_NEEDS_ANCHOR`: 概念相符但缺乏具体章节定位；
  - `CLAIM_NOT_SUPPORTED`: 严重脱节，门禁阶段直接阻断。
