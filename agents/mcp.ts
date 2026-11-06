import { isAbsolute } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { initMcp } from 'pendo-server-sdk';
import { AnalysisError, analyzeSession, errorResult } from './analyze.js';

type PendoRequestContext = { requestInfo?: { headers?: Record<string, string | string[] | undefined> } } | null | undefined;

const header = (context: PendoRequestContext, name: string) => {
  const value = context?.requestInfo?.headers?.[name];
  return (Array.isArray(value) ? value[0] : value) || null;
};

export async function startServer() {
  // Validate arguments ourselves so validation errors cannot echo private input.
  const server = new Server({ name: 'session-shape', version: '0.1.0' }, { capabilities: { tools: {} } });
  initMcp({
    server,
    apiKey: 'b903458e-c62a-427f-914a-200f8171447f',
    agentId: 'efp71MV976oms_nwR4FJjk9kpgA',
    endpoint: 'https://app.pendo.io',
    // TODO: map the real visitor identity. HTTP requests read x-user-id; on stdio set PENDO_VISITOR_ID in the MCP client's env block.
    visitorId: (context: PendoRequestContext) => (context?.requestInfo ? header(context, 'x-user-id') : process.env.PENDO_VISITOR_ID || null),
    // TODO: map the real account identity. HTTP requests read x-account-id; on stdio set PENDO_ACCOUNT_ID in the MCP client's env block.
    accountId: (context: PendoRequestContext) => (context?.requestInfo ? header(context, 'x-account-id') : process.env.PENDO_ACCOUNT_ID || null),
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: 'analyze_session',
    description: 'Analyze one local Claude Code JSONL file. Returns counts and redacted trouble records; no transcript text or paths. Times are seconds from session start.',
    inputSchema: {
      type: 'object', properties: { path: { type: 'string', description: 'Absolute path to a local JSONL file (up to 50 MiB).' } },
      required: ['path'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }] }));
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
      if (request.params.name !== 'analyze_session') throw new AnalysisError('UNKNOWN_TOOL');
      const args = request.params.arguments;
      if (!args || Object.keys(args).length !== 1 || typeof args.path !== 'string' || !args.path || args.path.includes('\0')) {
        throw new AnalysisError('INVALID_ARGUMENTS');
      }
      if (!isAbsolute(args.path)) throw new AnalysisError('PATH_NOT_ABSOLUTE');
      const result = await analyzeSession(args.path);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const result = errorResult(error);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
  });
  await server.connect(new StdioServerTransport());
  return server;
}
