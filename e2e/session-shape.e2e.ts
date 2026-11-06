import { test as base, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { agentUrl, attributeInventory, collectedEvents, decodeRequest, fakeAgent, pendoOrigins, productionCsp, staticRequest, type PendoAudit, type TestPendo } from './pendo-audit';

type TrackedEvent = { name: string; properties: Record<string, unknown> };
type AuditedWindow = Window & { sessionShapeTestEvents: TrackedEvent[] };
const trackedEvents = (page: Page) => page.evaluate(() => (window as unknown as AuditedWindow).sessionShapeTestEvents);

// Observe the full scenario. Only Pendo is intercepted; local assets, canvas,
// Blob URLs, and the download implementation still run in the real browser.
const test = base.extend<{ browserAudit: void; realPendo: boolean; pendoAudit: PendoAudit }>({
  realPendo: [false, { option: true }],
  pendoAudit: async ({}, use) => { await use({ requests: [] }); },
  browserAudit: [async ({ context, page, baseURL, realPendo, pendoAudit }, use) => {
    const unexpectedRequests: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    context.on('request', request => {
      if (!staticRequest(request, baseURL!) && !pendoOrigins.has(new URL(request.url()).origin)) {
        unexpectedRequests.push(`${request.method()} ${request.resourceType()} ${request.url()}`);
      }
    });
    // Context fallback also prevents requests from a popup from escaping.
    await context.route('**/*', route => {
      if (staticRequest(route.request(), baseURL!)) return route.continue();
      return route.abort('blockedbyclient');
    });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (staticRequest(request, baseURL!)) return route.continue();
      if (!pendoOrigins.has(url.origin)) return route.abort('blockedbyclient');
      if (['https://data.pendo.io', 'https://app.pendo.io'].includes(url.origin)) {
        pendoAudit.requests.push({ url: request.url(), method: request.method(), body: request.postDataBuffer(), contentType: request.headers()['content-type'] ?? '' });
        // Never route.fetch/continue these requests, including GETs and beacons.
        await route.fulfill({ status: 200, body: '', headers: { 'access-control-allow-origin': '*' } });
      } else if (request.url() === agentUrl && request.method() === 'GET') {
        if (!realPendo) return route.fulfill({ contentType: 'application/javascript', body: fakeAgent });
        try {
          if (process.env.PENDO_TEST_CDN_OFFLINE === '1') throw new Error('Simulated CDN outage');
          // Do not follow redirects to a collection endpoint.
          const response = await route.fetch({ timeout: 15_000, maxRedirects: 0 });
          if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
          const body = await response.body();
          pendoAudit.scriptSha256 = createHash('sha256').update(body).digest('hex');
          await route.fulfill({ response, body });
        } catch {
          pendoAudit.cdnUnavailable = 'CDN に届かない: cdn.pendo.io の SDK を取得できませんでした'
            + (process.env.PENDO_TEST_CDN_OFFLINE === '1' ? '（到達不能を模擬）' : '');
          await route.fulfill({ contentType: 'application/javascript', body: fakeAgent });
        }
      } else {
        // CSP-listed guide assets are allowed by the audit but not needed here.
        await route.fulfill({ status: 200, body: '' });
      }
    });
    await page.routeWebSocket('**/*', socket => {
      unexpectedRequests.push(`WebSocket ${socket.url()}`);
      socket.close();
    });
    context.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    context.on('weberror', error => pageErrors.push(error.error().message));
    page.on('websocket', socket => unexpectedRequests.push(`WebSocket ${socket.url()}`));
    await page.addInitScript(() => {
      const events: TrackedEvent[] = [];
      (window as unknown as AuditedWindow).sessionShapeTestEvents = events;
      window.addEventListener('session-shape:track', event => events.push((event as CustomEvent).detail));
    });
    await use();
    await page.waitForLoadState('networkidle');
    expect(unexpectedRequests, '同一 origin の静的資産と CSP の Pendo ホスト以外への要求').toEqual([]);
    expect(consoleErrors, 'console.error / CSP 違反').toEqual([]);
    expect(pageErrors, 'ブラウザ内の未処理例外').toEqual([]);
    const events = await trackedEvents(page);
    const kinds = ['demo_normal', 'demo_retry', 'user_file'];
    const allowed: Record<string, Record<string, unknown[]>> = {
      sample_start: { kind: ['demo_normal', 'demo_retry'] },
      file_received: { method: ['picker', 'drop'] },
      input_rejected: { reason: ['too_large', 'multiple', 'empty', 'busy'] },
      parse_complete: { kind: kinds, outcome: ['valid', 'partial_invalid', 'no_assistant'], has_timed_rows: [true, false] },
      shape_presented: { kind: kinds },
      export_dispatched: { kind: kinds },
      export_failed: { reason: ['png_failed'] },
    };
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['name', 'properties']);
      expect(allowed).toHaveProperty(event.name);
      expect(Object.keys(event.properties).sort()).toEqual(Object.keys(allowed[event.name]).sort());
      for (const [key, value] of Object.entries(event.properties)) expect(allowed[event.name][key]).toContain(value);
    }
    expect(JSON.stringify(events)).not.toContain('〔目印');
    expect(JSON.stringify(events)).not.toContain(filename);
  }, { auto: true }],
});

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('button', { name: '見本1：ふつうの会話', exact: true })).toBeVisible();
  // Assert the actual production policy is present, rather than bypassing CSP.
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toBe(productionCsp);
  await expect(page.locator('script[src*="/@vite/client"]')).toHaveCount(0);
});

async function expectCounts(page: Page, counts: {
  rows: number; chartedRows: number; invalidRows: number; assistantMessages: number; toolCalls: number;
}) {
  for (const [label, value] of [['読んだ行', counts.rows], ['図にした行', counts.chartedRows], ['読めない行', counts.invalidRows]] as const) {
    await expect(page.locator('.read-counts > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText(String(value));
  }
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

test('初期表示は許可以外の通信も console error もない', async ({ page }) => {
  await expect(page.getByText('読み込むと、ここに作業の形が現れます。')).toBeVisible();
});

for (const [number, button] of [[1, '見本1：ふつうの会話'], [2, '見本2：エラーとやり直し']] as const) {
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
    const kind = number === 1 ? 'demo_normal' : 'demo_retry';
    const chart = page.locator('.chart');
    await chart.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await trackedEvents(page)).filter(event => event.name === 'shape_presented')).toEqual([
      { name: 'shape_presented', properties: { kind } },
    ]);
    await page.locator('header').scrollIntoViewIfNeeded();
    await chart.scrollIntoViewIfNeeded();
    expect((await trackedEvents(page)).filter(event => event.name === 'shape_presented')).toHaveLength(1);
    expect((await trackedEvents(page)).filter(event => event.name !== 'shape_presented')).toEqual([
      { name: 'sample_start', properties: { kind } },
      { name: 'parse_complete', properties: { kind, outcome: 'valid', has_timed_rows: true } },
    ]);
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

for (const [number, viewportWidth] of [[1, 1440], [2, 1440], [2, 390]] as const) {
  test(`見本 ${number}・${viewportWidth}px の実際の PNG は上下の帯を含む固定寸法になる`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewportWidth, height: viewportWidth === 390 ? 844 : 900 });
    await page.getByRole('button', { name: number === 1 ? '見本1：ふつうの会話' : '見本2：エラーとやり直し', exact: true }).click();
    if (number === 2) {
      await page.locator('.row-action button').first().click();
      await expect(page.locator('.row-action button').first()).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-selection-band]')).toHaveCount(1);
    }
    const svg = page.getByRole('img', { name: '人の発言と道具の呼び出しの時間の帯' });
    await expect(svg).toBeVisible();
    const before = await svg.evaluate(element => element.outerHTML);
    const dimensions = await svg.evaluate((element: SVGSVGElement) => ({ width: element.width.baseVal.value, height: element.height.baseVal.value }));
    expect(dimensions).toEqual(viewportWidth === 390 ? { width: 360, height: 204 } : { width: 760, height: 254 });
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
    // Five lanes: desktop chart 254 + header 56 + footer 40; compact
    // chart 204 + header 80 + footer 72. Add 16px on each side of the chart.
    // The entire export is rasterized at 2x.
    expect(png.readUInt32BE(16)).toBe(viewportWidth === 390 ? 784 : 1584);
    expect(png.readUInt32BE(20)).toBe(viewportWidth === 390 ? 712 : 700);
    expect(await svg.evaluate(element => element.outerHTML)).toBe(before);
    await expect(page.getByRole('status').filter({ hasText: 'PNG を書き出しました。' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(downloads).toEqual(['session-shape.png']);
    expect((await trackedEvents(page)).filter(event => event.name === 'export_dispatched')).toEqual([
      { name: 'export_dispatched', properties: { kind: number === 1 ? 'demo_normal' : 'demo_retry' } },
    ]);
    await testInfo.attach('実ブラウザで書き出した PNG', { path, contentType: 'image/png' });
  });
}

test('壊れた行の混ざったファイルは確認を促す', async ({ page }, testInfo) => {
  const path = testInfo.outputPath(filename);
  await writeFile(path, `${uploadText}\n{"broken":"〔目印壊れた行〕"\n`);
  await page.getByLabel('会話の JSONL ファイル').setInputFiles(path);
  await expect(page.getByRole('status').filter({ hasText: /^読み込みを確認してください$/ })).toBeVisible();
  await expectCounts(page, { rows: 6, chartedRows: 5, invalidRows: 1, assistantMessages: 2, toolCalls: 2 });
  await expect(page.getByRole('status').filter({ hasText: /^読み込み成功$/ })).toHaveCount(0);
  await expectPrivate(page, [filename, ...markedValues(uploadRows), '〔目印壊れた行〕']);
});

for (const width of [1440, 390]) {
  for (const scenario of ['demo1', 'demo2', 'broken', 'long-model'] as const) {
    test(`S2 ${width}px ${scenario} の折りたたみ・横溢れ・非表示`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const mobile = width === 390;
      const sample = readFileSync(new URL('../src/samples/demo-2.jsonl', import.meta.url), 'utf8');
      if (scenario === 'demo1' || scenario === 'demo2') {
        await page.getByRole('button', { name: scenario === 'demo1' ? '見本1：ふつうの会話' : '見本2：エラーとやり直し', exact: true }).click();
      } else {
        const text = scenario === 'broken' ? `${sample}\n〔目印壊れた行〕` : sample.replaceAll('claude-opus-5-5', 'claude-sonnet-99-12345678-12345678-latest').replaceAll('claude-haiku-5-5', 'claude-fable-99-12345678-12345678-latest');
        await page.getByLabel('会話の JSONL ファイル').setInputFiles({ name: filename, mimeType: 'application/x-ndjson', buffer: Buffer.from(text) });
      }
      await expect(page.locator('.chart svg')).toBeVisible();
      const noOverflow = async () => {
        expect(await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth }))).toEqual({ document: width, body: width, viewport: width });
        // No small text on mobile; the SVG may scroll but must not be scaled below 14px.
        if (mobile) {
          const small = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
            if (!(el instanceof HTMLElement || el instanceof SVGTextElement) || !el.getClientRects().length) return false;
            if (![...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) return false;
            return parseFloat(getComputedStyle(el).fontSize) < 14;
          }).map(el => el.tagName));
          expect(small).toEqual([]);
        }
      };
      await noOverflow();
      if (scenario === 'demo1') {
        await expect(page.getByText('つまずきは 0 件', { exact: true })).toBeVisible();
        await expect(page.locator('.trouble-row')).toHaveCount(0);
        await expect(page.locator('[data-selection-band]')).toHaveCount(0);
      } else {
        await expect(page.locator('.trouble-row')).toHaveCount(2);
        await expect(page.locator('.row-action button').first()).toHaveAttribute('aria-pressed', 'true');
      }
      if (scenario === 'demo2' || (scenario === 'demo1' && !mobile)) {
        const path = testInfo.outputPath(`s2-${width}-${scenario}.png`);
        await page.screenshot({ path, fullPage: false });
        await testInfo.attach(`S2 ${width} ${scenario}`, { path, contentType: 'image/png' });
      }
      if (scenario === 'demo2') {
        const rows = page.locator('.row-action button');
        const firstX = await page.locator('[data-selection-band]').getAttribute('x');
        await rows.first().focus();
        await page.keyboard.press('Tab');
        await expect(rows.nth(1)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
        expect(await page.locator('[data-selection-band]').getAttribute('x')).not.toBe(firstX);
        await rows.first().focus();
        await page.keyboard.press('Space');
        await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-selection-band]')).toHaveAttribute('x', firstX!);
      }
      if (mobile) {
        await expect(page.locator('.import-controls')).toBeHidden();
        await expect(page.locator('.totals')).not.toHaveAttribute('open', '');
        await page.getByRole('button', { name: /記録を変更/ }).click();
        await expect(page.getByRole('button', { name: '見本1：ふつうの会話', exact: true })).toBeVisible();
        await page.locator('.totals > summary').click();
      }
      await page.getByText('モデル・トークンを見る', { exact: true }).click();
      await expect(page.getByText('使ったモデル', { exact: true })).toBeVisible();
      if (scenario === 'long-model') await expect(page.getByText(/claude-sonnet-99-12345678-12345678-latest/)).toBeVisible();
      await noOverflow();
      if (scenario === 'broken') {
        await expect(page.getByRole('status').filter({ hasText: /^読み込みを確認してください$/ })).toBeVisible();
        await expect(page.locator('.read-counts > div').last().locator('dd')).toHaveText('1');
      }
      await expectPrivate(page, [filename, ...sample.trim().split('\n').flatMap(line => markedValues(JSON.parse(line)))]);
    });
  }
}

async function exercisePrivacy(page: Page) {
  const inventories = [];
  const forbidden = new Set([filename, '〔目印', '秘密', 'Edit', 'Bash', 'Read', 'Grep', 'web_search', 'その他の道具', 'その他のモデル', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-99-12345678-12345678-latest']);
  const sample = readFileSync(new URL('../src/samples/demo-2.jsonl', import.meta.url), 'utf8');
  const entries = sample.trim().split('\n').map(line => JSON.parse(line));
  entries.flatMap(markedValues).forEach(value => forbidden.add(value));
  for (const entry of [...entries, ...uploadRows]) {
    if (typeof entry.timestamp === 'string') forbidden.add(entry.timestamp);
  }
  markedValues(uploadRows).forEach(value => forbidden.add(value));
  for (const kind of ['demo_retry', 'user_file']) {
    const compact = kind === 'user_file';
    await page.setViewportSize({ width: compact ? 390 : 1440, height: 900 });
    if (kind === 'demo_retry') await page.getByRole('button', { name: '見本2：エラーとやり直し', exact: true }).click();
    else await page.getByLabel('会話の JSONL ファイル').setInputFiles({ name: filename, mimeType: 'application/x-ndjson', buffer: Buffer.from(`${sample.replaceAll('claude-opus-5-5', 'claude-sonnet-99-12345678-12345678-latest')}\n${uploadText}`) });
    await expect(page.locator('.trouble-row')).toHaveCount(2);
    for (const button of await page.locator('.row-action button').all()) {
      await button.focus();
      await button.click();
    }
    // Actual text-bearing targets, including non-button elements Pendo captures.
    await page.locator('.chart svg').click({ position: { x: 50, y: 50 } });
    if (compact) await page.locator('.totals > summary').click();
    await page.locator('.model-details > summary').click();
    await page.locator('.stats > div').filter({ hasText: '道具の呼び出し' }).click();
    await page.getByText('使ったモデル', { exact: true }).click();
    await page.locator('.model-details > p').first().click();
    const texts = await page.locator('.stats, .stats > div, .stats dd, .lead, .selection, .failure-time, .model-details, .chart title').allTextContents();
    for (const text of texts) if (text.trim()) forbidden.add(text.trim());
    inventories.push({ kind, nodes: await attributeInventory(page) });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '図を PNG で書き出す' }).click();
    expect(await (await download).failure()).toBeNull();
    await expect.poll(async () => (await trackedEvents(page)).some(event => event.name === 'export_dispatched' && event.properties.kind === kind)).toBe(true);
  }
  return { inventories, forbidden: [...forbidden] };
}

test('偽の Pendo に渡す引数と初期設定は CDN なしでも契約どおり', async ({ page }, testInfo) => {
  const { inventories, forbidden } = await exercisePrivacy(page);
  const agent = await page.evaluate(() => {
    const pendo = (window as unknown as { pendo: TestPendo }).pendo;
    return { calls: pendo.calls, options: pendo.options };
  });
  expect(agent.options).toEqual([{ visitor: { id: '' }, excludeAllText: true, allowedText: [], recording: { enabled: false } }]);
  expect(agent.calls).toEqual(await trackedEvents(page));
  expect(agent.calls.map(event => event.name)).toEqual([
    'sample_start', 'parse_complete', 'shape_presented', 'export_dispatched',
    'file_received', 'parse_complete', 'shape_presented', 'export_dispatched',
  ]);
  for (const secret of forbidden) expect(JSON.stringify(agent.calls)).not.toContain(secret);
  await testInfo.attach('attribute-inventory.json', { body: JSON.stringify(inventories, null, 2), contentType: 'application/json' });
  await testInfo.attach('pendo-arguments.json', { body: JSON.stringify(agent, null, 2), contentType: 'application/json' });
});

test.describe('本物の SDK の送信内容', () => {
  test.use({ realPendo: true });
  test('見本2と目印の記録の本文・属性・小計を送らない', async ({ page, pendoAudit }, testInfo) => {
    test.setTimeout(60_000);
    // Navigation waits for the intercepted script; only CDN failures skip this test.
    test.skip(!!pendoAudit.cdnUnavailable, pendoAudit.cdnUnavailable);
    await expect.poll(() => page.evaluate(() => ((window as unknown as { pendo: TestPendo }).pendo).isReady?.()), { timeout: 15_000 }).toBe(true);
    const { inventories, forbidden } = await exercisePrivacy(page);
    await page.evaluate(() => ((window as unknown as { pendo: TestPendo }).pendo).flushNow?.({ unload: true }));
    // Guide configuration is intentionally an empty response. The SDK can hold
    // automatic events briefly; require actual click/focus and all custom events,
    // not merely the initial metadata request, before inspecting the payloads.
    await expect.poll(async () => {
      await page.evaluate(() => ((window as unknown as { pendo: TestPendo }).pendo).flushNow?.({ hidden: true }));
      const events = collectedEvents(pendoAudit.requests.map(decodeRequest));
      return ['click', 'focus', 'track'].map(type => events.filter(event => event.type === type).length > 0);
    }, { timeout: 20_000 }).toEqual([true, true, true]);
    await page.waitForLoadState('networkidle');
    const decoded = pendoAudit.requests.map(decodeRequest);
    await testInfo.attach('captured-pendo.json', { body: JSON.stringify(pendoAudit.requests.map(request => ({ ...request, body: request.body?.toString('base64') ?? null, bodyEncoding: 'base64' })), null, 2), contentType: 'application/json' });
    await testInfo.attach('decoded-pendo.json', { body: JSON.stringify({ scriptSha256: pendoAudit.scriptSha256, version: await page.evaluate(() => ((window as unknown as { pendo: TestPendo }).pendo).VERSION), decoded }, null, 2), contentType: 'application/json' });
    await testInfo.attach('attribute-inventory.json', { body: JSON.stringify(inventories, null, 2), contentType: 'application/json' });
    const events = collectedEvents(decoded);
    const automatic = ['identify', 'meta', 'load', 'click', 'focus', 'submit', 'change'];
    const application = ['sample_start', 'file_received', 'input_rejected', 'parse_complete', 'shape_presented', 'export_dispatched', 'export_failed'];
    for (const event of events) {
      if (event.type === 'track') expect(application).toContain(event.track_event_name);
      else expect(automatic).toContain(event.type);
    }
    const custom = [...new Map(events.filter(event => event.type === 'track').map(event => [event.sequence, event])).values()]
      .sort((a, b) => a.sequence - b.sequence).map(event => ({ name: event.track_event_name, properties: event.props }));
    expect(custom).toEqual(await trackedEvents(page));
    await testInfo.attach('pendo-event-names.json', { body: JSON.stringify({ automatic: [...new Set(events.filter(event => event.type !== 'track').map(event => event.type))], application: [...new Set(custom.map(event => event.name))] }, null, 2), contentType: 'application/json' });
    const serialized = JSON.stringify(decoded);
    for (const secret of forbidden) expect(serialized, secret).not.toContain(secret);
    await testInfo.attach('privacy-check.json', { body: JSON.stringify({ checkedStrings: forbidden, matches: forbidden.filter(secret => serialized.includes(secret)), requestCount: decoded.length, eventCount: events.length }, null, 2), contentType: 'application/json' });
  });
});
