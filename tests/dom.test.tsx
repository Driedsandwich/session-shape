// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Blob as NodeBlob } from 'node:buffer';
import App, { Results } from '../src/App';
import { parseFile } from '../src/parser';
import demo1 from '../src/samples/demo-1.jsonl?raw';
import demo2 from '../src/samples/demo-2.jsonl?raw';
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: (() => void)[] = [];
function mount(element: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); act(() => root.render(element));
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
afterEach(() => { mounted.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('表示境界のプライバシー', () => {
  it.each([demo1, demo2])('集計から描いた DOM の文字・属性・SVG に本文を置かない', async sample => {
    const s = await parseFile(new NodeBlob([sample]) as unknown as Blob);
    const host = mount(<Results summary={s} kind="user_file" />);
    expect(host.textContent).toContain('読み込み成功');
    for (const letter of 'ABCDEFGHI') {
      expect(host.textContent).not.toContain(`〔目印${letter}〕`);
      expect(host.innerHTML).not.toContain(`〔目印${letter}〕`);
    }
    expect(host.innerHTML).not.toContain('秘密');
    for (const entry of sample.trim().split('\n').map(line => JSON.parse(line))) {
      if (entry.message?.id) expect(host.innerHTML).not.toContain(entry.message.id);
    }
    expect(host.querySelector('svg')?.outerHTML).not.toContain('demo-');
    expect(host.querySelector('svg')).not.toBeNull();
  });
  it('見本ボタンから読み込み・表示まで通信も console 出力もしない', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const network = vi.fn(() => { throw new Error('通信禁止'); });
    vi.stubGlobal('fetch', network); vi.stubGlobal('XMLHttpRequest', network); vi.stubGlobal('WebSocket', network);
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    const host = mount(<App />);
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === '見本で試す')!;
    await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 40)); });
    expect(host.textContent).toContain('読み込み成功');
    expect(host.innerHTML).not.toContain('〔目印');
    expect(network).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it('選んだファイルの名前を表示せず、入力値を即座に消す', async () => {
    const host = mount(<App />);
    const input = host.querySelector('input')!;
    const file = new NodeBlob([demo2]);
    Object.defineProperty(file, 'name', { value: '秘密のファイル名.jsonl' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    const setter = vi.spyOn(input, 'value', 'set');
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); expect(setter).toHaveBeenCalledWith(''); await new Promise(resolve => setTimeout(resolve, 40)); });
    expect(host.textContent).toContain('読み込み成功');
    expect(host.innerHTML).not.toContain('秘密');
    expect(host.innerHTML).not.toContain('〔目印');
  });
});
