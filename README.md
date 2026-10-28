# byok-llm-chat

自分の LLM サーバー (LM Studio などの OpenAI 互換 API) に、ブラウザから直接つなぐ静的なチャット UI です。
ビルド不要の素の HTML/CSS/JS で、Cloudflare Pages に置いて Tailscale 経由で自宅の LLM を使う構成を想定しています。

```
ブラウザ ──HTTPS──> Cloudflare Pages (静的ホスト: このリポジトリ)
   │
   └──HTTPS──> Tailscale Serve ──> LM Studio (OpenAI互換 API)
```

サーバー側の処理はありません。API キー・履歴・設定はすべて利用者のブラウザ内に保存されます。

## 機能

- Markdown 表示 (表・コードのハイライトとコピー・安全な HTML 化)
- 複数の接続先 (名前 / Base URL / API キー) の保存と切り替え
- 設定モーダル (送信キー Enter / Ctrl+Enter、テーマ、文字サイズ、生成パラメータなど)
- チャット履歴の保存先を localStorage / sessionStorage から選択、JSON の書出し・読込
- キャラクター (システムプロンプト) のプリセット
- 日本語 IME 変換中の Enter では送信しない、スマホ幅に対応

## ローカルで試す

```
python -m http.server 8000
```

`http://localhost:8000` を開き、設定の「接続先」に Base URL を登録します。

## 接続先の準備 (LM Studio + Tailscale)

1. LM Studio の Developer タブでサーバーを起動し、**Enable CORS** をオンにします。
2. HTTPS で公開されたページから `http://` には接続できないため (mixed content)、Tailscale Serve で HTTPS 化します。

   ```
   tailscale serve --bg --https=443 http://localhost:1234
   tailscale serve status
   ```

3. 表示された URL に `/v1` を付けたもの (例: `https://<host>.<tailnet>.ts.net/v1`) を、アプリの接続先に登録します。
4. ブラウザを使う端末も tailnet に参加している必要があります。

## Cloudflare Pages へのデプロイ (Git 連携)

1. Cloudflare ダッシュボードの Workers & Pages で、Pages プロジェクトを作成し、このリポジトリを接続します。
2. ビルド設定:
   - Framework preset: なし
   - Build command: 空
   - Build output directory: `/`
   - Production branch: `main`
3. 以後、`main` に push すると自動でデプロイされます。`_headers` のキャッシュ設定と CSP も反映されます。

## セキュリティ上の注意

- 公開サイトは誰でも開けますが、LLM は tailnet 内にあるため、tailnet 外からは使えません。**Tailscale Funnel でインターネットに公開しないでください** (LM Studio には認証がありません)。
- LM Studio の CORS は全オリジンを許可します。
- API キーは端末の localStorage に平文で保存されます。共有 PC では使わないでください。
- CSP で外部スクリプトと外部画像を禁止しています (画像 URL 経由の会話内容の漏えい対策)。
- UI 自体を非公開にしたい場合は Cloudflare Access を前段に置けます。

## ドキュメント

設計と計画は [spec/](spec/README.md) にあります。AI コーディングエージェント向けの案内は [CLAUDE.md](CLAUDE.md) です。

## 構成

```
index.html        マークアップ
css/style.css     スタイル
js/app.js         アプリ本体
vendor/           marked / DOMPurify / highlight.js (同梱)
_headers          Cloudflare Pages 用ヘッダ設定
spec/             計画・設計
```
