<div align="center">

# Weekly Weight / 週イチ体重

**A browser page for logging your weight once a week, as one number.**<br>
**週に1回、体重を1つ入れるだけの記録ページ。**

No account, no install, nothing you enter is sent anywhere. Open it in a browser.<br>
登録なし・インストールなし・入力した内容の外部への送信なし。ブラウザで開いて使います。

![Static page](https://img.shields.io/badge/page-HTML%20%2F%20JavaScript-2f6f62)
![Dependencies](https://img.shields.io/badge/dependencies-none-2f6f62)
![Data](https://img.shields.io/badge/data-stays%20in%20your%20browser-2f6f62)
![Node](https://img.shields.io/badge/tests-Node.js%2022%2B-2f6f62)
![License](https://img.shields.io/badge/license-AGPL--3.0--only-2f6f62)

[English](#english) · [日本語](#日本語)

</div>

**Web version / Web版：** https://r38k51.github.io/weekly-weight/

<p align="center">
  <img src="docs/screenshots/01-first-open-top.png" alt="週イチ体重の画面：初めて開いたとき / First open" width="240">
  <img src="docs/screenshots/02-recorded-top.png" alt="週イチ体重の画面：記録したあと / After recording" width="240">
  <img src="docs/screenshots/03-dark-top.png" alt="週イチ体重の画面：ダークモード / Dark mode" width="240">
</p>
<p align="center"><sub>Phone (made-up data, 393px wide): first open, numbers after recording, dark mode / スマホ（架空のデータ、幅393px）：初めて開いたとき、記録したあとの数字、ダークモード</sub></p>

<p align="center">
  <img src="docs/screenshots/04-desktop-two-columns.png" alt="週イチ体重の画面：PCでは記録を上の帯に、数字とグラフを左、これまでの記録を右に並べる / On a PC, the form is a band at the top, with the numbers and chart on the left and the history on the right" width="720">
</p>
<p align="center"><sub>PC (1366px wide): form at the top, numbers and chart on the left, history on the right / PC（幅1366px）：記録を上の帯に、数字とグラフを左、これまでの記録を右に並べる</sub></p>

---

<a id="english"></a>

## English

[日本語はこちら](#日本語)

### What is it

**Weekly Weight** is a single browser page for logging your weight once a week, as one number. After you enter a value, it shows the difference from the previous record, the difference from the first record, the number of consecutive weeks you logged, and a trend chart.

There is no account and no backend. What you type is not sent anywhere. The interface is in Japanese only.

**Web version:** https://r38k51.github.io/weekly-weight/

### Features

- **One record per week.** A week runs from Monday to Sunday. Logging again in the same week replaces that week's record, and the page tells you before it does.
- **Four numbers.** Latest weight, difference from the previous record, difference from the first record, consecutive weeks. Differences are shown only as signed numbers, with no colors or arrows.
- **Trend chart.** A hand-written SVG with no chart library. Shows up to the latest 52 weeks.
- **History.** Newest week first. Weeks without a record are shown as a single line. Twelve rows at a time.
- **Backup and restore.** Save your records as a JSON file and load it on another device or after data loss.
- **Works on phones.** Built so that it does not scroll sideways at a width of 360 px. Supports enlarged text and the device's dark mode.

### How to use

1. Get this repository (GitHub "Code", then "Download ZIP", or `git clone`).
2. Open `index.html` in your browser. No server or installation is needed.
3. Enter a number in the weight field and press the record button. Today's date is filled in. You can add past weeks by choosing a date.

Accepted range is 20.0 to 400.0 kg, with at most one decimal place. Future dates are not accepted.

### Terms

| Term | Meaning |
|---|---|
| Week | Monday to Sunday, decided by the device's date |
| Difference from previous | Difference from the closest earlier week that has a record. If weeks without a record lie between, the page shows which week it compared with |
| Difference from first | Difference from the oldest record |
| Consecutive weeks | Number of weeks in a row with a record, counted back from the latest record. One missing week stops the count |

Differences are computed from all records each time the page is drawn. They are not stored.

### Your data

- Records are stored **only in this device's browser** (`localStorage`: key `weekly-weight-v1` holds the dates and weights, key `weekly-weight-last-backup` holds the date of your last backup). Nothing else is stored.
- What you enter is not sent to the outside. No analytics are included.
- When you open the public page (GitHub Pages), GitHub logs visitors' IP addresses for security purposes. The weights and dates you enter are not included.
- **Records can disappear.** If you clear browser data, the device breaks or is replaced, or you open the page in a different browser, the records may be lost or invisible.
- **Save a backup about once a month** with the "Save backup" button. You can log every week without making backups.
- To move to another device, save a backup on the current one, bring the file to the new one, and load it there. Loading replaces the current records with the file's content. It does not merge.
- If the saved data cannot be read, or the browser does not allow saving, the page says so and leaves your records unchanged.
- Backup files are named `weekly-weight-YYYY-MM-DD.json`. They are listed in `.gitignore` so they are not committed.

Backup format:

```json
{
  "app": "weekly-weight",
  "version": 1,
  "exportedAt": "2026-11-02T20:15:00+09:00",
  "records": [
    { "date": "2026-10-12", "kg": 63.0 },
    { "date": "2026-10-19", "kg": 62.6 }
  ]
}
```

When loading, the page checks: file size at most 1 MB; `app` and `version` match; 1 to 5000 records; each date is a real date and not in the future; each weight is between 20.0 and 400.0 with one decimal place; no two records in the same week. If any check fails, your records are left unchanged.

### Not included

Meal logging, daily input, accounts, ads, payments, and sharing other than the backup file.

### Tests

With Node.js 22 or later, run this in the repository folder. No packages need to be installed.

```
node --test
```

- `core.test.js`: week calculation, input parsing, differences, consecutive weeks, chart, backup validation, and more.
- `source.test.js`: checks that banned wording is absent from the page, that there is no way to send data out, and that `confirm()` and external scripts are not used.
- `app.test.js`: runs `app.js` on a small fake page and checks, for example, that notice lines are not rewritten with the same text and that changing the date clears the date error.

### Files

| File | Content |
|---|---|
| `index.html` | The page and its CSS |
| `core.js` | Calculation, validation, storage read/write (no DOM; also loadable from Node) |
| `app.js` | Rendering and interaction |
| `core.test.js` | Unit tests for `core.js` |
| `source.test.js` | Checks on page wording and on the absence of external sending and `confirm()` |
| `app.test.js` | Checks on how `app.js` behaves on a fake page (no library) |
| `.gitignore` | Keeps backup files out of the repository |

### Bugs and questions

Please report bugs and unclear points as an Issue in this repository. **Do not paste your actual weight records into an Issue.**

### License

[AGPL-3.0-only](LICENSE). Copyright (c) 2026 R38K51.

---

<a id="日本語"></a>

## 日本語

[English](#english)

### 週イチ体重とは

毎日の記録が続かなかった人が、体重だけを週に1回、1つの数字として残すためのページです。体重を入れて「記録する」を押すと、前回との差、開始からの差、連続して記録した週の数、推移のグラフが表示されます。

アカウントの登録はありません。サーバー側の処理はありません。入力した内容は、外部へ送信しません。

### 機能

- **週に1件だけ記録**：週は月曜はじまり、日曜まで。同じ週にもう一度入れると、その週の記録だけを置き換えます（置き換える前に案内が出ます。ほかの週の記録は残ります）。
- **数字の表示**：最新の体重、前回との差、開始からの差、連続週数。差は符号つきの数字だけで示し、色や矢印で良し悪しは付けません。
- **推移のグラフ**：外部ライブラリを使わない、自前の SVG。直近52週まで表示します。
- **これまでの記録**：新しい週が上。記録のない週は1行で示します。12行ずつ表示します。
- **バックアップの保存と読み込み**：JSON ファイルで保存し、別の端末や消えた後に読み込めます。
- **スマートフォンでも使える画面**：幅360 px で横スクロールが出ないように作っています。文字を大きくした表示や、端末のダークモードにも対応しています。

### 使い方

1. このリポジトリを入手します（GitHub の「Code」から「Download ZIP」、または `git clone`）。
2. フォルダの中の `index.html` を、ブラウザで開きます。サーバーやインストールは要りません。
3. 「体重（kg）」に数字を入れて、「記録する」を押します。日付は今日が入っています。過去の週の記録は、日付を選べば後から足せます。

入れられる範囲は 20.0〜400.0 kg、小数は第1位までです。未来の日付は記録できません。

### 用語

| 語 | 意味 |
|---|---|
| 週 | 月曜日から日曜日までの7日間。端末の日付で決まります |
| 前回との差 | その週より前で、最も近い週の記録との差。間に記録のない週があるときは、比べた週の日付を添えます |
| 開始からの差 | 最も古い週の記録との差 |
| 連続週数 | 最新の記録の週から、記録のある週が続いている数。1週でも抜けると、そこで止まります |

差の計算は、記録全体から表示のたびに行います（差は保存しません）。

### データの扱い

- 記録は、**この端末のブラウザの中だけ**に保存されます（`localStorage`。キー `weekly-weight-v1` に記録の日付と体重、キー `weekly-weight-last-backup` に最後にバックアップを作った日）。保存するのはこれだけです。
- 外部へは送信しません（アクセス解析も入れていません）。
- 公開ページ（GitHub Pages）を開くと、GitHub が安全のために訪問者の IP アドレスを記録します。入力した体重や日付は含まれません。
- **記録は消えることがあります。** ブラウザのデータを消したとき、端末の故障や買い替え、別のブラウザで開いたときは、記録が消えるか、見られなくなります。
- そのため、**月に1回ほどバックアップを保存してください**（画面の「バックアップを保存」）。バックアップをしなくても、毎週の記録はできます。
- 別の端末へ移すときは、今の端末でバックアップを保存し、できたファイルを新しい端末へ渡して、「バックアップを読み込む」を押します。読み込みは、いまの記録をファイルの内容に置き換えます（合成はしません）。
- 保存データが読めないとき、ブラウザが保存を許可していないときは、記録を変えずに、その旨を表示します。
- バックアップのファイル名は `weekly-weight-YYYY-MM-DD.json`。このファイルは `.gitignore` に入れてあり、リポジトリに載らないようにしています。

バックアップの形式：

```json
{
  "app": "weekly-weight",
  "version": 1,
  "exportedAt": "2026-11-02T20:15:00+09:00",
  "records": [
    { "date": "2026-10-12", "kg": 63.0 },
    { "date": "2026-10-19", "kg": 62.6 }
  ]
}
```

読み込みでは、ファイルが1 MB以下であること、`app` と `version` が合っていること、記録が1〜5000件であること、日付が実在して今日以前であること、体重が20.0〜400.0で小数第1位までであること、同じ週の記録が重なっていないことを確かめます。1つでも外れたら、記録は変えません。

### 作らないもの

食事の記録、毎日の入力、アカウント、広告、課金、バックアップ以外の共有は、作りません。

### テスト

Node.js 22以上で、このフォルダから次を実行します。依存パッケージの導入は要りません。

```
node --test
```

- `core.test.js`：週の計算、入力の変換、差、連続週数、グラフ、バックアップの検査など。
- `source.test.js`：画面に載せない語がないこと、外部送信の手段がないこと、`confirm()` と外部のスクリプトがないこと。
- `app.test.js`：小さな模擬の画面で `app.js` を動かし、案内の行が同じ文のまま書き直されないこと、日付を変えると日付のエラーが消えることなど。

### ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | 画面と CSS |
| `core.js` | 計算、検査、保存の読み書き（DOM なし。Node からも読める） |
| `app.js` | 画面の描画と操作 |
| `core.test.js` | `core.js` の単体テスト |
| `source.test.js` | 画面に載せない語、外部送信、`confirm()` がないことの確認 |
| `app.test.js` | 模擬の画面での `app.js` の動きの確認（ライブラリなし） |
| `.gitignore` | バックアップのファイルを載せない設定 |

### 不具合や質問

不具合や分かりにくい点は、このリポジトリの Issue でお知らせください。**Issue に実際の体重の記録を貼らないでください。**

### ライセンス

[AGPL-3.0-only](LICENSE)。Copyright (c) 2026 R38K51。
