// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import App from '../src/App';
import * as tracking from '../src/track';
import { exportPng } from '../src/export';
import { MAX_FILE_BYTES } from '../src/parser';
import demo1 from '../src/samples/demo-1.jsonl?raw';
import demo2 from '../src/samples/demo-2.jsonl?raw';

vi.mock('../src/export', () => ({ exportPng: vi.fn() }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const filename = '〔目印ファイル名〕秘密の会話.jsonl';
let host: HTMLDivElement, root: Root;
let spy: ReturnType<typeof vi.spyOn<typeof tracking, 'track'>>;
let details: unknown[];
const listen = (event: Event) => { details.push((event as CustomEvent).detail); };
const observers: { callback: IntersectionObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn> }[] = [];
function events(name: keyof tracking.TrackEvents) { return spy.mock.calls.filter(call => call[0] === name); }
function button(label: string) { return [...host.querySelectorAll('button')].find(node => node.textContent?.startsWith(label))!; }
function file(text = demo1) { return new NodeFile([text], filename) as unknown as File; }
function receive(files: Blob[], method: tracking.InputMethod = 'picker') {
  if (method === 'picker') {
    const input = host.querySelector('input')!;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files } });
    host.querySelector('.dropzone')!.dispatchEvent(drop);
  }
}
async function parse(action: () => void) {
  const count = events('parse_complete').length;
  await act(async () => {
    action();
    await vi.waitFor(() => expect(events('parse_complete')).toHaveLength(count + 1));
  });
}
function intersect(index: number, visible = true, ratio = visible ? 0.5 : 0) {
  const observer = observers[index];
  act(() => observer.callback([{
    target: observer.target, isIntersecting: visible, intersectionRatio: ratio,
  } as IntersectionObserverEntry], {} as IntersectionObserver));
}

beforeEach(() => {
  details = []; observers.length = 0;
  spy = vi.spyOn(tracking, 'track'); // Call through: also inspect the actual window events.
  window.addEventListener('session-shape:track', listen);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('IntersectionObserver', class {
    record: typeof observers[number];
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, disconnect: vi.fn() }; observers.push(this.record);
    }
    observe(target: Element) { this.record.target = target; }
    disconnect() { this.record.disconnect(); }
  });
  vi.mocked(exportPng).mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<App />));
});

afterEach(() => {
  try {
    const kinds = ['demo_normal', 'demo_retry', 'user_file'];
    const allowed: Record<string, Record<string, readonly unknown[]>> = {
      sample_start: { kind: ['demo_normal', 'demo_retry'] },
      file_received: { method: ['picker', 'drop'] },
      input_rejected: { reason: ['too_large', 'multiple', 'empty', 'busy'] },
      parse_complete: { kind: kinds, outcome: ['valid', 'partial_invalid', 'no_assistant'], has_timed_rows: [true, false] },
      shape_presented: { kind: kinds },
      export_dispatched: { kind: kinds },
      export_failed: { reason: ['png_failed'] },
    };
    for (const [name, properties] of spy.mock.calls) {
      expect(allowed).toHaveProperty(name);
      expect(Object.keys(properties).sort()).toEqual(Object.keys(allowed[name]).sort());
      for (const [key, value] of Object.entries(properties)) expect(allowed[name][key]).toContain(value);
    }
    expect(details).toEqual(spy.mock.calls.map(([name, properties]) => ({ name, properties })));
    for (const surface of [JSON.stringify(spy.mock.calls), JSON.stringify(details), host.innerHTML]) {
      expect(surface).not.toContain('〔目印');
      expect(surface).not.toContain(filename);
      expect(surface).not.toContain('秘密');
    }
  } finally {
    act(() => root.unmount()); host.remove();
    window.removeEventListener('session-shape:track', listen);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it('track は window の CustomEvent だけを出す', () => {
  const network = vi.fn(() => { throw new Error('通信禁止'); });
  vi.stubGlobal('fetch', network); vi.stubGlobal('XMLHttpRequest', network);
  vi.stubGlobal('WebSocket', network);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: network });
  const scripts = document.querySelectorAll('script').length;
  const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
  tracking.track('file_received', { method: 'drop' });
  expect(details).toEqual([{ name: 'file_received', properties: { method: 'drop' } }]);
  expect(network).not.toHaveBeenCalled();
  expect(document.querySelectorAll('script')).toHaveLength(scripts);
  expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  delete (navigator as unknown as Record<string, unknown>).sendBeacon;
});

it.each([
  ['見本で試す', 'demo_normal'], ['エラーとやり直しの見本', 'demo_retry'],
] as const)('見本 %s の開始・解析・可視表示・書き出しを区別する', async (label, kind) => {
  await parse(() => button(label).click());
  expect(spy.mock.calls).toEqual([
    ['sample_start', { kind }],
    ['parse_complete', { kind, outcome: 'valid', has_timed_rows: true }],
  ]);
  expect(observers[0].target).toBe(host.querySelector('.chart'));
  intersect(0, false); expect(events('shape_presented')).toHaveLength(0);
  intersect(0, true, 0); intersect(0, true, 0.005);
  expect(events('shape_presented')).toHaveLength(0);
  intersect(0); intersect(0); intersect(0, false); intersect(0);
  expect(events('shape_presented')).toEqual([['shape_presented', { kind }]]);
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  await act(async () => button('図を PNG').click());
  expect(events('export_dispatched')).toEqual([['export_dispatched', { kind }]]);
});

it.each(['picker', 'drop'] as const)('%s で受け取った利用者の記録の属性に内容を含めない', async method => {
  const text = `${demo2}\n${JSON.stringify({ type: 'assistant', timestamp: '2026-11-01T00:00:00Z', message: {
    model: '〔目印モデル〕', content: [{ type: 'tool_use', name: '〔目印道具〕', input: { text: '〔目印本文〕' } }],
  } })}`;
  await parse(() => receive([file(text)], method));
  expect(spy.mock.calls).toEqual([
    ['file_received', { method }],
    ['parse_complete', { kind: 'user_file', outcome: 'valid', has_timed_rows: true }],
  ]);
  intersect(0);
  await act(async () => button('図を PNG').click());
  expect(events('shape_presented')).toEqual([['shape_presented', { kind: 'user_file' }]]);
  expect(events('export_dispatched')).toEqual([['export_dispatched', { kind: 'user_file' }]]);
});

it.each([
  [`${demo1}\n〔目印壊れた行〕`, 'partial_invalid', true],
  ['〔目印壊れた行〕', 'partial_invalid', false],
  [JSON.stringify({ type: 'user', timestamp: '2026-11-01T00:00:00Z', message: { content: '〔目印本文〕' } }), 'no_assistant', true],
  [JSON.stringify({ type: 'assistant', message: { content: '〔目印本文〕' } }), 'valid', false],
  [JSON.stringify({ type: 'metadata', timestamp: '2026-11-01T00:00:00Z' }), 'no_assistant', false],
  ['', 'no_assistant', false],
] as const)('解析結果を固定の札と時刻の有無だけで表す (%s)', async (text, outcome, timed) => {
  await parse(() => receive([file(text)]));
  expect(events('parse_complete')).toEqual([['parse_complete', { kind: 'user_file', outcome, has_timed_rows: timed }]]);
  intersect(0);
  expect(events('shape_presented')).toEqual([['shape_presented', { kind: 'user_file' }]]);
});

it.each(['picker', 'drop'] as const)('%s の大きすぎるファイルと複数ファイルは読む前に断る', async method => {
  const large = file(); Object.defineProperty(large, 'size', { value: MAX_FILE_BYTES + 1 });
  const read = vi.spyOn(large, 'slice');
  await act(async () => receive([large], method));
  expect(spy.mock.calls).toEqual([
    ['file_received', { method }], ['input_rejected', { reason: 'too_large' }],
  ]);
  expect(read).not.toHaveBeenCalled();
  const first = file(), second = file();
  const readFirst = vi.spyOn(first, 'slice'), readSecond = vi.spyOn(second, 'slice');
  await act(async () => receive([first, second], method));
  expect(spy.mock.calls.slice(2)).toEqual([
    ['file_received', { method }], ['input_rejected', { reason: 'multiple' }],
  ]);
  expect(readFirst).not.toHaveBeenCalled(); expect(readSecond).not.toHaveBeenCalled();
  expect(events('parse_complete')).toHaveLength(0); expect(observers).toHaveLength(0);
});

it('選択の取り消しは受領に数えず、ファイルのない drop は empty とする', () => {
  act(() => receive([])); expect(spy).not.toHaveBeenCalled();
  act(() => receive([], 'drop'));
  expect(spy.mock.calls).toEqual([['input_rejected', { reason: 'empty' }]]);
});

it('読み込み中の drop は busy とし、元の解析が戻るまで完了を出さない', async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const pending = new Promise<ArrayBuffer>(done => { resolve = done; });
  const first = file(); vi.spyOn(first, 'slice').mockReturnValue({ arrayBuffer: () => pending } as Blob);
  act(() => receive([first]));
  expect(events('parse_complete')).toHaveLength(0);
  act(() => receive([file()], 'drop'));
  expect(events('input_rejected')).toEqual([['input_rejected', { reason: 'busy' }]]);
  await parse(() => resolve(new TextEncoder().encode(demo1).buffer));
  expect(events('parse_complete')).toHaveLength(1);
});

it('読む途中の例外は属性に出さず、解析完了や事前拒否にも数えない', async () => {
  const broken = file();
  vi.spyOn(broken, 'slice').mockImplementation(() => { throw new Error(`〔目印例外〕${filename}`); });
  await act(async () => receive([broken]));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('ファイルを読み込めませんでした');
  expect(spy.mock.calls).toEqual([['file_received', { method: 'picker' }]]);
});

it('同じ見本の再読み込みは別の一回とし、古い監視の通知は無視する', async () => {
  await parse(() => button('見本で試す').click());
  intersect(0);
  await parse(() => button('見本で試す').click());
  intersect(0); intersect(1); intersect(1);
  expect(events('shape_presented')).toEqual([
    ['shape_presented', { kind: 'demo_normal' }], ['shape_presented', { kind: 'demo_normal' }],
  ]);
  await parse(() => receive([file()]));
  intersect(1); intersect(2);
  expect(events('shape_presented').at(-1)).toEqual(['shape_presented', { kind: 'user_file' }]);
  expect(events('shape_presented')).toHaveLength(3);
});

it('図を見る前に次を読み込んだ場合、前の図の遅れた通知を数えない', async () => {
  await parse(() => button('見本で試す').click());
  await parse(() => button('エラーとやり直しの見本').click());
  intersect(0); expect(events('shape_presented')).toHaveLength(0);
  intersect(1);
  expect(events('shape_presented')).toEqual([['shape_presented', { kind: 'demo_retry' }]]);
});

it('StrictMode の監視の再設定でも同じ読み込みを二重に数えない', async () => {
  act(() => root.render(<StrictMode><App /></StrictMode>));
  await parse(() => button('見本で試す').click());
  expect(observers).toHaveLength(2);
  intersect(0); expect(events('shape_presented')).toHaveLength(0);
  intersect(1); intersect(1);
  expect(events('shape_presented')).toHaveLength(1);
});

it('IntersectionObserver がない環境では表示を推測して数えない', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  await parse(() => button('見本で試す').click());
  expect(host.querySelector('svg')).not.toBeNull();
  expect(events('shape_presented')).toHaveLength(0);
});

it('PNG 処理が戻った時点で書き出しを記録し、再描画で表示を重複させない', async () => {
  let resolve!: () => void;
  vi.mocked(exportPng).mockReturnValue(new Promise<void>(done => { resolve = done; }));
  await parse(() => receive([file()])); intersect(0);
  act(() => button('図を PNG').click());
  expect(events('export_dispatched')).toHaveLength(0);
  expect(button('PNG を作成中').disabled).toBe(true);
  await act(async () => resolve()); intersect(0);
  expect(events('export_dispatched')).toEqual([['export_dispatched', { kind: 'user_file' }]]);
  expect(events('shape_presented')).toHaveLength(1);
});

it('PNG の失敗に例外文を含めず、再試行の成功を記録する', async () => {
  vi.mocked(exportPng).mockRejectedValueOnce(new Error(`〔目印例外〕${filename}`));
  await parse(() => receive([file()]));
  await act(async () => button('図を PNG').click());
  expect(events('export_failed')).toEqual([['export_failed', { reason: 'png_failed' }]]);
  expect(events('export_dispatched')).toHaveLength(0);
  expect(host.textContent).toContain('PNG を書き出せませんでした');
  await act(async () => button('図を PNG').click());
  expect(events('export_dispatched')).toEqual([['export_dispatched', { kind: 'user_file' }]]);
});
