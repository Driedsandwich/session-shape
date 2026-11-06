import { isAbsolute } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AnalysisError, analyzeSession, errorResult } from './analyze.js';

export async function startServer() {
  // Validate arguments ourselves so validation errors cannot echo private input.
  const server = new Server({ name: 'session-shape', version: '0.1.0' }, { capabilities: { tools: {} } });
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
}
