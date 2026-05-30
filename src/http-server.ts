#!/usr/bin/env node

import { randomUUID } from "crypto";
import { createTavilyServer } from "./tavily-server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response, NextFunction } from "express";

const MCP_PORT = parseInt(process.env.MCP_PORT || "3000", 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || "";

function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  if (!MCP_AUTH_TOKEN) {
    next();
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== MCP_AUTH_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const app = createMcpExpressApp({ host: "0.0.0.0" });
const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", bearerAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  try {
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res, req.body);
      return;
    }
    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport;
        }
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) delete transports[sid];
      };
      const server = createTavilyServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session" }, id: null });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.get("/mcp", bearerAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

app.delete("/mcp", bearerAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

app.listen(MCP_PORT, () => {
  console.error(`Tavily MCP HTTP server listening on port ${MCP_PORT}`);
  console.error(`Auth: ${MCP_AUTH_TOKEN ? "Bearer Token enabled" : "disabled (no MCP_AUTH_TOKEN set)"}`);
});

process.on("SIGINT", async () => {
  for (const sid in transports) {
    await transports[sid].close();
    delete transports[sid];
  }
  process.exit(0);
});
