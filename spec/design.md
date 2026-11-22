# 設計詳細

## 1. 接続（Tailscale + Cloudflare 上の注意）

ブラウザから直接 LM Studio を呼ぶため、次の制約がある。UI はこれに沿った警告を出す。

- **Mixed content**: Cloudflare Pages は HTTPS。`http://100.x.x.x:1234` は呼べない。
  `tailscale serve --bg --https=443 http://localhost:1234` で
  `https://<host>.<tailnet>.ts.net/v1` を使う。
- **到達性**: ブラウザを動かす端末が tailnet に参加している必要がある（Funnel で公開する場合は
  API キーなどの認証を必須にすること。LM Studio 単体に認証は無い）。
- **CORS**: LM Studio の「Enable CORS」を有効にする。
- Chrome の Private Network Access により、公開サイトから LAN/tailnet へのアクセスで許可プロンプトが
  出る場合がある。

## 2. データモデルとストレージ

| データ | キー | 保存先 | 備考 |
|--------|------|--------|------|
| チャット履歴 | `chats`, `currentId` | 設定で `localStorage` / `sessionStorage` | 既存形式を維持 |
| 設定 | `settings` | localStorage | 下記 |
| 接続先 | `connections`, `activeConnection` | localStorage | API キーは平文（端末内のみ） |
| プリセット | `presets` | localStorage | 既存 |
| 旧設定 | `s_*` | localStorage | 初回起動時に `settings` / `connections` へ移行 |

`connections`: `[{id, name, baseUrl, apiKey}]`。`apiKey` があれば `Authorization: Bearer` を付与。

`settings` の既定値:

```
sendKey: "ctrlEnter" | "enter"   (ctrlEnter)
theme: "auto" | "light" | "dark" (auto)
fontSize: 12..20                 (14)
markdown: true
showReasoning: true
stream: true
temperature: 0.7
maxTokens: 1024
chatStorage: "local" | "session" (local)
apiMode: "openai" | "lmstudio"   (openai)
mcpServers: [{id,kind,label,url,allowedTools,headers,enabled}]  (kind: "ephemeral" | "plugin")  ([])
```

チャット保存先を切り替えた時は、現在の履歴を新しい保存先へ書き込み、旧保存先から削除する。
保存失敗（容量超過）はステータス欄に表示する。

## 2.1 LM Studio ネイティブ API / MCP

`apiMode: "lmstudio"` のとき、`<Base URL の /v1 を除いたもの>/api/v1/chat` へ POST する。
本文: `{model, input, system_prompt?, temperature, max_output_tokens?, stream, integrations?}`。
`integrations` は有効な `mcpServers` から `{type:"ephemeral_mcp", server_label, server_url, allowed_tools?, headers?}` を生成
（`allowed_tools` は空なら省略＝全ツール）。`kind: "plugin"` は LM Studio の `mcp.json` 登録済みサーバー用で、`label` にサーバー名（カンマ区切りで複数可、複数のとき `allowed_tools` は付けない）を入れ `{type:"plugin", id:"mcp/<名前>"}` を送る。API はステートレスなため、2ターン目以降は履歴を `input` 1本にまとめる。
SSE は `event:` 行付き（`message.delta` / `reasoning.delta` / `tool_call.*` / `error`）。ツール呼び出しは
チャット形式を変えず、思考過程 (`reasoning`) に追記して表示する。`openai` 方式の挙動は従来どおり。

- 前提: LM Studio 0.4.0 以降。ephemeral は「Allow per-request MCPs」、plugin は「Allow calling servers from mcp.json」が必要。
  サーバーによっては API トークンの権限や OAuth 認証が別途必要（拒否時は 403 / `authentication required`）。
- `temperature` はネイティブ API の範囲 (0〜1) に丸める。連続する同一ロールの発言（失敗した送信の残り）は送信前に結合する。
- `headers` は JSON か「名前: 値」行で入力し、オブジェクトに変換して送る（文字列のままだと 400）。plugin 側のヘッダーは `mcp.json` で持つ。

## 3. Markdown 表示

- `marked`（GFM, `breaks: true`）→ `DOMPurify` でサニタイズ → `innerHTML`。順序を変えない。
- 緩い解釈（設定 `lenientMd`、既定オン）: モデルが出す CommonMark 不正な強調を `marked` の前に補正する。
  `** 太字**`（開始直後の空白）を `**太字**` に、`**「x」**と`（句読点/CJK 隣接で成立しない）を `<strong>` に変換。
  コードブロック/インラインコード内は対象外。`2 ** 3 ** 4` のような記述を誤変換しうる点は許容。
- コードは `highlight.js` で色付けし、ブロックごとにコピーボタンを付ける（イベント委譲）。
- リンクは `target=_blank rel="noopener noreferrer"` に統一（DOMPurify フック）。
- ストリーミング中は `requestAnimationFrame` で描画を間引く。
- 思考過程（`reasoning_content`）は `<details>` に平文表示。設定で非表示にできる。
- ユーザー発言は平文のまま表示する。

## 4. 設定モーダル

単一ページ・セクション構成: 接続 / 入力・表示 / 生成 / データ（保存先・全履歴の書出し・読込・全消去）。
変更は即時反映・即時保存（保存ボタンなし）。

## 5. 入力

- 送信キー設定に従う。`Enter` モードでは Shift+Enter が改行。
- `KeyboardEvent.isComposing` / `keyCode 229` の間は送信しない（日本語 IME）。

- 履歴呼び出し（コンソール風）: 入力欄で ↑ / ↓ により送信済みユーザー発言を新しい順にたどる（全チャット横断）。
  キャレットが先頭行 (↑) / 最終行 (↓) にあるときだけ動作し、複数行の編集を妨げない。↓ で最新を越えると編集中の下書きに戻る。
  修飾キー併用・範囲選択中・IME 変換中は無効。

## 6. Cloudflare Pages 配備

- ビルド設定なし、出力ディレクトリはリポジトリルート。
- `_headers` で `/vendor/*` を長期キャッシュ、HTML は再検証、CSP で外部スクリプトを禁止。
  `img-src` は `'self' data:` のみ。外部画像を許すと、モデル出力の `![](https://x/?q=会話)` で
  会話内容が外部へ送出される（プロンプトインジェクション経由の漏えい）ため、外部画像は表示しない。
  CSP の `connect-src` は任意の接続先を許すため `https: http:` を許可（接続先がユーザー設定のため）。
- 追加の公開範囲制限が必要なら Cloudflare Access を前段に置く。

## 7. フェーズ2（未実装）: 履歴同期

Pages Functions + KV（設定・小さなメタ）/ D1（履歴）で端末間同期。
認証は Cloudflare Access の JWT を Functions で検証する。API キーなどの秘匿情報は同期対象外とする。
ローカル優先（オフライン可）で、更新時刻による last-write-wins を想定。
