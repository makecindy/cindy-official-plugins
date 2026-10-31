# 学术论文撰写、CER 论证链与风格校准

## 1. 结构化蓝图与 CER 论证链

论文正文严密遵循 CER (Claim-Evidence-Reasoning) 逻辑架构：
- **Claim (学术主张):** 每个段落的核心主题句必须清晰、确凿，不得含糊其辞。
- **Evidence (经验证据):** 每一个主张必须紧跟确切的经验证据（实验数据、统计检验量、或带精确 DOI 的文献引用）。
- **Reasoning (理论推理):** 阐明证据如何合乎逻辑地推导出主张，并主动讨论可能的竞争性解释。

## 2. 风格校准与去 AI 味 (De-AI-ification)

为了保留学者原生的自然语感并排除机器生成痕迹，必须执行以下负面清单检查：
1. **彻底清除空洞副词与形容词:** 严禁出现 `delve into`、`tapestry of`、`testament to`、`pivotal role`、`beacon of`、`in the fast-paced landscape` 等陈词滥调。
2. **拒绝模糊量词:** 将 `various`、`numerous`、`countless`、`大量研究表明` 替换为确切的样本数、文献代表性作者年份或具体统计指标。
3. **收敛断言语气 (Epistemic Calibration):** 严禁出现 `彻底证明 (undoubtedly proves)`、`完美解决 (flawlessly solves)`；客观呈现研究置信区间与边界条件（如 `数据表明`、`在被测样本范围内支持`）。
4. **长短句韵律节奏:** 打破 AI 模型常见的匀称句长，穿插有力短句与逻辑紧凑的复合句。

## 3. 规范化引用与格式

- 每一篇被引文献均应具备可检索的 DOI；
- 正文引用严格匹配文后参考文献列表，杜绝“孤儿引用”或“幽灵条目”；
- 采用 `bibtex_format_converter` 自动生成符合 IEEE、ACM、APA 7.0 等期刊标准的 BibTeX 条目。
