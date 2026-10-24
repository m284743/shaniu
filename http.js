#!/usr/bin/env node
// shaniu-mcp 远程 HTTP 入口（Streamable HTTP, 无会话状态模式）
// 部署在 bn.shaniu.ai/mcp，供 Smithery 等远程 MCP 客户端直接调用
import { createServer } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createShaniuServer } from "./server.js";

const PORT = parseInt(process.env.PORT || "3211");

const http = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "shaniu-mcp" }));
    return;
  }
  if (url.pathname !== "/mcp") { res.writeHead(404); res.end("not found"); return; }

  // 无状态模式：每个请求一个临时 transport + server 实例
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createShaniuServer();
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    console.error("mcp error:", e);
    if (!res.headersSent) { res.writeHead(500); res.end("internal error"); }
  }
});

http.listen(PORT, "127.0.0.1", () => console.log(`shaniu-mcp http listening on 127.0.0.1:${PORT}`));
