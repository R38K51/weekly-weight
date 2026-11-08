const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FILES = ["index.html", "app.js", "core.js"];
const sources = Object.fromEntries(FILES.map((name) => [name, fs.readFileSync(path.join(__dirname, name), "utf8")]));

// Words that must not appear anywhere on the screen (design section 6).
const BANNED_WORDS = [
  "BMI",
  "標準",
  "適正",
  "肥満",
  "やせ",
  "太った",
  "痩せた",
  "増えた",
  "減った",
  "目標",
  "ダイエット",
  "減量",
  "健康",
  "医師",
  "おすすめ",
  "頑張",
  "順調",
  "リバウンド",
  "通知",
];

test("no banned words in the page or scripts", () => {
  for (const [name, text] of Object.entries(sources)) {
    for (const word of BANNED_WORDS) {
      assert.ok(!text.includes(word), `${name} contains ${word}`);
    }
  }
});

test("no way to send data out", () => {
  for (const [name, text] of Object.entries(sources)) {
    for (const api of ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"]) {
      assert.ok(!new RegExp(`\\b${api}\\b`).test(text), `${name} uses ${api}`);
    }
    const urls = text.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`)<>]*/gi) ?? [];
    assert.deepEqual(
      urls.filter((url) => url !== "http://www.w3.org/2000/svg"),
      [],
      `${name} has a URL other than the SVG namespace`,
    );
  }
});

test("no browser confirm dialog and no external scripts", () => {
  for (const [name, text] of Object.entries(sources)) {
    assert.ok(!/(^|[^\w$])confirm\s*\(/.test(text), `${name} calls confirm()`);
  }
  const scripts = [...sources["index.html"].matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]);
  assert.deepEqual(scripts, ["core.js", "app.js"]);
  assert.ok(!/<link\b[^>]*\bhref\s*=\s*["']?(https?:)?\/\//i.test(sources["index.html"]), "external stylesheet");
});

// Design 2 "保存できないとき": these parts are hidden when storage is unavailable.
function storageExplanationParts(html) {
  return [...html.matchAll(/<(\w+)\b[^>]*\bdata-storage-explanation\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) =>
    m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, ""),
  );
}

test("only the 'kept in this browser' text is marked to hide when storage is unavailable", () => {
  const html = sources["index.html"];
  const parts = storageExplanationParts(html);
  assert.ok(parts.length >= 2, "the record note and the backup text are marked");
  assert.ok(parts[0].startsWith("記録はこの端末のブラウザの中だけに保存されます。"), "record note is marked");
  assert.ok(parts.some((text) => text.startsWith("記録は、この端末のブラウザの中だけに保存")), "backup text is marked");
  for (const text of parts) assert.ok(!text.includes("外部へ送信しません"), "the 'not sent out' text stays");
  // The "not sent out" sentence and the two backup buttons are not inside a marked part.
  const unmarked = html.replace(/<(\w+)\b[^>]*\bdata-storage-explanation\b[^>]*>[\s\S]*?<\/\1>/g, "");
  assert.ok(unmarked.includes("入力した内容は外部へ送信しません。"));
  assert.ok(unmarked.includes('id="export"') && unmarked.includes('id="import"'));
  assert.ok(sources["app.js"].includes("[data-storage-explanation]"));
});

test("the backup section says what the plan requires, in plain words", () => {
  const text = sources["index.html"].replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  // Plan: kept only in this browser, when it is lost, a backup is advised, nothing is sent out.
  for (const part of [
    "記録は、この端末のブラウザの中だけに保存されます。",
    "ブラウザのデータを消したとき、端末の故障や買い替え、別のブラウザで開いたときは、記録が消えるか、見られなくなります。",
    "バックアップをしなくても、毎週の記録はできます。",
    "機種変更や別の端末で見るときのために、月に1回ほどバックアップを保存してください。",
    "端末を移すとき：",
    "今の端末で「バックアップを保存」",
    "できたバックアップを、メールなどで新しい端末へ",
    "新しい端末で「バックアップを読み込む」",
  ]) {
    assert.ok(text.includes(part), part);
  }
  const start = text.indexOf("バックアップと保存について");
  const end = text.indexOf("バックアップを保存バックアップを読み込む", start);
  assert.ok(start >= 0 && end > start);
  const body = text.slice(start, end);
  for (const word of ["ファイル", "ダウンロード", "json", "JSON"]) assert.ok(!body.includes(word), word);
});

test("'not sent out' is written once, in the record section, before the first entry", () => {
  // Design 3-7: the plan asks for it on the screen, not for a number of times.
  const html = sources["index.html"];
  const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  assert.equal(text.match(/外部へ送信しません/g).length, 1);
  assert.ok(!sources["app.js"].includes("外部へ送信") && !sources["core.js"].includes("外部へ送信"));
  const record = html.slice(html.indexOf('<section aria-labelledby="h-record">'), html.indexOf('id="numbers-section"'));
  // Shown in every state: it is outside the part hidden while storage is unavailable.
  assert.ok(record.includes("</span>入力した内容は外部へ送信しません。</p>"));
});

test("history numbers do not wrap and the unit is in the header", () => {
  const html = sources["index.html"];
  assert.match(html, /td\.num, td \.num, th \.num \{ white-space: nowrap; overflow-wrap: normal; \}/);
  const app = sources["app.js"];
  assert.ok(app.includes('["体重", "（kg）"], ["前回との差", "（kg）"]'));
  assert.ok(app.includes('el("td", { class: "num" }, C.formatKgNumber(row.kg))'));
  assert.ok(app.includes('el("span", { class: "num" }, C.formatDiff(row.diffTenths))'));
});

test("skipped weeks are not shown as a week count, and get their own history row", () => {
  // "2週前" read like the streak "連続 2 週" (design 2, 差の計算).
  for (const name of FILES) assert.ok(!sources[name].includes("週前"), `${name} still writes a week count`);
  const app = sources["app.js"];
  assert.ok(app.includes("C.historyRows(records, t)"));
  assert.ok(app.includes('el("td", { colspan: "3" }, row.gapBelow)'));
  assert.ok(app.includes("C.previousDiffLabel(latest)"));
});

test("the prototype storage key is not used", () => {
  for (const [name, text] of Object.entries(sources)) {
    assert.ok(!/(getItem|setItem|removeItem)\(\s*["']weekly-weight["']/.test(text), `${name} touches the old key`);
  }
  assert.ok(!/\bclear\(\)/.test(sources["app.js"] + sources["core.js"]), "storage is never cleared");
  // The only removal is the records key, in discardSavedData (broken data, confirmed).
  assert.ok(!/\bremoveItem\b/.test(sources["app.js"]), "app.js removes nothing directly");
  assert.deepEqual(sources["core.js"].match(/removeItem\([^)]*\)/g), ["removeItem(STORAGE_KEY)"]);
});

test("starting over without a backup is offered only for broken data, behind a confirmation", () => {
  const html = sources["index.html"];
  const app = sources["app.js"];
  assert.ok(html.includes("バックアップがない場合は、保存データを消して、記録0件から始められます。消した保存データは戻せません。"));
  assert.ok(!html.includes("この画面からは記録できません"));
  assert.match(html, /<button type="button" class="secondary" id="discard" hidden>保存データを消して、新しく始める<\/button>/);
  assert.ok(html.includes("消した保存データは戻せません。バックアップがあるときは、消さずに「バックアップを読み込む」を使ってください。"));
  assert.ok(app.includes('$("discard").hidden = !broken;'));
  // The button only opens the panel; removing happens on "消して始める", and only while broken.
  assert.equal(app.match(/C\.discardSavedData\(/g).length, 1);
  const yes = app.slice(app.indexOf('$("discard-yes")'));
  assert.ok(yes.indexOf("if (!broken || unavailable) return;") < yes.indexOf("C.discardSavedData("));
  assert.ok(app.includes('$("discard-no").focus();'));
});

test("the 'cannot store' message gives a hint without naming a device, still three sentences", () => {
  const match = /<p id="unavailable"[^>]*>([^<]*)<\/p>/.exec(sources["index.html"]);
  assert.ok(match);
  assert.equal(
    match[1],
    "このブラウザでは、記録の保存が許可されていません。" +
      "ブラウザの設定でCookie（サイトのデータ）の保存を許可するか、プライベートブラウズではない通常の画面で、開き直してください。" +
      "記録は変更していません。",
  );
  assert.equal(match[1].split("。").filter(Boolean).length, 3);
  for (const word of ["iPhone", "Android", "Safari", "Chrome"]) assert.ok(!match[1].includes(word), word);
});

test("the fixed-input line is shown after recording, in the quiet style", () => {
  const app = sources["app.js"];
  assert.ok(app.includes("const fixed = C.inputCorrectionText(typed, kg.kg);"));
  assert.ok(app.includes('el("p", { class: "fixed" }, fixed)'));
  assert.match(sources["index.html"], /\.done \.fixed \{ color: var\(--muted\); font-size: var\(--fs-small\); \}/);
});

test("number cards choose their columns by text size and never break inside a number", () => {
  const html = sources["index.html"];
  // 12.5625em = 201 px at 16 px text: two cards fit from 480 px wide, never at 200% text.
  assert.match(html, /\.cards \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 12\.5625em\), 1fr\)\);/);
  assert.ok(!/@media \(min-width: 480px\)/.test(html), "no fixed 480 px breakpoint for the cards");
  assert.match(html, /\.card \.value \{[^}]*overflow-wrap: normal;[^}]*\}/);
});

// ---- design 8 (2026-11-03) ----

const core = require("./core.js");

// Every new text, built from the real functions with made-up values.
function newTexts() {
  const records = [{ date: "2026-10-26", kg: 62.9 }, { date: "2026-11-03", kg: 62.7 }];
  return [
    core.weekNoticeText("2026-11-04", "2026-11-09"),
    core.weekNoticeText("2026-12-31", "2027-01-05"),
    core.overwriteNoticeText(records, "2026-11-08", "2026-11-09"),
    core.overwriteDoneText("2026-11-04", 62.9, 62.7, "2026-11-09"),
    core.overwriteDoneText("2027-01-02", 63.1, 63.1, "2027-01-05"),
    core.overwriteNoticeText([{ date: "2026-12-29", kg: 63.0 }], "2027-01-03", "2027-01-05"),
    core.weekNoticeText("2028-02-29", "2028-03-01"),
    core.HISTORY_HINT,
  ];
}

test("the new texts have no banned words, no judging words and no promise of removing", () => {
  for (const text of newTexts()) {
    assert.equal(typeof text, "string");
    for (const word of BANNED_WORDS) assert.ok(!text.includes(word), `${text} contains ${word}`);
    // 8-B: facts only. 8-C: nothing can be removed or undone.
    // 2026-11-04: "上書き" became "置き換え"; no words of going up or down either.
    for (const word of ["更新しました", "変わりました", "消せます", "削除", "取り消し", "編集", "修正", "上書き", "増", "減"]) {
      assert.ok(!text.includes(word), `${text} contains ${word}`);
    }
  }
});

test("the week line sits under the date field (and its error), before the button", () => {
  const html = sources["index.html"];
  const date = html.indexOf('<input id="date"');
  const error = html.indexOf('id="date-error"');
  const week = html.indexOf('<p id="week-notice"');
  const button = html.indexOf('id="submit"');
  assert.ok(date < error && error < week && week < button);
  // No aria-live: it would be read again for every day stepped through.
  assert.match(html, /<p id="week-notice" class="week-notice" hidden><\/p>/);
  const app = sources["app.js"];
  assert.ok(app.includes("C.weekNoticeText(dateInput.value, today())"));
  assert.ok(app.includes("C.dateDescribedBy({"));
});

test("the overwrite notice is a polite status, shown from the start and while typing", () => {
  const html = sources["index.html"];
  assert.match(html, /<p id="overwrite" class="notice" role="status" aria-live="polite" hidden><\/p>/);
  const app = sources["app.js"];
  // Not while the confirmation after recording is shown.
  assert.ok(app.includes('const done = $("done").childElementCount > 0;'));
  // Typing in the weight field brings it back, so Enter users see it before sending.
  const typing = app.slice(app.indexOf('kgInput.addEventListener("input"'));
  assert.ok(typing.indexOf("updateOverwriteNotice();") < typing.indexOf("});"));
  // render() (start, after import and after starting over) updates both lines.
  const render = app.slice(app.indexOf("function render()"), app.indexOf("// ---- recording ----"));
  assert.ok(render.includes("updateWeekNotice();") && render.includes("updateOverwriteNotice();"));
  // After recording: the confirmation is filled before render(), so the notice stays hidden.
  const submit = app.slice(app.indexOf('$("entry-form").addEventListener("submit"'));
  assert.ok(submit.indexOf("C.overwriteDoneText(date, existing.kg, kg.kg, t)") > 0);
  assert.ok(submit.indexOf('$("done").replaceChildren(...nodes);') < submit.indexOf("render();"));
  assert.ok(submit.indexOf("const existing = C.findSameWeek(records, date);") < submit.indexOf("C.upsertRecord("));
});

test("the history hint is above the table and describes it", () => {
  const html = sources["index.html"];
  const head = html.indexOf('<h2 id="h-history">');
  const hint = html.indexOf('<p id="history-hint"');
  const table = html.indexOf('<div id="history">');
  assert.ok(head < hint && hint < table);
  const app = sources["app.js"];
  assert.ok(app.includes('show($("history-hint"), C.HISTORY_HINT);'));
  assert.ok(app.includes('el("table", { "aria-describedby": "history-hint" })'));
  assert.ok(!/id="(delete|edit|remove)/.test(html), "no delete or edit buttons");
});

test("the last backup line is right under the backup heading, once, in body text size", () => {
  const html = sources["index.html"];
  assert.match(html, /<h2 id="h-backup">バックアップと保存について<\/h2>\s*<p id="last-backup" class="last-backup"><\/p>\s*<div class="backup-text">/);
  assert.equal(html.match(/id="last-backup"/g).length, 1);
  assert.ok(!/\.last-backup \{[^}]*(font-size|font-weight|color)/.test(html), "same size and colour as the body");
});

// ---- 2026-11-04: "上書き" is not used on the screen any more ----

test("the screen says 置き換え, never 上書き", () => {
  for (const [name, text] of Object.entries(sources)) {
    assert.ok(!text.includes("上書き"), `${name} contains 上書き`);
  }
  const notice = core.overwriteNoticeText([{ date: "2026-11-03", kg: 62.7 }], "2026-11-04", "2026-11-09");
  // Only this week's record is replaced, and the other weeks stay; the sentence is about "この週の記録".
  assert.ok(notice.includes("この週の記録だけが新しい体重に置き換わります。"));
  assert.ok(notice.includes("ほかの週の記録はそのまま残ります。"));
  assert.ok(core.overwriteDoneText("2026-11-04", 62.9, 62.7, "2026-11-09").endsWith("に置き換えました。"));
  assert.ok(sources["index.html"].includes("同じ週にもう一度記録すると、その週の記録を置き換えます。"));
});
