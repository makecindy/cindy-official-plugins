# Cindy Rhino Bridge

Connect Cindy to a Rhino instance already open on the same computer.

- Rhino 8/9 uses McNeel RhinoAI's MCP Router for live tool discovery, modeling, Grasshopper operations, and viewport images.
- Rhino 6/7 uses the bundled loopback connector for object queries, basic geometry, transforms, layers, and operation receipts.

The plugin never installs, starts, or closes Rhino automatically. Write operations that time out or lose their connection return an unknown outcome and must not be retried until the model or original operation id has been checked.

## Setup

Open the plugin settings and choose one mode:

1. McNeel official: install Rhino-MCP-Platform in Rhino, run MCPConnect, and paste the absolute rhino-mcp-router path.
2. Basic connector: run rhino/cindy_bridge.py in Rhino, then save the displayed pairing key and matching local port in Cindy.

Use $rhino or ask Cindy to check the Rhino connection. The detailed workflow and compatibility limits are in the bundled usage manual.

Rhino and related marks belong to Robert McNeel & Associates. This Cindy plugin is not distributed by McNeel.
