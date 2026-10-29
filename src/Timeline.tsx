import { forwardRef } from 'react';
import type { Summary } from './parser';
export const colors = ['#2c6b63', '#c8663a', '#6a63a6', '#a38324', '#477d9c', '#ad5779'];
export function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)}時間 ${Math.floor(seconds / 60) % 60}分 ${seconds % 60}秒`;
}
export const Timeline = forwardRef<SVGSVGElement, { summary: Summary }>(function Timeline({ summary: s }, ref) {
  const width = 1120, left = 156, span = 916, bins = 160;
  const height = Math.max(300, 180 + s.tools.length * 44);
  const point = (at: number) => Math.round((at - (s.start ?? at)) / Math.max(s.durationMs, 1) * bins);
  const calls = new Map<string, { bin: number; lane: number; count: number; error: boolean }>();
  const humans = new Set<number>(), rows = new Set<number>();
  const lanes = new Map(s.tools.map((t, i) => [t.name, i]));
  for (const event of s.events) {
    const bin = point(event.at);
    if (event.kind === 'human') humans.add(bin);
    if (event.kind === 'row') rows.add(bin);
    if (event.kind !== 'tool') continue;
    const lane = lanes.get(event.tool ?? '') ?? 0;
    const key = `${lane}:${bin}:${event.error}`;
    const existing = calls.get(key);
    if (existing) existing.count++;
    else calls.set(key, { bin, lane, count: 1, error: event.error });
  }
  const x = (bin: number) => left + bin / bins * span;
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="人の発言と道具の呼び出しの時間の帯" style={{ fontFamily: 'sans-serif' }}>
    <rect width={width} height={height} rx="16" fill="#fffdf7" />
    <text x="28" y="34" fill="#243e39" fontSize="20" fontWeight="700">Session Shape</text>
    <text x="1090" y="34" textAnchor="end" fill="#526760" fontSize="13">{duration(s.durationMs)} · 道具 {s.toolCalls}回 · エラー {s.toolErrors}回</text>
    {Array.from({ length: 5 }, (_, i) => <g key={i}>
      <line x1={left + span * i / 4} x2={left + span * i / 4} y1="65" y2={height - 66} stroke="#e5e8df" />
      <text x={left + span * i / 4} y={height - 43} textAnchor="middle" fontSize="12" fill="#526760">{Math.round(s.durationMs / 1000 * i / 4)}秒</text>
    </g>)}
    <text x="28" y="86" fontSize="13" fill="#526760">人の発言</text>
    {[...humans].map(bin => <g key={bin}><line x1={x(bin)} x2={x(bin)} y1="98" y2={height - 66} stroke="#b8c8b8" strokeDasharray="3 5" /><path d={`M ${x(bin) - 4} 76 L ${x(bin) + 4} 76 L ${x(bin)} 84 Z`} fill="#243e39" /></g>)}
    {s.tools.map((tool, i) => <g key={tool.name}><text x="28" y={125 + i * 44} fill="#243e39" fontSize="13">{tool.name}</text><line x1={left} x2={left + span} y1={120 + i * 44} y2={120 + i * 44} stroke="#edf0e7" /></g>)}
    {[...calls].map(([key, call]) => <g key={key}>
      {call.error ? <path d={`M ${x(call.bin) - 5} ${115 + call.lane * 44} l 10 10 m 0 -10 l -10 10`} stroke="#b33f37" strokeWidth="3" /> : <circle cx={x(call.bin)} cy={120 + call.lane * 44} r={Math.min(8, 4 + Math.log2(call.count))} fill={colors[call.lane % colors.length]} />}
      <title>{s.tools[call.lane]?.name} · {call.count}回{call.error ? ' · エラー' : ''}</title>
    </g>)}
    {[...rows].map(bin => <line key={bin} x1={x(bin)} x2={x(bin)} y1={height - 69} y2={height - 65} stroke="#8f9e94" />)}
    {!s.events.length && <text x="560" y="155" textAnchor="middle" fontSize="16" fill="#526760">時刻のある行がありません</text>}
    <text x="28" y={height - 15} fill="#526760" fontSize="12">▼ 人の発言　● 道具　× エラー　｜ 記録の行　・近い点はまとめて表示</text>
  </svg>;
});
