# 小游戏上传交接

`upload-mini-app-package` 成功已包含直传、complete 和解析轮询；不得再调用 `complete-mini-app-package-upload`。`packageRecordStatus=artifact_only` 只表示尚未创建包体记录，不表示尚未完成上传。

查询上传产物时使用 `miniAppArtifactId` 作为 `artifact_id`，不得用 `taskId` 替代。后续包体操作先转 [taptap-package-management](taptap-suite/references/taptap-package-management/MANUAL.md) 核对状态。

若重复 complete 已报错，保留成功返回的产物 ID，只读核对产物，不能重传或换 key 重放。
