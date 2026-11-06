#!/usr/bin/env node
import { AnalysisError, analyzeSession, errorResult } from './analyze.js';

try {
  const [command, path, ...options] = process.argv.slice(2);
  if (command === 'mcp' && path === undefined) {
    const { startServer } = await import('./mcp.js');
    const { flush } = await import('pendo-server-sdk');
    // Send buffered Pendo events before the process stops.
    const stop = () => { flush().finally(() => process.exit(0)); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const server = await startServer();
    server.onclose = () => { void flush(); };
    process.stdin.once('end', () => { void server.close(); });
  } else {
    if (command !== 'analyze' || !path || path.startsWith('-') || path.includes('\0') ||
        options.length > 1 || (options.length === 1 && options[0] !== '--pretty')) {
      throw new AnalysisError('INVALID_ARGUMENTS');
    }
    const result = await analyzeSession(path);
    process.stdout.write(JSON.stringify(result, null, options[0] === '--pretty' ? 2 : undefined) + '\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify(errorResult(error)) + '\n');
  process.exitCode = 1;
}
