// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { exportPng } from '../src/export';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
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
  Object.defineProperty(svg, 'viewBox', { value: { baseVal: { width: 1120, height: 300 } } });
  return { svg, create, revoke, draw, encode, download };
}
it('SVG を canvas に描き PNG を保存し、blob URL を解放する', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const m = setup();
  await exportPng(m.svg);
  expect(m.draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 2240, 600);
  expect(m.encode).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  expect(m.download).toHaveBeenCalledOnce();
  expect(m.revoke).toHaveBeenCalledWith('blob:svg');
  vi.runAllTimers(); expect(m.revoke).toHaveBeenCalledWith('blob:png');
});
it('SVG の描画に失敗した場合も元の URL を解放する', async () => {
  const m = setup(true);
  await expect(exportPng(m.svg)).rejects.toThrow('PNG_FAILED');
  expect(m.revoke).toHaveBeenCalledWith('blob:svg'); expect(m.download).not.toHaveBeenCalled();
});
it('PNG のエンコードに失敗した場合はダウンロードしない', async () => {
  const m = setup(); m.encode.mockImplementation(callback => callback(null));
  await expect(exportPng(m.svg)).rejects.toThrow('PNG_FAILED');
  expect(m.revoke).toHaveBeenCalledWith('blob:svg'); expect(m.download).not.toHaveBeenCalled();
});
