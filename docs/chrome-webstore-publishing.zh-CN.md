# Chrome 商店自动发布

[English](./chrome-webstore-publishing.md)

相关改动合入 `main` 后，`Publish Chrome extension` 工作流检查商店版本。
当 `my-browser/extension/manifest.json` 的版本更新时，使用
`scripts/build-my-browser.mjs` 打包、上传并提交 Google 审核，通过后自动发布。
已安装扩展随后通过 Chrome 自身的更新机制更新；这不代表立即强制更新，也不跳过
Google 审核。Cindy 插件的 `ghost.json` 版本与扩展版本独立。

已有待审核版本会保留；每六小时检查一次，等前一版审核完成后提交 `main` 最新版本。
相同或更低版本直接跳过。暂存发布、商店警告、下架及被拒绝／取消的版本需在后台处理，
修正后提高版本号。支持从 `main` 手动触发。API 写入失败不会盲目重试：结果不明确时，
先检查商店后台再重跑。

## 一次性配置

使用独立 Google Cloud 项目，无需服务账号私钥或 OAuth refresh token。
管理员登录 `gcloud` 后执行：

```sh
# 本配置的新项目不必绑定结算账号。
gcloud projects create YOUR_PROJECT_ID --name='Cindy Chrome Publishing'
bash .github/scripts/setup-chrome-webstore.sh YOUR_PROJECT_ID \
  makecindy/cindy-official-plugins 1309858579 306974279
```

配置脚本用于首次创建，遇到错误会停止；部分完成时先检查现有资源，再继续剩余命令。
它启用 API，创建服务账号和 Workload Identity Federation 提供方。
提供方仅接受指定仓库／组织的数字 ID、`main` 上的指定发布工作流，以及
`chrome-webstore` 环境。服务账号没有项目级资源角色；GitHub 仅获得该账号的
`roles/iam.workloadIdentityUser` 身份使用权限。

在 Chrome 商店**发布者设置 → 服务账号**添加脚本输出的账号邮箱。
这项权限覆盖整个发布者账号，Google 每个发布者仅允许一个服务账号；已有账号时，
先确认现有使用方，不直接替换。工作流仅操作配置的扩展。

创建 GitHub 环境 `chrome-webstore`，将部署分支限制为 `main`，设置以下环境变量
（不是 Secret）：

| 变量 | 内容 |
| --- | --- |
| `CWS_SERVICE_ACCOUNT` | 配置脚本输出 |
| `CWS_WORKLOAD_IDENTITY_PROVIDER` | 配置脚本输出 |
| `CWS_PUBLISHER_ID` | 开发者后台中的发布者 ID |
| `CWS_EXTENSION_ID` | 现有 32 位扩展 ID，与 `my-browser/distribution.json` 一致 |

保留仓库现有 PR 和分支保护。检查／发布任务获取短期、限定 scope 的访问令牌。
依赖打包在没有 OIDC 和 Google 凭据的独立任务中执行。发布任务只下载当前运行的产物，
上传前核对源提交、SHA-256 和 ZIP 内的 manifest。
持有凭据的任务仅执行受信任的发布脚本，不执行扩展代码。

## 首次运行和维护

工作流合并后，从 `main` 手动触发并检查 Actions 摘要。当前版本已待审核／已发布时，
预期跳过，不上传；下一个真正更新的版本也需在商店后台核对。
自动测试使用模拟 API，不能证明真实 Google 授权已打通。

商店包变化时提高扩展 manifest 版本；插件包内容变化时也提高插件版本。
PR 检查会要求扩展源文件、依赖配置、许可证或 Chrome 打包脚本变更时同步提高扩展版本。
商店描述、截图、隐私声明和新增权限说明仍需在后台维护，自动提交前应保持最新。
工作流不修改这些信息，不取消审核，也不自动发布刻意暂存的版本。

参考：[Chrome 商店 API](https://developer.chrome.com/docs/webstore/using-api)、
[服务账号](https://developer.chrome.com/docs/webstore/service-accounts)、
[Google GitHub 身份认证](https://github.com/google-github-actions/auth)。
