# Session Shape

**AI コーディングの記録を形で見る。** Claude Code の会話の JSONL を落とすと、人の発言、AI の応答、道具の使い方、エラーとやり直しを数と時間の帯にします。作者：新宅えら。MIT ライセンス。

## 使い方

1. 会話の JSONL を 1 つドラッグ＆ドロップ、または「ファイルを選ぶ」。記録がなくても「見本1：ふつうの会話」「見本2：エラーとやり直し」で試せます。
2. つまずき（エラーとやり直し）の一覧を見る。行を選ぶと、下の SVG の時間の帯でその時刻が光ります。右の柱に会話の小計が出ます。
3. 「図を PNG で書き出す」で保存。PNG は題「Session Shape」、会話の長さ、道具とエラーの総数、時間の帯、凡例を含みます（つまずきを選んでいるときは、その位置の帯と凡例も入ります）。自動投稿・自動共有はありません。

Claude Code の記録は、利用者の機械の中の Claude Code の設定のフォルダにあります。設定場所は環境によって異なるため、そのフォルダ内でプロジェクトや会話に対応する `.jsonl` を探してください。実際の記録をこのリポジトリに追加しないでください。

## ファイルを送らない設計

記録の読み込み・集計・PNG の作成は、すべてブラウザ内で実行します。記録の本文・ファイル名・中身の数（小計・道具やモデルの名前）は、どこにも送りません。同梱の見本は `?raw` でビルド時に取り込みます。Vite の module-preload polyfill は無効です。

頁の使われ方（どのボタンを押したか・図まで行ったか）は、作品を良くするために Pendo の Novus で計測します。アプリから送る事象と属性は [HYPOTHESIS.md の7事象の表](HYPOTHESIS.md#計測の口と事象)のとおりです。送信直前に名前・属性・札の値を検査し、表にない値を含む事象は送りません。Pendo の自動計測はページの読み込み、クリック、focus なども記録します。

クリック・focus した要素の文字は送らない設定（`excludeAllText: true`、`allowedText: []`）にし、画面の録画は `recording: { enabled: false }` で切っています。`excludeAllText` は属性の値を止めないため、本物の SDK の送信を遮断・復号する試験で、DOM の属性も点検します。[文字の設定](https://web-sdk.pendo.io/config/analytics/)・[録画の設定](https://web-sdk.pendo.io/config/replay/)・[属性収集の説明](https://support.pendo.io/hc/en-us/articles/360031861612-HTML-attributes-in-data-collection)。

来訪者の識別には Pendo の匿名訪問者 ID を使います。空の訪問者 ID で初期化し、ブラウザに保存済みの匿名 ID があれば再利用します。標準では localStorage を使い、利用できない場合などにはファーストパーティ Cookie を使います。公式文書では匿名のブラウザデータは標準で100日間の非活動が期限、訪問者 Cookie の期限は100日です。ブラウザの保存情報を消すと同じ訪問者として識別できないことがあります。この期間は Pendo サーバー上の計測データの保存期間を意味しません。[匿名訪問者](https://support.pendo.io/hc/en-us/articles/360032202751-Anonymous-visitors)・[Cookie と localStorage](https://support.pendo.io/hc/en-us/articles/360041032971-Cookies-and-local-storage)。

- JSON の各行を数値・時刻・道具名・モデル名だけの `Summary` に変換します。本文、thinking、入出力、ファイル名、cwd、git の枝、題、sessionId や uuid は表示データに含めません。
- 本文・生の例外を console に出しません。ファイル選択の入力値はイベント内で即座に空にします。ファイルを React の state に保存しません。
- 道具名はコード内の既知名一覧、モデル名は Claude の製品名と数値バージョンの形式だけを許可し、それ以外は「その他の道具」「その他のモデル」に置換します。MCP の独自名なども伏せます。これは名前への本文混入を防ぐための保守的な仕様です。
- `message.id`・`tool_use_id` と元の道具名は集計処理の内部だけで照合に使い、集計完了時に破棄します。
- localStorage / IndexedDB / Cookie / Service Worker に記録を保存しません。次のファイルの読み込み時・ページを閉じる時に集計結果を手放します。
- 本番の CSP で許す外部ホストは `cdn.pendo.io`・`app.pendo.io`・`data.pendo.io`・`pendo-io-static.storage.googleapis.com`（Pendo のガイド用 script）だけです。`connect-src` は `https://app.pendo.io https://data.pendo.io` に限ります。PNG は安全な SVG のみを blob URL から canvas に描画し、`toBlob` で出力します。

DOM にあるのは固定の説明文と、安全な集計値だけです。データの本文・ファイル名をツールチップ、aria-label、data 属性、SVG にも入れません。

## 数え方と最小版の範囲

- 1 ファイルを 1 会話として扱います。複数会話を結合したファイルの分割は対象外です。
- 50MB は `50 × 1024 × 1024` バイト。超過は内容を読む前に拒否します。256KiB ずつ読み、UTF-8 の境界と LF / CRLF / CR を扱います。1 行が巨大な場合はその行の分だけメモリを使います。
- 読んだ行：空行以外。読めない行：JSON として壊れた行のみ。知らない type や JSON のプリミティブも「その他の行」。1 行の失敗で停止しません。
- 図にした行：有効な timestamp のある user / assistant 行。図の下の小さな目盛りに集約します。時刻がない user / assistant 行は別に数え、数値の集計には含めます。
- 成功：読めない行が 0、かつ assistant が 1 行以上。空ファイル・未知 type だけは成功になりません。
- 長さ：全 type の有効な timestamp の最小値と最大値の差。横軸は開始からの秒数です。
- 人の発言：user の content に text ブロックがある行。文字列形式の content も数えます。tool_result だけは除外。
- AI の応答：assistant の `message.id` ごとに 1 回。同じ ID の分割行は重ねて数えません。ID がない行は 1 行を 1 応答として数えます。空文字や文字列以外の ID も ID なしとして扱います。
- 道具：tool_use / server_tool_use を名前別に加算。tool_result の `is_error === true` をエラーとして数え、ID で元の呼び出しの点を × にします。対応する呼び出しや時刻がないエラーは総数にのみ残ります。
- やり直し：エラーを返した呼び出しは道具の ID で特定し、その後の最初の道具の呼び出しと道具の名前で比べます。同じ名前なら 1 回。行順で判定し、本文やメタデータ行は挟まっていてもかまいません。並列作業の因果関係を断定する数値ではありません。
- サブエージェント：全 type で `isSidechain === true` の行。
- usage：`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` の有限な非負数を合計。user / assistant の同じ `message.id` の最初の行だけを足し、ID がない行は行ごとに足します。最初の行の欠落は 0 とし、後続行の usage で補完・更新しません。請求額の推定はしません。
- 大量の点は横軸の 160 区間で道具・エラー別にまとめます。人の発言の区切りも同一区間では 1 本になります。集計の数値は間引きません。

`src/samples/` の見本は各 31 行、全て架空です。それぞれ 3 か所で同じ `message.id` の thinking と道具呼び出しを別の行に分け、同じ usage を持たせています。見本 1 は通常の作業、見本 2 は 2 回のエラーとやり直しです。

## 開発と試験

Node.js 22.12 以上を使います。

```sh
npm install
npm test
npm run build
npm run preview
```

`http://localhost:4173/session-shape/` で本番 build を確認できます。編集用には `npm run dev`（`http://localhost:5173/session-shape/`）。通信を制限する設計に合わせて HMR を無効にしているため、変更後は再読み込みしてください。Vite 開発用クライアントの通信と本番コードは別物です。

Web の npm 実行時依存は React / React DOM です。Pendo SDK は CDN から読み込みます。図は手組みの SVG。Vitest と jsdom により集計、サイズ境界、チャンク境界、DOM の文字・属性への本文漏出、選択欄のクリアを検証します。Vitest の PNG 試験は画像・canvas API を模擬します。

初回は `npx playwright install --with-deps chromium` で試験用の Chromium を入れます。
`npm run test:e2e` は本番 build と `vite preview` を自動起動し、CSP が有効な headless Chromium で通信・集計・本文とファイル名の非表示・実際の PNG ダウンロードを検証します。
結果は `playwright-report/` に保存され、GitHub Actions でも push ごとに独立した workflow で実行します。

## GitHub Pages への公開

Pendo の公開アプリキーと読み込みコードを含みます。個人の認証トークンは含めません。

1. GitHub に公開リポジトリ `session-shape` を作り、このフォルダの内容を `main` に push します。`node_modules` と `dist` は除外されます。
2. Settings → Pages → Build and deployment → Source を **GitHub Actions** にします。
3. 初回 push が設定前に走った場合は、設定後に Actions の `Publish Session Shape to Pages` を手動実行します。以後 `main` への push ごとに試験・build・公開が動きます。
4. 公開先は `https://<GitHub の利用者名>.github.io/session-shape/`。別の repo 名なら `vite.config.ts` の `base` も変更します。

設定は [Vite の GitHub Pages ガイド](https://vite.dev/guide/static-deploy.html#github-pages) と [GitHub のカスタム workflow ガイド](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) を参照しています。

## AI のエージェントから使う

`npm ci` 後、CLI は `node lib/agents/cli.js analyze <ファイル.jsonl> --pretty` で集計 JSON を返します。
MCP は `node lib/agents/cli.js mcp` で stdio サーバーを起動し、`analyze_session` にファイルの絶対パスを渡します。
この入口は Node 内で同じ parser を使い、解析時に外へ通信しません。MCP 用の依存は Web の bundle に入りません。
登録方法・JSON の欄・エラー・GitHub 経由の起動については [エージェント向けの説明](docs/AGENTS.md) を参照してください。

## Novus の接続と確認

PR #5 の読み込みコードの上に、文字収集と録画の停止、7事象の送信口を追加しています。`data-feature="import-session"` / `view-shape` / `export-png` で入口・図・書き出しを区別できます。送信前の検査は `src/track.ts` にまとめ、既存の `session-shape:track` CustomEvent も残しています。

`npm run test:e2e` は `app.pendo.io`・`data.pendo.io` への要求をローカルで捕まえて空の200を返し、本物の Pendo に試験データを送りません。既存の操作試験と引数の確認は偽の SDK で必ず実行し、別の試験で CDN の本物の SDK が作る要求を復号して検査します。CDN に届かない場合だけ、その実 SDK の試験を理由つきで skip します。

`allowedText: []` は管理画面の許可リストを上書きしません。属性収集の追加、文字の許可、SDK 更新時は同じ試験を実行してください。属性の除外用 `htmlAttributeBlacklist` は公式には Pendo Support への依頼事項であり、未確認の初期化設定としては追加していません。現在の設定と検証範囲は [プライバシー説明](docs/PRIVACY_DRAFT.md) に記載しています。[PR #5](https://github.com/Driedsandwich/session-shape/pull/5)。
