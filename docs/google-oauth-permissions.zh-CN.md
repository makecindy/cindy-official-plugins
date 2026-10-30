<p align="right"><strong>简体中文</strong> · <a href="google-oauth-permissions.md">English</a></p>

# Google 联系人功能与 OAuth 审核清单

日期：2026-10-28。适用：Gmail 插件 1.6.1 的源码提案。此文件不是 Google 已批准的证明。

本轮范围：账号头像、个人联系人查询与增删改、其他联系人读取、可见企业目录读取。
Gmail 设置管理不在本轮范围。个人联系人管理通过聊天工具 `gmail_contacts` 提供，
不新增独立通讯录页面，不写入 Cindy 智能通讯录。邮件读取已向新版桌面侧栏返回精确邮箱
匹配的个人联系人照片，旧客户端忽略此可选字段。审核演示仍需真实 Google 授权和测试账号验证。

## 本轮新增权限

以下均以 `https://www.googleapis.com/auth/` 开头。

| Scope | 实际用途 | 演示入口 |
| --- | --- | --- |
| `userinfo.profile` | 当前授权账号的姓名与照片；Host 从 UserInfo 的 picture 读取头像 | 重新连接后的账号列表 |
| `contacts` | 查询个人联系人、照片，创建、修改和删除联系人 | gmail_contacts 的 list/search/get/create/update/delete |
| `contacts.other.readonly` | 查询 Google 自动保存的其他联系人及可用照片 | gmail_contacts 的 other_contacts |
| `directory.readonly` | 查询当前用户可见的 Workspace 目录人员及可用照片 | gmail_contacts 的 directory |

联系人需要编辑，因此使用 `contacts`，不重复添加 `contacts.readonly`。
只读权限不足以完成用户明确选择的联系人增删改。目录访问仍受 Workspace 管理员策略限制，
不申请 Admin SDK 或全域委托。各来源都不能保证任意邮箱存在照片。

## 已有权限盘点

源码中 Gmail、Calendar、Drive、Sheets 使用同一个 OAuth client，适合统一整理审核材料。
必须在 Google Cloud Verification Center 核对已批准权限，不能从源码推断获批状态。

| 插件 | 当前声明（基础身份权限之外） | 本次处理 |
| --- | --- | --- |
| Gmail | gmail.readonly / gmail.compose / gmail.modify | 保留现有声明；不顺便变更已有账号的权限迁移策略 |
| Calendar | calendar | 本次不改 |
| Drive | drive | 本次不改 |
| Sheets | drive | 本次不改 |

现有 `gmail.modify` 已支持常用读信、草稿、发信、标记与移入垃圾箱等操作。
Gmail 现有三项有重叠，提交时应核对实际调用与已批准范围；本次不为头像增列
gmail.send、gmail.labels 或更广的 mail.google.com 权限。
gmail.settings.basic 仅在实现过滤规则、签名、自动回复等设置管理时申请；
gmail.settings.sharing 不是普通用户 OAuth 的通用设置权限。

## 提交与演示

1. 在测试 OAuth 项目中启用 People API，配置上述四个 scope。使用测试账号，避免先把未获批范围推给生产用户。
2. 在可识别版本的 Cindy 中安装测试包，录制英文授权流程，展示应用名称和浏览器中的 client ID；授权由 Host 与 Google 页面处理，不能把 token/授权码复制到任务或录屏材料中。
3. 展示当前账号头像；查询一个已有照片的测试联系人；分页读取其他联系人；用允许目录访问的 Workspace 测试账号查询目录同事。
4. 明确要求创建一个测试联系人，读取其 resourceName，再修改其电话或公司信息并读回；明确要求删除同一个测试联系人并核实。不要操作真实业务联系人充当演示。
5. 验证拒绝新增联系人权限时，原邮件权限仍可用；联系人操作提示补授权。验证多账号不会自动替换所选账号、过期 etag 不覆盖新资料、网络异常不自动重复写入。
6. 核对隐私政策、主页、数据用途和全部已有 scope。为每项新增权限提交用途说明和演示视频，批准后再发布生产授权范围。

统一准备审核不等于用户连接 Gmail 时要授予 Calendar/Drive。旧 token 不会因修改
manifest 自动获得联系人权限，用户需要主动重新连接并授予新增权限；拒绝部分权限
应只影响对应功能。是否已获 Google 审核批准、端到端授权是否成功，需要单独验证。

## 数据路径与验证边界

联系人请求由 Host `cindy.fetch` 代发到固定的 `people.googleapis.com`，沿用所选
Gmail 账号，凭据由 Host 注入。联系人数据不持久写入插件 KV，不发送给第三方头像服务。
联系人结果会返回当前 AI 任务；审核材料与隐私政策必须如实说明宿主与所选模型的实际
数据处理流程，不能仅因插件不落盘就声称全部数据只在本机。账号头像由 Host 现有头像
通道处理。代码测试使用合成数据，不构成真实 Google 授权或真人数据读写的验收证明。

侧栏只查询前 12 个不重复的邮件参与人，查询预算为两秒，与邮件其他读取重叠执行；
按账号隔离的一分钟内存缓存有容量上限。缺少联系人授权、默认照片、非精确邮箱匹配
或网络异常都会回退，不影响邮件可读。其他联系人和企业目录照片仍通过 `gmail_contacts`
查询；侧栏自动匹配目前只搜索个人通讯录。

新版桌面依次回退 Gravatar（邮件头邮箱规范化后的 SHA-256 哈希）、DuckDuckGo 的
公开企业域名图标接口和姓名首字。服务会收到邮箱哈希或域名，以及查看者的网络地址；
不发送邮件正文、原始邮箱、Google 凭据或联系人记录。哈希不代表匿名保证。图片不带
Referer，Gmail、QQ 等公共邮箱跳过服务商图标。域名图标不代表发件人身份认证。
产品隐私说明需如实反映此路径。正文外部图片仍需用户单独点击显示。
不需要 Unavatar 订阅或 Logo.dev 密钥。

新增敏感/受限 scope 要补充审核；Google 当前说明，已完成安全评估的应用不会仅因增加
scope 就要求重做评估。其他评估或定期复审要求仍按项目实际情况判断。

## 官方依据

- [Scope 变更与重新审核](https://support.google.com/cloud/answer/13464018?hl=en)
- [最小必要权限政策](https://developers.google.com/identity/protocols/oauth2/policies)
- [用途说明和演示视频要求](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Gmail scope 清单](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google 账号资料](https://developers.google.com/identity/openid-connect/openid-connect)
- [联系人创建](https://developers.google.com/people/api/rest/v1/people/createContact)、[更新与 etag](https://developers.google.com/people/api/rest/v1/people/updateContact)
- [其他联系人](https://developers.google.com/people/api/rest/v1/otherContacts/list)、[企业目录查询](https://developers.google.com/people/api/rest/v1/people/searchDirectoryPeople)
