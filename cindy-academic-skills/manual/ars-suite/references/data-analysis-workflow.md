# Stage 1.5 实证研究与数据分析规范 (Empirical & Statistical Analysis SOP)

> **核心原则：** 统计学不是把弱证据粉饰为强证据的魔术，而是对不确定性（Uncertainty）与实验效应的诚实量化。审稿人最容易摧毁论文的环节在于：选错检验方法、隐瞒假设前提违反、伪重复（Pseudoreplication）、过度依赖单一 $p$ 值以及漏报效应量与置信区间。

---

## 一、科研数据分析全流程六步法 (The 6-Step Analysis Arc)

严谨的学术实证分析必须严格按顺序推进，严禁根据分析结果倒推检验方法（杜绝 p-hacking）：

```text
[Step 1: 锁定假设与设计] ──> [Step 2: 独立实验单元与样本检查] ──> [Step 3: 统计模型决策]
                                                                        │
[Step 6: APA/Nature 规范汇报] <── [Step 5: 效应量与置信区间计算] <── [Step 4: 前提假设诊断与补救]
```

1. **锁定假设与设计 (Pre-commitment):** 明确因变量（连续/分类/等级）、自变量（组别、时间、协变量）以及实验设计（独立组间、配对被试内、混合设计）。在观察数据前选定主要统计模型。
2. **检查实验单元与伪重复 (Replication Audit):** 
   - 必须确保样本量 $N$ 代表**完全独立的实验/生物单元**。
   - 严禁将来自同一只动物/受试者的多个切片、同一孔板的重复读数、同一细胞系的分裂或模型的重复运行，直接作为独立的 $N$ 进行组间比较（此类属于技术重复 Technical Replicates）。
3. **统计模型决策 (Model Selection):** 依据决策树选择主要检验模型（Primary Test）与候选替代模型（Remedial Test）。
4. **前提假设诊断 (Assumption Diagnostics):**
   - **正态性 (Normality):** Shapiro-Wilk 检验（小样本）或 Q-Q 图结合偏度/峰度。
   - **方差齐性 (Homoscedasticity):** Levene 检验。若方差不齐，默认使用 Welch 检验（Welch's t-test / Welch's ANOVA），绝不能硬套标准 Student 检验。
   - **球形度 (Sphericity - 重复测量):** Mauchly 检验。若违反，必须报告 Greenhouse-Geisser ($\epsilon < 0.75$) 或 Huynh-Feldt 校正。
   - **多重共线性 (回归):** 方差膨胀因子 $\text{VIF} < 5$（严格标准 $\text{VIF} < 2.5$）。
5. **效应量与置信区间 (Effect Sizes & 95% CIs):**
   - $p$ 值仅说明效应是否存在，**效应量（Effect Size）与 95% 置信区间才决定其实际价值与重要性**。
   - 两组比较：Cohen's $d$（小样本 $n < 20$ 采用 Hedges' $g$ 校正）。
   - 多组方差分析：偏 Eta 方（Partial Eta Squared $\eta_p^2$）或 Omega 方（$\omega^2$）。
   - 二分类关联：比值比 Odds Ratio (OR) 或 Cramer's $V$。
6. **多重比较校正 (Multiple Testing Correction):**
   - 凡涉及多个终点指标、多组事后比较（Post-hoc）或探索性扫描，必须执行校正：
     - 事后两两比较：Tukey HSD（方差齐）或 Games-Howell（方差不齐）。
     - 探索性假设或海量检验：Benjamini-Hochberg (BH) 假发现率 (FDR) 控制。
     - 极严格验证：Bonferroni 校正（$\alpha_{\text{adjusted}} = 0.05 / K$）。

---

## 二、常用实证统计决策树速查

| 研究设计与场景 | 因变量数据类型 | 满足参数前提时的首选模型 | 前提偏离时的非参数/稳健替代 | 推荐效应量 |
| :--- | :--- | :--- | :--- | :--- |
| **两组独立比较** (A组 vs B组) | 连续型 (Continuous) | **独立样本 t 检验** (方差不齐转 Welch t) | **Mann-Whitney U 检验** (Wilcoxon 秩和) | Cohen's $d$ / Hedges' $g$ |
| **两组自身配对** (前测 vs 后测) | 连续型 (Continuous) | **配对样本 t 检验** (Paired t-test) | **Wilcoxon 符号秩检验** (Signed-rank) | Cohen's $d_z$ |
| **三组及以上独立** (不同剂量组) | 连续型 (Continuous) | **单因素方差分析** (One-way ANOVA) | **Kruskal-Wallis 检验** (+ Dunn 事后) | Partial $\eta^2$ ($\eta_p^2$) |
| **三组及以上重复测量** (多时点) | 连续型 (Continuous) | **重复测量方差分析** (RM-ANOVA) | **Friedman 检验** / 线性混合效应 (LMM) | Partial $\eta^2$ ($\eta_p^2$) |
| **两变量连续关联** (身高与体重) | 连续型 (Continuous) | **Pearson 积差相关** | **Spearman 秩相关** / Kendall's $\tau$ | 相关系数 $r$ ($r^2$) |
| **多因素因果/预测** (多个自变量) | 连续型 (Continuous) | **多元线性回归** (OLS Regression) | **稳健回归 (Huber M)** / GLM | $R^2$, Adj. $R^2$, 标准化 $\beta$ |
| **二分类结果预测** (发病/未发病) | 二分类 (Binary) | **二元 Logistic 回归** | 惩罚 Logistic 回归 (Firth) | 比值比 (Odds Ratio, OR) |
| **列联表频数独立性** | 分类/计数 (Count) | **Pearson 卡方检验** ($\chi^2$) | **Fisher 精确概率检验** (任一期望频数<5) | Cramer's $V$ / $\phi$ |

---

## 三、APA 7.0 与顶刊标准统计书写模板

### 1. 独立样本 t 检验
- **规范语句：** “独立样本 $t$ 检验结果表明，干预组后测得分 ($M = 78.40, SD = 8.25$) 显著高于对照组 ($M = 65.10, SD = 9.10$), $t(58) = 5.92, p < .001, d = 1.53, 95\%\text{ CI } [10.81, 15.79]$。”
- **规则：** $p < .001$ 不写等于号；小于 1 的概率不带前导 0（写 `.001` 而不是 `0.001`）。

### 2. 单因素与多因素方差分析 (ANOVA)
- **规范语句：** “单因素方差分析显示，不同训练模式对成绩的主效应具有统计学意义，$F(2, 57) = 4.35, p = .017, \eta_p^2 = .13$。Tukey HSD 事后多重比较表明，强化训练组得分显著高于常规组 ($p_{\text{adj}} = .012$)。”

### 3. 多元回归分析
- **规范语句：** “多元线性回归模型整体显著，$F(3, 116) = 14.82, p < .001, R^2 = .28, R^2_{\text{adj}} = .26$。在控制年龄与基线指标后，学习动机仍能显著正向预测学业表现，$\beta = 0.38, t(116) = 4.21, p < .001, 95\%\text{ CI } [0.20, 0.56]$。”

### 4. 标准三线表格式 (Publication Three-Line Table)
在手稿与报告中必须采用规范的三线表，顶线与底线加粗，中线分隔表头与数据行：

| Group / Condition | N | Mean | SD | 95% CI | Test Statistic | p-value | Effect Size |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Control Group | 30 | 65.10 | 9.10 | [61.70, 68.50] | -- | -- | -- |
| Intervention Group | 30 | 78.40 | 8.25 | [75.32, 81.48] | $t(58) = 5.92$ | $< .001$ | $d = 1.53$ |

---

## 四、审稿人常问的五大统计红线自查

1. **是否有过度使用“显著 (Significant)”代替“有实际价值”？**
   - 严禁将微小但样本量极大导致的 $p < .05$ 吹嘘为突破性发现，必须附带效应量讨论。
2. **是否把技术重复当作生物独立重复？**
   - 明确标注 $N$ 是代表多少位独立患者、多少只实验动物，还是多少个细胞切片。
3. **是否存在未校正的多重检验？**
   - 如果比较了 10 个指标，必须提供 FDR 或 Bonferroni 校正后的 $p_{\text{adj}}$。
4. **误差棒（Error Bar）到底代表什么？**
   - 图注中必须明确声明：误差棒代表标准差 (SD, 反映变异程度)、标准误 (SEM, 反映均值抽样误差) 还是 95% 置信区间 (95% CI)。
5. **相关性是否被偷换为因果推论？**
   - 观测性横截面数据不得使用“导致”、“促使”等因果动词，应使用“呈正向关联”、“显著预测”。
