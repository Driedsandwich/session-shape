import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MAX_FILE_BYTES, parseFile } from '../src/parser';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../lib/agents/cli.js', import.meta.url));
const guard = fileURLToPath(new URL('./fixtures/agent-guards.mjs', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'session-shape-private-'));
afterAll(() => rm(temporary, { recursive: true, force: true }));
const sample = (n: number) => fileURLToPath(new URL(`../src/samples/demo-${n}.jsonl`, import.meta.url));

async function runCli(args: string[], forbidBlob = false) {
  try {
    const result = await execute(process.execPath, ['--import', guard, cli, ...args], {
      env: { ...process.env, SESSION_SHAPE_FORBID_BLOB: forbidBlob ? '1' : '0' }, timeout: 10_000,
    });
    return { ...result, code: 0 };
  } catch (error) {
    const result = error as { stdout: string; stderr: string; code: number };
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  }
}

async function withMcp<T>(callback: (client: Client) => Promise<T>, forbidBlob = false) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['--import', guard, cli, 'mcp'], stderr: 'pipe',
    env: { SESSION_SHAPE_FORBID_BLOB: forbidBlob ? '1' : '0' },
  });
  let stderr = '';
  transport.stderr!.on('data', chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: 'session-shape-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    return await callback(client);
  } finally {
    await client.close();
    expect(stderr).toBe('');
  }
}

function expectedSample(n: number) {
  return {
    schemaVersion: 1, durationMs: 120000, humanMessages: 3, assistantMessages: 10,
    toolCalls: 7, toolErrors: n === 1 ? 0 : 2, retries: n === 1 ? 0 : 2, sidechainRows: 2,
    models: ['claude-haiku-5-5', 'claude-opus-5-5'],
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 500 },
    rows: 31, chartedRows: 23, invalidRows: 0, success: true,
    troubles: n === 1 ? [] : [
      { number: 1, tool: 'Edit', matched: true, failedAt: 12, errorAt: 13, nextSame: { at: 20 }, nextCall: { tool: 'Edit', at: 20 }, retry: true },
      { number: 2, tool: 'Bash', matched: true, failedAt: 50, errorAt: 53, nextSame: { at: 61 }, nextCall: { tool: 'Bash', at: 61 }, retry: true },
    ],
  };
}
const failure = (code: string) => ({ schemaVersion: 1, error: { code } });

describe('Node CLI と stdio MCP', () => {
  it.each([1, 2])('見本 %i は画面・parser の固定期待値と同じ JSON を通信なしで返す', async n => {
    // Fixed expectations also used in parser.test.ts; DOM renders this Summary.
    const result = await runCli(['analyze', sample(n)]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual(expectedSample(n));
    await withMcp(async client => {
      const response = await client.callTool({ name: 'analyze_session', arguments: { path: sample(n) } });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toEqual(expectedSample(n));
      expect(response.content).toEqual([{ type: 'text', text: result.stdout.trim() }]);
    });
  });

  it('--pretty は同じ JSON を整形し、相対パスも受け取る', async () => {
    const result = await runCli(['analyze', 'src/samples/demo-2.jsonl', '--pretty']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(JSON.stringify(expectedSample(2), null, 2) + '\n');
  });

  it('道具を 1 つだけ公開し、入力は絶対パス 1 つと宣言する', async () => {
    await withMcp(async client => {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({ name: 'analyze_session',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
      });
    });
  });

  it.each([true, false])('本文・入力・パス・メタデータを伏せ、独自道具のやり直し=%s を画面と同じにする', async same => {
    const mark = (name: string) => `〔目印${name}〕`;
    const path = join(temporary, `${mark('ファイル名')}-${same}.jsonl`);
    const row = (type: string, second: number, content: unknown) => ({
      type, timestamp: `2026-10-20T01:00:0${second}Z`, cwd: mark('作業フォルダ'),
      gitBranch: mark('枝名'), title: mark('会話題'), sessionId: mark('会話ID'), uuid: mark('行ID'),
      message: { model: mark('モデル'), content },
    });
    const text = [
      row('user', 0, [{ type: 'text', text: mark('人の発言') }]),
      row('assistant', 1, [
        { type: 'text', text: mark('AIの文') }, { type: 'thinking', thinking: mark('思考') },
        { type: 'tool_use', id: mark('道具ID'), name: `mcp__${mark('独自道具A')}`,
          input: { command: mark('道具入力'), file_path: mark('ファイルの道') } },
      ]),
      row('user', 2, [{ type: 'tool_result', tool_use_id: mark('道具ID'), is_error: true, content: mark('結果') }]),
      row('assistant', 3, [{ type: 'tool_use', name: `mcp__${mark(same ? '独自道具A' : '独自道具B')}` }]),
    ].map(row => JSON.stringify(row)).join('\n');
    await writeFile(path, text);
    const browser = await parseFile(new Blob([text]));
    const result = await runCli(['analyze', path]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(output.troubles).toEqual(browser.troubles);
    expect(output.models).toEqual(['その他のモデル']);
    expect(output.troubles[0]).toMatchObject({ tool: 'その他の道具', nextCall: { tool: 'その他の道具', at: 3 }, retry: same });
    expect(output.retries).toBe(same ? 1 : 0);
    await withMcp(async client => {
      const response = await client.callTool({ name: 'analyze_session', arguments: { path } });
      expect(response.structuredContent).toEqual(output);
      for (const serialized of [result.stdout + result.stderr, JSON.stringify(response)]) {
        for (const secret of ['〔目印', path, basename(path), temporary, 'mcp__']) expect(serialized).not.toContain(secret);
      }
    });
  });

  it('50 MiB 超過は Blob を開く前に CLI と MCP で FILE_TOO_LARGE にする', async () => {
    const path = join(temporary, 'oversize-private.jsonl');
    const file = await open(path, 'w');
    try { await file.truncate(MAX_FILE_BYTES + 1); } finally { await file.close(); }
    const result = await runCli(['analyze', path], true);
    expect(result).toEqual({ stdout: '', stderr: JSON.stringify(failure('FILE_TOO_LARGE')) + '\n', code: 1 });
    await withMcp(async client => {
      const response = await client.callTool({ name: 'analyze_session', arguments: { path } });
      expect(response).toEqual({ isError: true, structuredContent: failure('FILE_TOO_LARGE'),
        content: [{ type: 'text', text: JSON.stringify(failure('FILE_TOO_LARGE')) }] });
    }, true);
  });

  it.each([
    [[], 'INVALID_ARGUMENTS'],
    [['analyze'], 'INVALID_ARGUMENTS'],
    [['analyze', 'private.jsonl', '--private-option'], 'INVALID_ARGUMENTS'],
    [['analyze', join(temporary, 'missing-private.jsonl')], 'FILE_READ_FAILED'],
    [['analyze', temporary], 'FILE_NOT_REGULAR'],
  ] as [string[], string][])('CLI の失敗は固定札だけを stderr に出す (%j)', async (args, code) => {
    expect(await runCli(args)).toEqual({ stdout: '', stderr: JSON.stringify(failure(code)) + '\n', code: 1 });
  });

  it.each([
    [{}, 'INVALID_ARGUMENTS'],
    [{ path: 42 }, 'INVALID_ARGUMENTS'],
    [{ path: sample(1), '〔目印余計なキー〕': '〔目印値〕' }, 'INVALID_ARGUMENTS'],
    [{ path: '〔目印相対パス〕.jsonl' }, 'PATH_NOT_ABSOLUTE'],
    [{ path: join(temporary, '〔目印不存在〕.jsonl') }, 'FILE_READ_FAILED'],
    [{ path: temporary }, 'FILE_NOT_REGULAR'],
  ])('MCP の失敗も入力を反映しない (%j)', async (args, code) => {
    await withMcp(async client => {
      expect(await client.callTool({ name: 'analyze_session', arguments: args })).toEqual({
        isError: true, structuredContent: failure(code as string),
        content: [{ type: 'text', text: JSON.stringify(failure(code as string)) }],
      });
    });
  });

  it('空ファイル・壊れた行は画面と同じ部分集計と success=false を返す', async () => {
    const path = join(temporary, 'partial-private.jsonl');
    for (const [text, expected] of [
      ['', { rows: 0, invalidRows: 0, assistantMessages: 0, success: false }],
      ['{〔目印壊れた行〕\n' + await readFile(sample(2), 'utf8'), { rows: 32, invalidRows: 1, assistantMessages: 10, success: false }],
    ] as const) {
      await writeFile(path, text);
      const result = await runCli(['analyze', path]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject(expected);
      await withMcp(async client => {
        const response = await client.callTool({ name: 'analyze_session', arguments: { path: resolve(path) } });
        expect(response.isError).not.toBe(true);
        expect(response.structuredContent).toEqual(JSON.parse(result.stdout));
        expect(JSON.stringify(response)).not.toContain('〔目印');
      });
    }
  });

  it.each(['fetch("https://example.invalid")', '(await import("node:net")).connect(443, "example.invalid")'])('通信禁止ガード自身が接続を止める (%s)', async script => {
    await expect(execute(process.execPath, ['--import', guard, '--input-type=module', '-e', script]))
      .rejects.toMatchObject({ code: 97, stdout: '', stderr: 'NETWORK_FORBIDDEN\n' });
  });
});
