<!-- Title: <type>(<plugin-directory>): <short description>
标题示例：fix(qq-mail): validate the move result
Keep it brief. CI checks version bump, DCO, manifest schema, locales, and packaging automatically.
简明填写即可。版本、DCO、清单格式、语言资源和打包由 CI 自动检查，无需抄录输出。
-->

## What and why / 改了什么、为什么

<!-- User-facing change, affected plugin(s), and related issue if any.
用户可见变化、涉及插件及关联 issue（如有）。 -->

## Verification / 验证

<!-- Automated tests or checks you ran (e.g. `node --test .tests/<plugin>.test.mjs`).
Manual Cindy client testing is optional for routine fixes; note any known gaps if relevant.
贴本地跑过的测试或检查结果；常规修复不强制实机验收，如有已知限制顺手说明即可。 -->

## Boundary changes, if applicable / 边界变更（无变化可写「无」或留空）

<!-- Fill ONLY when applicable:
- New plugin or `provisioning.json` audience change (`all` vs opt-in `{ "emails": [] }`)
- New/widened permissions, credentials, autonomous network hosts, subprocesses, or Manifest-v3 direct capability fields
- Changed third-party OAuth scopes or dependency on an unmerged Cindy host capability (list scope, platform approval, and host PR merge status; once merged to `main` with `minCindyVersion` isolation or old-host fallback, no need to wait for a stable client release)
- Renaming/deleting a published plugin, or changing `.github/workflows/**` / review rules

仅在涉及时填写：新增插件或改 audience；新增/扩大权限、凭证、自主域名、子进程或 Manifest-v3 直接能力字段；变更第三方 OAuth scope 或依赖尚未合入宿主 `main` 的能力（写明平台批准与宿主 PR 合入状态；宿主已合 `main` 且有 `minCindyVersion` 隔离或旧端降级时无需等客户端正式版）；重命名/删除已发布插件或修改发布/审查规则。 -->
