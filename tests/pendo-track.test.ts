// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { track } from '../src/track';

const call = track as (name: unknown, properties: unknown) => void;
const valid = [
  ['sample_start', { kind: 'demo_retry' }],
  ['file_received', { method: 'picker' }],
  ['input_rejected', { reason: 'too_large' }],
  ['parse_complete', { kind: 'user_file', outcome: 'valid', has_timed_rows: true }],
  ['shape_presented', { kind: 'user_file' }],
  ['export_dispatched', { kind: 'demo_normal' }],
  ['export_failed', { reason: 'png_failed' }],
] as const;
afterEach(() => { delete window.pendo; });

it.each(valid)('%s の固定の札だけを新しい object で渡す', (name, properties) => {
  const send = vi.fn();
  window.pendo = { initialize: vi.fn(), track: send };
  call(name, properties);
  expect(send).toHaveBeenCalledExactlyOnceWith(name, properties);
  expect(send.mock.calls[0][1]).not.toBe(properties);
});

it.each(valid)('%s の未知属性・値・欠落は事象全体を送らない', (name, properties) => {
  const send = vi.fn();
  window.pendo = { initialize: vi.fn(), track: send };
  call(name, { ...properties, filename: '〔目印ファイル名〕' });
  for (const key of Object.keys(properties)) {
    for (const invalid of ['〔目印本文〕', 123, null, {}, [], 'true', undefined]) {
      call(name, { ...properties, [key]: invalid });
    }
    const missing = { ...properties } as Record<string, unknown>;
    delete missing[key];
    call(name, missing);
  }
  expect(send).not.toHaveBeenCalled();
});

it('表にない名前・不正な properties・継承値・getter を通さない', () => {
  const send = vi.fn();
  window.pendo = { initialize: vi.fn(), track: send };
  for (const name of ['〔目印事象名〕', 'constructor', '__proto__', 'toString', null, 1]) call(name, { kind: 'demo_normal' });
  for (const props of [null, undefined, 'demo_normal', [], Object.create({ kind: 'demo_normal' }), { get kind() { throw Error('getter'); } }]) {
    expect(() => call('sample_start', props)).not.toThrow();
  }
  call('sample_start', { kind: 'user_file' });
  call('sample_start', { kind: 'demo_normal', [Symbol('secret')]: '〔目印〕' });
  expect(send).not.toHaveBeenCalled();
});

it('Pendo や track がなくても既存の CustomEvent をそのまま出す', () => {
  const listener = vi.fn();
  window.addEventListener('session-shape:track', listener);
  try {
    for (const agent of [undefined, { initialize: vi.fn() }]) {
      window.pendo = agent;
      expect(() => call('sample_start', { kind: 'demo_normal' })).not.toThrow();
    }
    // The local contract remains unchanged even for an invalid outbound event.
    call('unknown', { secret: 'local only' });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[2][0].detail).toEqual({ name: 'unknown', properties: { secret: 'local only' } });
  } finally {
    window.removeEventListener('session-shape:track', listener);
  }
});

it('ローカルの購読者が元の object を変えても検査済みの札だけを送る', () => {
  const send = vi.fn();
  window.pendo = { initialize: vi.fn(), track: send };
  const listener = (event: Event) => { (event as CustomEvent).detail.properties.kind = '〔目印〕'; };
  window.addEventListener('session-shape:track', listener);
  try {
    call('sample_start', { kind: 'demo_normal' });
    expect(send).toHaveBeenCalledExactlyOnceWith('sample_start', { kind: 'demo_normal' });
  } finally {
    window.removeEventListener('session-shape:track', listener);
  }
});

it('表の残りの札と真偽値も通す', () => {
  const send = vi.fn();
  window.pendo = { initialize: vi.fn(), track: send };
  const events = [
    ...['demo_normal', 'demo_retry'].map(kind => ['sample_start', { kind }]),
    ...['picker', 'drop'].map(method => ['file_received', { method }]),
    ...['too_large', 'multiple', 'empty', 'busy'].map(reason => ['input_rejected', { reason }]),
    ...['demo_normal', 'demo_retry', 'user_file'].flatMap(kind => [
      ['shape_presented', { kind }], ['export_dispatched', { kind }],
      ...['valid', 'partial_invalid', 'no_assistant'].flatMap(outcome => [true, false].map(has_timed_rows => ['parse_complete', { kind, outcome, has_timed_rows }])),
    ]),
    ['export_failed', { reason: 'png_failed' }],
  ];
  for (const [name, properties] of events) call(name, properties);
  expect(send.mock.calls).toEqual(events);
});
