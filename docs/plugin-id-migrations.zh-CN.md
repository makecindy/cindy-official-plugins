# 已发布插件的 ID 迁移

[English](./plugin-id-migrations.md)

发布差异门禁继续拒绝删除已发布插件或变更其 ID，唯一例外是
[`plugin-id-migrations.json`](../plugin-id-migrations.json) 中精确登记的迁移对。
每项包含 `from`、`to` 与对应的 `serverPr`。维护者先在独立 PR 中审查登记，
之后改名 PR 才能使用它。

门禁读取**基线提交**中的登记，不读取改名 PR 自己添加的登记。旧目录/ID 必须在
基线存在、在目标消失；新目录/ID 必须在基线不存在、在目标出现。前后 manifest
ID 必须与登记匹配。新版本必须高于旧版本，原有 manifest、包结构、本地化、
provisioning 和公开发布检查继续生效。未登记的删除/改名、原目录内改 ID、
新旧 ID 共存、覆盖已有目标都不放行。迁移完成后登记可以保留，新 ID 的普通更新
仍走原有门禁。

Server PR 链接供审查追溯实现；CI 不读取 Server 仓库，也不证明已部署、客户端
已发布或旧安装已实际迁移。登记本身不执行迁移，也不发布插件包。

`baguette-simulator` → `cindy-simulator` 遵守
[维护者确定的顺序](https://github.com/makecindy/cindy-official-plugins/pull/213#issuecomment-6389936450)：
[Server #1048](https://github.com/xindong/cindy-server/pull/1048) 全部副本部署完成，
包含 [#7014](https://github.com/makecindy/cindy/pull/7014) 的客户端发布后，
插件 #213 再 rebase 到包含已审登记的 main，验证整合后的包及 CI，经维护者复审后合并。
新包激活仍须经过已有市场审核。
