import type { Summary } from './parser';
import { colors, duration, markerColors } from './Timeline';

type ExportTotals = Pick<Summary, 'durationMs' | 'toolCalls' | 'toolErrors'>;
const namespace = 'http://www.w3.org/2000/svg';

// Only pass the safe SVG rendered by Timeline. Work on a detached copy so the
// displayed chart (including its selection) remains unchanged.
export function serializeExportSvg(svg: SVGSVGElement, totals: ExportTotals) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  // Normalize React's xmlns attribute before XML serialization.
  copy.removeAttribute('xmlns');
  copy.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', namespace);
  const chartWidth = Number(svg.getAttribute('width'));
  const chartHeight = Number(svg.getAttribute('height'));
  const compact = chartWidth < 760;
  const inset = 16;
  const width = chartWidth + inset * 2;
  const parts = [duration(totals.durationMs), `道具 ${totals.toolCalls}回`, `エラー ${totals.toolErrors}回`];
  // Conservative glyph widths for the local 14px font. Wrap at separators for
  // long sessions/counts as well as compact charts, without shrinking the text.
  const textWidth = (value: string) => [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 14 : 8), 0);
  const available = chartWidth - (compact ? inset * 2 : 200) - 16;
  const lines: string[] = [];
  for (const part of parts) {
    const last = lines.length - 1;
    if (last >= 0 && textWidth(`${lines[last]} · ${part}`) <= available) lines[last] += ` · ${part}`;
    else {
      if (last >= 0) lines[last] += ' ·';
      lines.push(part);
    }
  }
  const headerHeight = (compact ? 80 : 56) + (lines.length - 1) * 24;
  const footerHeight = compact ? 72 : 40;
  const height = headerHeight + chartHeight + footerHeight;
  const chart = document.createElementNS(namespace, 'g');
  chart.setAttribute('transform', `translate(${inset} ${headerHeight})`);
  chart.append(...copy.childNodes);
  copy.append(chart);
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  copy.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const background = document.createElementNS(namespace, 'rect');
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));
  background.setAttribute('fill', '#ffffff');
  copy.prepend(background);
  function text(value: string, x: number, y: number, bold = false, right = false) {
    const node = document.createElementNS(namespace, 'text');
    node.textContent = value;
    node.setAttribute('x', String(x)); node.setAttribute('y', String(y));
    node.setAttribute('font-size', bold ? '18' : '14');
    node.setAttribute('font-weight', bold ? '700' : '400');
    node.setAttribute('text-anchor', right ? 'end' : 'start');
    node.setAttribute('fill', '#172033');
    copy.append(node);
    return node;
  }
  text('Session Shape', inset, 32, true);
  lines.forEach((line, index) => text(line, width - inset, (compact ? 56 : 32) + index * 24, false, true));
  const selected = copy.querySelector('[data-selection-band="true"]') !== null;
  const footerY = headerHeight + chartHeight + 26;
  const legend = text('', inset, footerY);
  function legendItem(parent: SVGTextElement, mark: string, label: string, fill: string, outlined = false) {
    const symbol = document.createElementNS(namespace, 'tspan');
    symbol.textContent = mark;
    symbol.setAttribute('fill', fill);
    if (outlined) {
      symbol.setAttribute('stroke', markerColors.human);
      symbol.setAttribute('stroke-width', '0.6');
      symbol.setAttribute('paint-order', 'stroke fill');
    }
    parent.append(symbol, document.createTextNode(` ${label}`));
  }
  legendItem(legend, '●', '道具　', colors[0]);
  legendItem(legend, '×', 'エラー　', markerColors.error);
  legendItem(legend, '┆', '人の発言', markerColors.human);
  if (selected) {
    const row = compact ? text('', inset, footerY + 24) : legend;
    if (!compact) row.append(document.createTextNode('　'));
    legendItem(row, '▮', '選んだつまずき', markerColors.selection, true);
  }
  return { source: new XMLSerializer().serializeToString(copy), width, height };
}

export async function exportPng(svg: SVGSVGElement, totals: ExportTotals): Promise<void> {
  const exported = serializeExportSvg(svg, totals);
  const source = new Blob([exported.source], { type: 'image/svg+xml;charset=utf-8' });
  const sourceUrl = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('PNG_FAILED')); image.src = sourceUrl; });
    const canvas = document.createElement('canvas');
    canvas.width = exported.width * 2;
    canvas.height = exported.height * 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG_FAILED');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG_FAILED')), 'image/png'));
    const url = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = url; link.download = 'session-shape.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally { URL.revokeObjectURL(sourceUrl); }
}
