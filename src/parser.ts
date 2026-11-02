/** Only this deliberately narrow projection may cross into React. Never return raw rows. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;
export type UsageKey = typeof USAGE_KEYS[number];
export type Event = { at: number; kind: 'human' | 'row' | 'tool'; tool?: string; error: boolean };
/** Times are seconds from the session start; null is a missing timestamp. */
export type Trouble = {
  number: number; tool: string; matched: boolean; failedAt: number | null; errorAt: number | null;
  nextSame: { at: number | null } | null;
  nextCall: { tool: string; at: number | null } | null; retry: boolean;
};
export type Summary = {
  rows: number; chartedRows: number; invalidRows: number; otherRows: number; untimedRows: number;
  humanMessages: number; assistantMessages: number; toolCalls: number; toolErrors: number;
  retries: number; sidechainRows: number; start: number | null; end: number | null; durationMs: number;
  models: string[]; tools: { name: string; count: number }[];
  usage: Record<UsageKey, number>; events: Event[]; troubles: Trouble[]; success: boolean;
};
const toolNames = new Set(['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Task', 'Agent', 'TodoWrite', 'WebFetch', 'WebSearch', 'NotebookEdit', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'Skill', 'ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'web_search', 'web_fetch', 'code_execution']);
const safeTool = (value: unknown) => typeof value === 'string' && toolNames.has(value) ? value : 'その他の道具';
const safeModel = (value: unknown): string | null => typeof value !== 'string' ? null :
  /^claude-(?:(?:opus|sonnet|haiku|fable)-\d{1,2}(?:-\d{1,8}){0,2}|\d{1,2}(?:-\d{1,2})?-(?:opus|sonnet|haiku|fable)(?:-\d{8})?)(?:-latest)?$/.test(value) ? value : 'その他のモデル';
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const timestamp = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const n = Date.parse(v); return Number.isFinite(n) ? n : null;
};
export function checkFileSize(size: number): boolean { return Number.isFinite(size) && size >= 0 && size <= MAX_FILE_BYTES; }

export function createAccumulator() {
  const result: Summary = {
    rows: 0, chartedRows: 0, invalidRows: 0, otherRows: 0, untimedRows: 0, humanMessages: 0,
    assistantMessages: 0, toolCalls: 0, toolErrors: 0, retries: 0, sidechainRows: 0,
    start: null, end: null, durationMs: 0, models: [], tools: [], events: [], troubles: [], success: false,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  const tools = new Map<string, number>();
  const models = new Set<string>();
  // IDs and original tool names stay private to the accumulator and are discarded at finish.
  const assistantIds = new Set<string>();
  const usageIds = new Set<string>();
  type Call = { name: string | null; at: number | null; event?: Event; nextSame?: Call };
  type Failure = { call?: Call; at: number | null; nextCall?: Call; retry: boolean };
  const calls = new Map<string, Call>();
  const orderedCalls: Call[] = [];
  const failures: Failure[] = [];
  const pending = new Map<string, Failure[]>();
  let awaitingNext: Failure[] = [];
  let failedEntry: Failure | null = null;
  let failedTool: string | null = null;
  function line(raw: string) {
    if (!raw.trim()) return;
    result.rows++;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { result.invalidRows++; return; }
    const row = obj(parsed);
    const at = timestamp(row.timestamp);
    if (at !== null) {
      result.start = result.start === null ? at : Math.min(result.start, at);
      result.end = result.end === null ? at : Math.max(result.end, at);
    }
    if (row.isSidechain === true) result.sidechainRows++;
    if (row.type !== 'user' && row.type !== 'assistant') { result.otherRows++; return; }
    if (at === null) result.untimedRows++;
    else { result.chartedRows++; result.events.push({ at, kind: 'row', error: false }); }
    const message = obj(row.message);
    const blocks = Array.isArray(message.content) ? message.content.map(obj) : [];
    const human = row.type === 'user' && (typeof message.content === 'string' || blocks.some(b => b.type === 'text' && typeof b.text === 'string'));
    if (human) {
      result.humanMessages++;
      if (at !== null) result.events.push({ at, kind: 'human', error: false });
    }
    const messageId = typeof message.id === 'string' && message.id.length > 0 ? message.id : null;
    if (row.type === 'assistant' && (messageId === null || !assistantIds.has(messageId))) {
      result.assistantMessages++;
      if (messageId !== null) assistantIds.add(messageId);
    }
    const model = safeModel(message.model);
    if (model) models.add(model);
    if (messageId === null || !usageIds.has(messageId)) {
      // The first row wins, even when its usage is missing or invalid.
      if (messageId !== null) usageIds.add(messageId);
      const usage = obj(message.usage);
      for (const key of USAGE_KEYS) {
        const n = usage[key];
        if (typeof n === 'number' && Number.isFinite(n) && n >= 0) result.usage[key] = Math.min(Number.MAX_SAFE_INTEGER, result.usage[key] + n);
      }
    }
    for (const block of blocks) {
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        const name = safeTool(block.name);
        const original = typeof block.name === 'string' ? block.name : null;
        result.toolCalls++;
        tools.set(name, (tools.get(name) ?? 0) + 1);
        const call: Call = { name: original, at };
        orderedCalls.push(call);
        for (const failure of awaitingNext) failure.nextCall = call;
        awaitingNext = [];
        if (failedTool !== null && original === failedTool) {
          result.retries++;
          if (failedEntry) failedEntry.retry = true;
        }
        // The very next call after an error is the retry candidate, even across text/metadata rows.
        failedTool = null;
        failedEntry = null;
        const event: Event | undefined = at === null ? undefined : { at, kind: 'tool', tool: name, error: false };
        call.event = event;
        if (event) result.events.push(event);
        if (typeof block.id === 'string') {
          calls.set(block.id, call);
          const earlier = pending.get(block.id);
          if (earlier && event) event.error = true;
          for (const failure of earlier ?? []) if (!failure.call) failure.call = call;
          pending.delete(block.id);
        }
      }
      if (block.type === 'tool_result' && block.is_error === true) {
        result.toolErrors++;
        const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
        const call = id === null ? undefined : calls.get(id);
        const failure: Failure = { call, at, retry: false };
        failures.push(failure);
        awaitingNext.push(failure);
        failedEntry = failure;
        failedTool = call?.name ?? null;
        if (call?.event) call.event.error = true;
        else if (id !== null) {
          const entries = pending.get(id) ?? [];
          entries.push(failure);
          pending.set(id, entries);
        }
      }
    }
  }
  function finish(): Summary {
    result.durationMs = result.start === null || result.end === null ? 0 : result.end - result.start;
    result.models = [...models].sort();
    result.tools = [...tools].map(([name, count]) => ({ name, count }));
    result.success = result.invalidRows === 0 && result.assistantMessages > 0;
    result.events.sort((a, b) => a.at - b.at);
    // Link in original call order, using private names, never the redacted label.
    const nextByName = new Map<string, Call>();
    for (let i = orderedCalls.length - 1; i >= 0; i--) {
      const call = orderedCalls[i];
      if (call.name !== null) {
        call.nextSame = nextByName.get(call.name);
        nextByName.set(call.name, call);
      }
    }
    const seconds = (at: number | null | undefined) => at == null || result.start === null ? null : (at - result.start) / 1000;
    result.troubles = failures.map((failure, i) => ({
      number: i + 1, tool: safeTool(failure.call?.name), matched: !!failure.call,
      failedAt: seconds(failure.call?.at), errorAt: seconds(failure.at),
      nextSame: failure.call?.nextSame ? { at: seconds(failure.call.nextSame.at) } : null,
      nextCall: failure.nextCall ? { tool: safeTool(failure.nextCall.name), at: seconds(failure.nextCall.at) } : null,
      retry: failure.retry,
    }));
    calls.clear(); pending.clear(); assistantIds.clear(); usageIds.clear(); nextByName.clear();
    orderedCalls.length = 0; failures.length = 0; awaitingNext = []; failedTool = null; failedEntry = null;
    return result;
  }
  return { line, finish };
}

/** Streaming decoder preserves UTF-8 characters split across chunks; accepts LF / CRLF / CR. */
export async function readLines(chunks: AsyncIterable<Uint8Array>, consume: (line: string) => void) {
  const decoder = new TextDecoder();
  let carry = '';
  function drain(final = false) {
    const pattern = /\r\n|\n|\r/g;
    let start = 0;
    for (let match = pattern.exec(carry); match; match = pattern.exec(carry)) {
      if (!final && match[0] === '\r' && match.index === carry.length - 1) break;
      consume(carry.slice(start, match.index)); start = pattern.lastIndex;
    }
    carry = carry.slice(start);
    if (final && carry.length) { consume(carry); carry = ''; }
  }
  for await (const chunk of chunks) { carry += decoder.decode(chunk, { stream: true }); drain(); }
  carry += decoder.decode(); drain(true);
}
export async function parseFile(file: Blob, onProgress?: (percent: number) => void): Promise<Summary> {
  if (!checkFileSize(file.size)) throw new Error('FILE_TOO_LARGE');
  const accumulator = createAccumulator();
  async function* chunks() {
    for (let offset = 0; offset < file.size; offset += 256 * 1024) {
      yield new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
      onProgress?.(Math.min(100, Math.round((offset + 256 * 1024) / file.size * 100)));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  await readLines(chunks(), accumulator.line);
  return accumulator.finish();
}
