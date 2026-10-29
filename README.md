# Session Shape

**AI コーディングの記録を形で見る。** Claude Code の会話の JSONL を落とすと、人の発言、AI の応答、道具の使い方、エラーとやり直しを数と時間の帯にします。作者：新宅えら。MIT ライセンス。

## 使い方

1. 会話の JSONL を 1 つドラッグ＆ドロップ、または「ファイルを選ぶ」。記録がなくても「見本で試す」「エラーとやり直しの見本」で試せます。
2. 数と SVG の時間の帯を見る。
3. 「図を PNG で書き出す」で保存。PNG は時間の帯、会話の長さ、道具とエラーの総数を含みます。自動投稿・自動共有はありません。

Claude Code の記録は、利用者の機械の中の Claude Code の設定のフォルダにあります。設定場所は環境によって異なるため、そのフォルダ内でプロジェクトや会話に対応する `.jsonl` を探してください。実際の記録をこのリポジトリに追加しないでください。

## ファイルを送らない設計

処理はすべてブラウザ内で実行します。アプリのコードは fetch・XHR・WebSocket・外部 CDN・解析サービスを使いません。同梱の見本は `?raw` でビルド時に取り込みます。通常のページと静的資産の読み込みはありますが、選択したファイルを送信する経路はありません。Vite の fetch を使う module-preload polyfill も無効です。

- JSON の各行を数値・時刻・道具名・モデル名だけの `Summary` に変換します。本文、thinking、入出力、ファイル名、cwd、git の枝、題、sessionId や uuid は表示データに含めません。
- 本文・生の例外を console に出しません。ファイル選択の入力値はイベント内で即座に空にします。ファイルを React の state に保存しません。
- 道具名はコード内の既知名一覧、モデル名は Claude の製品名と数値バージョンの形式だけを許可し、それ以外は「その他の道具」「その他のモデル」に置換します。MCP の独自名なども伏せます。これは名前への本文混入を防ぐための保守的な仕様です。
- `tool_use_id` と元の道具名は集計処理の内部だけで照合に使い、集計完了時に破棄します。
- localStorage / IndexedDB / Cookie / Service Worker に記録を保存しません。次のファイルの読み込み時・ページを閉じる時に集計結果を手放します。
- 本番の CSP は `connect-src 'none'`。PNG は安全な SVG のみを blob URL から canvas に描画し、`toBlob` で出力します。

DOM にあるのは固定の説明文と、安全な集計値だけです。データの本文・ファイル名をツールチップ、aria-label、data 属性、SVG にも入れません。

## 数え方と最小版の範囲

- 1 ファイルを 1 会話として扱います。複数会話を結合したファイルの分割は対象外です。
- 50MB は `50 × 1024 × 1024` バイト。超過は内容を読む前に拒否します。256KiB ずつ読み、UTF-8 の境界と LF / CRLF / CR を扱います。1 行が巨大な場合はその行の分だけメモリを使います。
- 読んだ行：空行以外。読めない行：JSON として壊れた行のみ。知らない type や JSON のプリミティブも「その他の行」。1 行の失敗で停止しません。
- 図にした行：有効な timestamp のある user / assistant 行。図の下の小さな目盛りに集約します。時刻がない user / assistant 行は別に数え、数値の集計には含めます。
- 成功：読めない行が 0、かつ assistant が 1 行以上。空ファイル・未知 type だけは成功になりません。
- 長さ：全 type の有効な timestamp の最小値と最大値の差。横軸は開始からの秒数です。
- 人の発言：user の content に text ブロックがある行。文字列形式の content も数えます。tool_result だけは除外。
- AI の応答：assistant の行数。メッセージ ID による重複除去はしません。
- 道具：tool_use / server_tool_use を名前別に加算。tool_result の `is_error === true` をエラーとして数え、ID で元の呼び出しの点を × にします。対応する呼び出しや時刻がないエラーは総数にのみ残ります。
- やり直し：エラー後の最初の道具呼び出しが同じ道具名なら 1 回。行順で判定し、本文やメタデータ行は挟まっていてもかまいません。並列作業の因果関係を断定する数値ではありません。
- サブエージェント：全 type で `isSidechain === true` の行。
- usage：`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` の有限な非負数を行ごとに合計。欠落は 0。請求額の推定はしません。
- 大量の点は横軸の 160 区間で道具・エラー別にまとめます。人の発言の区切りも同一区間では 1 本になります。集計の数値は間引きません。

`src/samples/` の見本は各 28 行、全て架空です。見本 1 は通常の作業、見本 2 は 2 回のエラーとやり直しです。

## 開発と試験

Node.js 22.12 以上を使います。

```sh
npm install
npm test
npm run build
npm run preview
```

`http://localhost:4173/session-shape/` で本番 build を確認できます。編集用には `npm run dev`（`http://localhost:5173/session-shape/`）。通信を制限する設計に合わせて HMR を無効にしているため、変更後は再読み込みしてください。Vite 開発用クライアントの通信と本番コードは別物です。

実行時依存は React / React DOM のみ。図は手組みの SVG。Vitest と jsdom により集計、サイズ境界、チャンク境界、DOM の文字・属性への本文漏出、選択欄のクリアを検証します。PNG の試験は画像・canvas API を模擬します。実ブラウザの操作はこの作業では行っていません。

## GitHub Pages への公開

この成果物には公開先・個人のトークン・Novus のコードは含めていません。workflow は作成済みで未実行です。

1. GitHub に公開リポジトリ `session-shape` を作り、このフォルダの内容を `main` に push します。`node_modules` と `dist` は除外されます。
2. Settings → Pages → Build and deployment → Source を **GitHub Actions** にします。
3. 初回 push が設定前に走った場合は、設定後に Actions の `Publish Session Shape to Pages` を手動実行します。以後 `main` への push ごとに試験・build・公開が動きます。
4. 公開先は `https://<GitHub の利用者名>.github.io/session-shape/`。別の repo 名なら `vite.config.ts` の `base` も変更します。

設定は [Vite の GitHub Pages ガイド](https://vite.dev/guide/static-deploy.html#github-pages) と [GitHub のカスタム workflow ガイド](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) を参照しています。

## 後で Novus をつなぐとき

現状は計測コードなし。`data-feature="import-session"` / `view-shape` / `export-png` と日本語のボタン・見出しで 3 歩を区別できます。Novus の接続仕様・送信先・計測イベントは未決定です。接続時は公式の手順を確認して必要な CSP 許可を限定的に追加し、本文や File オブジェクトをイベントに渡さないこと、DOM 漏出試験が引き続き通ることを確認してください。
