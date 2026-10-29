import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAccumulator, parseFile, readLines, checkFileSize, MAX_FILE_BYTES } from '../src/parser';
const samples = [1, 2].map(n => readFileSync(new URL(`../src/samples/demo-${n}.jsonl`, import.meta.url), 'utf8'));
const parse = (text: string) => parseFile(new Blob([text]));
const row = (type: string, content: unknown, extra = {}) => JSON.stringify({ type, timestamp: '2026-10-20T01:00:00Z', message: { content }, ...extra });

describe('JSONL の集計', () => {
  it.each([0, 1])('見本 %i を既知の数値に集計する', async index => {
    const s = await parse(samples[index]);
    expect(s).toMatchObject({ rows: 31, chartedRows: 23, invalidRows: 0, otherRows: 8, untimedRows: 0, humanMessages: 3, assistantMessages: 10, toolCalls: 7, toolErrors: index * 2, retries: index * 2, sidechainRows: 2, durationMs: 120000, success: true, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 500 } });
    expect(s.models).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    expect(s.tools).toEqual(index === 0 ? [{name:'Read',count:2},{name:'Edit',count:1},{name:'Bash',count:2},{name:'Grep',count:1},{name:'web_search',count:1}] : [{name:'Read',count:1},{name:'Edit',count:2},{name:'Grep',count:1},{name:'Bash',count:2},{name:'web_search',count:1}]);
    expect(s.events.filter(e => e.error)).toHaveLength(index * 2);
  });
  it.each([0, 1])('見本 %i の分割行は同じ ID・usage で、応答と usage だけを一度ずつ数える', async index => {
    const assistants = samples[index].trim().split('\n').map(line => JSON.parse(line)).filter(r => r.type === 'assistant');
    const groups = new Map<string, typeof assistants>();
    for (const entry of assistants) groups.set(entry.message.id, [...(groups.get(entry.message.id) ?? []), entry]);
    expect(assistants).toHaveLength(13);
    expect(groups.size).toBe(10);
    const split = [...groups.values()].filter(entries => entries.length > 1);
    expect(split).toHaveLength(3);
    for (const [first, second] of split) {
      expect(first.message.content.map((b: { type: string }) => b.type)).toEqual(['thinking']);
      expect(['tool_use', 'server_tool_use']).toContain(second.message.content[0].type);
      expect(second.message.usage).toEqual(first.message.usage);
    }
    const s = await parse(samples[index]);
    expect(s.assistantMessages).toBe(10);
    expect(s.usage).toEqual({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 500 });
    expect(s.events.filter(e => e.kind === 'tool')).toHaveLength(7);
    for (const id of groups.keys()) expect(JSON.stringify(s)).not.toContain(id);
  });
  it('同じ ID の行が離れていても一度だけ加算し、道具の塊はすべて数える', async () => {
    const usage = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 40, cache_creation_input_tokens: 5 };
    const text = [
      row('assistant', [], { message: { id: '秘密の応答ID', usage, content: [{ type: 'thinking', thinking: '秘密の考え' }] } }),
      row('assistant', [], { message: { id: '別の応答ID', usage, content: [] } }),
      row('assistant', [], { message: { id: '秘密の応答ID', usage, content: [{ type: 'tool_use', name: 'Read' }] } }),
      row('assistant', [], { message: { id: '秘密の応答ID', usage, content: [{ type: 'server_tool_use', name: 'web_search' }] } }),
    ].join('\n');
    const s = await parse(text);
    expect(s).toMatchObject({ rows: 4, chartedRows: 4, assistantMessages: 2, toolCalls: 2,
      usage: { input_tokens: 20, output_tokens: 4, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 } });
    expect(s.tools).toEqual([{ name: 'Read', count: 1 }, { name: 'web_search', count: 1 }]);
    expect(s.events.filter(e => e.kind === 'tool')).toHaveLength(2);
    expect(JSON.stringify(s)).not.toContain('秘密');
    expect(JSON.stringify(s)).not.toContain('別の応答ID');
    expect(await parse(text)).toEqual(s); // IDs must not leak across file reads.
  });
  it('ID がない・空・文字列以外の行は応答と usage を行ごとに加算する', async () => {
    const text = [undefined, undefined, null, null, '', '', 42, 42].map(id =>
      row('assistant', [], { message: { id, content: [], usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 40, cache_creation_input_tokens: 5 } } })
    ).join('\n');
    expect(await parse(text)).toMatchObject({ assistantMessages: 8,
      usage: { input_tokens: 80, output_tokens: 16, cache_read_input_tokens: 320, cache_creation_input_tokens: 40 } });
  });
  it('usage は最初の行を採用し、後続行で変更・欠落の補完をしない', async () => {
    const text = [
      { id: 'a', usage: { input_tokens: 10, output_tokens: -1 } },
      { id: 'b' },
      { id: 'a', usage: { input_tokens: 99, output_tokens: 99, cache_read_input_tokens: 99 } },
      { id: 'b', usage: { input_tokens: 99, cache_creation_input_tokens: 99 } },
    ].map(message => row('assistant', [], { message })).join('\n');
    expect(await parse(text)).toMatchObject({ assistantMessages: 2,
      usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  });
  it('fable も既存のモデルと同じ形式だけを許可する', async () => {
    for (const family of ['opus', 'sonnet', 'haiku', 'fable']) {
      for (const model of [`claude-${family}-5-1`, `claude-${family}-5-1-20261020`, `claude-5-1-${family}-20261020`, `claude-${family}-5-1-latest`]) {
        expect((await parse(row('assistant', [], { message: { model } }))).models).toEqual([model]);
      }
    }
    for (const model of ['claude-fable-5-1-秘密', 'claude-fable-秘密', 'claude-fable-5-1\n秘密']) {
      const s = await parse(row('assistant', [], { message: { model } }));
      expect(s.models).toEqual(['その他のモデル']);
      expect(JSON.stringify(s)).not.toContain('秘密');
    }
  });
  it('空ファイルと空行だけでは成功にしない', async () => {
    for (const text of ['', '\n \r\n\t']) expect(await parse(text)).toMatchObject({ rows: 0, invalidRows: 0, success: false, durationMs: 0 });
  });
  it('壊れた行の後も集計を続ける', async () => {
    const s = await parse('{broken\n' + samples[0] + '\n{"text":');
    expect(s).toMatchObject({ rows: 33, invalidRows: 2, assistantMessages: 10, success: false });
  });
  it('未知の type と JSON の値は読めない行に数えない', async () => {
    const s = await parse(['attachment','system','file-history-snapshot','queue-operation','api-request','future'].map(type => row(type, [])).join('\n') + '\nnull\n42\n[]');
    expect(s).toMatchObject({ rows: 9, otherRows: 9, invalidRows: 0, success: false });
  });
  it('tool_result だけの user は人の発言に数えない', async () => {
    expect(await parse(row('user', [{ type: 'tool_result', is_error: true }]))).toMatchObject({ humanMessages: 0, toolErrors: 1, retries: 0 });
    expect(await parse(row('user', [{ type: 'text', text: '' }, { type: 'tool_result' }]))).toMatchObject({ humanMessages: 1 });
    expect(await parse(row('user', '文字列形式の本文'))).toMatchObject({ humanMessages: 1 });
  });
  it('50MB 境界を含み、超過は読む前に拒否する', async () => {
    expect(checkFileSize(MAX_FILE_BYTES)).toBe(true);
    expect(checkFileSize(MAX_FILE_BYTES + 1)).toBe(false);
    expect(checkFileSize(-1)).toBe(false);
    const file = { size: MAX_FILE_BYTES + 1, slice() { throw new Error('読んではいけない'); } } as unknown as Blob;
    await expect(parseFile(file)).rejects.toThrow('FILE_TOO_LARGE');
  });
  it.each([0, 1])('見本 %i の本文・内部 ID・メタデータを結果に残さない', async index => {
    const output = JSON.stringify(await parse(samples[index]));
    for (const letter of 'ABCDEFGHI') expect(output).not.toContain(`〔目印${letter}〕`);
    for (const word of ['秘密', 'demo-', 'uuid', 'file_path', 'cwd', 'gitBranch', 'thinking', 'signature']) expect(output).not.toContain(word);
  });
  it('道具名やモデル名に混入した本文も伏せる', async () => {
    const s = await parse(row('assistant', [{type:'tool_use', id:'secret', name:'〔目印A〕'}], { message: { model: '〔目印B〕', content: [{type:'tool_use',name:'〔目印C〕'}] } }));
    expect(s.models).toEqual(['その他のモデル']);
    expect(s.tools).toEqual([{ name: 'その他の道具', count: 1 }]);
    expect(JSON.stringify(s)).not.toContain('〔目印');
  });
  it('UTF-8 と CRLF が分割されても行ごとに読む', async () => {
    const text = '\uFEFF' + row('user', [{ type: 'text', text: '日本語' }]) + '\r\n' + row('assistant', []) + '\r' + row('system', []);
    const bytes = new TextEncoder().encode(text), a = createAccumulator();
    async function* chunks() { for (const byte of bytes) yield new Uint8Array([byte]); }
    await readLines(chunks(), a.line);
    expect(a.finish()).toMatchObject({ rows: 3, humanMessages: 1, assistantMessages: 1, otherRows: 1, invalidRows: 0, success: true });
  });
  it('異なる道具が挟まればやり直しに数えない', async () => {
    const text = [row('assistant', [{type:'tool_use',id:'a',name:'Edit'}]),row('user', [{type:'tool_result',tool_use_id:'a',is_error:true}]),row('assistant', [{type:'tool_use',name:'Read'},{type:'tool_use',name:'Edit'}])].join('\n');
    expect(await parse(text)).toMatchObject({ toolErrors: 1, retries: 0 });
  });
  it('時刻がない行も数値集計し、不正な usage は無視する', async () => {
    const s = await parse(JSON.stringify({type:'assistant',timestamp:'秘密の時刻',message:{usage:{input_tokens:-3,output_tokens:'秘密',cache_read_input_tokens:2},content:[]}}));
    expect(s).toMatchObject({ untimedRows: 1, chartedRows: 0, success: true, durationMs: 0, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 2 } });
  });
});
