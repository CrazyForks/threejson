[中文](../zh/mcp-cursor.md) | [English](./mcp-cursor.md)

# ThreeJSON MCP For Cursor

The MCP server lets Cursor call ThreeJSON scene generation, validation, and texture filling tools.

## Install

```bash
cd tools/mcp-threejson
npm install
```

Copy `tools/mcp-threejson/setting.example.json` to `setting.json`. `llm.*` drives scene and semantic texture planning; `texture.baseUrl` and `texture.apiKey` configure the independent texture service.

The MCP settings are independent from `tools/threejson-agent/setting.json`.

## Workspace Root

Cursor MCP configuration can set `THREEJSON_ROOT`. If it is not set, `server.mjs` infers the repository root from its own path.

## Relation To threejson-agent

Overlapping `llm` and `agent` settings have the same meaning and can be copied between the two settings files, but credentials must be maintained separately.

Texture options supported by MCP include `baseUrl`, `apiKey`, `strategy`, `pbr`,
`allowUnknownLicense`, `persistenceMode`, and `concurrency`. Acquisition always uses the neutral
texture-service Provider contract; it does not reuse the chat provider's image endpoint or write
through the removed local texture sink. Agent-only path redirection and asset search settings do not apply.

## Cursor Configuration

Add the MCP server entry in Cursor, point it to `tools/mcp-threejson/server.mjs`, and set `THREEJSON_ROOT` to the repository root when needed.
