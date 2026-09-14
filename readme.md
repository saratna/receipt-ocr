# レシートOCR — 自作レシート管理システム

## 概要

買い物レシートを Pixel などで撮影し、OCR + AI で明細を構造化抽出、Google Sheets に蓄積、写真を Google Drive に保存するシステム。
名刺OCR（meishi-ocr）と同じ構成（PWA → Google Apps Script → Vision / Gemini / Sheets）をレシート向けに再構成したもの。

## システム構成

```
Pixel（PWA）→ Google Apps Script（中継サーバー）
├→ Cloud Vision API（OCR）
├→ Gemini 2.5 Flash（構造化抽出・JAN補完）
├→ Google Drive（レシート画像保存）
└→ Google Sheets（レシートDB）
```

## アーキテクチャ

| 層 | 役割 | 技術 |
|---|------|------|
| OCR層 | 画像から生テキスト抽出 | Google Cloud Vision API |
| 知性層 | 店舗・明細・税率・JAN抽出 | Gemini 2.5 Flash |
| 保存層 | 画像保存・明細蓄積・検索 | Google Drive / Sheets |

### 設計思想

- **AIには考えさせろ、計算はさせるな** — 集計はスプレッドシート、AIは抽出・補正のみ
- **OCR + VLM の二段構え** — Vision が文字を読み、Gemini が文脈で補正
- **APIキーはGAS側に隠蔽** — PWA にはキーを出さない
- **商品1行ずつ** — 集計・検索しやすい正規化

## 機能一覧

### スキャン・登録

- 背面カメラでレシート撮影
- Cloud Vision で OCR
- Gemini で店舗・日付・時間・T番号・商品明細を抽出
- **JANコード補完**
  1. レシート印字から抽出
  2. 無い場合は商品名から検索（Gemini）
  3. それでも無い場合は画像から再読み取り
- 登録前にヘッダ／明細の編集・行追加／削除が可能
- 画像を Google Drive に保存
- 商品1行ずつ Google Sheets に追記

### 検索

- 店舗・商品名・JAN・日付・ファイル名で部分一致検索
- リアルタイム検索（500ms デバウンス）
- 結果から Drive 画像リンクを開ける

## レシートDBカラム構成

| 列 | 項目 |
|---|------|
| A | 登録日時 |
| B | レシート日付 |
| C | レシート時間 |
| D | 店舗（会社名） |
| E | T番号 |
| F | 商品名 |
| G | JANコード |
| H | 数量 |
| I | 消費税率 |
| J | 単価 |
| K | 消費税 |
| L | レシートファイル名 |
| M | Drive URL |

1レシートに商品が N 個あれば N 行。B〜E・L・M は同一レシートで同じ値を繰り返す。

## ファイル構成

```
receipt-ocr/
├── index.html   ... PWA フロント（カメラ・編集・検索）
├── app.js       ... PWA ロジック
├── code.gs      ... GAS バックエンド（※APIキーはプレースホルダ）
└── readme.md    ... このファイル
```

## 利用API・サービス

| サービス | 用途 |
|---------|------|
| Google Cloud Vision API | OCR |
| Gemini 2.5 Flash | 構造化抽出・JAN補完 |
| Google Sheets API | データ蓄積・検索 |
| Google Drive | レシート画像保存 |
| Google Apps Script | 中継サーバー |
| GitHub Pages（任意） | PWA ホスティング |

## セットアップ手順

### 1. Google Cloud Console

1. プロジェクト作成
2. 以下を有効化
   - Cloud Vision API
   - Generative Language API（Gemini）
   - Google Sheets API
   - Google Drive API
3. APIキー発行・制限（Vision + Generative Language のみ許可）

### 2. Google Drive

1. 「レシート画像」フォルダを作成
2. URL のフォルダ ID を控える  
   例: `https://drive.google.com/drive/folders/XXXXXXXX` の `XXXXXXXX`

### 3. Google Sheets

1. スプレッドシート作成
2. タブ名を `レシートDB` にする
3. 後述の GAS で `setupSheetHeaders` を実行するか、手動でヘッダー行を入れる

ヘッダー例:

`登録日時 / レシート日付 / レシート時間 / 店舗 / T番号 / 商品名 / JANコード / 数量 / 消費税率 / 単価 / 消費税 / レシートファイル名 / Drive URL`

### 4. Google Apps Script

1. スプレッドシートから「拡張機能」→「Apps Script」
2. `code.gs` の内容を貼り付け
3. `CONFIG` を設定
   - `VISION_API_KEY`
   - `GEMINI_API_KEY`
   - `SPREADSHEET_ID`
   - `DRIVE_FOLDER_ID`
4. `setupSheetHeaders` を実行してヘッダー作成（任意）
5. `testSetup` で接続確認
6. ウェブアプリとしてデプロイ（実行ユーザー: 自分 / アクセス: 全員）

### 5. PWA

1. `secrets.example.js` をコピーして `secrets.js` を作成（**GitHub には上げない**）
2. `secrets.js` に次を設定
   - `GAS_URL` … デプロイURL
   - `API_TOKEN` … GAS の `CONFIG.API_TOKEN` と**同じ**長いランダム文字列
3. ローカル試験（どちらか）:

```powershell
cd C:\Users\user\Projects\receipt-ocr
python -m http.server 3000
```

ブラウザで `http://localhost:3000` を開く。  
（Node.js が入っている場合は `npx --yes serve .` でも可）

止め方: ターミナルで `Ctrl + C`

4. GitHub Pages を使う場合
   - リポジトリは public でも、`secrets.js` は push しない
   - Pages に載せるには、手元で `secrets.js` を置いた状態で別途デプロイするか、トークン付きファイルを Pages 用に手動配置する必要がある
   - **注意:** ブラウザに渡したトークンは、Pages の JS を読めば見える。入口の「URLだけ知っている第三者」やボット対策には有効だが、ソースを読める相手には完全な秘密にはならない

## 入口トークン（API_TOKEN）

- すべての `scan` / `save` / `search` で必須
- GAS: `CONFIG.API_TOKEN`
- フロント: `secrets.js` の `API_TOKEN`
- 未設定（`YOUR_API_TOKEN`）のままだと GAS は `Unauthorized` を返す
- `doGet`（生存確認 `{"status":"ok"}`）だけはトークン不要

### トークン生成アプリ（同梱）

ブラウザで `token-generator.html` を開く（ローカル試験中なら `http://localhost:3000/token-generator.html`）。

1. 「トークンを生成」→ コピーして GAS の `API_TOKEN` に貼る
2. デプロイURLを入力（任意）→ 「secrets.js 全文をコピー」
3. プロジェクトの `secrets.js` に貼り付けて保存

生成はブラウザ内だけ。ネット送信なし。

## JANコード補完について

- 確実に印字されている JAN のみを優先
- 商品名からの補完は「確信度が低い場合は空欄」とするプロンプトにしているため、必ず入る保証はない
- 登録前の編集画面で手動修正・追記が可能

## 注意事項

- `code.gs` の APIキー・`API_TOKEN` の実値は公開しない（GitHub にはプレースホルダのまま）
- `secrets.js` は絶対に commit / push しない
- Drive 保存時、リンクを知っている人が見られる共有設定にしている（必要なら GAS 内の共有設定を変更）
- 大きなレシート画像は処理時間が長くなることがある
- Gemini の JAN 推測は誤る場合がある。確定データとしては編集確認を推奨