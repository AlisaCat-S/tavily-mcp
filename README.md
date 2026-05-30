# Tavily MCP Server

![GitHub Repo stars](https://img.shields.io/github/stars/tavily-ai/tavily-mcp?style=social)
![npm](https://img.shields.io/npm/dt/tavily-mcp)
![smithery badge](https://smithery.ai/badge/@tavily-ai/tavily-mcp)

Tavily MCP 服务器提供以下工具：
- `tavily_search` — 实时网页搜索
- `tavily_extract` — 从网页提取内容
- `tavily_map` — 网站结构映射
- `tavily_crawl` — 网站爬取
- `tavily_research` — 综合研究（多源信息汇总）

## Docker 部署（远程 MCP + Cloudflare Tunnel）

通过 Docker Compose 一键部署远程 HTTP MCP 服务器，配合 Cloudflare Tunnel 暴露到公网。

### 快速开始

1. 创建 `.env` 文件：

```bash
TAVILY_API_KEY=your-tavily-api-key
MCP_AUTH_TOKEN=your-secret-token
CF_TUNNEL_TOKEN=your-cloudflare-tunnel-token
# TAVILY_API_BASE_URL=https://your-custom-api.com  # 可选，自定义 API 地址
```

2. 启动服务：

```bash
docker compose up -d
```

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `TAVILY_API_KEY` | 是 | Tavily API 密钥 |
| `MCP_AUTH_TOKEN` | 否 | MCP 接口的 Bearer Token。为空则不启用认证 |
| `CF_TUNNEL_TOKEN` | 是 | Cloudflare Tunnel Token（在 Zero Trust 面板创建隧道后获取） |
| `TAVILY_API_BASE_URL` | 否 | 自定义 Tavily API 地址（默认 `https://api.tavily.com`） |
| `MCP_PORT` | 否 | HTTP 监听端口（默认 `3000`） |

### Docker 镜像

每次推送自动构建多架构镜像（amd64/arm64）并发布到 GHCR：

```
ghcr.io/alisacat-s/tavily-mcp-server:latest
```

## 部署后接入指南

部署完成后，各客户端可通过以下方式接入你的远程 MCP 服务器。

### Claude Code

```bash
# 全局可用（所有项目）
claude mcp add --transport http --scope user tavily-remote https://your-domain.com/mcp \
  --header "Authorization: Bearer your-secret-token"

# 仅当前项目可用
claude mcp add --transport http tavily-remote https://your-domain.com/mcp \
  --header "Authorization: Bearer your-secret-token"
```

`--scope user` 表示用户级别配置，添加后在任何项目中都能使用该 MCP 服务器。不加则仅在当前项目生效。

### Cursor

在 Cursor 设置中编辑 MCP 配置（`.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "tavily-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-domain.com/mcp"],
      "env": {
        "MCP_HEADERS": "{\"Authorization\": \"Bearer your-secret-token\"}"
      }
    }
  }
}
```

### Windsurf / Cline

在对应的 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "tavily-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-domain.com/mcp"],
      "env": {
        "MCP_HEADERS": "{\"Authorization\": \"Bearer your-secret-token\"}"
      }
    }
  }
}
```

### 无认证模式

如果 `MCP_AUTH_TOKEN` 为空或未设置，服务器不要求任何认证，客户端连接时无需传递 `Authorization` header：

```bash
claude mcp add --transport http --scope user tavily-remote https://your-domain.com/mcp
```

## 本地运行（Stdio 模式）

### 前置条件

- [Tavily API key](https://app.tavily.com/home)
- [Node.js](https://nodejs.org/) v20+

### 使用 NPX

```bash
npx -y tavily-mcp@latest
```

### 客户端配置示例

```json
{
  "mcpServers": {
    "tavily-mcp": {
      "command": "npx",
      "args": ["-y", "tavily-mcp@latest"],
      "env": {
        "TAVILY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## 默认参数配置

通过 `DEFAULT_PARAMETERS` 环境变量设置搜索工具的默认参数：

```json
{
  "mcpServers": {
    "tavily-mcp": {
      "command": "npx",
      "args": ["-y", "tavily-mcp@latest"],
      "env": {
        "TAVILY_API_KEY": "your-api-key-here",
        "DEFAULT_PARAMETERS": "{\"include_images\": true, \"max_results\": 15, \"search_depth\": \"advanced\"}"
      }
    }
  }
}
```

## 用户标识（可选）

设置 `TAVILY_HUMAN_ID` 环境变量可标识终端用户，Tavily 会在服务端对该值做 SHA-256 哈希后存储，用于按用户统计分析。

```json
{
  "env": {
    "TAVILY_API_KEY": "your-api-key-here",
    "TAVILY_HUMAN_ID": "your-user-id"
  }
}
```

## 致谢

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Anthropic](https://anthropic.com)
- [Tavily](https://tavily.com)

