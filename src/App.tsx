import { useEffect, useRef, useState } from 'react';
import { checkFileSize, parseFile, type Summary } from './parser';
import { Timeline } from './Timeline';
import { exportPng } from './export';
import { track, type InputKind, type InputMethod } from './track';
import demo1 from './samples/demo-1.jsonl?raw';
import demo2 from './samples/demo-2.jsonl?raw';

type InputSource = { kind: Exclude<InputKind, 'user_file'> } | { kind: 'user_file'; method: InputMethod };

export function Results({ summary: s, kind }: { summary: Summary; kind: InputKind }) {
  const svg = useRef<SVGSVGElement>(null);
  const chart = useRef<HTMLDivElement>(null);
  const presented = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!chart.current || typeof IntersectionObserver === 'undefined') return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active || presented.current || !entries.some(entry => entry.target === chart.current && entry.isIntersecting && entry.intersectionRatio >= 0.01)) return;
      presented.current = true;
      track('shape_presented', { kind });
      observer.disconnect();
    }, { threshold: 0.01 });
    observer.observe(chart.current);
    return () => { active = false; observer.disconnect(); };
  }, [kind]);
  const seconds = Math.floor(s.durationMs / 1000);
  const time = [[Math.floor(seconds / 3600), '時間'], [Math.floor(seconds / 60) % 60, '分'], [seconds % 60, '秒']] as const;
  const stats = [
    ['人の発言', s.humanMessages, '回', ''], ['AI の応答', s.assistantMessages, '回', ''],
    ['道具の呼び出し', s.toolCalls, '回', ''], ['道具のエラー', s.toolErrors, '回', 'error-value'],
    ['直後のやり直し', s.retries, '回', 'retry-value'], ['サブエージェントの行', s.sidechainRows, '行', ''],
  ] as const;
  return <section className="results" data-feature="view-shape" aria-labelledby="results-title">
    <div className="read-result">
      <div className="result-state">
        <span className={`status ${s.success ? '' : 'warning'}`} role="status">{s.success ? '読み込み成功' : '読み込みを確認してください'}</span>
        <p className="source-label">{kind === 'demo_retry' ? '見本 2・架空の数値' : kind === 'demo_normal' ? '見本 1・架空の数値' : '選んだ記録の集計'}</p>
      </div>
      <p className="read-counts"><span>読んだ行 <strong>{s.rows}</strong></span><span className="count-separator" aria-hidden="true"> ・ </span><span>図にした行 <strong>{s.chartedRows}</strong></span><span className="count-separator" aria-hidden="true"> ・ </span><span>読めない行 <strong>{s.invalidRows}</strong></span></p>
      {!s.success && <p className="notice">{s.invalidRows > 0 ? '壊れた JSON の行を飛ばして集計しました。' : 'AI の応答の行がありません。'} 読めない行が 0 で、AI の応答が 1 行以上あれば成功です。</p>}
    </div>
    <div className="stats-panel">
      <h2 id="results-title">セッションの概要</h2>
      <dl className="stats">
        <div><dt>会話の長さ</dt><dd className={seconds >= 3600 ? 'long-duration' : ''}>{time.filter(([value, unit]) => value > 0 || (seconds === 0 && unit === '秒')).map(([value, unit], index) => <span key={unit}>{index > 0 && ' '}<Quantity value={value} unit={unit} /></span>)}</dd></div>
        {stats.map(([label, value, unit, color]) => <div key={label}><dt>{label}</dt><dd className={color}><Quantity value={value} unit={unit} /></dd></div>)}
      </dl>
    </div>
    <div className="details">
      <div className="models"><h3>使ったモデル</h3><p>{s.models.length ? s.models.join(' / ') : '記録なし'}</p></div>
      <div className="usage"><h3>トークンの使用量</h3><dl className="tokens">{([
        ['入力', s.usage.input_tokens], ['出力', s.usage.output_tokens], ['キャッシュの読み', s.usage.cache_read_input_tokens], ['キャッシュの作成', s.usage.cache_creation_input_tokens],
      ] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd className={count >= 1_000_000_000 ? 'long-count' : ''}><Quantity value={count} /></dd></div>)}</dl></div>
    </div>
    <section className="timeline-panel" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="sr-only">時間の帯</h2>
      <div className="chart" ref={chart} tabIndex={0} aria-label="時間の帯。幅が足りない場合は横にスクロールできます"><Timeline ref={svg} summary={s} /></div>
    </section>
    <section className="share" data-feature="export-png" aria-label="図の書き出し"><button disabled={exporting} onClick={async () => {
      if (!svg.current) return;
      setExporting(true); setNotice('');
      try { await exportPng(svg.current); track('export_dispatched', { kind }); setNotice('PNG を書き出しました。'); }
      catch { track('export_failed', { reason: 'png_failed' }); setNotice('PNG を書き出せませんでした。もう一度お試しください。'); }
      finally { setExporting(false); }
    }}>{exporting ? 'PNG を作成中…' : '図を PNG で書き出す'}<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m-5-5 5 5 5-5M3 15v6h18v-6" /></svg></button><p role="status">{notice}</p></section>
    <div className="explanation">
      <details><summary>図の読み方と数え方</summary><p>その他の行 {s.otherRows} ・ 時刻がない会話の行 {s.untimedRows}</p><p>横軸は開始からの秒数。帯は道具の実行時間ではありません。丸は呼び出し、× はエラー、縦点線は人の発言、軸上の短い線は記録の行です。近い点はまとめ、呼び出しの数が多いほど点を大きくしています。やり直しは行順で判定し、時間上で隣り合う点からは判断しません。</p><ul className="tool-list" aria-label="道具ごとの呼び出し数">{s.tools.map(tool => <li key={tool.name}>{tool.name} <strong>{tool.count}</strong></li>)}</ul><p>空行は除外します。図にした行は時刻がある user / assistant の行です。その他の type は数だけ集計します。会話の長さは全行の有効な時刻の最小と最大の差です。</p><p>エラーを返した呼び出しは道具の ID で特定し、その後の最初の道具の呼び出しと道具の名前で比べます。同じ名前ならやり直しとして、記録の行順で数えます。</p><p>AI の応答は assistant の message.id ごとに 1 回、usage は同じ message.id の最初の行だけを加算します。ID がない行は行ごとに数えます（空文字や文字列以外の ID も含みます）。最初の行に usage がなくても後続行で補完しません。道具の呼び出しは分割された行でも塊ごとに数えます。</p><p>本文の混入を防ぐため、未確認の道具名・モデル名は「その他」に置き換えます。時刻がない行の数値も集計します。</p></details>
    </div>
  </section>;
}

// Break only between digit groups; keep the final group beside its unit.
function Quantity({ value, unit }: { value: number; unit?: string }) {
  const groups = value.toLocaleString('ja-JP').split(',');
  return <span className="quantity">{groups.map((group, index) => index === groups.length - 1
    ? <span className="quantity-tail" key={index}>{group}{unit && <span className="unit">{unit}</span>}</span>
    : <span key={index}>{group},<wbr /></span>)}</span>;
}

function Legend() {
  return <ul className="legend" aria-label="図の凡例"><li><i className="call-symbol" aria-hidden="true" />呼び出し</li><li><i className="error-symbol" aria-hidden="true" />エラー</li><li><i className="human-symbol" aria-hidden="true" />人の発言</li></ul>;
}

function FileIcon() {
  return <svg aria-hidden="true" viewBox="0 0 48 56" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 2h24l12 13v37H6zM30 2v14h12" /></svg>;
}

function EmptyTimeline() {
  return <section className="empty-state" aria-labelledby="empty-title"><div className="section-heading"><h2 id="empty-title">時間の帯</h2><Legend /></div><div className="empty-chart"><div className="empty-lanes">{['Read', 'Edit', 'Bash', 'Grep'].map(name => <div key={name}>{name}</div>)}</div><p>読み込むと、ここに作業の形が現れます。</p></div><p className="empty-axis">開始からの秒数</p></section>;
}

export default function App() {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const loadId = useRef(0);
  const [result, setResult] = useState<{ summary: Summary; kind: InputKind; id: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showImport, setShowImport] = useState(false);
  async function load(files: readonly Blob[], source: InputSource) {
    if (source.kind === 'user_file' && files.length > 0) track('file_received', { method: source.method });
    if (busy.current) { track('input_rejected', { reason: 'busy' }); return; }
    if (files.length !== 1) {
      track('input_rejected', { reason: files.length > 1 ? 'multiple' : 'empty' });
      setError('会話のファイルを 1 つずつ選んでください。'); return;
    }
    const file = files[0];
    setError(''); setResult(null);
    if (!checkFileSize(file.size)) { track('input_rejected', { reason: 'too_large' }); setError('50MB を超えるファイルは読み込めません。50MB 以下の会話の記録を選んでください。'); return; }
    busy.current = true; setLoading(true); setProgress(0);
    try {
      const summary = await parseFile(file, setProgress);
      track('parse_complete', {
        kind: source.kind,
        outcome: summary.invalidRows > 0 ? 'partial_invalid' : summary.assistantMessages > 0 ? 'valid' : 'no_assistant',
        has_timed_rows: summary.chartedRows > 0,
      });
      setResult({ summary, kind: source.kind, id: ++loadId.current });
    }
    catch { setError('ファイルを読み込めませんでした。会話の JSONL ファイルを選び直してください。'); }
    finally { busy.current = false; setLoading(false); }
  }
  return <div className={`shell ${result ? 'loaded' : 'initial'}`}>
    <header><a className="brand" href="#top" aria-label="Session Shape の先頭へ">Session Shape</a><p className="tagline">Claude Code の記録を、数と時間の帯に。</p><p className="header-privacy">処理はブラウザの中だけ。ファイルは送信しません。本文は表示しません。</p></header>
    <main id="top">
    {!result && <section className="intro"><h1>会話の中身は、そのままに。<br className="mobile-break" /> 作業の流れを、ひと目で。</h1></section>}
    <section className={`dropzone ${dragging ? 'dragging' : ''} ${showImport ? 'expanded' : ''}`} data-feature="import-session" aria-labelledby="import-title" aria-busy={loading}
      onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); void load(Array.from(event.dataTransfer.files), { kind: 'user_file', method: 'drop' }); }}>
      {result && <button className="mobile-import-toggle secondary" aria-expanded={showImport} aria-controls="import-body" onClick={() => setShowImport(!showImport)}>別の記録を読み込む<span aria-hidden="true">{showImport ? '−' : '＋'}</span></button>}
      <div className="import-body" id="import-body">
      <h2 id="import-title">データの読み込み</h2>
      <div className="drop-prompt"><div className="drop-icon"><FileIcon /></div><h3>会話の JSONL を、ここに</h3><p>1 回に 1 つの会話 · 50MB まで</p></div>
      <input ref={input} className="file-input" type="file" accept=".jsonl,application/json,application/x-ndjson" aria-label="会話の JSONL ファイル" tabIndex={-1} onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = ''; // Clear filename before any state update / asynchronous work.
        if (files.length) void load(files, { kind: 'user_file', method: 'picker' });
      }} />
      <div className="import-actions"><button disabled={loading} onClick={() => input.current?.click()}>ファイルを選ぶ</button>
      <button className="secondary" disabled={loading} onClick={() => { track('sample_start', { kind: 'demo_normal' }); void load([new Blob([demo1])], { kind: 'demo_normal' }); }}>見本で試す</button><button className="secondary retry-demo" disabled={loading} onClick={() => { track('sample_start', { kind: 'demo_retry' }); void load([new Blob([demo2])], { kind: 'demo_retry' }); }}>エラーとやり直しの見本</button></div>
      <p className="privacy">処理はブラウザの中だけ。ファイルは送信しません。本文は表示しません。</p>
      {loading && <p role="status">読み込み中… {progress}%</p>}
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
    </section>
    {result ? <Results key={result.id} summary={result.summary} kind={result.kind} /> : <EmptyTimeline />}
    </main><footer><span>Session Shape</span><span>作者 新宅えら · MIT License</span><span>記録はこのページを閉じると破棄されます。</span></footer>
  </div>;
}
