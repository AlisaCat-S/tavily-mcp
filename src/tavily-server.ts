import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

const API_KEY = process.env.TAVILY_API_KEY;
const IS_KEYLESS = !API_KEY;
const HUMAN_ID = process.env.TAVILY_HUMAN_ID;
const SESSION_ID = randomUUID();
const API_BASE_URL = (process.env.TAVILY_API_BASE_URL || 'https://api.tavily.com').replace(/\/+$/, '');

interface TavilyResponse {
  query: string;
  follow_up_questions?: Array<string>;
  answer?: string;
  images?: Array<string | { url: string; description?: string }>;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
    raw_content?: string;
    favicon?: string;
  }>;
}

interface TavilyCrawlResponse {
  base_url: string;
  results: Array<{ url: string; raw_content: string; favicon?: string }>;
  response_time: number;
}

interface TavilyResearchResponse {
  request_id?: string;
  status?: string;
  content?: string;
  error?: string;
}

interface TavilyMapResponse {
  base_url: string;
  results: string[];
  response_time: number;
}

const baseURLs = {
  search: `${API_BASE_URL}/search`,
  extract: `${API_BASE_URL}/extract`,
  crawl: `${API_BASE_URL}/crawl`,
  map: `${API_BASE_URL}/map`,
  research: `${API_BASE_URL}/research`
};

const docsURLs: Record<string, string> = {
  search: 'https://docs.tavily.com/documentation/api-reference/endpoint/search',
  extract: 'https://docs.tavily.com/documentation/api-reference/endpoint/extract',
  crawl: 'https://docs.tavily.com/documentation/api-reference/endpoint/crawl',
  map: 'https://docs.tavily.com/documentation/api-reference/endpoint/map',
  research: 'https://docs.tavily.com/documentation/api-reference/endpoint/research',
};

const axiosInstance = axios.create({
  headers: {
    'accept': 'application/json',
    'content-type': 'application/json',
    ...(IS_KEYLESS
      ? { 'X-Tavily-Access-Mode': 'keyless', 'X-Client-Source': 'tavily-mcp-keyless' }
      : { 'Authorization': `Bearer ${API_KEY}`, 'X-Client-Source': 'MCP' }),
    'X-Session-Id': SESSION_ID,
    ...(HUMAN_ID ? { 'X-Human-Id': HUMAN_ID } : {}),
  }
});

function getDefaultParameters(): Record<string, any> {
  try {
    const parametersEnv = process.env.DEFAULT_PARAMETERS;
    if (!parametersEnv) return {};
    const defaults = JSON.parse(parametersEnv);
    if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
      console.warn(`DEFAULT_PARAMETERS is not a valid JSON object: ${parametersEnv}`);
      return {};
    }
    return defaults;
  } catch (error: any) {
    console.warn(`Failed to parse DEFAULT_PARAMETERS as JSON: ${error.message}`);
    return {};
  }
}

// --- PLACEHOLDER_API_METHODS ---

async function search(params: any): Promise<TavilyResponse> {
  const defaults = getDefaultParameters();
  const searchParams: any = {
    query: params.query,
    search_depth: params.search_depth,
    topic: params.topic,
    time_range: params.time_range,
    max_results: params.max_results,
    include_images: params.include_images,
    include_image_descriptions: params.include_image_descriptions,
    include_raw_content: params.include_raw_content,
    include_domains: params.include_domains || [],
    exclude_domains: params.exclude_domains || [],
    country: params.country,
    include_favicon: params.include_favicon,
    start_date: params.start_date,
    end_date: params.end_date,
    exact_match: params.exact_match,
    ...(IS_KEYLESS ? {} : { api_key: API_KEY }),
  };
  for (const key in searchParams) {
    if (key in defaults) {
      searchParams[key] = defaults[key];
    }
  }
  if ((searchParams.start_date || searchParams.end_date) && searchParams.time_range) {
    searchParams.time_range = undefined;
  }
  const cleanedParams: any = {};
  for (const key in searchParams) {
    const value = searchParams[key];
    if (value !== "" && value !== null && value !== undefined &&
        !(Array.isArray(value) && value.length === 0)) {
      cleanedParams[key] = value;
    }
  }
  const response = await axiosInstance.post(baseURLs.search, cleanedParams);
  return response.data;
}

async function extract(params: any): Promise<TavilyResponse> {
  const response = await axiosInstance.post(baseURLs.extract, {
    ...params,
    ...(IS_KEYLESS ? {} : { api_key: API_KEY })
  });
  return response.data;
}

async function crawl(params: any): Promise<TavilyCrawlResponse> {
  const response = await axiosInstance.post(baseURLs.crawl, {
    ...params,
    ...(IS_KEYLESS ? {} : { api_key: API_KEY })
  });
  return response.data;
}

async function map(params: any): Promise<TavilyMapResponse> {
  const response = await axiosInstance.post(baseURLs.map, {
    ...params,
    ...(IS_KEYLESS ? {} : { api_key: API_KEY })
  });
  return response.data;
}

async function research(params: any): Promise<TavilyResearchResponse> {
  const INITIAL_POLL_INTERVAL = 2000;
  const MAX_POLL_INTERVAL = 10000;
  const POLL_BACKOFF_FACTOR = 1.5;
  const MAX_PRO_MODEL_POLL_DURATION = 900000;
  const MAX_MINI_MODEL_POLL_DURATION = 300000;

  try {
    const response = await axiosInstance.post(baseURLs.research, {
      input: params.input,
      model: params.model || 'auto',
      ...(IS_KEYLESS ? {} : { api_key: API_KEY })
    });

    const requestId = response.data.request_id;
    if (!requestId) {
      return { error: `No request_id returned from research endpoint. Documentation: ${docsURLs.research}` };
    }

    const maxPollDuration = params.model === 'mini'
      ? MAX_MINI_MODEL_POLL_DURATION
      : MAX_PRO_MODEL_POLL_DURATION;

    let pollInterval = INITIAL_POLL_INTERVAL;
    let totalElapsed = 0;

    while (totalElapsed < maxPollDuration) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      totalElapsed += pollInterval;

      try {
        const pollResponse = await axiosInstance.get(`${baseURLs.research}/${requestId}`);
        const status = pollResponse.data.status;
        if (status === 'completed') {
          return { content: pollResponse.data.content || '' };
        }
        if (status === 'failed') {
          return { error: `Research task failed. Documentation: ${docsURLs.research}` };
        }
      } catch (pollError: any) {
        if (pollError.response?.status === 404) {
          return { error: 'Research task not found' };
        }
        throw pollError;
      }

      pollInterval = Math.min(pollInterval * POLL_BACKOFF_FACTOR, MAX_POLL_INTERVAL);
    }

    return { error: `Research task timed out. Documentation: ${docsURLs.research}` };
  } catch (error: any) {
    if (error.response?.status === 401) {
      throw new Error(`Invalid API key. Documentation: ${docsURLs.research}`);
    } else if (error.response?.status === 429) {
      throw new Error(`Usage limit exceeded. Documentation: ${docsURLs.research}`);
    }
    throw error;
  }
}

// --- PLACEHOLDER_FORMAT ---

function isKeylessEnvelope(data: any): boolean {
  return !!(data && typeof data === 'object'
    && data.error && typeof data.error === 'object'
    && typeof data.error.code === 'string');
}

function formatKeylessEnvelope(data: any): string {
  const err = data.error;
  const lines: string[] = [String(err.message ?? '')];
  if (err.retry_after_seconds != null) {
    lines.push(`Retry after: ${err.retry_after_seconds}s`);
  }
  if (Array.isArray(err.next_actions) && err.next_actions.length > 0) {
    lines.push('', 'Continuation options:');
    for (const a of err.next_actions) {
      if (a?.type === 'agentic_payment') {
        lines.push(`- Agentic payment (${a.scheme ?? 'x402'}): ${a.details ?? ''}`);
      } else if (a?.type === 'signup') {
        lines.push(`- Sign up for a Tavily API key: ${a.url ?? ''}`);
      } else if (a?.type === 'bonus_credits' && a.eligible) {
        lines.push(`- Earn ${a.credits_on_completion ?? ''} bonus credits by POSTing answers to ${a.endpoint ?? ''}`);
        if (Array.isArray(a.questions)) {
          a.questions.forEach((q: string, i: number) => lines.push(`    ${i + 1}. ${q}`));
        }
      }
    }
  }
  return lines.filter(Boolean).join('\n');
}

function formatResults(response: TavilyResponse): string {
  const output: string[] = [];
  if (response.answer) {
    output.push(`Answer: ${response.answer}`);
  }
  output.push('Detailed Results:');
  response.results.forEach(result => {
    output.push(`\nTitle: ${result.title}`);
    output.push(`URL: ${result.url}`);
    output.push(`Content: ${result.content}`);
    if (result.raw_content) {
      output.push(`Raw Content: ${result.raw_content}`);
    }
    if (result.favicon) {
      output.push(`Favicon: ${result.favicon}`);
    }
  });
  if (response.images && response.images.length > 0) {
    output.push('\nImages:');
    response.images.forEach((image, index) => {
      if (typeof image === 'string') {
        output.push(`\n[${index + 1}] URL: ${image}`);
      } else {
        output.push(`\n[${index + 1}] URL: ${image.url}`);
        if (image.description) {
          output.push(`   Description: ${image.description}`);
        }
      }
    });
  }
  return output.join('\n');
}

function formatCrawlResults(response: TavilyCrawlResponse): string {
  const output: string[] = [];
  output.push(`Crawl Results:`);
  output.push(`Base URL: ${response.base_url}`);
  output.push('\nCrawled Pages:');
  response.results.forEach((page, index) => {
    output.push(`\n[${index + 1}] URL: ${page.url}`);
    if (page.raw_content) {
      const contentPreview = page.raw_content.length > 200
        ? page.raw_content.substring(0, 200) + "..."
        : page.raw_content;
      output.push(`Content: ${contentPreview}`);
    }
    if (page.favicon) {
      output.push(`Favicon: ${page.favicon}`);
    }
  });
  return output.join('\n');
}

function formatMapResults(response: TavilyMapResponse): string {
  const output: string[] = [];
  output.push(`Site Map Results:`);
  output.push(`Base URL: ${response.base_url}`);
  output.push('\nMapped Pages:');
  response.results.forEach((page, index) => {
    output.push(`\n[${index + 1}] URL: ${page}`);
  });
  return output.join('\n');
}

function formatResearchResults(response: TavilyResearchResponse): string {
  if (response.error) {
    return `Research Error: ${response.error}`;
  }
  return response.content || 'No research results available';
}

// --- PLACEHOLDER_CREATE_SERVER ---

export function createTavilyServer(): Server {
  if (IS_KEYLESS) {
    console.error('[tavily-mcp] no TAVILY_API_KEY set; running in keyless mode.');
  }

  const server = new Server(
    { name: "tavily-mcp", version: "0.2.20" },
    { capabilities: { tools: {} } }
  );

  server.onerror = (error: any) => {
    console.error("[MCP Error]", error);
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
      {
        name: "tavily_search",
        description: "Search the web for current information on any topic. Use for news, facts, or data beyond your knowledge cutoff. Returns snippets and source URLs.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            search_depth: { type: "string", enum: ["basic","advanced","fast","ultra-fast"], description: "The depth of the search", default: "basic" },
            topic: { type: "string", enum: ["general"], description: "The category of the search", default: "general" },
            time_range: { type: "string", description: "The time range back from the current date", enum: ["day", "week", "month", "year"] },
            start_date: { type: "string", description: "Results after this date (YYYY-MM-DD)", default: "" },
            end_date: { type: "string", description: "Results before this date (YYYY-MM-DD)", default: "" },
            max_results: { type: "number", description: "Maximum number of results", default: 5, minimum: 5, maximum: 20 },
            include_images: { type: "boolean", description: "Include query-related images", default: false },
            include_image_descriptions: { type: "boolean", description: "Include image descriptions", default: false },
            include_raw_content: { type: "boolean", description: "Include parsed HTML content", default: false },
            include_domains: { type: "array", items: { type: "string" }, description: "Domains to include", default: [] },
            exclude_domains: { type: "array", items: { type: "string" }, description: "Domains to exclude", default: [] },
            country: { type: "string", description: "Boost results from a specific country (full name)", default: "" },
            include_favicon: { type: "boolean", description: "Include favicon URL", default: false },
            exact_match: { type: "boolean", description: "Only return exact phrase matches" }
          },
          required: ["query"]
        }
      },
      {
        name: "tavily_extract",
        description: "Extract content from URLs. Returns raw page content in markdown or text format.",
        inputSchema: {
          type: "object",
          properties: {
            urls: { type: "array", items: { type: "string" }, description: "URLs to extract from" },
            extract_depth: { type: "string", enum: ["basic", "advanced"], description: "Extraction depth", default: "basic" },
            include_images: { type: "boolean", description: "Include images", default: false },
            format: { type: "string", enum: ["markdown", "text"], description: "Output format", default: "markdown" },
            include_favicon: { type: "boolean", description: "Include favicon URLs", default: false },
            query: { type: "string", description: "Query to rerank content chunks" }
          },
          required: ["urls"]
        }
      },
      {
        name: "tavily_crawl",
        description: "Crawl a website starting from a URL. Extracts content from pages with configurable depth and breadth.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Root URL to crawl" },
            max_depth: { type: "integer", description: "Max crawl depth", default: 1, minimum: 1 },
            max_breadth: { type: "integer", description: "Max links per level", default: 20, minimum: 1 },
            limit: { type: "integer", description: "Total links to process", default: 50, minimum: 1 },
            instructions: { type: "string", description: "Natural language instructions for the crawler" },
            select_paths: { type: "array", items: { type: "string" }, description: "Regex path patterns", default: [] },
            select_domains: { type: "array", items: { type: "string" }, description: "Regex domain patterns", default: [] },
            allow_external: { type: "boolean", description: "Return external links", default: true },
            extract_depth: { type: "string", enum: ["basic", "advanced"], description: "Extraction depth", default: "basic" },
            format: { type: "string", enum: ["markdown", "text"], description: "Content format", default: "markdown" },
            include_favicon: { type: "boolean", description: "Include favicon URL", default: false }
          },
          required: ["url"]
        }
      },
      {
        name: "tavily_map",
        description: "Map a website's structure. Returns a list of URLs found starting from the base URL.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Root URL to map" },
            max_depth: { type: "integer", description: "Max mapping depth", default: 1, minimum: 1 },
            max_breadth: { type: "integer", description: "Max links per level", default: 20, minimum: 1 },
            limit: { type: "integer", description: "Total links to process", default: 50, minimum: 1 },
            instructions: { type: "string", description: "Natural language instructions" },
            select_paths: { type: "array", items: { type: "string" }, description: "Regex path patterns", default: [] },
            select_domains: { type: "array", items: { type: "string" }, description: "Regex domain patterns", default: [] },
            allow_external: { type: "boolean", description: "Return external links", default: true }
          },
          required: ["url"]
        }
      },
      {
        name: "tavily_research",
        description: "Perform comprehensive research on a topic. Rate limit: 20 requests per minute.",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string", description: "Research task description" },
            model: { type: "string", enum: ["mini", "pro", "auto"], description: "Research depth", default: "auto" }
          },
          required: ["input"]
        }
      },
    ];
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    try {
      let response: TavilyResponse;
      const args = request.params.arguments ?? {};

      switch (request.params.name) {
        case "tavily_search":
          if (args.country) args.topic = "general";
          response = await search({
            query: args.query, search_depth: args.search_depth, topic: args.topic,
            time_range: args.time_range, max_results: args.max_results,
            include_images: args.include_images, include_image_descriptions: args.include_image_descriptions,
            include_raw_content: args.include_raw_content,
            include_domains: Array.isArray(args.include_domains) ? args.include_domains : [],
            exclude_domains: Array.isArray(args.exclude_domains) ? args.exclude_domains : [],
            country: args.country, include_favicon: args.include_favicon,
            start_date: args.start_date, end_date: args.end_date, exact_match: args.exact_match
          });
          break;

        case "tavily_extract":
          response = await extract({
            urls: args.urls, extract_depth: args.extract_depth,
            include_images: args.include_images, format: args.format,
            include_favicon: args.include_favicon, query: args.query,
          });
          break;

        case "tavily_crawl": {
          const crawlResponse = await crawl({
            url: args.url, max_depth: args.max_depth, max_breadth: args.max_breadth,
            limit: args.limit, instructions: args.instructions,
            select_paths: Array.isArray(args.select_paths) ? args.select_paths : [],
            select_domains: Array.isArray(args.select_domains) ? args.select_domains : [],
            allow_external: args.allow_external, extract_depth: args.extract_depth,
            format: args.format, include_favicon: args.include_favicon, chunks_per_source: 3,
          });
          return { content: [{ type: "text", text: formatCrawlResults(crawlResponse) }] };
        }

        case "tavily_map": {
          const mapResponse = await map({
            url: args.url, max_depth: args.max_depth, max_breadth: args.max_breadth,
            limit: args.limit, instructions: args.instructions,
            select_paths: Array.isArray(args.select_paths) ? args.select_paths : [],
            select_domains: Array.isArray(args.select_domains) ? args.select_domains : [],
            allow_external: args.allow_external
          });
          return { content: [{ type: "text", text: formatMapResults(mapResponse) }] };
        }

        case "tavily_research": {
          const researchResponse = await research({ input: args.input, model: args.model });
          return { content: [{ type: "text", text: formatResearchResults(researchResponse) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }

      return { content: [{ type: "text", text: formatResults(response) }] };
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (isKeylessEnvelope(error.response?.data)) {
          return { content: [{ type: "text", text: formatKeylessEnvelope(error.response!.data) }] };
        }
        const toolName = request.params.name?.replace('tavily_', '') || '';
        const docsUrl = docsURLs[toolName] || '';
        const responseData = error.response?.data;
        const detail = responseData && typeof responseData === 'object'
          ? (responseData.detail || responseData.message || responseData)
          : (error.message);
        const detailStr = typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
        const docsSuffix = docsUrl ? `\nDocumentation: ${docsUrl}` : '';
        return { content: [{ type: "text", text: `Tavily API error: ${detailStr}${docsSuffix}` }], isError: true };
      }
      throw error;
    }
  });

  return server;
}

export function listTools(): void {
  const tools = [
    { name: "tavily_search", description: "Real-time web search with customizable depth, domain filtering, and time-based filtering." },
    { name: "tavily_extract", description: "Extract and process content from URLs with basic or advanced parsing." },
    { name: "tavily_crawl", description: "Systematically explore websites with configurable depth and breadth limits." },
    { name: "tavily_map", description: "Create site maps by analyzing website structure and navigation paths." },
    { name: "tavily_research", description: "Comprehensive research gathering information from multiple sources." }
  ];
  console.log("Available tools:");
  tools.forEach(tool => {
    console.log(`\n- ${tool.name}`);
    console.log(`  Description: ${tool.description}`);
  });
  process.exit(0);
}
