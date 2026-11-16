# 集卡配置与库存

本文件供 Agent 执行集卡操作；给厂商的玩法说明、方案选择、预览与结果统一按 [用户指引](taptap-suite/references/taptap-game-sign/references/game-sign-examples.md)，不直接转述下方接口说明。活动定位、可编辑状态、图片交接、配置必填条件及提审按 [活动主流程](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)；授权与幂等沿用 [共享执行规范](taptap-suite/references/shared-execution.md)。

作用域用 `developer_id` / `app_id`；示例值不是业务默认值，写入前预览并沿用同一意图的幂等键，写后回读。

## 配置集卡

支持 **3 种基础卡 + 1 种奖品卡（3+1，共 4 种）** 或 **3 种基础卡 + 2 种奖品卡（3+2，共 5 种）**。基础卡保留 3 种，奖品卡可保留紫色或金色中的 1 张，也可两张都保留。首次配置时明确介绍两种方案，沿用用户已有选择；预置数量不是用户必须配置的数量。

这里的 3+1／3+2 指卡片种类：3 种基础卡搭配 1 或 2 种奖品卡。每种奖品卡对应自己的奖品、概率和库存。兑换某项奖品时消耗每种基础卡各 1 张及该奖品对应的奖品卡 1 张；3+2 不要求同时集齐两种奖品卡才能兑换一次，已消耗的基础卡不能用于另一轮兑换。

- **3+1**：先读配置，明确保留对象；多出的奖品卡按 [删除预览](#删除预览) 及已有授权处理，再回读确认 3 种基础卡和 1 种目标奖品卡。不能擅自决定删除对象或只留空另一张卡冒充完成。
- **3+2**：复用现有两张奖品卡；缺少时才按下述新增规则补充，再回读确认 3 张基础卡和 2 张奖品卡。已选 3+1 时不自动补回第二张奖品卡。
- 面向厂商的卡片表格按下方「卡片展示」组织，ID 留在内部用于保存、删除、导码和回读。

仅可补充缺失的 SR／SSR 奖品卡；两种等级都存在时不再添加，也不能创建基础卡或其他等级。添加后使用返回的 `card_id` 配置奖品和库存，再查询确认结果；添加卡片本身不会恢复已删除的配置。抽卡概率不能保证库存发完，预期参与人数也不能作为实际中奖人数。

若已开启集卡却读到 **0 张卡**，先核对集卡开关和实际卡片列表，不直接判断原因；`add-card` 只能补奖品卡，无法创建基础卡，`save-card` 也不能凭空补卡。缺少基础卡时停止反复新增或保存，向用户说明“当前缺少基础卡，暂时无法继续配置，需要联系平台处理”；若用户选择重建，先说明影响并取得明确授权，不能自动重建。提审需具备基础卡和奖品卡。

开启集卡后先读 `get-config`，核对已有卡片、类型与 ID。配置现有卡片时复用原 `card_id`；只有确需新增且当前限制允许时才 `add-card`，并用返回的 `card_id` 保存。存在预置卡不等于禁止新增；满额时不自动删卡腾位。

```text
# 1. 仅当本次要求开启且当前尚未开启时更新；新建已开启则跳过（要求可编辑）
call_tool(name:"game-sign update-activity", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", title:"<活动标题>", color:"#224488",
        game_sign_start_time:<start>, game_sign_end_time:<end>,
        activity_end_time:<end>, enable_card_collection:true},
  idempotency_key:"<stable-key>", dry_run:true})

# 2. 取预置卡 id（开启后 card_collection_id 才会生成）
call_tool(name:"game-sign get-config", args:{
  developer_id:"<developerId>", app_id:"<appId>", data:{review_id:"<reviewId>"}})

# 3. 基础卡：只填名称与封面，rate=0
call_tool(name:"game-sign save-card", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", card_id:"<cardId>", card_title:"基础卡",
        cover_url:"https://cdn.example.com/c.png", rate:0},
  idempotency_key:"<stable-key>", dry_run:true})

# 4. 奖品卡（非 BASIC）：概率 10% 对应 rate=10000（100000 为 100%）；必须带 award
call_tool(name:"game-sign save-card", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", card_id:"<cardId>", card_title:"紫卡",
        cover_url:"https://cdn.example.com/c.png", rate:10000,
        award:{title:"钻石x500", picture_url:"https://cdn.example.com/a.png",
               type:"GOODS", redemption_conditions:"<用户确认的集卡规则>",
               state:"<用户确认的实物领奖说明>", expire_time:<秒级时间戳>}},
  idempotency_key:"<stable-key>", dry_run:true})

# 5. 实物库存
call_tool(name:"game-sign add-card-stock", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", card_id:"<cardId>", add_count:100},
  idempotency_key:"<stable-key>", dry_run:true})

# 6. 删卡（BASIC 不允许删除）
call_tool(name:"game-sign delete-card", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", card_id:"<cardId>"},
  idempotency_key:"<stable-key>", dry_run:true})
```

`award` 字段：`title`（奖品内容）、`picture_url`、`type`（`GOODS` 实物 / `REDEEM_CODE` 兑换码）、
`sub_type`（`REDEEM_CODE_GAME` / `REDEEM_CODE_JD`）、`expiration` 相关的 `expire_time`（秒级时间戳，必填）、
`redemption_conditions`、`state`、`exchange_url` 按 [配置必填条件](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md) 收集，不能因参数允许省略就遗漏完整配置所需的信息。

### 卡片展示

所有编号、枚举的输出边界以 [发送前检查](taptap-suite/references/taptap-game-sign/references/game-sign-examples.md) 为准。内部类型映射：`BASIC` → 基础卡、`SR` → 紫色奖品卡、`SSR` → 金色奖品卡；对外只使用右侧中文，不附原值。同名基础卡可用“基础卡 1／2／3”展示，本次会话保持标签与真实 ID 的映射稳定；不得把展示标签当接口 ID。JSON 保留真实 ID 供后续操作使用。

### 删除预览

删除前用名称和中文类型说明保留哪张、删除哪张，以及被删卡已有的配置、库存和删除影响；有图片可辅助识别，但不能替代上述内容。空白卡如实说明尚无已配置奖品、库存为 0，不声称删除了不存在的库存；无法核实的影响先说明并补查。预览与授权按 [配置预览](taptap-suite/references/taptap-game-sign/references/game-sign-examples.md) 处理，已有同一目标、方案及影响的确认直接沿用，不重复确认，也不能仅以内部 dry-run 或写后说明替代用户可见预览。

### 回读与结果说明

保存成功与独立回读核实分别记录。按当前响应核对同一卡片的名称、封面、类型、概率、奖品名称／类型和库存。返回 `cards[].award` 时，进一步核对其中的 `picture_url`、`expire_time`、`redemption_conditions`、`state` 和 `exchange_url`，分别对应奖品图片、过期时间、兑换规则、领取说明和网页兑换链接；以实际返回值为准，不用保存请求回填查询结果。

未返回 `award`、值为 null，或其中需要核实的字段缺失／为 null 时，该部分保留待核实；不因此判断已清空或保存失败。返回空字符串时按实际空值核对，不能用请求值替换。保存明确成功时，向厂商分别说明已保存、已核对和仍待核实的项目，不固定声称奖品信息都无法核对。需要进一步确认时核对已验证的后台页面。写入结果未知时，缺字段不能证明成功或失败，不重放或换幂等键；也不自动重建或要求用户重填。

### 实物补库存的状态与数量

执行 `add-card-stock` 前先查询活动状态，仅在**待提交／审核拒绝**时追加实物库存。其他状态下停止操作，向用户说明当前活动状态暂不支持补库存；不反复重试，也不自动撤回审核或重建活动。

`add_count` 是本次追加的正整数件数，不是目标剩余库存。例如回读剩余 20 件，用户要求补到 100 件，本次增加 80 件；用户要求“再加 100 件”则传 100。补到目标值时依据最新库存计算，存在并发领取或其他补库时不能保证最终剩余恰好等于目标。写后回读同一卡片的库存；新一次追加会再次增加库存，结果未知时先核实，不能换幂等键重发。

库存按奖品类型处理：`GOODS` 使用 `add-card-stock`，`REDEEM_CODE` 使用 [导码与恢复](taptap-suite/references/taptap-game-sign/references/code-import.md) 的 `card_id` 参数。写后回读同一目标；业务拒绝或库存未变化时说明实际结果，不换 key 连续重试。需人工核实则使用当前环境的可靠入口。

基础卡不可删除。奖品卡删除前核实目标与授权，删除后回读配置。提审要求奖品库存满足服务端条件，readiness 通过不替代提交时的最终校验。

## 集卡兑换码交接

集卡导码要求奖品类型为 `REDEEM_CODE`，使用 card_id；prepare/import/get-code-import 支持互斥的 award_id/card_id。不得将 card_id 当成 award_id。本地导码走 [导码与恢复](taptap-suite/references/taptap-game-sign/references/code-import.md) 的 `card_id` 参数，导入后核实处理结果和库存。需要核实未知结果时可交接已验证的页面，并回读 get-config 和 check-readiness。

人工核实需要当前环境中已验证的开发者页面入口，优先使用本次服务端返回的地址或用户提供的已确认链接。没有可靠入口时说明缺口，不根据上传地址、服务地址或猜测的路径拼接页面。

记录 review_id、card_id 和未完成事项；用户完成网页导入后，get-config 回读目标卡片的 import_status 和库存，再 check-readiness。只有对应卡片导入完成且无 error 才继续提审；每日奖励按 [兑换码导入](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md) 查询对应 award_id。用户说已上传不能替代回读。

## 异常恢复

已有奖品不支持在实物与兑换码之间直接切换。补库存失败不等于非限量配置错误，更不能靠修改概率或替换奖品类型修复。内部保留请求标识和目标，向用户说明哪项未完成及具体原因。
新增卡片的等级由服务端从缺失的 SR／SSR 中分配，不能按列表位置、标题或原卡等级推断；新增后回读 card_id 和 card_type。两种等级都缺失时不能承诺补回指定等级。

