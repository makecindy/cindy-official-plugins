# 同程程心 Cindy 插件源码

同程程心为 Cindy 提供机票、火车票、酒店、景区门票、汽车票、度假行程和综合交通七类查询。

## 安装与配置

1. 将下载的 `.cindy` 安装包拖入 Cindy，确认安装权限。
2. 打开同程旅行 App 或微信小程序，登录后搜索「程心激活码」，按提示申领。
3. 在 Cindy「插件 → 同程程心 → 设置」中粘贴激活码，点击「保存 Key」。

设置页提供[同程官网](https://www.ly.com/)和[官方客服](https://www.ly.com/public/newhelp/CustomerService.html)入口。激活码申领需在 App 或小程序内完成；官网不是激活码直达申领页。

每位用户使用自己的 API Key，凭证由 Cindy 安全保存，不随安装包分发。

## 使用方式

在 Cindy 插件设置中保存用户自己的 API Key，然后由 Agent 调用对应工具。多日游使用 travel_search；未指定交通方式时使用 traffic_search。

可以直接告诉 Cindy：「用同程程心查询 2026 年 11 月 1 日上海到北京的火车票，只返回指定日期的车次。」

收到真实接口结果才代表查询成功。注意核对返回日期与车站；余票为 `*` 时不能判定有票，票价和预订状态以同程或 12306 实际页面为准。

## 开发与验证

- 网关固定为 https://wx.17u.cn/skills/gateway/api/v1/gateway，请求使用 POST JSON、version: 1.0.0 和 camelCase 参数。
- 请求带 `date` 时，worker 会校验返回资源日期与请求日期一致；网关忽略 date 参数回落其它日期时自动重试一次，仍不一致则返回 `date_mismatch` 并明确提示，不会把错误日期的资源当作目标日期展示。
- 在插件目录运行 `npm run build`，执行语法、离线单测及包成员检查。
- 使用 Cindy 的 `ghost_forge_pack` 从源码目录校验并生成安装包。
- 离线测试不验证真实账号、网络或预订入口；真实调用需有效的用户 API Key。
