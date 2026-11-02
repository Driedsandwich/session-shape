import { forwardRef } from 'react';
import type { Summary, Trouble } from './parser';
export const colors = ['#2F4BA8'];
export function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}時間 ${Math.floor(seconds / 60) % 60}分 ${seconds % 60}秒`;
  return seconds % 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${Math.floor(seconds / 60)}分`;
}
export const Timeline = forwardRef<SVGSVGElement, { summary: Summary; selected?: Trouble; compact?: boolean }>(function Timeline({ summary: s, selected, compact = false }, ref) {
  // Mobile uses its own viewBox so type stays at least 14 CSS px; only the chart may scroll.
  const labelWidth = Math.max(0, ...s.tools.map(t => [...t.name].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 14 : 8), 0) + 8));
  const width = compact ? 360 : 760, left = Math.max(compact ? 92 : 104, labelWidth), span = width - left - 22, bins = 160;
  const top = compact ? 20 : 44, laneHeight = compact ? 28 : 40;
  const bottom = top + Math.max(1, s.tools.length) * laneHeight;
  const height = bottom + (compact ? 44 : 10);
  const point = (at: number) => Math.round((at - (s.start ?? at)) / Math.max(s.durationMs, 1) * bins);
  const calls = new Map<string, { bin: number; lane: number; count: number; error: boolean }>();
  const humans = new Set<number>();
  const lanes = new Map(s.tools.map((t, i) => [t.name, i]));
  for (const event of s.events) {
    const bin = point(event.at);
    if (event.kind === 'human') humans.add(bin);
    if (event.kind !== 'tool') continue;
    const lane = lanes.get(event.tool ?? '') ?? 0;
    const key = `${lane}:${bin}:${event.error}`;
    const existing = calls.get(key);
    if (existing) existing.count++;
    else calls.set(key, { bin, lane, count: 1, error: event.error });
  }
  const x = (bin: number) => left + bin / bins * span;
  const atX = (seconds: number) => left + seconds * 1000 / Math.max(s.durationMs, 1) * span;
  const start = selected?.matched ? selected.failedAt : null;
  const end = selected?.nextCall?.at ?? start;
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="人の発言と道具の呼び出しの時間の帯" style={{ fontFamily: '"Noto Sans CJK JP", system-ui, sans-serif' }}>
    <rect width={width} height={height} fill="#ffffff" />
    {start != null && end != null && <rect data-selection-band="true" x={Math.min(atX(start), atX(end))} y={top - 20} width={Math.max(4, Math.abs(atX(end) - atX(start)))} height={bottom - top + 16} fill="#e9eefc" />}
    {Array.from({ length: 4 }, (_, i) => <g key={i}>
      <line x1={left + span * i / 3} x2={left + span * i / 3} y1={top - 20} y2={bottom - 4} stroke="#dce0e8" />
      <text x={left + span * i / 3} y={compact ? bottom + 18 : 23} textAnchor="middle" fontSize="14" fill="#59647a">{Math.round(s.durationMs / 1000 * i / 3)}{compact ? '' : '秒'}</text>
    </g>)}
    {[...humans].map(bin => <line key={bin} x1={x(bin)} x2={x(bin)} y1={top - 20} y2={bottom - 4} stroke="#9aa7c4" strokeDasharray="3 3" />)}
    {s.tools.map((tool, i) => <g key={tool.name}><text x="0" y={top + 5 + i * laneHeight} fill="#172033" fontSize="14">{tool.name}</text><line x1={left} x2={left + span} y1={top + i * laneHeight} y2={top + i * laneHeight} stroke="#d3d9e3" /></g>)}
    {[...calls].map(([key, call]) => <g key={key}>
      {call.error ? <path d={`M ${x(call.bin) - 4} ${top - 4 + call.lane * laneHeight} l 8 8 m 0 -8 l -8 8`} stroke="#C8402A" strokeWidth="1.6" /> : <circle cx={x(call.bin)} cy={top + call.lane * laneHeight} r={Math.min(8, (compact ? 3.5 : 5) + Math.log2(call.count))} fill={colors[0]} />}
      <title>{s.tools[call.lane]?.name} · {call.count}回{call.error ? ' · エラー' : ''}</title>
    </g>)}
    {!s.events.length && <text x={width / 2} y={top} textAnchor="middle" fontSize="14" fill="#59647a">時刻のある行がありません</text>}
    {compact && <text x={left + span / 2} y={height - 5} textAnchor="middle" fontSize="14" fill="#59647a">経過時間（秒）</text>}
  </svg>;
});
