import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { checkFileSize, parseFile } from '../src/parser.js';

export const SCHEMA_VERSION = 1;
export type ErrorCode = 'INVALID_ARGUMENTS' | 'PATH_NOT_ABSOLUTE' | 'FILE_TOO_LARGE' | 'FILE_NOT_REGULAR' | 'FILE_READ_FAILED' | 'UNKNOWN_TOOL';
export class AnalysisError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

export function errorResult(error: unknown) {
  return { schemaVersion: SCHEMA_VERSION, error: { code: error instanceof AnalysisError ? error.code : 'FILE_READ_FAILED' } };
}

export async function analyzeSession(path: string) {
  try {
    // Inspect metadata before opening a Blob or reading any file contents.
    const info = await stat(path);
    if (!info.isFile()) throw new AnalysisError('FILE_NOT_REGULAR');
    if (!checkFileSize(info.size)) throw new AnalysisError('FILE_TOO_LARGE');
    const file = await openAsBlob(path);
    if (!checkFileSize(file.size)) throw new AnalysisError('FILE_TOO_LARGE');
    const s = await parseFile(file);
    // Explicit projection: never return paths, original rows, or raw exceptions.
    return {
      schemaVersion: SCHEMA_VERSION,
      durationMs: s.durationMs,
      humanMessages: s.humanMessages,
      assistantMessages: s.assistantMessages,
      toolCalls: s.toolCalls,
      toolErrors: s.toolErrors,
      retries: s.retries,
      sidechainRows: s.sidechainRows,
      models: s.models,
      usage: s.usage,
      rows: s.rows,
      chartedRows: s.chartedRows,
      invalidRows: s.invalidRows,
      success: s.success,
      troubles: s.troubles,
    };
  } catch (error) {
    throw error instanceof AnalysisError ? error : new AnalysisError('FILE_READ_FAILED');
  }
}
