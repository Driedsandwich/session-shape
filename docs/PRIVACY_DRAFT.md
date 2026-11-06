# Novus 接続後のプライバシー説明

PR #5 の SDK 導入に、文字収集と録画の停止、検査つきの7事象の送信を追加した実装の説明です。変更前の計画は HYPOTHESIS.md にそのまま残しています。

## 読み込む記録

記録の読み込み・集計・PNG の作成はすべてブラウザ内で実行します。記録の本文・ファイル名・作業フォルダ・大きさ・中身の数（行数・小計・トークン数・道具やモデルの名前）を外部には送りません。本文・ファイル名は画面や PNG にも出しません。記録そのものを localStorage・Cookie などには保存しません。

## 使われ方の計測

作品を良くするために、Pendo の Novus で頁の使われ方を計測します。アプリが送るのは HYPOTHESIS.md の表の7事象と固定の属性だけです。`src/track.ts` は実行時にも表と照らし、不明な名前・属性・値、必須属性の欠落を含む事象全体を送信対象から除きます。本文やファイルを渡す入口にはしません。従来のローカル CustomEvent は残しています。

Pendo はページ読み込み・クリック・focus などを自動計測します。クリック・focus の文字は `excludeAllText: true` で止め、`allowedText: []` を指定しています。画面の録画は `recording: { enabled: false }` で無効にしています。[Analytics](https://web-sdk.pendo.io/config/analytics/)・[Replay](https://web-sdk.pendo.io/config/replay/)。

文字を止める設定は HTML 属性値には効きません。SDK が取得する属性と親要素を実ブラウザで点検し、送信を捕まえて復号する試験に含めています。`allowedText` は管理画面側のリストを上書きできません。属性除外の `htmlAttributeBlacklist` は公式には Pendo Support に設定を依頼する仕組みなので、未確認の initialize オプションは使っていません。[データ収集を止める方法](https://support.pendo.io/hc/en-us/articles/17541315915035-Data-collection-prevention-strategies)・[HTML 属性](https://support.pendo.io/hc/en-us/articles/360031861612-HTML-attributes-in-data-collection)。

実行した DOM 点検では、つまずきボタンの `aria-label` に道具名と時刻がありました。配信 SDK `2.348.0_prod-io` の復号結果にはその属性がなく、道具名・時刻も含まれませんでした。`id`・`class`・`data-feature` などの構造用の値は送信されますが、点検した値に小計・道具名・モデル名はありませんでした。属性の削除や読み上げの変更は行っていません。

## 接続先と訪問識別

本番 CSP が許す外部ホストは `cdn.pendo.io`・`app.pendo.io`・`data.pendo.io`・`pendo-io-static.storage.googleapis.com` です。最後のホストは PR #5 が許可した Pendo ガイド用 script のホストです。`connect-src` は `https://app.pendo.io https://data.pendo.io` だけです。読み込み script と CSP は PR #5 から変えていません。[PR #5](https://github.com/Driedsandwich/session-shape/pull/5)。

初期化時の訪問者 ID は空文字です。Pendo は保存済みの匿名 ID を再利用するか、匿名 ID を生成します。標準で localStorage を使い、利用不能時などにファーストパーティ Cookie を使います。匿名ブラウザデータの標準の期限は100日間の非活動、訪問者 Cookie の期限は100日と公式文書に記載されています。保存情報の削除やブラウザの違いにより、同じ人が別の訪問者になる場合があります。[匿名訪問者](https://support.pendo.io/hc/en-us/articles/360032202751-Anonymous-visitors)・[Cookie と localStorage](https://support.pendo.io/hc/en-us/articles/360041032971-Cookies-and-local-storage)・[localStorage のキー](https://web-sdk.pendo.io/cookies/localstorage/)。

## 確認の範囲

試験ではデータ・アプリの両ホストへの URL の問いと本文を受け止め、外部に送らず空の200を返します。本物の SDK の `jzb` などを Base64・zlib・UTF-8 の順で復号し、見本2と目印入り記録を操作した内容を検査します。SDK を取得できない場合は実 SDK の試験だけを理由つきで skip します。別の偽 SDK の試験と単体試験は CDN に依存しません。

Pendo 管理画面の変更、サーバーでの受領・表示、サーバー側の保存期間、HYPOTHESIS.md の指標の算出は、この作業では検証していません。試験を本物の Pendo に送って計測開始 T0 とすることもしていません。管理画面の収集設定や配信 SDK が変わった場合は、再検査が必要です。
