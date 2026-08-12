# MCP integration (Cursor / compatible hosts)

Register the stdio server at `tools/mcp-threejson/server.mjs` with `THREEJSON_ROOT` pointing at the repository root.

Credentials: `tools/mcp-threejson/setting.json` → `llm`, or `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` environment variables. Texture acquisition additionally uses `texture.baseUrl` and `texture.apiKey` (or `THREEJSON_TEXTURE_API_KEY`).

Texture tools use the unified `threejson/texture` pipeline. The LLM plans semantic needs only; search, generation and persistence are performed by the configured texture service.

See [`docs/zh/mcp-cursor.md`](../../../../docs/zh/mcp-cursor.md) for example `.cursor/mcp.json`.
