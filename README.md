# KYG Style Tools

カスタムドメイン **[tools.kyg-style.com](https://tools.kyg-style.com/)** 向けの、ブラウザだけで使える小さなツール集（GitHub Pages）です。

## 公開 URL

| URL | 内容 |
|-----|------|
| https://tools.kyg-style.com/ | ハブ（ツール一覧・日本語 UI） |
| https://tools.kyg-style.com/改行ツール/ | SNSアカウント名強制改行ツール |
| https://tools.kyg-style.com/newline/ | 上記への ASCII エイリアス（リダイレクト） |

## リポジトリ構成

```
x-display-name-newline/   # リポジトリ名（履歴互換のためそのまま）
├── CNAME                 # tools.kyg-style.com（変更しない）
├── index.html            # ハブ一覧
├── style.css             # ハブ用スタイル
├── 改行ツール/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── newline/
│   └── index.html        # /改行ツール/ へリダイレクト
└── README.md
```

今後のツールは **兄弟フォルダ**（例: `◯◯ツール/`）として追加します。

## 新しいツールの追加手順

1. リポジトリ直下にフォルダを作る（例: `◯◯ツール/`）
2. その中に `index.html`（必要なら `style.css` / `app.js`）を置く。パスはフォルダ内の相対パスで完結させる
3. ルートの `index.html` にカード（リンク）を 1 つ追加する
4. 共有しやすい ASCII パスが必要なら `ascii-name/index.html` で日本語パスへリダイレクトする
5. `main` に push → GitHub Pages が自動デプロイ

## SNSアカウント名強制改行ツール

[tools.ic731.net の改行ツール](https://tools.ic731.net/twitter/new_line/)と同様に、表示名の改行位置に Unicode **Line Separator（U+2028 / LSEP）** を入れ、結果をコピーして X の設定に貼り付けます。

### 使い方

1. **入力** — テキストエリアに表示名を入力し、改行したい位置で Enter
2. **変換** — `\r\n` / `\n` が U+2028（LSEP）に置き換えられる（入力時に自動変換も可）
3. **コピー** — 「コピー」ボタンでクリップボードへ
4. **貼り付け** — X → 設定とプライバシー → あなたのアカウント → アカウント情報 → 表示名

### 注意

- 改行の**直前・直後のスペース**があると、X 側で改行が表示されないことがあります
- 絵文字・肌色修飾・ZWJ・国旗などは改行以外いじりません

### 技術メモ

| 項目 | 内容 |
|------|------|
| 改行コード | U+2028（LSEP）のみ |
| 変換対象 | `\r\n` / `\n` / 単独 `\r` のみ |
| その他の文字 | すべて保持 |

## カスタムドメイン（ConoHa DNS）

- **GitHub Pages カスタムドメイン**: `tools.kyg-style.com`（ルート `CNAME` ファイルの内容と一致）
- **ConoHa DNS**: `tools` の **CNAME** → `kouhei-yamamoto-jp.github.io`

DNS 側はリポジトリ外で管理します。このリポジトリでは `CNAME` の内容（`tools.kyg-style.com`）を維持し、Pages 設定は外さないでください。

## ローカル確認

```bash
npx serve .
# → http://localhost:3000/
# → http://localhost:3000/改行ツール/
# → http://localhost:3000/newline/
```

`package.json` は不要です。静的ファイルのみで完結します。
