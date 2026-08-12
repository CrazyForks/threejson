[中文](./mcp-cursor.md) | [English](../en/mcp-cursor.md)

# ThreeJSON MCP（Cursor）

通过 MCP 在 Cursor 中调用 ThreeJSON 场景生成、校验与纹理填充。

## 安装

```bash
cd tools/mcp-threejson
npm install
```

在 `tools/mcp-threejson/` 下复制 [`setting.example.json`](../../tools/mcp-threejson/setting.example.json) 为 `setting.json`。`llm.*` 用于场景与纹理语义规划；`texture.baseUrl` / `texture.apiKey` 指向独立的统一纹理服务。与 [`tools/threejson-agent/setting.json`](../../tools/threejson-agent/setting.json) **相互独立**（两套文件、各自目录）。

仓库根目录由 Cursor MCP 配置里的环境变量 `THREEJSON_ROOT` 指定；未设置时 [`server.mjs`](../../tools/mcp-threejson/server.mjs) 按自身路径推断为仓库根。外置 Agent 默认以 **CLI 当前工作目录** 为工作区；仅当 `setting.paths.relativetRoot` 非空且 `paths.redirectRelative` 为 `true` 时才按配置重定向相对路径，二者不要混用。

## 与 threejson-agent 的 setting 对照

重叠块字段语义与 Agent 示例一致，可直接复制 `llm` / `agent` 的取值（密钥仍需分别维护两份 `setting.json`）。

| 配置块 / 字段 | threejson-agent | mcp-threejson | 说明 |
|---------------|-----------------|---------------|------|
| `llm.*` | 支持 | 支持 | MCP 经 `chatOptionsFromSetting` 读取；`generate` / `update` / `plan_textures` 使用 |
| `llm.maxTokens` | 支持（CLI 桥接） | 示例保留，**当前 MCP 未透传** | 见 `server.mjs` 的 `chatOptionsFromSetting`；缺省走 core 默认 |
| `agent.enabled` | CLI 默认 / `--agent` | 支持 | MCP 以工具参数 `agentEnabled` 为准；`setting.agent` 仅作 `depth` 等默认 |
| `agent.depth` | 支持 | 支持 | `threejson_generate` 的 `depth` 未传时用 `setting.agent.depth` |
| `texture.baseUrl` / `apiKey` | 支持 | 支持 | 独立纹理服务；不复用聊天供应商的生图接口 |
| `texture.strategy` / `pbr` | 支持 | 支持 | 默认语义混合与完整 PBR；实际能力以服务端声明为准 |
| `texture.allowUnknownLicense` | 支持 | 支持 | 默认 `false`，许可未知候选只返回待确认，不自动应用 |
| `texture.persistenceMode` | 支持 | 支持 | `remote`、`archive-selected` 或 `archive-all`；无存储时退化为远程代理 |
| `texture.concurrency` | 支持 | 支持 | 独立纹理任务并发数，默认 `3` |
| `texture.fillAfterAgent` | 支持 | **忽略** | Agent `run` 流水线开关；MCP 手动调用 `threejson_fill_textures` |
| `asset.*` | 支持（search/import） | **无** | 无对应 MCP tool |
| `paths.relativetRoot` + `paths.redirectRelative` | 支持 | **无** | Agent CLI `-i/-o` 默认相对 cwd；MCP 用 `THREEJSON_ROOT` |
| `paths.redirectRelativeWarn` | 支持 | **无** | `false` 时不输出重定向 stderr 提示 |

## 配置 Cursor

在项目或用户配置中加入（路径按本机修改）：

```json
{
  "mcpServers": {
    "threejson": {
      "command": "node",
      "args": ["tools/mcp-threejson/server.mjs"],
      "env": {
        "THREEJSON_ROOT": "E:/WORKSPACE/00ProjectSpace/ThreeJSJson/ThreeJSON"
      }
    }
  }
}
```

## 工具一览

| 工具 | 说明 |
|------|------|
| `threejson_validate` | 校验场景 JSON |
| `threejson_generate` | 文本生成场景（可选 `agentEnabled`） |
| `threejson_update` | 按说明更新场景 |
| `threejson_plan_textures` | 一次 LLM 调用生成纯语义纹理需求，不生成 URL |
| `threejson_fill_textures` | 经统一纹理服务搜索/生成/代理，并更新场景中的权威源 URL |

更多说明见 [`tools/threejson-agent/shell/py/threejson_agent/skills/mcp.md`](../../tools/threejson-agent/shell/py/threejson_agent/skills/mcp.md)。
