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

// Local integration point only. Never pass files, summaries, or exceptions here.
export function track<N extends keyof TrackEvents>(name: N, properties: TrackEvents[N]): void {
  window.dispatchEvent(new CustomEvent('session-shape:track', { detail: { name, properties } }));
}
