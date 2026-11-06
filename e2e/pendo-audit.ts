import type { Page, Request } from '@playwright/test';
import { inflateSync } from 'node:zlib';

// Deliberately literal: a CSP expansion requires a review of this test too.
export const productionCsp = "default-src 'none'; script-src 'self' 'sha256-s4IOMExjQlTDuS8fQ+OpazXycLBFAtZARDOp2ilBAe4=' https://cdn.pendo.io https://app.pendo.io https://data.pendo.io https://pendo-io-static.storage.googleapis.com; style-src 'self' 'unsafe-inline' https://cdn.pendo.io https://app.pendo.io; img-src 'self' blob: data: https://cdn.pendo.io https://app.pendo.io https://data.pendo.io; font-src 'self'; connect-src https://app.pendo.io https://data.pendo.io; frame-src https://app.pendo.io; object-src 'none'; base-uri 'none'; form-action 'none'";
export const pendoOrigins = new Set(productionCsp.match(/https:\/\/[^ ;]+/g));
export const agentUrl = 'https://cdn.pendo.io/agent/static/b903458e-c62a-427f-914a-200f8171447f/pendo.js';
export type CapturedRequest = { url: string; method: string; body: Buffer | null; contentType: string };
export type PendoAudit = { requests: CapturedRequest[]; cdnUnavailable?: string; scriptSha256?: string };
export type TestPendo = {
  calls: { name: string; properties: Record<string, unknown> }[];
  options: unknown[];
  VERSION?: string;
  isReady?: () => boolean;
  flushNow?: (options?: { hidden?: boolean; unload?: boolean }) => void;
};
export const fakeAgent = `(() => {
  const queue = window.pendo._q;
  const agent = window.pendo = { calls: [], options: [],
    initialize(options) { this.options.push(options); },
    track(name, properties) { this.calls.push({ name, properties }); }
  };
  for (const [method, ...args] of queue) agent[method]?.(...args);
})();`;

export function staticRequest(request: Request, baseURL: string): boolean {
  const url = new URL(request.url());
  const origin = new URL(baseURL).origin;
  if (url.protocol === 'blob:' && url.origin === origin && request.resourceType() === 'image') return true;
  const document = request.resourceType() === 'document' && url.href === baseURL;
  const asset = ['script', 'stylesheet', 'image', 'font'].includes(request.resourceType())
    && url.pathname.startsWith('/session-shape/assets/');
  return url.origin === origin && request.method() === 'GET' && (document || asset);
}

// SDK 2.348.0 compress(): JSON -> UTF-8 -> Zlib.Deflate -> base64url.
// Source: https://cdn.pendo.io/agent/static/b903458e-c62a-427f-914a-200f8171447f/pendo.js
// Unknown/broken encodings throw: a partially inspected payload must not pass.
export function decodeCompressed(value: string): unknown {
  if (!/^[A-Za-z0-9_+/=-]+$/.test(value)) throw new Error('Unsupported Pendo base64 payload');
  return JSON.parse(inflateSync(Buffer.from(value, 'base64url')).toString('utf8'));
}
function decodeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
    (key === 'jzb' || key === 'events') && typeof value === 'string' ? decodeCompressed(value) : value,
  ]));
}
export function decodeRequest(request: CapturedRequest) {
  const url = new URL(request.url);
  const query = [...url.searchParams].map(([key, value]) => ({ key,
    value: key === 'jzb' || key === 'events' ? decodeCompressed(value) : value,
  }));
  let body: unknown = null;
  if (request.body?.length) {
    const text = request.body.toString('utf8');
    if (text.startsWith('{') || text.startsWith('[')) {
      const json: unknown = JSON.parse(text);
      body = json && !Array.isArray(json) && typeof json === 'object' ? decodeFields(json as Record<string, unknown>) : json;
    } else if (request.contentType.includes('application/x-www-form-urlencoded')) {
      body = [...new URLSearchParams(text)].map(([key, value]) => ({ key, value: decodeFields({ [key]: value })[key] }));
    } else {
      body = JSON.parse(inflateSync(request.body).toString('utf8'));
    }
  }
  return { endpoint: `${url.origin}${url.pathname}`, method: request.method, query, body };
}

// Every actionable node, its descendants (actual click targets), and all parents.
// Include chart/summary targets explicitly because Pendo also captures clicks there.
export async function attributeInventory(page: Page) {
  return page.evaluate(() => {
    const targets = [...document.querySelectorAll('button, a, input, summary, [role="button"], [tabindex], .chart *, .stats *, .model-details *')];
    const nodes = new Set<Element>();
    for (const target of targets) {
      nodes.add(target);
      target.querySelectorAll('*').forEach(child => nodes.add(child));
      for (let parent = target.parentElement; parent; parent = parent.parentElement) nodes.add(parent);
    }
    return [...nodes].map(node => ({
      tag: node.tagName.toLowerCase(),
      attributes: Object.fromEntries([...node.attributes]
        .filter(attr => ['aria-label', 'title', 'id', 'class'].includes(attr.name) || attr.name.startsWith('data-'))
        .map(attr => [attr.name, attr.value])),
    }));
  });
}

export type PendoEvent = { type: string; sequence: number; browser_time: number; track_event_name?: string; props: Record<string, unknown> };
export function collectedEvents(value: unknown): PendoEvent[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectedEvents);
  const object = value as Record<string, unknown>;
  if (typeof object.type === 'string' && typeof object.browser_time === 'number') return [object as PendoEvent];
  return Object.values(object).flatMap(collectedEvents);
}
