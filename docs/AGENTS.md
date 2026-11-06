# AI のエージェントから使う

Node.js 22.12 以上で、Claude Code の JSONL をローカルで解析する入口です。
CLI と MCP は `src/parser.ts` の `parseFile` をそのまま使います。
Web の右の柱の小計 7 項目、モデル、usage、左の柱の読み込み数、つまずきの一覧を JSON にします。
本文、thinking、道具の入力・結果、ファイル名・パス、作業フォルダ、枝名、題、内部 ID は返しません。
道具名・モデル名の許可範囲も画面と同じです。未知の道具名は「その他の道具」、未知のモデル名は「その他のモデル」になります。

## 準備と CLI

この変更を含む checkout のルートで実行します。

```sh
npm ci
node lib/agents/cli.js analyze src/samples/demo-2.jsonl --pretty
```

`npm ci` の `prepare` が既存の TypeScript コンパイラで Node 用の `lib/` を作ります。
ソース変更後は `npm run build:agents`。Web の `npm run build` と出力先は別です。
`npm run analyze -- <ファイル.jsonl> --pretty` でも実行できますが、npm 自身の見出しが標準出力に加わるため、機械からは `node` または bin を直接使ってください。

bin を登録する場合は checkout 内で `npm link` を実行し、次の形で使います。

```sh
session-shape analyze <ファイル.jsonl> [--pretty]
```

CLI は相対パス・絶対パスのいずれも受け取ります。`--pretty` は末尾に指定します。
成功時は標準出力に JSON 1 つと改行、標準エラー出力は空、終了コードは 0 です。
読めない JSON 行は画面と同じく飛ばして部分集計し、空ファイルも集計を返します。これらは `success: false` でも終了コード 0 です。
ファイルを開けないなどの失敗は標準出力が空、標準エラー出力に固定のエラー JSON 1 つ、終了コード 1 です。

### GitHub からの npx

2026-11-06 に次のコマンドを実行したところ、終了コード 1、`could not determine executable to run` でした。
公開 main の基点 `2d3043d` の package.json には bin がありません。この変更はローカルの to-a にあり、push していません。

```sh
npx --yes github:Driedsandwich/session-shape analyze src/samples/demo-2.jsonl
```

現時点では上記の `npm ci` と `node lib/agents/cli.js ...` を使ってください。
新しく clone する場合は、repo ルートで提供された `to-a.patch` を `git am < to-a.patch` で適用してから `npm ci` を実行します。
この変更には bin と prepare を含めていますが、変更後の公開 GitHub 経由の起動は公開前のため未確認です。
依存の取得・インストールには通信が必要です。準備後の CLI と MCP サーバーの解析処理にはネットワーク接続がありません。

## MCP（stdio）

サーバー起動は `node lib/agents/cli.js mcp`。標準入出力は MCP の通信専用です。
`analyze_session` だけを公開し、入力は次の形です。`path` はサーバーが動く機械の絶対パスに置き換えます。

```json
{"path":"/absolute/path/session.jsonl"}
```

追加の引数は受け付けません。ディレクトリは拒否し、通常のファイル（それを指すシンボリックリンクを含む）を読みます。
50 MiB（52,428,800 バイト）を超えるファイルは内容を読む前に拒否します。
成功応答の `structuredContent` が CLI と同じ JSON です。`content` にも互換性のため同じ JSON を text 1 件で返します。
ファイルや入力のエラーは `isError: true` と固定のエラー JSON を返します。空ファイル・壊れた JSON 行の部分集計は `isError` を立てません。

Claude Code への登録（checkout の場所を絶対パスに置き換える）:

```sh
claude mcp add --transport stdio session-shape -- node /absolute/path/session-shape/lib/agents/cli.js mcp
```

公式の [Claude Code の stdio 登録方法](https://code.claude.com/docs/en/mcp#option-3-add-a-local-stdio-server) の `--transport stdio` と `--` の形式を確認しました。

Codex への登録:

```sh
codex mcp add session-shape -- node /absolute/path/session-shape/lib/agents/cli.js mcp
```

または Codex の `~/.codex/config.toml` に次を追加します。

```toml
[mcp_servers.session-shape]
command = "node"
args = ["/absolute/path/session-shape/lib/agents/cli.js", "mcp"]
```

公式の [Codex MCP 文書](https://developers.openai.com/codex/mcp)（[現在の転送先](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)）で、CLI の `--` と設定の `command` / `args` を確認しました。いずれも 2026-11-06 確認です。
登録先の PATH で Node.js 22.12 以上を利用できる必要があります。

## JSON schema 版 1

成功時の最上位は以下の欄だけです。数え方は parser と共通で、時刻のない行も数値の集計に含みます。

| 欄 | 型・単位 | 意味 |
| --- | --- | --- |
| `schemaVersion` | number、固定値 `1` | この JSON の版。成功・エラーとも持つ |
| `durationMs` | number、ミリ秒 | 会話の長さ。全 type の有効な timestamp の最大値と最小値の差。時刻がなければ 0 |
| `humanMessages` | number、回 | user の content が文字列、または text ブロックを含む行数。tool_result のみは除外 |
| `assistantMessages` | number、回 | assistant の message.id ごとの応答数。ID がない・空・文字列以外なら行ごとに数える |
| `toolCalls` | number、回 | tool_use / server_tool_use ブロックの数 |
| `toolErrors` | number、回 | is_error が true の tool_result ブロックの数 |
| `retries` | number、回 | エラーの直後の呼び出しが元と同じ道具名だった回数 |
| `sidechainRows` | number、行 | 全 type で isSidechain が true の行数。独立したエージェントの人数ではない |
| `models` | string[] | parser が許可・置換したモデル名の重複なし一覧。ソート済み |
| `usage` | object | 下表の 4 項目。user / assistant の同じ message.id は最初の行だけ採用し、後続行で欠落を補わない。ID がなければ各行を加算 |
| `rows` | number、行 | 読んだ空行以外の行数 |
| `chartedRows` | number、行 | 有効な timestamp のある user / assistant 行数 |
| `invalidRows` | number、行 | JSON として読めない行数。未知の type や JSON のプリミティブは含めない |
| `success` | boolean | invalidRows が 0 で assistantMessages が 1 以上。画面の「読み込み成功」と同じ |
| `troubles` | object[] | エラー結果ごとに 1 件。ファイルの行・ブロック順。下表参照 |

`src/parser.ts` の `USAGE_KEYS` の全 4 項目を返します。有限な非負数だけを加算し、各合計の上限は `Number.MAX_SAFE_INTEGER` です。欠落は 0、請求額の推定はしません。

| 欄 | 型・単位 | 意味 |
| --- | --- | --- |
| `usage.input_tokens` | number、トークン | 入力の合計 |
| `usage.output_tokens` | number、トークン | 出力の合計 |
| `usage.cache_read_input_tokens` | number、トークン | キャッシュの読みの合計 |
| `usage.cache_creation_input_tokens` | number、トークン | キャッシュの作成の合計 |

つまずきの時刻は絶対時刻ではなく、全 type の最初の有効な timestamp からの**秒数**です。小数を含む場合があります。元の時刻がないときは `null` で、0 秒とは区別します。

| 欄 | 型・単位 | 意味 |
| --- | --- | --- |
| `troubles[].number` | number | 1 から始まる一覧の番号 |
| `troubles[].tool` | string | エラーの元の道具。未知名または対応不明は「その他の道具」 |
| `troubles[].matched` | boolean | tool_use_id に対応する呼び出しが見つかったか |
| `troubles[].failedAt` | number または null、秒 | エラーの元になった呼び出しの時刻 |
| `troubles[].errorAt` | number または null、秒 | エラー結果の時刻 |
| `troubles[].nextSame` | object または null | 元の呼び出し以後の最初の同名呼び出し。なければ null。エラー直後の呼び出しとは限らない |
| `troubles[].nextSame.at` | number または null、秒 | 上記の同名呼び出しの時刻 |
| `troubles[].nextCall` | object または null | エラー結果以後の最初の呼び出し。なければ null |
| `troubles[].nextCall.at` | number または null、秒 | 直後の呼び出しの時刻 |
| `troubles[].nextCall.tool` | string | 直後の道具。未知名は「その他の道具」 |
| `troubles[].retry` | boolean | 直後の呼び出しが元と同名のやり直しと判定されたか |

やり直し判定は時刻順ではなく行・ブロック順です。本文・メタデータ行は間にあってもかまいません。
次の呼び出しまでに複数のエラーがあれば最後のエラーだけを候補にします。
対応が後から見つかっても判定は遡って変えません。未知の道具同士も、内部の元の名前が違えば同名とはしません。
並列作業の因果関係を断定する値ではありません。

## 固定のエラー JSON

```json
{"schemaVersion":1,"error":{"code":"FILE_TOO_LARGE"}}
```

| 欄・値 | 意味 |
| --- | --- |
| `error` | 解析結果の代わりに返すエラー object |
| `error.code` | 以下の固定文字列だけ。元の例外・入力値・パスは含まない |
| `INVALID_ARGUMENTS` | CLI の構文不正、または MCP の引数の不足・余分な欄・型の不正・空パス・NUL |
| `PATH_NOT_ABSOLUTE` | MCP に相対パスを指定した |
| `FILE_TOO_LARGE` | 50 MiB 超過。内容を読む前に拒否 |
| `FILE_NOT_REGULAR` | 通常のファイルではない |
| `FILE_READ_FAILED` | 不存在・権限不足・読み込み中の変更などで処理できない。生の例外は返さない |
| `UNKNOWN_TOOL` | analyze_session 以外の道具を呼んだ |

## 試験

`npm test` は Node 用のコードを作り直し、実際の CLI と SDK の stdio client から MCP を呼びます。
子プロセス内で fetch と net の接続を禁止し、呼んだ瞬間に非ゼロ終了させます。
サイズ超過試験では openAsBlob も禁止して、本文を開く前の拒否を確認します。
試験用の私的な文字列は実行時に作り、CLI の標準出力・標準エラーと MCP の応答全体への漏出を検証します。
