# byok-llm-chat 改善計画

## 背景と目的

`index.html` は LM Studio のローカル LLM API 疎通確認用に作った単一ファイルの汎用チャット UI。
今後は次の構成で使う。

```
ブラウザ ──HTTPS──> Cloudflare Pages (静的ホスト)
   │
   └──HTTPS──> Tailscale (Serve/Funnel) ──> LM Studio (OpenAI互換 API)
```

そのためチャット UI をリッチ化する。ビルド工程は入れない（素の HTML/CSS/JS + vendor 同梱）。

## スコープ

| # | 項目 | フェーズ |
|---|------|----------|
| 1 | Markdown 表示（表・コードのハイライト・コピー、安全な HTML 化） | 1 |
| 2 | 接続先の保存・選択・管理（名前 / URL / API キー） | 1 |
| 3 | 設定モーダル（送信キー、テーマ、フォントサイズ、生成パラメータ等） | 1 |
| 4 | ストレージの使い分け（チャット履歴の保存先を local / session から選択） | 1 |
| 5 | Cloudflare Pages 配備（キャッシュヘッダ、ライブラリ同梱） | 1 |
| 6 | モバイル対応（サイドバー開閉）、日本語 IME 入力中の Enter 誤送信防止 | 1 |
| 7 | Cloudflare KV/D1 による履歴同期 | 2（未実装・設計のみ） |

## 非ゴール

- バックエンド（Pages Functions など）の実装はフェーズ1では行わない。
- ビルドツール / フレームワークの導入。
- マルチユーザー対応。

## ファイル構成

```
index.html        マークアップ（サイドバー、チャット、設定モーダル）
css/style.css     スタイル（テーマは CSS 変数、data-theme で切替）
js/app.js         アプリ本体
vendor/           marked / DOMPurify / highlight.js（CDN 非依存）
_headers          Cloudflare Pages 用キャッシュ・セキュリティヘッダ
spec/             本ドキュメント
```

詳細は [design.md](design.md)。

## 受け入れ基準（フェーズ1）

- 見出し・リスト・表・引用・コードブロック・リンクを含む応答が整形表示される。
- 応答中の `<script>` や `onerror=` 等は実行されない。
- 接続先を複数登録し、サイドバーで切り替えるとモデル一覧が再取得される。再読込後も保持される。
- 送信キーを「Enter」「Ctrl/Cmd+Enter」から選べる。IME 変換確定の Enter では送信されない。
- チャット保存先を local / session に切り替えても履歴が失われない（移行される）。
- 既存の `localStorage` データ（`chats`, `presets`, `s_*`）がそのまま読み込める。
- HTTPS ページから http:// の接続先を指定した場合、原因を示す警告が出る。
