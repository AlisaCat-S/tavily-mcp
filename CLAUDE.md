# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to build/
npm run watch        # Compile in watch mode
npm run inspector    # Run with MCP Inspector for testing
```

There is no test suite or linter configured in this project.

## Running Locally

The server communicates over stdio. Set `TAVILY_API_KEY` env var (or omit it for keyless mode):

```bash
TAVILY_API_KEY=<key> node build/index.js
```

CLI flag `--list-tools` prints available tools and exits.

## Architecture

This is a single-file MCP server (`src/index.ts`) that exposes Tavily API endpoints as MCP tools. It uses the `@modelcontextprotocol/sdk` stdio transport.

**TavilyClient** is the main class:
- Creates an MCP `Server` instance with tool capabilities
- Sets up an axios instance with auth headers (Bearer token or keyless headers depending on `TAVILY_API_KEY` presence)
- Registers tool handlers via `ListToolsRequestSchema` and `CallToolRequestSchema`
- Each tool method (`search`, `extract`, `crawl`, `map`, `research`) posts to the corresponding Tavily REST endpoint

**Tools exposed:** `tavily_search`, `tavily_extract`, `tavily_crawl`, `tavily_map`, `tavily_research`

**Keyless mode:** When no API key is set, the server runs with limited functionality (search and extract only), using `X-Tavily-Access-Mode: keyless` headers. Error responses from the API in keyless mode use a structured envelope format handled by `isKeylessEnvelope`/`formatKeylessEnvelope`.

**Default parameters:** The `DEFAULT_PARAMETERS` env var (JSON string) lets users set default values for search tool parameters.

**Research tool polling:** The `research` method is async — it submits a job, then polls with exponential backoff until completion or timeout (5min for mini, 15min for pro).
