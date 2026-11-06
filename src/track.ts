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

type PendoAgent = { track(name: string, properties: Record<string, string | boolean>): void };
declare global { interface Window { pendo?: PendoAgent } }

// Events forwarded to Pendo Track Events, under the exact names registered in Pendo.
const PENDO_EVENTS: ReadonlySet<keyof TrackEvents> = new Set<keyof TrackEvents>([
  'file_received', 'input_rejected', 'parse_complete', 'shape_presented', 'export_dispatched', 'export_failed',
]);

// Local integration point only. Never pass files, summaries, or exceptions here.
export function track<N extends keyof TrackEvents>(name: N, properties: TrackEvents[N]): void {
  window.dispatchEvent(new CustomEvent('session-shape:track', { detail: { name, properties } }));
  // Forward the same fixed labels to Pendo when the agent is loaded; tracking must never break the app.
  if (!PENDO_EVENTS.has(name)) return;
  try { window.pendo?.track(name, { ...properties }); } catch { /* ignore tracking failures */ }
}
