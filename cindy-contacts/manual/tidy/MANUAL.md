# 通讯录日常检查

目标：只处理新增的真实往来；没有变化就收尾。日常检查不等于全面整理，不能每天重扫历史、重新找一遍工具或重写已有档案。

## 每轮必做

1. `maintenance({action:"begin"})`，按用户指定的 scope；默认 `recent`。以返回的各来源 `from` / `to` 为准。复用 `previous_sources` 中成功的路径；实际增量查询即完成可读性检查，不再另做一轮探测。首次配置或路径失效才找替代，不安装插件、改设置或替用户登录。通过 `action:"sources"` 报告实际状态。
2. **先查轻量索引**：只取 ID、时间、参与人、主题、短摘要和分页信息。按 `sources[].how` 读本次窗口；不要先读取整封邮件、历史线程或附件。未知真人也要判定，不能只查已有联系人。
3. **正文前批量排重**：`maintenance({action:"filter",source,account,refs})`，每批最多 100 条。account 是稳定的服务商和账号标识；邮件用 message id，聊天用消息 id，可变日程用 event id + revision。只处理返回的 `unseen`；filter 不会标记完成。没有未处理项的来源直接收尾。
4. 仅为无法从索引判断的候选读取必要正文。确认纯营销、机器人或无关通知后可批量 `ack`（参数同 filter）。有真实往来时，**首次写入前**读下方详细规则；按人聚合，新建前查重，每人 `get({id,compact:true})` 一次，只保存有实质变化的字段。该内容涉及的全部人物都完成 record 和必要的 save 后才 ack；未完成、失败、人数超限的不能 ack。只整理某个人的任务不能代替全局确认。
5. 遵守 begin 的 `budget` 和 `max_changes`。新内容优先，历史 backlog 仅在任务允许且有剩余预算时补；不要自行遍历全部历史。要补历史或恢复分页时才读详细规则。预算达到就保存精确缺口，不为凑 complete 继续扫描。
6. **始终 end**：带 `run_id`、实际扫描及更新数量、各来源 coverage。读全写 complete；未读写 none；部分完成写 partial，并保存具体账号/会话、未处理时间范围，分页带 `resume:{account,query,cursor}`。query 保留固定时间范围，cursor 只放分页 token，不能放凭证。附件无关不算缺口；群聊和单聊未覆盖的部分必须保留。没有新往来也要 end，不读取或重写联系人档案。

## 只有需要时再读

`ghost_manual({ghost_id:"cindy-contacts",path:"tidy/references/details.md"})`

- **准备写真人档案**：查记人与待办规则；按事聚合、旧消息不覆盖较新进展，不因重复 record 重写档案。GitHub 只补已有人的资料，不记往来或待办。
- **首次找来源、来源失败**：查读取路径、群聊/单聊覆盖及权限原因；不要每天重复全文加载和遍历入口。
- **回补、续页或遇到阻塞**：查 progress 的 partial / blocked / complete 用法。每页落盘断点，失败保留位置并退避重试。未处理内容不能标为完成。
- **用户追问漏读**：查诊断规则，不自行重跑整轮。

已有来源可用且无新内容的一轮，不需要读上述详细手册或 usage。旧插件没有 budget/filter/ack/progress 时，不调用不存在的 action，仍用轻量索引和精确 coverage 收尾。
运行前的轻量检查：若 begin 返回 `checked_empty`，这些来源已由程序检查并保存进度，不再查询。
`available_checks` 是当前已授权的检查器。首次核实来源的所有账号与路径后，在
`maintenance(action:"sources")` 对应项的 `check_providers` 填完整覆盖的 providerId；
覆盖不全则填 `[]`，不要用 Gmail 检查替代其它邮箱。Cindy 内置检查仅覆盖本机对话，
不包括其它电脑或外部聊天。换账号路径时重新核实绑定。检查未知、超时或授权失效仍走原增量流程。
