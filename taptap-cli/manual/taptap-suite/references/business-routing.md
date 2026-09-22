# 业务 Skill 路由

业务操作必须路由到对应 skill；完整路由表见 `taptap-cli` 主文件的「快速决策」。本文件只在请求横跨多个业务域或路由不确定时做边界消歧，各域流程规则以对应业务 SKILL.md 和共享执行规范为准。

### 跨 skill 边界（防误路由 / 防混淆）

- **资料编辑 ≠ 创建游戏**：还没有 appId、只是要新建游戏时走 `taptap-publish-game`；已有 appId 后要改资料、换包体、提交审核或处理版本生命周期时走 `taptap-app-edit`
- **准备上线 ≠ 提交审核**：上传、补资料、绑定包体、查询就绪度或“正式上线”目标都不能推断提审意图；只有用户明确说“提交审核 / 提审”后才可进入 `prepare-review-snapshot`，预审后仍要单独确认 `submit-app-review`
- **包体管理 ≠ 资料草稿包体切换**：查"包体管理页 / 当前线上包 / Windows 或 H5 包列表 / 云玩或 TapPlay 用哪个包"走 `taptap-package-management`；改资料版本草稿绑定哪个包体走 `taptap-app-edit`
- **包体管理以查询和上传入口为主**：包体管理状态查询走 `taptap-package-management`；唯一确认式写例外是小游戏包体库明确需要初始化 Tap 小游戏能力时，先询问用户并在确认后开通。H5 与小游戏互斥，H5 不通过该能力开通。上传走 CLI app-scope 上传命令；TapTap 制造 / Spark 包体由 TapTap 制造传入，已有 ready 版本的资料页主包绑定转 `taptap-app-edit`
- **测试计划 ≠ 包体自测**：创建或管理测试计划、资格批次、激活码、报名用户走 `taptap-test-plan`；查看包体状态或生成可自测版本二维码走 `taptap-package-management`
- **上架资质 ≠ 测试玩家资格**：版号、备案、隐私、防沉迷、AI/IP 等上架要求走 `taptap-qualification`；CBT 玩家资格、资格批次和激活码走 `taptap-test-plan`
- **素材库收录 ≠ 资料字段写入**：找参考图、收录图片走 `taptap-asset-library`；把图片设为图标、宣传图或截图字段走 `taptap-app-edit`
- **物料上传 ≠ 资料写入或包体绑定**：目录/zip 或多种本地物料走 `taptap-materials` 盘点和逐项上传；图片和视频再交给 `taptap-app-edit` 写入字段，包体先交给 `taptap-package-management` 查询状态，绑定由 `taptap-app-edit` 按包体槽位契约确认式完成
- **敏感资质页面填写 ≠ CLI 已执行**：资质工具要求人工填写时，只给完整开发者后台链接并等待用户完成；不要调用前端卡片工具或声称已代填
- **数据表现只读**：用户问下载量、PV、转化、订单、评分统计等经营数据时走 `taptap-dashboard-stats`；不要把数据查询结果当作资料字段或版本状态写回
- **评分统计 ≠ 评价正文**：评分/评价的统计指标、趋势和分布走 `taptap-dashboard-stats`；单条评价的正文、配图、作者和回复走 `taptap-player-feedback`。两者口径不同，不能用对方的数据替代；用户说「好评」时必须先区分是统计口径还是列表筛选口径

### 跨 skill 串联（一次任务要换 skill 接力）

- **创建游戏后的 handoff**：`taptap-publish-game` 创建成功后，下一步不再只是页面入口，也不是立刻输出最终资料缺口清单。先确认创建信息和首批物料已交接，读取并报告实际可见的 `region_flag_*`，再只展示当前包体可用的推进方式；正式上线资料走 `taptap-app-edit`，上架资质走 `taptap-qualification`，测试走 `taptap-test-plan`，包体状态与自测走 `taptap-package-management`，参考图片检索/收录走 `taptap-asset-library`。
