// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { exportPng, serializeExportSvg } from '../src/export';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { File as NodeFile } from 'node:buffer';
import { parseFile } from '../src/parser';
import { Timeline } from '../src/Timeline';
import demo2 from '../src/samples/demo-2.jsonl?raw';
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: (() => void)[] = [];
const totals = { durationMs: 90000, toolCalls: 7, toolErrors: 2 };
afterEach(() => { mounted.splice(0).forEach(unmount => unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(fail = false) {
  const create = vi.fn().mockReturnValueOnce('blob:svg').mockReturnValueOnce('blob:png');
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_: string) { queueMicrotask(() => fail ? this.onerror?.() : this.onload?.()); }
  });
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('session-shape.png'); expect(this.href).toBe('blob:png');
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '1120'); svg.setAttribute('height', '300');
  svg.setAttribute('viewBox', '0 0 1120 300');
  return { svg, create, revoke, draw, encode, download };
}
it('SVG を canvas に描き PNG を保存し、blob URL を解放する', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const m = setup();
  await exportPng(m.svg, totals);
  expect(m.draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 2240, 792);
  expect(m.encode).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  expect(m.download).toHaveBeenCalledOnce();
  expect(m.revoke).toHaveBeenCalledWith('blob:svg');
  vi.runAllTimers(); expect(m.revoke).toHaveBeenCalledWith('blob:png');
});
it('SVG の描画に失敗した場合も元の URL を解放する', async () => {
  const m = setup(true);
  await expect(exportPng(m.svg, totals)).rejects.toThrow('PNG_FAILED');
  expect(m.revoke).toHaveBeenCalledWith('blob:svg'); expect(m.download).not.toHaveBeenCalled();
});
it('PNG のエンコードに失敗した場合はダウンロードしない', async () => {
  const m = setup(); m.encode.mockImplementation(callback => callback(null));
  await expect(exportPng(m.svg, totals)).rejects.toThrow('PNG_FAILED');
  expect(m.revoke).toHaveBeenCalledWith('blob:svg'); expect(m.download).not.toHaveBeenCalled();
});

const filename = '〔目印ファイル名〕秘密の会話.jsonl';
async function timeline(compact = false, selection: 'none' | 'first' | 'untimed' | 'unmatched' = 'none') {
  const summary = await parseFile(new NodeFile([demo2], filename) as unknown as File);
  const selected = selection === 'none' ? undefined : {
    ...summary.troubles[0],
    ...(selection === 'untimed' ? { failedAt: null } : {}),
    ...(selection === 'unmatched' ? { matched: false } : {}),
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(createElement(Timeline, { summary, compact, selected })));
  mounted.push(() => act(() => root.unmount()));
  return { svg: host.querySelector('svg')!, summary };
}
it.each([false, true])('書き出す SVG に題・小計・凡例だけを足し、画面を変えない (compact=%s)', async compact => {
  const { svg, summary } = await timeline(compact);
  const before = svg.outerHTML;
  const exported = serializeExportSvg(svg, summary);
  const result = new DOMParser().parseFromString(exported.source, 'image/svg+xml');
  expect(result.querySelector('parsererror')).toBeNull();
  expect(result.documentElement.textContent).toContain('Session Shape');
  expect(result.documentElement.textContent).toContain('2分 · 道具 7回 · エラー 2回');
  expect(result.documentElement.textContent).toContain('● 道具　× エラー　┆ 人の発言');
  expect(exported.source).not.toContain('選んだつまずき');
  expect(exported.source).not.toContain('〔目印');
  expect(exported.source).not.toContain('秘密');
  expect(exported.source).not.toContain(filename);
  expect(exported.source).not.toContain('demo-2');
  expect(result.querySelector('text[font-weight="700"]')?.textContent).toBe('Session Shape');
  expect(svg.outerHTML).toBe(before);
  expect(svg.textContent).not.toContain('Session Shape');
});
it.each([false, true])('実際の選択の帯がある場合にだけ凡例を加える (compact=%s)', async compact => {
  for (const selection of ['first', 'untimed', 'unmatched'] as const) {
    const { svg, summary } = await timeline(compact, selection);
    const before = svg.outerHTML;
    const { source } = serializeExportSvg(svg, summary);
    expect(source.includes('▮ 選んだつまずき')).toBe(selection === 'first');
    expect(source).not.toContain('〔目印');
    expect(source).not.toContain(filename);
    expect(svg.outerHTML).toBe(before);
  }
});
it('長い会話と大きな総数は compact の上の帯で改行し、図の高さも確保する', async () => {
  const { svg } = await timeline(true);
  const exported = serializeExportSvg(svg, { durationMs: 360000000000, toolCalls: 1234567, toolErrors: 1234567 });
  const result = new DOMParser().parseFromString(exported.source, 'image/svg+xml');
  const labels = [...result.querySelectorAll('svg > text[text-anchor="end"]')];
  expect(labels.map(node => node.textContent)).toEqual(['100000時間 0分 0秒 · 道具 1234567回 ·', 'エラー 1234567回']);
  expect(labels.map(node => node.getAttribute('y'))).toEqual(['56', '80']);
  expect(result.querySelector('svg > g')?.getAttribute('transform')).toBe('translate(0 104)');
  expect(exported.height).toBe(Number(svg.getAttribute('height')) + 104 + 72);
});
