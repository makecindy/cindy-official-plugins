# TapTap 上架规则目录（v4）

本文件是 Agent 使用的结构化规则目录，只整理以下两份 TapTap 官方文档中明确写出的要求：

- [游戏物料要求](https://developer.taptap.cn/docs/store/release/publish/material/)
- [TapTap 游戏审核规范细则](https://developer.taptap.cn/docs/store/release/publish/agree/)

两份页面在 2026-08-20 显示版本 `v4`。本文件不替代原文；回答用户或生成风险清单时必须保留文档名称、章节和链接。

用于逐条校对和复现的页面 Markdown 快照保存在 [sources/v4](taptap-suite/references/sources/v4/manifest.md)；抓取日期、页面版本、原始 HTML SHA-256 和快照 SHA-256 记录在 [manifest.md](taptap-suite/references/sources/v4/manifest.md)。规则摘要与快照冲突时，以对应官方页面当前内容为准，并先刷新快照和目录，不能静默沿用旧摘要。

## 来源边界

官方规则 / 当前事实 / 历史审核 / 测试证据 / 无法验证 的完整分层定义，以[游戏物料要求](taptap-suite/references/material-requirements.md)「事实来源分层」为唯一正本。本文件只约束：只有本文件列出的、可定位到上述两份文档具体章节的内容，才能称为“官方规则”或“规范要求”。

## 规则记录格式

面向用户输出官方规则时至少保留：

```text
规则 ID｜检查对象｜要求摘要｜可检测性｜文档名称｜章节｜链接
```

可检测性由一个或多个下列取值组成；同一条合并规则需要多类证据时用 `+` 连接：

- `deterministic`：可以由字段值或媒体元数据确定。
- `semantic`：需要理解图片、视频或文案内容，只能形成风险提示或人工复核项。
- `external-evidence`：需要资质、授权、官网或游戏安装包之外的证据。

## 一、平台收录与通用内容

### 法律法规与平台安全

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.general.isbn_payment` | 未获国家新闻出版署批准的移动游戏不得在大陆地区上线运营，没有版号的游戏不得含任何形式的内购计费 | external-evidence | 审核规范 1.1.1 |
| `review.general.illegal_sensitive` | 游戏不得包含违法、涉政、涉赌、暴力血腥、色情性暗示及广告法禁用词等内容 | semantic | 审核规范 1.1.2 |
| `review.general.rights` | 不得攻击、侮辱或诽谤他人，不得侵犯著作权、商标权、肖像权、名誉权等合法权益 | semantic+external-evidence | 审核规范 1.1.3 |
| `review.general.weapon` | 不得过度真实描述武器制造工艺、参数或宣扬违法滥用武器 | semantic | 审核规范 1.1.4 |
| `review.general.public_order` | 不得含反政府、反社会、犯罪鼓动、安全隐患或扰乱社会秩序等内容 | semantic | 审核规范 1.1.5–1.1.6 |

### 游戏内付费、广告与下载

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.payment.clear_price` | 付费项目明码标价，并明确说明用户可获得的服务 | semantic | 审核规范 1.2.1 |
| `review.payment.no_inducement` | 不得诱导站外充值、线下交易、二维码赞助或众筹 | semantic | 审核规范 1.2.2 |
| `review.payment.no_auto_charge` | 不得自动扣费 | external-evidence | 审核规范 1.2.3 |
| `review.ad.no_placeholder` | 不得存在空白/招商广告位，游戏主要目的不能是广告或营销 | semantic | 审核规范 1.3.1 |
| `review.ad.no_system_imitation` | 广告不得模仿系统通知或提示诱导点击 | semantic | 审核规范 1.3.2 |
| `review.ad.lifecycle` | 应用关闭或退到后台后广告不得继续存在 | external-evidence | 审核规范 1.3.3 |
| `review.ad.closable` | 不得有无法关闭的悬浮窗或弹窗广告 | external-evidence | 审核规范 1.3.4 |
| `review.download.no_bundle_force` | 不得默认勾选、捆绑、强制或未经许可自动下载其他应用 | external-evidence | 审核规范 1.3.5–1.3.6、1.3.8–1.3.9 |
| `review.ad.label` | 广告与普通内容并列且可能造成误解时，应显著标明“广告” | semantic | 审核规范 1.3.7 |

### 重复游戏、欺诈与暂不收录

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.game.no_duplicate` | 不上传多个内容相同或相似的游戏；新版主体功能不得与旧版差异过大 | semantic+external-evidence | 审核规范 1.4.1–1.4.2 |
| `review.game.quality_dependency` | 不得只是简单网页或模板套壳，主要功能不能依赖第三方应用或网页 | semantic | 审核规范 1.4.3–1.4.4 |
| `review.game.no_infringing_duplicate` | 游戏内容不得与已收录游戏相同 | external-evidence | 审核规范 1.4.5 |
| `review.game.no_fraud` | 不得欺诈、误导用户或在审核后通过服务端开启违规内容 | semantic+external-evidence | 审核规范 1.5.1–1.5.2 |
| `review.game.collection_scope` | 非官方联运/折扣包、破解盗版、博彩、实物或现金奖励、虚拟货币/区块链、色情血腥、宗教民族违规、同人、非游戏应用及其他违法游戏属于文档列出的暂不收录范围 | semantic+external-evidence | 审核规范 1.6.1–1.6.10 |

### 所有物料的通用规则

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.material.no_disallowed_content` | 文案、图片、视频不得含平台不收录内容、无关素材、强制引导、评价引导或其他网站导流 | semantic | 审核规范 2.1.1–2.1.2、2.1.5–2.1.8 |
| `review.material.authorization` | 不得含侵权内容；已授权或购买素材需提交证明 | external-evidence | 审核规范 2.1.3 |
| `review.material.no_store_rating` | 不得包含游戏商店评分等数据 | semantic | 审核规范 2.1.4 |
| `review.material.no_code_group_link` | 文案不得含兑换码、玩家群信息或不允许的外部链接 | semantic | 审核规范 2.1.9 |
| `review.material.visual_quality` | 图片和视频应清晰，不能明显模糊、拉伸、压缩、翻转，也不得使用白底、黑底、透明底或纯色、渐变等过于简单图案 | semantic | 审核规范 2.1.10 |
| `review.material.no_sensitive_occlusion` | 敏感部位应使用衣物处理，不能用圣光、暗幕、云团、表情包、马赛克等遮挡 | semantic | 审核规范 2.1.11 |
| `review.material.zh_cn` | 上架中国大陆地区时提供简体中文文案与物料 | deterministic+semantic | 审核规范 2.1.12 |

## 二、物料规格与字段内容

### 图标

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `material.icon.required` | 图标为必填物料 | deterministic | 游戏物料要求“一、图标” |
| `material.icon.dimension` | 不低于 512×512，比例 1:1 | deterministic | 游戏物料要求“一、图标” |
| `material.icon.format` | PNG 或 JPG | deterministic | 游戏物料要求“一、图标” |
| `material.icon.square` | 上传直角方图，不自行裁切圆角 | semantic | 游戏物料要求“一、图标”；审核规范 2.2.3 |
| `material.icon.background` | 不得使用默认图标、白底、黑底或透明底 | semantic | 游戏物料要求“一、图标”；审核规范 2.1.10、2.2.3 |
| `review.icon.relevance` | 图标应符合游戏内容，不得添加误导角标或无关热门词 | semantic | 审核规范 2.2.1–2.2.2 |

### 游戏名

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.title.qualification` | 游戏名应与资质对应，不得添加热门搜索词类副名称 | external-evidence+semantic | 审核规范 2.3.1 |
| `review.title.content` | 游戏名不得含违规、误导或与游戏无关的信息 | semantic | 审核规范 2.3.2–2.3.3 |
| `review.title.installed_name_matches` | 安装到手机后的 App 名称与详情页游戏标题一致 | external-evidence | 审核规范 2.3.4 |
| `review.title.symbols` | 游戏名只允许文档列出的标点符号 | deterministic | 审核规范 2.3.5 |

### Windows / 电脑主机素材

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `material.pc.logo` | 游戏 Logo 为 PNG、4MB 内；宽度达到 1280px 或高度达到 720px | deterministic | 游戏物料要求 2.1 |
| `material.pc.cover.horizontal` | 横版封面 460×215，PNG/JPG，3MB 内 | deterministic | 游戏物料要求 2.2 |
| `material.pc.cover.vertical` | 竖版封面 600×900，PNG/JPG，3MB 内 | deterministic | 游戏物料要求 2.3 |
| `material.pc.cover.text` | 横竖封面必须带游戏 Logo/标题，不得出现标题以外的宣传性文字 | semantic | 游戏物料要求 2.2–2.3 |
| `material.pc.library_hero` | 背景壁纸 3840×1240，PNG/JPG，10MB 内 | deterministic | 游戏物料要求 2.4 |
| `material.pc.library_hero.text` | 背景壁纸避免游戏 Logo、宣传标题等文字内容 | semantic | 游戏物料要求 2.4 |
| `material.pc.logoless.file` | 无 Logo 宣传图横版不低于 1920×1080、竖版不低于 720×1080；PNG/JPG，单张 6MB 内 | deterministic | 游戏物料要求 2.5 |
| `material.pc.logoless_pair` | 无 Logo 宣传图需同时提供横版和竖版，内容相同或相似 | deterministic+semantic | 游戏物料要求 2.5 |
| `material.pc.logoless.text` | 无 Logo 宣传图不得包含文字或游戏 Logo | semantic | 游戏物料要求 2.5 |

### 简介、开发者的话与更新日志

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `material.description.required` | 简介为必填文案 | deterministic | 游戏物料要求 3.1 |
| `material.description.purpose` | 简介描述游戏类型、玩法和特色，只介绍游戏本身 | semantic | 游戏物料要求 3.1；审核规范 2.4.1 |
| `review.copy.compliance` | 简介和开发者的话不得违反法律法规、平台收录标准，不得引导评价、引战、蹭热度或导流 | semantic | 审核规范 2.4.2–2.4.6 |
| `review.copy.no_contact` | 简介和开发者的话不得包含联系方式、兑换码、玩家群信息或不允许的外链 | deterministic+semantic | 游戏物料要求 3.1–3.2；审核规范 2.1.9、2.4.7 |
| `review.copy.description_developer_distinct` | 简介与开发者的话不得高度相似 | semantic | 游戏物料要求 3.2；审核规范 2.4.8 |
| `material.changelog.required` | 更新日志为必填文案 | deterministic | 游戏物料要求 3.3 |
| `material.changelog.relevant` | 更新日志描述本次版本变动，不得含宣传、广告、联系方式或无关内容 | semantic | 游戏物料要求 3.3；审核规范 4.4.1–4.4.2 |

### 游戏截图

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `material.screenshot.required` | 游戏截图为必填物料 | deterministic | 游戏物料要求 4.2 |
| `material.screenshot.count` | 至少 3 张，不能上传相同截图 | deterministic+semantic | 游戏物料要求 4.2；审核规范 2.5.7 |
| `material.screenshot.orientation` | 所有截图方向和宽高比一致 | deterministic | 游戏物料要求 4.2；审核规范 2.5.2 |
| `material.screenshot.dimension` | 横版不低于 1280×720；竖版不低于 720×1280，并符合文档比例范围 | deterministic | 游戏物料要求 4.2 |
| `material.screenshot.file` | PNG/JPG，单张不超过 4MB | deterministic | 游戏物料要求 4.2 |
| `review.screenshot.gameplay` | 下载/试玩时必须提供核心玩法截图；实机画面至少占 50%，且实机截图在前 | semantic | 游戏物料要求 4.2；审核规范 2.5.1 |
| `review.screenshot.truthful` | 截图须与实际游戏一致，不得用不存在或过度美化的画面误导用户 | semantic | 游戏物料要求 4.2；审核规范 2.5.3–2.5.4、2.5.8 |
| `review.screenshot.upright` | 不得使用翻转或颠倒朝向的截图 | semantic | 审核规范 2.5.5 |
| `review.screenshot.no_excess_marketing` | 不得添加过多商业营销内容，应展示玩法机制、美术风格等 | semantic | 审核规范 2.5.6 |
| `review.screenshot.no_commerce_only` | 不得只展示充值、商城、抽卡等商业内容 | semantic | 游戏物料要求 4.2；审核规范 2.5.9 |

### 游戏实机录屏

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `material.gameplay_video.required` | 正式上线开放下载或试玩时必须提供实机视频 | deterministic | 游戏物料要求 4.1；审核规范 2.6.1 |
| `material.gameplay_video.file` | MP4/MOV，H.264 或 HEVC，5GB 内 | deterministic | 游戏物料要求 4.1 |
| `material.gameplay_video.duration` | 大于 15 秒且不超过 30 分钟，建议 2 分钟内 | deterministic | 游戏物料要求 4.1；审核规范 2.6.9 |
| `material.gameplay_video.dimension` | 短边不低于 540px，宽高比 21:9 到 9:21 | deterministic | 游戏物料要求 4.1 |
| `review.gameplay_video.core_play` | 前 5 秒展示核心玩法，核心玩法连续超过 10 秒；前 30 秒限制长时间纯展示、CG、立绘等内容 | semantic | 游戏物料要求 4.1；审核规范 2.6.2 |
| `review.gameplay_video.no_extra_audio_text` | 不得添加游戏本体外配音和字幕 | semantic | 游戏物料要求 4.1；审核规范 2.6.3 |
| `review.gameplay_video.no_pre_post_roll` | 不得出现任何形式的前贴片；后贴片仅可出现厂商 Logo 和游戏 Logo | semantic | 审核规范 2.6.4 |
| `review.gameplay_video.no_external_brand` | 不得含其他平台 Logo、水印或第三方导流 | semantic | 游戏物料要求 4.1；审核规范 2.6.5 |
| `review.gameplay_video.no_occlusion` | 不得用圣光、暗幕、云团、表情包、马赛克等遮挡画面 | semantic | 游戏物料要求 4.1；审核规范 2.6.6 |
| `review.gameplay_video.no_pip_device` | 不得画中画，录屏内容占比应在 80% 以上，不得拍出游玩设备 | semantic | 游戏物料要求 4.1；审核规范 2.6.7–2.6.8 |
| `review.gameplay_video.not_trailer_substitute` | 实机录屏不得使用宣传视频替代 | semantic | 审核规范 2.6.10 |
| `review.gameplay_video.no_marketing_only` | 不得含营销诱导文案或只展示折扣、充值等纯商业化内容 | semantic | 游戏物料要求 4.1；审核规范 2.6.11、2.6.13 |
| `review.gameplay_video.hd` | 实机录屏应提供高清视频 | semantic | 审核规范 2.6.12 |

`review.gameplay_video.not_trailer_substitute` 只支持“用途不能互相替代”的官方结论。两份文档没有写“宣传片与实机录屏内容不得高度雷同”，因此不得把“高度雷同”表述为该规则原文或官方阈值。

### 16:9 与 1:1 宣传图

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `material.promo_16_9.required` | 16:9 宣传图为必填物料 | deterministic | 游戏物料要求 5.1 |
| `material.promo_16_9.file` | 不低于 1920×1080，16:9，PNG/JPG，4MB 内 | deterministic | 游戏物料要求 5.1 |
| `review.promo.title_only` | 必须展示游戏名，不得出现游戏名以外的文字 | semantic | 游戏物料要求 5.1；审核规范 2.7.1 |
| `review.promo.no_raw_screenshot` | 不得直接使用未经排版的游戏截图 | semantic | 游戏物料要求 5.1；审核规范 2.7.2 |
| `review.promo.no_collage` | 不得多图拼接或平铺 | semantic | 游戏物料要求 5.1；审核规范 2.7.3 |
| `review.promo.no_icon` | 不得出现游戏 Icon | semantic | 游戏物料要求 5.1；审核规范 2.7.4 |
| `review.promo.truthful` | 贴近真实美术资产或玩法，不得过度美化或添加误导信息 | semantic | 游戏物料要求 5.1；审核规范 2.7.5 |
| `review.promo.no_person_phone` | 非真人卖点游戏不得使用真人素材，不得出现实物手机 | semantic | 游戏物料要求 5.1；审核规范 2.7.6–2.7.7 |
| `review.promo.no_title_poster` | 不得把标题/Logo 做成大字报；简单背景不能只有标题/Logo | semantic | 游戏物料要求 5.1；审核规范 2.7.8 |
| `material.promo_1_1.file` | 不低于 1440×1440，1:1，PNG/JPG，4MB 内 | deterministic | 游戏物料要求 5.2 |
| `material.promo_1_1.required` | 上传竖版实机录屏时必须提供；仅上传横版实机录屏时无需提供 | deterministic | 游戏物料要求 5.2 |
| `material.promo_1_1.consistency` | 主体内容应与对应平台的 16:9 宣传图保持统一 | semantic | 游戏物料要求 5.2 |
| `review.promo_1_1.content` | 必须展示游戏标题；不得出现标题以外的宣传性文字、游戏图标、直接游戏截图或简单拼贴 | semantic | 游戏物料要求 5.2 |

### 宣传片

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `material.trailer.file` | 1280×720 以上、16:9 横屏；MP4/MOV、H.264/HEVC、5GB 内 | deterministic | 游戏物料要求 5.3 |
| `material.trailer.duration` | 不少于 15 秒 | deterministic | 游戏物料要求 5.3 |
| `review.trailer.core_play` | 以展示核心玩法为主，前 3 秒避免 Logo、黑屏等无实机画面内容 | semantic | 游戏物料要求 5.3；审核规范 2.8.5 |
| `review.trailer.no_external_brand` | 不得含其他平台 Logo、水印或第三方导流 | semantic | 游戏物料要求 5.3；审核规范 2.8.1 |
| `review.trailer.no_occlusion` | 不得用圣光、暗幕、云团、表情包、马赛克等遮挡画面 | semantic | 游戏物料要求 5.3；审核规范 2.8.2 |
| `review.trailer.truthful` | 不得添加误导用户或违反规定的信息、素材，并应提供高清视频 | semantic | 游戏物料要求 5.3；审核规范 2.8.3–2.8.4 |

### 首页推荐语

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.promotion_text.exact_date` | 不使用“今日、明日、下周”等模糊时效；有时效内容需精确到年月日 | semantic | 审核规范 2.9.1 |
| `review.promotion_text.no_commercial_claim` | 不得使用文档列举的商业化宣传用语 | semantic | 审核规范 2.9.2 |
| `review.promotion_text.no_award_rating` | 不得添加平台或媒体奖项评价 | semantic | 审核规范 2.9.3 |
| `review.promotion_text.no_absolute_claim` | 不得使用极限词或绝对化用语 | semantic | 审核规范 2.9.4 |
| `review.promotion_text.relevant_authorized` | 内容应与游戏相关，不得使用未授权 IP，不得只重复游戏标题 | semantic | 审核规范 2.9.5–2.9.7 |
| `review.promotion_text.no_malicious_meme` | 不得添加恶意玩梗内容 | semantic | 审核规范 2.9.8 |

### 首页编辑推荐栏目推荐图

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `material.editorial_image.file` | 1920×1280（3:2）；建议提供 PSD，并必须提供 PNG 或 JPG | deterministic | 游戏物料要求“六、首页编辑推荐栏目推荐图” |
| `material.editorial_image.scope` | 该素材仅限编辑推荐游戏，通过开发者中心工单提交；没有该图的游戏不展示在专属栏目 | external-evidence | 游戏物料要求“六、首页编辑推荐栏目推荐图” |

## 三、商店配置

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.store.status_truthful` | 游戏状态按实际情况填写 | external-evidence | 审核规范 3.1.1 |
| `review.store.test_server_status` | 测试服或先行服不支持选择游戏状态，前台默认为“关注” | deterministic | 审核规范 3.1.2 |
| `review.community.name` | 玩家群名称与游戏或官方匹配，不得带引流或其他平台标识 | semantic | 审核规范 3.2.1–3.2.3 |
| `review.community.number_link` | 群号码只能填写一个；链接为纯链接，不加其他文字或符号 | deterministic | 审核规范 3.2.4–3.2.5 |
| `review.website.official` | 有游戏官网时，链接必须是游戏官方网站，不能用第三方商店或 APK 直链，并应真实有效；没有游戏官网则无需填写 | external-evidence | 审核规范 3.3.1–3.3.2 |

### 预约里程碑

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.reserve_milestone.scope_count` | 仅用于正式公测开服，最多 3 档 | deterministic+external-evidence | 审核规范 3.4.1–3.4.2 |
| `review.reserve_milestone.asset` | 奖励图为 200×200、透明背景、100KB 内的 PNG，不能使用黑白图案 | deterministic+semantic | 审核规范 3.4.3–3.4.4 |
| `review.reserve_milestone.number` | 里程数只使用 TapTap 预约数值和阿拉伯数字，不含符号 | deterministic+external-evidence | 审核规范 3.4.5–3.4.6 |
| `review.reserve_milestone.reward` | 奖励应是明确的游戏内具体奖励，已添加内容不得自行修改 | semantic+external-evidence | 审核规范 3.4.7–3.4.8 |

## 四、安装包文件

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.apk.package_name` | 包名不得含渠道标识、不得用打包工具默认包名，应与官方包名一致且保持唯一 | deterministic+external-evidence | 审核规范 4.1.1–4.1.4 |
| `review.apk.package_name_matches` | 后台 APK 包名资料与上传 APK 实际包名一致 | deterministic | 审核规范 4.1.5 |
| `review.apk.version_code` | Version Code 不得为 0，新包不得低于当前版本 | deterministic | 审核规范 4.2.1–4.2.2 |
| `review.apk.version_name` | Version Name 与官网一致 | external-evidence | 审核规范 4.3.1 |
| `review.apk.changelog` | 更新日志与版本变动有关，不得含宣传、广告、联系方式或无关内容 | semantic | 审核规范 4.4.1–4.4.2 |
| `review.apk.signature` | APK 不得使用公用证书签名 | deterministic+external-evidence | 审核规范 4.5.1 |

两份指定文档没有规定具体设备的安装测试矩阵，也没有规定“通过某设备安装测试”是文档条款。具体设备安装失败只能作为历史审核反馈或测试证据展示。

## 五、资质与授权

资质规则只做来源索引；实际是否满足由 `taptap-qualification` 和服务端返回判断。

| 规则 ID | 要求摘要 | 可检测性 | 来源 |
| --- | --- | --- | --- |
| `review.qualification.chain` | 主体不一致、存在授权或主体变更时，应提交真实、完整、可追溯的证明及文档要求的独家授权 | external-evidence | 审核规范 5.1.1–5.1.4、5.2.1–5.2.4 |
| `review.asset.authorization` | 版权敏感、真人、原创或购买素材需提供相应授权或证明 | external-evidence | 审核规范 5.3.1–5.3.4 |
| `review.isbn` | 大陆地区开放下载涉及版号和授权时，应按文档提交完整材料 | external-evidence | 审核规范 5.4.1–5.4.2 |
| `review.copyright` | 软著发生更名、主体转移等历史时提交完整材料 | external-evidence | 审核规范 5.5.1 |
| `review.app_filing` | 提供 APP 备案信息 | external-evidence | 审核规范 5.6.1 |
| `review.anti_addiction` | 实名认证与防沉迷信息真实有效，视频符合关联说明的填写要求 | external-evidence | 审核规范 5.7.1–5.7.2 |
| `review.privacy` | 分发前填写隐私政策链接并通过隐私安全合规检测 | external-evidence | 审核规范 5.8.1 |

## 六、历史审核与官方规则的映射纪律

历史审核原文可以与相关官方规则并列，但必须使用不同来源类型：

```text
官方规则：审核规范 2.6.10 要求实机录屏不得使用宣传视频替代。
历史审核：版本 V-... 被反馈“宣传视频与实机视频内容高度雷同”。
自动判断：无法从不同 videoId 推导内容不同，需人工复核。
```

禁止写成：

```text
官方规范要求宣传视频与实机视频不得高度雷同。
```

同理，设备安装失败只能写成历史事实：

```text
历史审核：版本 V-... 的 APK 在审核列出的设备上安装失败。
官方文档覆盖：上述两份文档没有指定该设备矩阵。
验证状态：没有当前包体的测试证据时标记“无法确认”。
```

## 七、冲突与更新处理

- 格式、尺寸、容量、时长和比例以当前 `get-app-module` 返回的 `image_spec` / `video_spec` 判断当前字段能否使用；回答中仍可附官方章节作为通用来源。
- 若实时规格与 v4 文档数值不同，不把任一方静默覆盖成另一方；明确说明“当前字段实时规格”和“官方 v4 通用文档”存在差异。
- 内容规则只以官方文档明确文字为准。Agent 可以进行语义风险判断，但必须标为“人工/AI 判断”，不得宣称来自未写明的官方条款。
- 文档页面版本或内容更新后，应新增规则快照或更新本文件的版本与检索日期，并检查规则 ID 的兼容性；不要无记录地改变旧审核报告的来源。
