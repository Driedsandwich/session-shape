import { useRef, useState } from 'react';
import { checkFileSize, parseFile, type Summary } from './parser';
import { colors, duration, Timeline } from './Timeline';
import { exportPng } from './export';
import demo1 from './samples/demo-1.jsonl?raw';
import demo2 from './samples/demo-2.jsonl?raw';

export function Results({ summary: s }: { summary: Summary }) {
  const svg = useRef<SVGSVGElement>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const stats = [
    ['会話の長さ', duration(s.durationMs)], ['人の発言', `${s.humanMessages}回`],
    ['AI の応答', `${s.assistantMessages}回`], ['道具の呼び出し', `${s.toolCalls}回`],
    ['道具のエラー', `${s.toolErrors}回`], ['直後のやり直し', `${s.retries}回`],
    ['サブエージェントの行', `${s.sidechainRows}行`],
  ];
  return <>
    <section className="results" data-feature="view-shape" aria-labelledby="results-title">
      <div className="section-heading"><span className="step">02</span><h2 id="results-title">図を見る</h2><span className={`status ${s.success ? '' : 'warning'}`} role="status">{s.success ? '読み込み成功' : '読み込みを確認してください'}</span></div>
      <p className="read-counts">読んだ行 <strong>{s.rows}</strong> ・ 図にした行 <strong>{s.chartedRows}</strong> ・ 読めない行 <strong>{s.invalidRows}</strong></p>
      <p className="muted">その他の行 {s.otherRows} ・ 時刻がない会話の行 {s.untimedRows}</p>
      {!s.success && <p className="notice">{s.invalidRows > 0 ? '壊れた JSON の行を飛ばして集計しました。' : 'AI の応答の行がありません。'} 読めない行が 0 で、AI の応答が 1 行以上あれば成功です。</p>}
      <dl className="stats">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="chart"><Timeline ref={svg} summary={s} /></div>
      <p className="muted">横軸は開始からの秒数。点は道具、× はエラー、点線は人の発言です。近い点はまとめ、呼び出しの数が多いほど点を大きくしています。</p>
      <ul className="tool-list" aria-label="道具ごとの呼び出し数">{s.tools.map((tool, i) => <li key={tool.name}><i style={{ background: colors[i % colors.length] }} />{tool.name} <strong>{tool.count}</strong></li>)}</ul>
      <div className="details"><div><h3>使ったモデル</h3><p>{s.models.length ? s.models.join(' / ') : '記録なし'}</p></div><div><h3>トークンの合計</h3><dl className="tokens">{([
        ['入力', s.usage.input_tokens], ['出力', s.usage.output_tokens], ['キャッシュの読み', s.usage.cache_read_input_tokens], ['キャッシュの作成', s.usage.cache_creation_input_tokens],
      ] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString('ja-JP')}</dd></div>)}</dl></div></div>
      <details><summary>数え方について</summary><p>空行は除外します。図にした行は時刻がある user / assistant の行です。その他の type は数だけ集計します。会話の長さは全行の有効な時刻の最小と最大の差です。</p><p>やり直しは、エラーを返した道具と、その後の最初の道具呼び出しが同じ場合です。道具の ID で照合し、記録の行順で数えます。usage と AI の応答は行ごとに加算します。</p><p>本文の混入を防ぐため、未確認の道具名・モデル名は「その他」に置き換えます。時刻がない行の数値も集計します。</p></details>
    </section>
    <section className="share" data-feature="export-png" aria-labelledby="share-title"><div><div className="section-heading"><span className="step">03</span><h2 id="share-title">形を共有する</h2></div><p>時間の帯を PNG に。共有するのは、あなたの手で。</p></div><button disabled={exporting} onClick={async () => {
      if (!svg.current) return;
      setExporting(true); setNotice('');
      try { await exportPng(svg.current); setNotice('PNG を書き出しました。'); }
      catch { setNotice('PNG を書き出せませんでした。もう一度お試しください。'); }
      finally { setExporting(false); }
    }}>{exporting ? 'PNG を作成中…' : '図を PNG で書き出す'} <span aria-hidden="true">↗</span></button><p role="status">{notice}</p></section>
  </>;
}

export default function App() {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  async function load(file: Blob) {
    if (busy.current) return;
    setError(''); setSummary(null);
    if (!checkFileSize(file.size)) { setError('50MB を超えるファイルは読み込めません。50MB 以下の会話の記録を選んでください。'); return; }
    busy.current = true; setLoading(true); setProgress(0);
    try { setSummary(await parseFile(file, setProgress)); }
    catch { setError('ファイルを読み込めませんでした。会話の JSONL ファイルを選び直してください。'); }
    finally { busy.current = false; setLoading(false); }
  }
  return <div className="shell">
    <header><a className="brand" href="#top" aria-label="Session Shape の先頭へ"><span className="brand-mark" aria-hidden="true">▥</span> Session Shape</a><span className="local-badge"><span aria-hidden="true">●</span> ブラウザの中で完結</span></header>
    <main id="top"><section className="intro"><p className="eyebrow">AI コーディングの記録を形で見る</p><h1>会話の中身は、そのままに。<br />作業の流れを、ひと目で。</h1><p>Claude Code の記録から、道具の使い方とやり直しの流れを。<br />文章を見せず、数と時間でふり返る小さな道具です。</p><ol className="steps" aria-label="使い方"><li><span>01</span> 落とす</li><li><span>02</span> 図を見る</li><li><span>03</span> 共有する</li></ol></section>
    <section className={`dropzone ${dragging ? 'dragging' : ''}`} data-feature="import-session" aria-labelledby="import-title" aria-busy={loading}
      onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (busy.current) return; const files = event.dataTransfer.files; if (files.length !== 1) { setError('会話のファイルを 1 つずつ選んでください。'); return; } void load(files[0]); }}>
      <div className="section-heading"><span className="step">01</span><h2 id="import-title">記録を落とす</h2></div>
      <div className="drop-icon" aria-hidden="true">↓</div><h3>会話の JSONL を、ここに</h3><p>1 回に 1 つの会話 · 50MB まで</p>
      <input ref={input} className="file-input" type="file" accept=".jsonl,application/json,application/x-ndjson" aria-label="会話の JSONL ファイル" tabIndex={-1} onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = ''; // Clear filename before any state update / asynchronous work.
        if (file) void load(file);
      }} />
      <button disabled={loading} onClick={() => input.current?.click()}>ファイルを選ぶ <span aria-hidden="true">＋</span></button>
      <div className="demo"><span>記録がなくても</span><button className="secondary" disabled={loading} onClick={() => void load(new Blob([demo1]))}>見本で試す</button><button className="text-button" disabled={loading} onClick={() => void load(new Blob([demo2]))}>エラーとやり直しの見本</button></div>
      <p className="privacy">ファイルの送信はありません。本文・ファイル名・作業フォルダは表示しません。</p>
      {loading && <p role="status">読み込み中… {progress}%</p>}{error && <p className="notice" role="alert">{error}</p>}
    </section>
    {summary ? <Results summary={summary} /> : <div className="empty-state"><span aria-hidden="true">▂ ▅ ▃ ▇ ▄ ▂ ▆</span><p>読み込むと、ここに作業の形が現れます。</p></div>}
    </main><footer><span>Session Shape</span><span>作者 新宅えら · MIT License</span><span>記録はこのページを閉じると破棄されます。</span></footer>
  </div>;
}
