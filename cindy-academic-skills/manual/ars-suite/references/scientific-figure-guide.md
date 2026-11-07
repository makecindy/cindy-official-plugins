# Stage 1.8 顶刊科研配图与多面板可视化规范 (Scientific Figures & Multi-panel Visualization SOP)

> **核心哲学：** 科学配图的第一法则是**“诚实传达科学证据”**，而非仅追求视觉华丽。顶级学术期刊（Nature, Science, Cell, IEEE）审查配图的三大死线是：严禁使用“炸药图”（遮盖分布的柱状图）、严禁使用彩虹色（Jet/Rainbow）导致失真、严禁对图像/数据进行选择性增强或隐瞒。

---

## 一、多面板证据链架构 (Multi-Panel Evidence Architecture)

一张高质量的论文主图（Main Figure）必须解答一个完整的研究论断，各子图（Panel）应承担不同的推论角色，而非单纯堆砌指标：

```text
[Panel a: 概念/流水线总览] ──> [Panel b: 核心英雄面板 (Hero Evidence)]
                                      │
[Panel d: 机制印证/火山相关图] <── [Panel c: 动态响应/浓度梯度轨迹]
```

1. **Panel a (概念总览 / 机制原理):** 实验流程图、模型架构图或分子信号通路示意图。引导读者建立全局上下文。
2. **Panel b (核心英雄面板 Hero Panel):** 最具决定性意义的处理组 vs 对照组量化对比。
   - **推荐图表：** 小提琴图 (Violin plot) + 半透明箱线图 (Box plot) + 个体生物重复散点抖动 (Jittered dots)。
   - **禁止：** 只有均值和误差线的粗暴柱状图（“炸药图”）。
3. **Panel c (动态轨迹 / 剂量响应):** 展现随时间（Time-course）或浓度梯度（Dose-response）的连续定量变化。
   - 带有浅色半透明误差带（Error Band，明确标明是 SEM 还是 95% CI）。
4. **Panel d (机制印证 / 差异火山图 / 多变量相关):** 验证假说边界，如差异基因/特征火山图 (Volcano plot) 或生物标志物与结局的 Pearson/Spearman 散点回归线。

---

## 二、国际顶刊物理排版与分辨率硬指标

| 规范维度 | Nature / Science / Cell 标准要求 | IEEE / ACM 标准要求 | 实施与检查注意项 |
| :--- | :--- | :--- | :--- |
| **单栏宽度 (Single Column)** | **89 mm (3.5 英寸)** | **88 mm (3.5 英寸)** | 单个子图或双子图纵向堆叠使用 |
| **双栏跨页 (Double Column)** | **180 mm (7.1 英寸)** | **181 mm (7.1 英寸)** | 3~6 个子图横纵组合的主图标准宽度 |
| **1.5 栏 (Intermediate)** | 120 mm ~ 136 mm | 120 mm ~ 130 mm | 适合右侧留出侧边图注的排版 |
| **字体层级 (Typography)** | Helvetica / Arial / DejaVu Sans | Times New Roman / Helvetica | Panel 标签 (a, b) 加粗 8pt；轴标题 7pt；刻度 6pt |
| **矢量输出 (Vector)** | **PDF 或 EPS (字体嵌入)** | **PDF / EPS** | `plt.rcParams['pdf.fonttype'] = 42` (TrueType 嵌入) |
| **栅格输出 (Raster)** | **300+ DPI** (线图 600~1200 DPI) | **300+ DPI** | 严禁截图！必须程序化直接输出 |

---

## 三、色盲友好与可访问性学术色板 (Okabe-Ito Palette)

严禁在科研配图中使用彩虹色（Jet, Rainbow），因其非线性感知亮度会人为制造虚假边界。

推荐使用国际通用的 **Okabe-Ito 色板**（对红绿色盲、蓝黄色盲完全兼容）：

| 颜色名称 | 16进制色值 (HEX) | RGB 取值 | 适用语义 |
| :--- | :---: | :---: | :--- |
| **Black** | `#000000` | (0, 0, 0) | 对照组、基线、坐标轴 |
| **Sky Blue** | `#56B4E9` | (86, 180, 233) | 实验处理组 1、野生型 (WT) |
| **Vermilion (朱红)** | `#D55E00` | (213, 94, 0) | 突变体 (KO)、核心干预组、上调特征 |
| **Bluish Green** | `#009E73` | (0, 158, 115) | 恢复组、阳性对照、下调特征 |
| **Orange** | `#E69F00` | (230, 159, 0) | 备选对比组 |
| **Blue** | `#0072B2` | (0, 114, 178) | 主要相关线 |

> **冗余编码法则 (Redundant Encoding):** 颜色绝不能作为区分信息的唯一线索！必须同时配合点形状（圆形、方形、三角）或线型（实线、虚线、点划线）。

---

## 四、图注 (Figure Legend) 顶刊标准撰写五要素

每一个图注必须在没有正文的情况下能够独立自明（Self-contained）：
1. **总标题：** 第一句加粗，直接陈述科学结论（如 **Fig. 1 \| Targeted disruption of X attenuates Y in mice.**）。
2. **面板导引：** 用小写加粗字母逐项说明（**a**, Overview of... **b**, Quantitation of...）。
3. **样本量声明：** 明确给出独立的实验单元样本量（如 $n = 8$ independent biological animals per group）。
4. **误差棒定义：** 必须明确指出误差棒代表什么（如 Data are shown as mean ± s.e.m. 或 Box plots show median, IQR, and 1.5× IQR whiskers）。
5. **统计检验声明：** 明确指出检验方法与显著性符号（如 Two-tailed unpaired Student's t-test, \*P < 0.05, \*\*P < 0.01, \*\*\*P < 0.001, NS indicates not significant）。

---

## 五、【陷阱排查】DPI 设置与字体极小/元素缩小的冲突机制详解

在科研绘图时，很多人（以及很多通用 AI）生成的代码常出现一个致命问题：**导出的图片在 Word 或 LaTeX 中插入后，文字和散点变得极其微小，肉眼几乎无法辨认**。

### 1. 核心冲突根源：物理尺寸与显示分辨率的脱钩
- **字号在 Matplotlib 中是绝对物理量：** 1 point（磅）严格等于 $\frac{1}{72}$ 英寸（约 0.35 mm）。`fontsize=7` 的文字物理高度永远是约 2.45 mm。
- **错误的做法：** AI 通常习惯随手写一个 `figsize=(10, 6)` 或 `(12, 8)`。当用户把这张 12 英寸宽的图片插入到论文单栏（标准宽度 89 mm = 3.5 英寸）时，排版软件会将其强制缩小到原来的 $3.5 / 12 \approx 29\%$！此时原本 7pt 的文字就被等比压缩成了 **2pt**，变成看不清的“蚂蚁字”！
- **Seaborn 覆盖冲突（致命陷阱）：** 很多代码先设置了 `plt.rcParams['font.size'] = 7`，接着写了一行 `sns.set_theme()` 或 `sns.set_style("white")`。**Seaborn 的 `set_theme()` 会在内部直接重置所有 rcParams**，彻底抹除前面所有的字号与字体设置！
- **`plt.figure(dpi=...)` 冲突：** 在 `plt.figure(dpi=300)` 中强制设置高 DPI，会导致屏幕渲染器（Renderer）以 300 DPI 计算坐标变换和边距，与随后的 `layout="constrained"` 或 `plt.tight_layout()` 产生边距误算与标签重叠。

### 2. 避坑三大铁律（Standard Best Practice）
1. **顺序铁律（Theme First, rcParams Second）：** 必须先调用 `sns.set_theme(style="ticks")`，**然后**再配置 `plt.rcParams` 自定义参数，绝不能颠倒！
2. **物理尺寸 1:1 铁律（Match Physical Inches Directly）：**
   - 单栏主图：`figsize=(3.5, 2.8)`（英寸，对应 89 mm）。
   - 双栏主图：`figsize=(7.08, 3.5)`（英寸，对应 180 mm）。
   - 字号严格设为 `font.size = 7`，刻度设为 `6`，子图标签 `a, b` 设为 `8`。这样导出的图片在论文中是 1:1 放置，文字大小与正文完全一致，绝不会被二次缩放缩小！
3. **DPI 分离铁律（Preview Low, Save High）：** 画布初始化保持默认屏幕 DPI（100），高分辨率（300/600 DPI）**仅在保存函数中指定**：
   ```python
   plt.savefig("figure_output.png", dpi=300, bbox_inches="tight")
   plt.savefig("figure_output.pdf", format="pdf", bbox_inches="tight")
   ```

---

## 六、【双语绘图】中英文混排无乱码与负号方块修复指南

在需要撰写毕业论文、国内中英双语会议报告或中英文对照图表时，常见两大技术痛点：

### 1. 中文字符丢失（Tofu 方块 □□□）与负号缺失
- **现象：** Matplotlib 默认字体（DejaVu Sans）不含中文字符，导致中文显示为方块；若粗暴替换为 `SimHei`（黑体），又会导致负数坐标轴的减号变成方块（因为 `SimHei` 缺乏标准 Unicode 减号 `\u2212`）。
- **标准跨平台解决方案：**
  ```python
  # 1. 跨平台优雅回退字体栈（Windows / macOS / Linux 自动适配）
  plt.rcParams['font.sans-serif'] = [
      'Arial', 'Helvetica', 'DejaVu Sans',          # 英文首选（顶刊标准无衬线）
      'Microsoft YaHei', 'SimHei',                  # Windows 中文
      'PingFang SC', 'Hiragino Sans GB',            # macOS 中文
      'Source Han Sans SC', 'WenQuanYi Micro Hei',  # Linux 中文
      'sans-serif'
  ]
  
  # 2. 核心：必须显式关闭 unicode_minus！
  plt.rcParams['axes.unicode_minus'] = False  # 彻底解决坐标轴负号变方块乱码
  ```

### 2. 双语灵活切换模式 (Bilingual Labeling Switch)
推荐在代码中通过统一常量 `LANG_MODE` 管理所有轴标题与图例文本，实现“一键切换国际英文期刊版”与“国内答辩双语版”：
```python
LANG_MODE = "dual"  # 可选: "en", "zh", "dual"

LABELS = {
    "x_title": {"en": "Concentration (μM)", "zh": "处理浓度 (μM)", "dual": "Concentration / 处理浓度 (μM)"},
    "y_title": {"en": "Cell Viability (%)", "zh": "细胞活性 (%)", "dual": "Cell Viability / 细胞活性 (%)"},
    "control": {"en": "Control", "zh": "对照组", "dual": "Control / 对照组"},
    "treatment": {"en": "Treatment", "zh": "给药组", "dual": "Treatment / 给药组"}
}

# 绘图时直接引用当前语言模式：
ax.set_xlabel(LABELS["x_title"][LANG_MODE], fontweight="bold")
ax.set_ylabel(LABELS["y_title"][LANG_MODE], fontweight="bold")
```
