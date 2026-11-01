import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Summary } from './parser';
export const colors = ['#244cd6'];
export function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)}時間 ${Math.floor(seconds / 60) % 60}分 ${seconds % 60}秒`;
}
export const Timeline = forwardRef<SVGSVGElement, { summary: Summary }>(function Timeline({ summary: s }, ref) {
  const localSvg = useRef<SVGSVGElement>(null);
  const [availableWidth, setAvailableWidth] = useState(1120);
  useImperativeHandle(ref, () => localSvg.current!, []);
  useEffect(() => {
    const parent = localSvg.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.floor(entry.contentRect.width)));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  // Keep text and markers at their actual CSS size, including in the PNG.
  // Extra-long axes use only the chart's horizontal scroll region.
  const compact = availableWidth < 600;
  const labelWidth = Math.max(0, ...s.tools.map(tool => [...tool.name].reduce((width, char) => width + (char.charCodeAt(0) > 127 ? (compact ? 14 : 16) : (compact ? 9.5 : 10.5)), 0)));
  const left = Math.max(compact ? 54 : 120, labelWidth + 12);
  const axisLabelWidth = `${Math.round(s.durationMs / 1000)}秒`.length * 9;
  const width = Math.max(320, availableWidth, left + axisLabelWidth * (compact ? 3 : 5) + 32);
  const right = Math.max(28, axisLabelWidth / 2 + 8);
  const span = width - left - right, bins = 160;
  const laneHeight = 32;
  const top = compact ? 76 : 64;
  const bottom = top + Math.max(s.tools.length, 2) * laneHeight;
  const height = bottom + (compact ? 36 : 16);
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
  return <svg ref={localSvg} xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="人の発言と道具の呼び出しの時間の帯" style={{ fontFamily: '"Noto Sans JP", system-ui, "Noto Sans CJK JP", sans-serif' }}>
    <title>Session Shape · {duration(s.durationMs)} · 道具 {s.toolCalls}回 · エラー {s.toolErrors}回</title>
    <desc>丸は呼び出し、× はエラー、縦点線は人の発言。横軸は開始からの秒数。近い点はまとめて表示し、数が多いほど点を大きくします。帯は実行時間ではありません。</desc>
    <rect width={width} height={height} rx="6" fill="#ffffff" />
    <text x="0" y="22" fontSize={compact ? 18 : 22} fontWeight="700" fill="#14243d">時間の帯</text>
    <g transform={`translate(${compact ? 0 : width - 286}, ${compact ? 46 : 16})`} fontSize="14" fill="#14243d">
      <circle cx="5" cy="-4" r="4" fill="#244cd6" /><text x="18">呼び出し</text>
      <path d="M 106 -9 l 10 10 m 0 -10 l -10 10" stroke="#c13030" strokeWidth="2.5" /><text x="124">エラー</text>
      <line x1="197" x2="197" y1="-14" y2="4" stroke="#7587a4" strokeDasharray="4 4" /><text x="209">人の発言</text>
    </g>
    {Array.from({ length: compact ? 3 : 5 }, (_, i) => {
      const fraction = i / (compact ? 2 : 4);
      return <g key={i}>
        <line x1={left + span * fraction} x2={left + span * fraction} y1={top} y2={bottom} stroke="#e1e7f0" />
        <text x={left + span * fraction} y={compact ? bottom + 22 : top - 14} textAnchor="middle" fontSize="14" fill="#526079">{Math.round(s.durationMs / 1000 * fraction)}秒</text>
      </g>;
    })}
    <line x1={left} x2={left + span} y1={compact ? bottom : top} y2={compact ? bottom : top} stroke="#7587a4" />
    {[...humans].map(bin => <line key={bin} x1={x(bin)} x2={x(bin)} y1={top} y2={bottom} stroke="#7587a4" strokeDasharray="4 4" />)}
    {s.tools.map((tool, i) => <g key={tool.name}><text x="0" y={top + (i + .5) * laneHeight + 5} fill="#14243d" fontSize={compact ? 14 : 16} fontWeight="700">{tool.name}</text><line x1={left} x2={left + span} y1={top + (i + 1) * laneHeight} y2={top + (i + 1) * laneHeight} stroke="#e1e7f0" /></g>)}
    {[...calls].map(([key, call]) => <g key={key}>
      {call.error ? <path d={`M ${x(call.bin) - 5} ${top + (call.lane + .5) * laneHeight - 5} l 10 10 m 0 -10 l -10 10`} stroke="#c13030" strokeWidth="2.5" /> : <circle cx={x(call.bin)} cy={top + (call.lane + .5) * laneHeight} r={Math.min(8, 4 + Math.log2(call.count))} fill={colors[call.lane % colors.length]} />}
      <title>{s.tools[call.lane]?.name} · {call.count}回{call.error ? ' · エラー' : ''}</title>
    </g>)}
    {[...rows].map(bin => <line key={bin} x1={x(bin)} x2={x(bin)} y1={bottom - 2} y2={bottom + 2} stroke="#7587a4" />)}
    {!s.events.length && <text x={left} y={top + 36} fontSize="14" fill="#526079">時刻のある行がありません</text>}
    {!!s.events.length && !s.tools.length && <text x={left} y={top + 36} fontSize="14" fill="#526079">道具の呼び出しはありません</text>}
  </svg>;
});
