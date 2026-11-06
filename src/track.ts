export type InputKind = 'demo_normal' | 'demo_retry' | 'user_file';
export type InputMethod = 'picker' | 'drop';
export type TrackEvents = {
  sample_start: { kind: Exclude<InputKind, 'user_file'> };
  file_received: { method: InputMethod };
  input_rejected: { reason: 'too_large' | 'multiple' | 'empty' | 'busy' };
  parse_complete: { kind: InputKind; outcome: 'valid' | 'partial_invalid' | 'no_assistant'; has_timed_rows: boolean };
  shape_presented: { kind: InputKind };
  export_dispatched: { kind: InputKind };
  export_failed: { reason: 'png_failed' };
};

// Runtime boundary: TypeScript types alone cannot protect outbound data.
// Keep this exact allowlist aligned with the seven-event table in HYPOTHESIS.md.
const kinds = ['demo_normal', 'demo_retry', 'user_file'];
const allowed: Record<string, Record<string, readonly (string | boolean)[]>> = {
  sample_start: { kind: ['demo_normal', 'demo_retry'] },
  file_received: { method: ['picker', 'drop'] },
  input_rejected: { reason: ['too_large', 'multiple', 'empty', 'busy'] },
  parse_complete: { kind: kinds, outcome: ['valid', 'partial_invalid', 'no_assistant'], has_timed_rows: [true, false] },
  shape_presented: { kind: kinds },
  export_dispatched: { kind: kinds },
  export_failed: { reason: ['png_failed'] },
};

function outbound(name: unknown, properties: unknown): Record<string, string | boolean> | undefined {
  if (typeof name !== 'string' || !Object.hasOwn(allowed, name)
    || !properties || typeof properties !== 'object' || Array.isArray(properties)) return;
  const schema = allowed[name];
  const descriptors = Object.getOwnPropertyDescriptors(properties);
  if (Reflect.ownKeys(properties).length !== Object.keys(schema).length) return;
  const result: Record<string, string | boolean> = {};
  for (const [key, values] of Object.entries(schema)) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !values.includes(descriptor.value)) return;
    result[key] = descriptor.value;
  }
  return result;
}

export function track<N extends keyof TrackEvents>(name: N, properties: TrackEvents[N]): void {
  const checked = outbound(name, properties);
  window.dispatchEvent(new CustomEvent('session-shape:track', { detail: { name, properties } }));
  if (checked && typeof window.pendo?.track === 'function') window.pendo.track(name, checked);
}
