import { useEffect, useRef, useState, type ReactNode } from 'react';
import { checkFileSize, parseFile, type Summary } from './parser';
import { duration, Timeline } from './Timeline';
import { exportPng } from './export';
import { track, type InputKind, type InputMethod } from './track';
import demo1 from './samples/demo-1.jsonl?raw';
import demo2 from './samples/demo-2.jsonl?raw';

type InputSource = { kind: Exclude<InputKind, 'user_file'> } | { kind: 'user_file'; method: InputMethod };
export const timeLabel = (seconds: number | null) => seconds === null ? '時刻なし' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 760px)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 760px)');
    if (!query) return;
    const update = () => setCompact(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}
function ReadReport({ summary: s }: { summary: Summary }) {
  return <div className="read-report">
    <strong role="status">{s.success ? '読み込み成功' : '読み込みを確認してください'}</strong>
    <dl className="read-counts">
      <div><dt>読んだ行</dt><dd>{s.rows}</dd></div>
      <div><dt>図にした行</dt><dd>{s.chartedRows}</dd></div>
      <div><dt>読めない行</dt><dd>{s.invalidRows}</dd></div>
    </dl>
    {!s.success && <p className="notice">{s.invalidRows > 0 ? '壊れた JSON の行を飛ばして集計しました。' : 'AI の応答の行がありません。'} 読めない行が 0 で、AI の応答が 1 行以上あれば成功です。</p>}
  </div>;
}
function Privacy() { return <p className="privacy">ブラウザ内で処理<br />本文・ファイル名は表示しません</p>; }

export function Results({ summary: s, kind, importPanel }: { summary: Summary; kind: InputKind; importPanel?: ReactNode }) {
  const svg = useRef<SVGSVGElement>(null);
  const chart = useRef<HTMLDivElement>(null);
  const presented = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(0);
  const compact = useCompact();
  const trouble = s.troubles[selected];
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
  const stats = [
    ['会話の長さ', duration(s.durationMs)], ['人の発言', `${s.humanMessages}回`],
    ['AI の応答', `${s.assistantMessages}回`], ['道具の呼び出し', `${s.toolCalls}回`],
    ['道具のエラー', `${s.toolErrors}回`], ['直後のやり直し', `${s.retries}回`],
    ['サブエージェント', `${s.sidechainRows}行`],
  ];
  return <div className="workspace">
    <aside className="import-column">{importPanel ?? <ReadReport summary={s} />}<Privacy /></aside>
    <section className="results" data-feature="view-shape" aria-labelledby="results-title">
      <h1 id="results-title">つまずきとやり直し</h1>
      <p className="lead">{s.toolErrors ? <><span className="desktop-copy">{s.toolErrors}件のエラーを、前後の呼び出しで見る</span><span className="mobile-copy">エラー{s.toolErrors}回・直後のやり直し{s.retries}回</span></> : 'つまずきは 0 件'}</p>
      {s.troubles.length > 0 && <div className="trouble-list" role="table" aria-label="つまずきの一覧">
        <div className="list-head" role="row"><span role="columnheader">時刻</span><span role="columnheader">道具</span><span role="columnheader">直後の呼び出し</span><span role="columnheader">やり直し</span><span /></div>
        {s.troubles.map((item, i) => <div role="row" key={item.number} className={`trouble-row ${i === selected ? 'selected' : ''}`}>
          <span role="cell" className="failure-time">{timeLabel(item.failedAt)}</span>
          <span role="cell" className="failure-tool"><span className="error-cross" aria-label="エラー">×</span> {item.matched ? item.tool : '対応不明'}</span>
          <div className="followup" role="presentation"><span role="cell" className="next-call">{item.nextCall ? `${timeLabel(item.nextCall.at)} → ${item.nextCall.tool}` : '次の呼び出しなし'}</span>
          <span role="cell" className="retry-count"><span className="mobile-copy">やり直し</span>{item.retry ? '1回' : '0回'}</span></div>
          <span role="cell" className="row-action"><button aria-pressed={i === selected} aria-label={`つまずき ${item.number}：${timeLabel(item.failedAt)} ${item.matched ? item.tool : '対応不明'} を選択`} onClick={() => setSelected(i)}>›</button></span>
        </div>)}
      </div>}
      {trouble && <p className="selection desktop-copy">選択中：{trouble.matched ? trouble.tool : '対応不明'}　{timeLabel(trouble.failedAt)} → {trouble.nextCall ? timeLabel(trouble.nextCall.at) : '次の呼び出しなし'}</p>}
      <section className="position" aria-labelledby="position-title">
        <h2 id="position-title">{trouble ? '選んだつまずきの位置' : '会話全体の流れ'}</h2>
        {trouble && <p className="selection mobile-copy">{trouble.matched ? trouble.tool : '対応不明'}　{timeLabel(trouble.failedAt)} → {trouble.nextCall ? timeLabel(trouble.nextCall.at) : '次の呼び出しなし'}</p>}
        {trouble && (!trouble.matched || trouble.failedAt === null) && <p className="muted">{!trouble.matched ? '対応不明のため' : '時刻なしのため'}、位置の帯は表示できません。</p>}
        <div className="chart" ref={chart}><Timeline ref={svg} summary={s} selected={trouble} compact={compact} /></div>
      </section>
      <section className="share" data-feature="export-png" aria-label="PNG の書き出し">
        <button disabled={exporting} onClick={async () => {
          if (!svg.current) return;
          setExporting(true); setNotice('');
          try { await exportPng(svg.current, s); track('export_dispatched', { kind }); setNotice('PNG を書き出しました。'); }
          catch { track('export_failed', { reason: 'png_failed' }); setNotice('PNG を書き出せませんでした。もう一度お試しください。'); }
          finally { setExporting(false); }
        }}>{exporting ? 'PNG を作成中…' : '図を PNG で書き出す'}</button>
        <p className="export-help">やり直しは行順で判定します</p>
        <p role="status" className="export-notice">{notice}</p>
      </section>
    </section>
    <aside className="summary-column">
      <details className="totals" open={!compact}>
        <summary tabIndex={compact ? 0 : -1} onClick={event => { if (!compact) event.preventDefault(); }}>会話の小計 <span className="mobile-copy">{duration(s.durationMs)}・道具{s.toolCalls}回</span></summary>
        <dl className="stats">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <details className="model-details"><summary>モデル・トークンを見る</summary>
          <h3>使ったモデル</h3><p>{s.models.length ? s.models.join(' / ') : '記録なし'}</p>
          <h3>トークンの合計</h3><dl className="tokens">{([
            ['入力', s.usage.input_tokens], ['出力', s.usage.output_tokens], ['キャッシュの読み', s.usage.cache_read_input_tokens], ['キャッシュの作成', s.usage.cache_creation_input_tokens],
          ] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString('ja-JP')}</dd></div>)}</dl>
          <details className="counting"><summary>数え方について</summary><p>空行は除外します。図にした行は時刻がある user / assistant の行です。その他の type は数だけ集計します。会話の長さは全行の有効な時刻の最小と最大の差です。</p><p>エラー結果 1 件を一覧の 1 件とします。ID で呼び出しを特定し、結果の後の最初の道具呼び出しと元の名前を比較します。やり直しは行順で判定し、次の呼び出しまでに複数のエラーがあれば最後のエラーだけが候補です。後から対応が判明しても判定は遡りません。</p><p>AI の応答は assistant の message.id ごとに 1 回、usage は同じ ID の最初の行だけを加算します。ID がない・空・文字列以外なら行ごとに数えます。後続行で usage を補完しません。道具は塊ごとに数えます。</p><p>未確認の道具名・モデル名は「その他」に置き換えます。時刻がない行の数値も集計します。その他の行 {s.otherRows}・時刻がない会話の行 {s.untimedRows}。</p><p>図の点は道具、× はエラー、点線は人の発言です。近い点はまとめ、呼び出しが多いほど大きくします。PNG は全体の時間軸を書き出します。</p></details>
        </details>
      </details>
    </aside>
    <div className="mobile-report"><span>{s.success ? '読み込み成功' : '読み込みを確認してください'}・{s.rows}行 / 図{s.chartedRows}行 / 不明{s.invalidRows}行</span>{!s.success && <p>読み込みの詳しい結果は「記録を変更」で確認できます。</p>}</div>
  </div>;
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
  const [importOpen, setImportOpen] = useState(false);
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
      setImportOpen(false);
    }
    catch { setError('ファイルを読み込めませんでした。会話の JSONL ファイルを選び直してください。'); }
    finally { busy.current = false; setLoading(false); }
  }
  const importPanel = <section className={`import-panel ${result && !importOpen ? 'collapsed' : ''}`} data-feature="import-session" aria-labelledby="import-title" aria-busy={loading}>
    <button className="mobile-switch" aria-expanded={!result || importOpen} aria-controls="import-controls" onClick={() => setImportOpen(!importOpen)}><strong>{result ? result.kind === 'demo_normal' ? '見本1を表示中' : result.kind === 'demo_retry' ? '見本2を表示中' : '記録を表示中' : '記録を読み込む'}</strong><span>記録を変更 ﹀</span></button>
    <div id="import-controls" className="import-controls">
      <h2 id="import-title">記録を読み込む</h2>
      <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void load(Array.from(event.dataTransfer.files), { kind: 'user_file', method: 'drop' }); }}>JSONL をここに落とす</div>
      <input ref={input} className="file-input" type="file" accept=".jsonl,application/json,application/x-ndjson" aria-label="会話の JSONL ファイル" tabIndex={-1} onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (files.length) void load(files, { kind: 'user_file', method: 'picker' });
      }} />
      <button disabled={loading} onClick={() => input.current?.click()}>ファイルを選択</button>
      <div className="demo"><button className={result?.kind === 'demo_normal' ? 'active' : ''} disabled={loading} onClick={() => { setImportOpen(false); track('sample_start', { kind: 'demo_normal' }); void load([new Blob([demo1])], { kind: 'demo_normal' }); }}>見本1：ふつうの会話</button><button className={result?.kind === 'demo_retry' ? 'active' : ''} disabled={loading} onClick={() => { setImportOpen(false); track('sample_start', { kind: 'demo_retry' }); void load([new Blob([demo2])], { kind: 'demo_retry' }); }}>見本2：エラーとやり直し</button></div>
      {result && <ReadReport summary={result.summary} />}
      {loading && <p role="status">読み込み中… {progress}%</p>}
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
  </section>;
  return <div className="shell">
    <header><a className="brand" href="#top" aria-label="Session Shape の先頭へ">Session Shape</a><span className="local-badge">ブラウザ内で処理<span className="desktop-copy">　|　本文・ファイル名は表示しません</span></span></header>
    <main id="top">{result ? <Results key={result.id} summary={result.summary} kind={result.kind} importPanel={importPanel} /> : <div className="workspace"><aside className="import-column">{importPanel}<Privacy /></aside><section className="results empty-state"><h1>つまずきとやり直し</h1><p>読み込むと、ここに作業の形が現れます。</p><p className="muted">見本、または会話の JSONL ファイルで始められます。1 回に 1 つ、50MB まで。</p></section></div>}</main>
    <footer>本文・ファイル名は表示しません</footer>
  </div>;
}
