# Cindy Rhino Bridge

把 Cindy 连接到同一台电脑上已经打开的 Rhino 实例。

- Rhino 8/9：通过 McNeel RhinoAI MCP Router 实时发现工具，执行建模、Grasshopper 操作并回显视口图片。
- Rhino 6/7：通过随包回环连接器查询对象、创建基础几何、执行变换、管理图层并查询操作回执。

插件不会自动安装、启动或关闭 Rhino。写操作超时或断线时会返回“结果未知”；在核对模型或原 operation_id 前不得自动重试。

## 设置

打开插件设置并选择一种模式：

1. McNeel 官方模式：在 Rhino 中安装 Rhino-MCP-Platform，运行 MCPConnect，把 rhino-mcp-router 的绝对路径填入设置。
2. 基础连接模式：在 Rhino 中运行 rhino/cindy_bridge.py，把弹窗显示的配对密钥和相同本机端口保存到 Cindy。

可使用 $rhino，或直接让 Cindy 检测 Rhino 连接。详细操作顺序与兼容限制见随包 usage 手册。

Rhino 名称及相关商标归 Robert McNeel & Associates 所有；本 Cindy 插件并非由 McNeel 发行。
