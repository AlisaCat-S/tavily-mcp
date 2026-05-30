#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createTavilyServer, listTools } from "./tavily-server.js";

interface Arguments {
  'list-tools': boolean;
  _: (string | number)[];
  $0: string;
}

const argv = yargs(hideBin(process.argv))
  .option('list-tools', {
    type: 'boolean',
    description: 'List all available tools and exit',
    default: false
  })
  .help()
  .parse() as Arguments;

if (argv['list-tools']) {
  listTools();
}

const server = createTavilyServer();

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("Tavily MCP server running on stdio");
}).catch(console.error);
