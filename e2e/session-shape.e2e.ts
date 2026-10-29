import { test as base, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

// Observe from before navigation through the end of every scenario. Do not mock
// network, image loading, canvas, Blob URLs, or the download implementation.
const test = base.extend<{ browserAudit: void }>({
  browserAudit: [async ({ context, page, baseURL }, use) => {
    const unexpectedRequests: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const origin = new URL(baseURL!).origin;
    context.on('request', request => {
      const url = new URL(request.url());
      // Exporting an image reads a local Blob, with no network request.
      if (url.protocol === 'blob:' && url.origin === origin && request.resourceType() === 'image') return;
      const document = request.resourceType() === 'document' && url.href === baseURL;
      const asset = ['script', 'stylesheet', 'image', 'font'].includes(request.resourceType())
        && url.pathname.startsWith('/session-shape/assets/');
      if (url.origin !== origin || request.method() !== 'GET' || !(document || asset)) {
        unexpectedRequests.push(`${request.method()} ${request.resourceType()} ${url.href}`);
      }
    });
    context.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    context.on('weberror', error => pageErrors.push(error.error().message));
    page.on('websocket', socket => unexpectedRequests.push(`WebSocket ${socket.url()}`));
    await use();
    await page.waitForLoadState('networkidle');
    expect(unexpectedRequests, '同一 origin の静的資産以外への要求').toEqual([]);
    expect(consoleErrors, 'console.error / CSP 違反').toEqual([]);
    expect(pageErrors, 'ブラウザ内の未処理例外').toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ page }) => {
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('button', { name: '見本で試す', exact: true })).toBeVisible();
  // Assert the actual production policy is present, rather than bypassing CSP.
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("connect-src 'none'");
  await expect(page.locator('script[src*="/@vite/client"]')).toHaveCount(0);
});

async function expectCounts(page: Page, counts: {
  rows: number; chartedRows: number; invalidRows: number; assistantMessages: number; toolCalls: number;
}) {
  await expect(page.locator('.read-counts')).toHaveText(
    `読んだ行 ${counts.rows} ・ 図にした行 ${counts.chartedRows} ・ 読めない行 ${counts.invalidRows}`,
  );
  for (const [label, value] of [['AI の応答', counts.assistantMessages], ['道具の呼び出し', counts.toolCalls]] as const) {
    await expect(page.locator('.stats > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText(`${value}回`);
  }
  await expect(page.getByRole('img', { name: '人の発言と道具の呼び出しの時間の帯' })).toBeVisible();
}

async function expectPrivate(page: Page, secrets: string[]) {
  const surfaces = await page.evaluate(() => ({
    visibleText: document.body.innerText,
    allText: document.documentElement.textContent ?? '',
    markup: document.documentElement.outerHTML,
    attributes: [...document.querySelectorAll('*')].flatMap(node => [...node.attributes].map(attr => attr.value)).join('\n'),
    svg: [...document.querySelectorAll('svg')].map(node => node.outerHTML).join('\n'),
    inputValues: [...document.querySelectorAll('input')].map(input => input.value).join('\n'),
    filenames: [...document.querySelectorAll('input')].flatMap(input => [...(input.files ?? [])].map(file => file.name)).join('\n'),
  }));
  for (const [surface, text] of Object.entries(surfaces)) {
    for (const secret of ['〔目印', '秘密', ...secrets]) expect(text, `${surface}: ${secret}`).not.toContain(secret);
  }
}

// Collect both the sentinel and its entire marked value from the checked-in
// samples so newly added marked fields also become privacy assertions.
function markedValues(value: unknown): string[] {
  if (typeof value === 'string') return value.includes('〔目印') ? [value, ...(value.match(/〔目印[^〕]*〕/g) ?? [])] : [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(markedValues);
  return [];
}

test('初期表示は外部通信も console error もない', async ({ page }) => {
  await expect(page.getByText('読み込むと、ここに作業の形が現れます。')).toBeVisible();
});

for (const [number, button] of [[1, '見本で試す'], [2, 'エラーとやり直しの見本']] as const) {
  test(`見本 ${number} の集計と本文の非表示`, async ({ page }) => {
    const sample = readFileSync(new URL(`../src/samples/demo-${number}.jsonl`, import.meta.url), 'utf8');
    const entries = sample.trim().split('\n').map(line => JSON.parse(line));
    const secrets = [...new Set(entries.flatMap(markedValues))];
    expect(secrets.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /^読み込み成功$/ })).toBeVisible();
    // These fixed expectations also appear in tests/parser.test.ts. Do not
    // compute expected results using the production parser under test.
    await expectCounts(page, { rows: 31, chartedRows: 23, invalidRows: 0, assistantMessages: 10, toolCalls: 7 });
    for (const label of ['道具のエラー', '直後のやり直し']) {
      await expect(page.locator('.stats > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText(`${(number - 1) * 2}回`);
    }
    await expectPrivate(page, [...secrets, ...entries.flatMap(entry => entry.message?.id ? [entry.message.id] : [])]);
  });
}

const filename = '〔目印ファイル名〕秘密の会話.jsonl';
const messageId = '〔目印応答ID〕';
const toolId = '〔目印道具ID〕';
const usage = { input_tokens: 10, output_tokens: 2 };
function row(type: string, message: object) {
  return { type, timestamp: '2026-10-20T01:00:00Z', cwd: '〔目印作業フォルダ〕', message };
}
const uploadRows = [
  row('user', { content: [{ type: 'text', text: '〔目印本文〕見せない文章' }] }),
  row('assistant', { id: messageId, model: '〔目印モデル名〕', usage, content: [{ type: 'thinking', thinking: '〔目印考え〕' }] }),
  row('assistant', { id: messageId, model: '〔目印モデル名〕', usage, content: [{ type: 'tool_use', id: toolId, name: 'Read', input: { file_path: '〔目印道具入力〕' } }] }),
  row('user', { content: [{ type: 'tool_result', tool_use_id: toolId, content: '〔目印道具結果〕' }] }),
  row('assistant', { id: '〔目印別応答ID〕', usage, content: [{ type: 'tool_use', name: '〔目印道具名〕', input: { text: '〔目印別入力〕' } }] }),
];
const uploadText = uploadRows.map(entry => JSON.stringify(entry)).join('\n');

test('ファイル選択で分割応答を重複集計せず、本文もファイル名も残さない', async ({ page }, testInfo) => {
  const path = testInfo.outputPath(filename);
  await writeFile(path, uploadText);
  const input = page.getByLabel('会話の JSONL ファイル');
  await input.setInputFiles(path);
  await expect(page.getByRole('status').filter({ hasText: /^読み込み成功$/ })).toBeVisible();
  await expectCounts(page, { rows: 5, chartedRows: 5, invalidRows: 0, assistantMessages: 2, toolCalls: 2 });
  await expect(input).toHaveValue('');
  expect(await input.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
  await expectPrivate(page, [filename, ...markedValues(uploadRows)]);
});

test('本物の canvas から PNG を 1 件ダウンロードし、SVG の 2 倍の幅になる', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '見本で試す', exact: true }).click();
  const svg = page.getByRole('img', { name: '人の発言と道具の呼び出しの時間の帯' });
  await expect(svg).toBeVisible();
  const dimensions = await svg.evaluate((element: SVGSVGElement) => ({ width: element.width.baseVal.value, height: element.height.baseVal.value }));
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '図を PNG で書き出す' }).click();
  const download = await downloading;
  const path = testInfo.outputPath('session-shape.png');
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const png = await readFile(path);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.toString('ascii', 12, 16)).toBe('IHDR');
  expect(png.readUInt32BE(16)).toBe(dimensions.width * 2);
  expect(png.readUInt32BE(20)).toBe(dimensions.height * 2);
  await expect(page.getByRole('status').filter({ hasText: 'PNG を書き出しました。' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(downloads).toEqual(['session-shape.png']);
  await testInfo.attach('実ブラウザで書き出した PNG', { path, contentType: 'image/png' });
});

test('壊れた行の混ざったファイルは確認を促す', async ({ page }, testInfo) => {
  const path = testInfo.outputPath(filename);
  await writeFile(path, `${uploadText}\n{"broken":"〔目印壊れた行〕"\n`);
  await page.getByLabel('会話の JSONL ファイル').setInputFiles(path);
  await expect(page.getByRole('status').filter({ hasText: /^読み込みを確認してください$/ })).toBeVisible();
  await expectCounts(page, { rows: 6, chartedRows: 5, invalidRows: 1, assistantMessages: 2, toolCalls: 2 });
  await expect(page.getByRole('status').filter({ hasText: /^読み込み成功$/ })).toHaveCount(0);
  await expectPrivate(page, [filename, ...markedValues(uploadRows), '〔目印壊れた行〕']);
});
