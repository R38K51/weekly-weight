const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const core = require("./core.js");

// All weights and dates in this file are made up for testing.

const r = (date, kg) => ({ date, kg });

function fakeStorage(initial = {}, { failGet = false, failSet = false, failRemove = false, ignoreRemove = false } = {}) {
  const data = { ...initial };
  const calls = { get: [], set: [], remove: [] };
  return {
    data,
    calls,
    getItem(key) {
      calls.get.push(key);
      if (failGet) throw new Error("blocked");
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      calls.set.push(key);
      if (failSet) throw new Error("quota");
      data[key] = String(value);
    },
    removeItem(key) {
      calls.remove.push(key);
      if (failRemove) throw new Error("blocked");
      if (!ignoreRemove) delete data[key];
    },
  };
}

// ---- weeks ----

test("weeks start on Monday, across months, years and leap days", () => {
  assert.equal(core.weekOf("2026-11-01"), "2026-10-26"); // Sunday
  assert.equal(core.weekOf("2026-11-02"), "2026-11-02"); // Monday
  assert.equal(core.weekOf("2026-11-08"), "2026-11-02"); // Sunday of the same week
  assert.equal(core.weekOf("2027-01-01"), "2026-12-28"); // Friday, the week began last year
  assert.equal(core.weekOf("2027-01-03"), "2026-12-28");
  assert.equal(core.weekOf("2027-01-04"), "2027-01-04");
  assert.equal(core.weekOf("2028-02-29"), "2028-02-28"); // leap day, Tuesday
  assert.equal(core.weekOf("2028-03-05"), "2028-02-28");
  assert.equal(core.isRealDate("2028-02-29"), true);
  assert.equal(core.isRealDate("2027-02-29"), false);
  assert.equal(core.isRealDate("2026-13-01"), false);
  assert.equal(core.isRealDate("2026-11-2"), false);
  assert.equal(core.isRealDate(""), false);
});

test("results do not depend on the time zone", () => {
  const script = `
    const c = require(${JSON.stringify(path.join(__dirname, "core.js"))});
    const rows = c.buildRows([{date:"2026-10-12",kg:63.0},{date:"2026-10-26",kg:62.9},{date:"2026-11-08",kg:62.7}]);
    process.stdout.write(JSON.stringify([
      c.weekOf("2026-11-01"), c.weekOf("2026-11-02"), c.weekOf("2027-01-03"), c.weekOf("2028-02-29"),
      c.streak([{date:"2026-11-02",kg:62}], "2026-11-09"), rows.map(x => [x.week, x.diffTenths, x.gapWeeks]),
      c.formatWeekRange("2026-12-28", "2027-01-05"),
      c.weekNoticeText("2026-11-08", "2026-11-09"), c.weekNoticeText("2026-12-31", "2027-01-05"),
    ]));
  `;
  const zones = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
  const run = (tz, code) => execFileSync(process.execPath, ["-e", code], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  // The zones really differ in the child processes.
  const offsets = zones.map((tz) => run(tz, "process.stdout.write(String(new Date(2026, 10, 2).getTimezoneOffset()))"));
  assert.equal(new Set(offsets).size, zones.length);
  const outputs = zones.map((tz) => run(tz, script));
  for (const output of outputs) assert.equal(output, outputs[0]);
  assert.deepEqual(JSON.parse(outputs[0]).slice(0, 4), ["2026-10-26", "2026-11-02", "2026-12-28", "2028-02-28"]);
});

// ---- input ----

test("weight input is normalized and checked in order", () => {
  assert.deepEqual(core.parseKgInput("62.4"), { ok: true, kg: 62.4 });
  assert.deepEqual(core.parseKgInput("６２．４"), { ok: true, kg: 62.4 });
  assert.deepEqual(core.parseKgInput("62,4"), { ok: true, kg: 62.4 });
  assert.deepEqual(core.parseKgInput(" 62 "), { ok: true, kg: 62 });
  assert.deepEqual(core.parseKgInput("20"), { ok: true, kg: 20 });
  assert.deepEqual(core.parseKgInput("400.0"), { ok: true, kg: 400 });
  assert.equal(core.parseKgInput("").error, "EMPTY");
  assert.equal(core.parseKgInput("　 ").error, "EMPTY");
  assert.equal(core.parseKgInput("abc").error, "NOT_NUMBER");
  assert.equal(core.parseKgInput("62.").error, "NOT_NUMBER");
  assert.equal(core.parseKgInput("62.4x").error, "NOT_NUMBER");
  assert.equal(core.parseKgInput("62.45").error, "DECIMALS");
  assert.equal(core.parseKgInput("500.45").error, "DECIMALS"); // decimals are checked before range
  assert.equal(core.parseKgInput("19.9").error, "RANGE");
  assert.equal(core.parseKgInput("400.1").error, "RANGE");
  assert.equal(core.parseKgInput("-62").error, "RANGE");
});

test("a fixed input is told in one line; plain input is not", () => {
  const cases = [
    ["62,9", "入力の「62,9」は 62.9 として記録しました。"],
    ["６２．９", "入力の「６２．９」は 62.9 として記録しました。"],
    ["６２", "入力の「６２」は 62.0 として記録しました。"],
    ["62，9", "入力の「62，9」は 62.9 として記録しました。"],
    ["6 2.9", "入力の「6 2.9」は 62.9 として記録しました。"],
    [" 62,9 ", "入力の「62,9」は 62.9 として記録しました。"],
  ];
  for (const [text, expected] of cases) {
    const kg = core.parseKgInput(text);
    assert.equal(kg.ok, true, text);
    assert.equal(core.inputCorrectionText(text, kg.kg), expected);
  }
  for (const text of ["62.9", "62", " 62.9 ", "62.0", "　62.9"]) {
    const kg = core.parseKgInput(text);
    assert.equal(kg.ok, true, text);
    assert.equal(core.inputCorrectionText(text, kg.kg), null, text);
  }
});

test("dates must be present and not in the future", () => {
  assert.equal(core.checkDate("", "2026-11-02").error, "EMPTY");
  assert.equal(core.checkDate("2026-02-30", "2026-11-02").error, "EMPTY");
  assert.equal(core.checkDate("2026-11-03", "2026-11-02").error, "FUTURE");
  assert.equal(core.checkDate("2026-11-02", "2026-11-02").ok, true);
  assert.equal(core.checkDate("2020-01-06", "2026-11-02").ok, true);
});

// ---- records and differences ----

test("a second record in a week replaces the first, without changing the input", () => {
  const before = [r("2026-10-26", 62.8)];
  let records = core.upsertRecord(before, r("2026-11-03", 62.4));
  records = core.upsertRecord(records, r("2026-11-08", 62.1));
  assert.deepEqual(records, [r("2026-10-26", 62.8), r("2026-11-08", 62.1)]);
  assert.deepEqual(before, [r("2026-10-26", 62.8)]);
  assert.deepEqual(core.findSameWeek(records, "2026-11-02"), r("2026-11-08", 62.1));
  assert.equal(core.findSameWeek(records, "2026-10-19"), null);
  assert.equal(core.findSameWeek(records, ""), null);
});

test("rows follow the design example, including a skipped week", () => {
  const rows = core.buildRows([r("2026-11-02", 62.7), r("2026-10-12", 63.0), r("2026-10-26", 62.9)]);
  assert.deepEqual(
    rows.map((row) => [row.week, row.diffTenths, row.gapWeeks, row.startDiffTenths]),
    [
      ["2026-10-12", null, null, null],
      ["2026-10-26", -1, 2, -1],
      ["2026-11-02", -2, 1, -3],
    ],
  );
  assert.deepEqual(rows[2].previous, { week: "2026-10-26", kg: 62.9 });
});

test("a skipped week is named by date and gets its own history row, never a week count", () => {
  const records = [r("2026-11-02", 62.7), r("2026-10-12", 63.0), r("2026-10-26", 62.9)];
  const rows = core.historyRows(records, "2026-11-04");
  assert.deepEqual(
    rows.map((row) => [row.week, row.diffNote, row.gapBelow]),
    [
      ["2026-11-02", "", null],
      ["2026-10-26", "（10月12日の週と比べた差）", "10月19日〜25日は記録なし"],
      ["2026-10-12", "", null],
    ],
  );
  for (const row of rows) {
    assert.ok(!/\d週/.test(row.diffNote + (row.gapBelow ?? "")), "no week count that reads like the streak");
  }
  const summary = core.summarize(records, "2026-11-04");
  assert.equal(core.previousDiffLabel(summary.latest), "前回との差");
  assert.equal(core.previousDiffLabel(core.buildRows(records)[1]), "前回との差（記録のない週をはさむ）");
});

test("several skipped weeks make one row, across months and years", () => {
  const rows = core.historyRows([r("2026-09-01", 63.4), r("2026-10-07", 63.1)], "2026-11-04");
  // 9月1日 is in the week of 8月31日; 10月7日 in the week of 10月5日.
  assert.equal(rows[0].gapBelow, "9月7日〜10月4日は記録なし");
  assert.equal(rows[0].diffNote, "（8月31日の週と比べた差）");
  const late = core.historyRows([r("2026-12-16", 64.1), r("2027-01-13", 63.8)], "2027-02-01");
  assert.equal(late[0].gapBelow, "2026年12月21日〜2027年1月10日は記録なし");
  assert.equal(late[0].diffNote, "（2026年12月14日の週と比べた差）");
  const sameYear = core.historyRows([r("2026-12-16", 64.1), r("2027-01-13", 63.8)], "2026-12-31");
  assert.equal(sameYear[0].gapBelow, "12月21日〜1月10日は記録なし");
});

test("differences are exact to 0.1 kg", () => {
  // 62.3 - 62.0 is not exactly 0.3 in floating point.
  assert.notEqual(62.3 - 62.0, 0.3);
  const rows = core.buildRows([r("2026-10-05", 62.0), r("2026-10-12", 62.3), r("2026-10-19", 62.3)]);
  assert.equal(rows[1].diffTenths, 3);
  assert.equal(rows[2].diffTenths, 0);
  assert.equal(core.formatDiff(rows[1].diffTenths), "+0.3");
  assert.equal(core.formatDiff(rows[2].diffTenths), "±0.0");
  assert.equal(core.formatDiff(-2), "−0.2");
  assert.equal(core.formatDiff(-15), "−1.5");
  assert.equal(core.spokenDiff("前回との差", -2), "前回との差 マイナス 0.2 キログラム");
  assert.equal(core.spokenDiff("開始からの差", 4), "開始からの差 プラス 0.4 キログラム");
  assert.equal(core.formatKg(63), "63.0 kg");
  assert.equal(core.formatKgNumber(63), "63.0");
  assert.equal(core.formatKgNumber(64.8), "64.8");
  assert.equal(core.formatKgNumber(400), "400.0");
});

test("overwriting the oldest week changes every start difference", () => {
  let records = [r("2026-10-05", 63.2), r("2026-10-12", 62.8), r("2026-10-19", 62.5)];
  assert.deepEqual(core.buildRows(records).map((row) => row.startDiffTenths), [null, -4, -7]);
  records = core.upsertRecord(records, r("2026-10-07", 62.6));
  const rows = core.buildRows(records);
  assert.equal(records.length, 3);
  assert.deepEqual(rows.map((row) => row.startDiffTenths), [null, 2, -1]);
  assert.deepEqual(rows.map((row) => row.diffTenths), [null, 2, -3]);
});

test("overwriting a later week keeps the start weight (screen records 05 to 08)", () => {
  // The same steps as the screen records, with the same made-up values.
  let records = core.upsertRecord([], r("2026-10-12", core.parseKgInput("６３．０").kg));
  records = core.upsertRecord(records, r("2026-10-26", core.parseKgInput("62,9").kg));
  records = core.upsertRecord(records, r("2026-11-04", 62.7));
  let summary = core.summarize(records, "2026-11-04");
  assert.equal(summary.start.kg, 63.0);
  assert.equal(summary.latest.startDiffTenths, -3);
  records = core.upsertRecord(records, r("2026-11-03", 62.5)); // overwrite the latest week
  summary = core.summarize(records, "2026-11-04");
  assert.deepEqual(records, [r("2026-10-12", 63.0), r("2026-10-26", 62.9), r("2026-11-03", 62.5)]);
  assert.equal(summary.start.kg, 63.0);
  assert.equal(summary.start.week, "2026-10-12");
  assert.equal(summary.latest.diffTenths, -4);
  assert.equal(summary.latest.startDiffTenths, -5);
  // Overwriting a middle week does not change the start either.
  records = core.upsertRecord(records, r("2026-10-27", 64.0));
  summary = core.summarize(records, "2026-11-04");
  assert.equal(summary.start.kg, 63.0);
  assert.equal(summary.latest.startDiffTenths, -5);
});

test("streak counts from the latest record's week", () => {
  const records = [r("2026-10-12", 63.0), r("2026-10-26", 62.9), r("2026-11-02", 62.7)];
  assert.equal(core.streak(records, "2026-11-02"), 2); // design example
  assert.equal(core.streak(records, "2026-11-15"), 2); // last week counts, this week is not over
  assert.equal(core.streak(records, "2026-11-16"), null); // two weeks ago
  assert.equal(core.streak([r("2026-11-04", 62.0)], "2026-11-05"), 1);
  assert.equal(core.streak([r("2026-10-05", 62.0)], "2026-11-05"), null); // one old record gives "—"
  assert.equal(core.streak([], "2026-11-05"), null);
  const run = [r("2026-12-21", 62.4), r("2026-12-28", 62.3), r("2027-01-04", 62.5)];
  assert.equal(core.streak(run, "2027-01-06"), 3); // across the new year
});

test("summary gives what the cards need", () => {
  const empty = core.summarize([], "2026-11-02");
  assert.equal(empty.count, 0);
  assert.equal(empty.latest, null);
  const one = core.summarize([r("2026-11-02", 62.7)], "2026-11-02");
  assert.equal(one.count, 1);
  assert.equal(one.latest.diffTenths, null);
  assert.equal(one.latest.startDiffTenths, null);
  assert.equal(one.streak, 1);
  const many = core.summarize([r("2026-10-12", 63.0), r("2026-10-26", 62.9), r("2026-11-02", 62.7)], "2026-11-02");
  assert.equal(many.latest.diffTenths, -2);
  assert.equal(many.latest.startDiffTenths, -3);
  assert.equal(many.start.week, "2026-10-12");
});

test("next record week: this week until it is recorded, then the week after", () => {
  assert.equal(core.nextRecordWeek([], "2026-11-04"), null);
  assert.equal(core.nextRecordText([], "2026-11-04"), null);
  const lastWeek = [r("2026-10-26", 62.9)];
  assert.equal(core.nextRecordWeek(lastWeek, "2026-11-04"), "2026-11-02");
  assert.equal(core.nextRecordText(lastWeek, "2026-11-04"), "次の記録は、11月2日（月）から始まる週（今週）です。");
  const thisWeek = [r("2026-10-26", 62.9), r("2026-11-04", 62.7)];
  assert.equal(core.nextRecordWeek(thisWeek, "2026-11-04"), "2026-11-09");
  assert.equal(core.nextRecordText(thisWeek, "2026-11-08"), "次の記録は、11月9日（月）から始まる週です。");
  // A long gap: this week, not the week after the old record.
  assert.equal(core.nextRecordWeek([r("2026-09-07", 63.1)], "2026-11-04"), "2026-11-02");
  // Across the new year, the year is written by the Monday's year.
  assert.equal(core.nextRecordText([r("2026-12-30", 62.4)], "2026-12-31"), "次の記録は、2027年1月4日（月）から始まる週です。");
  // Saved dates after today (clock went back): the week after the latest record.
  assert.equal(core.nextRecordWeek([r("2026-11-10", 62.4)], "2026-11-04"), "2026-11-16");
});

test("one record: the dash is explained as 'record once more next week'", () => {
  assert.equal(core.ONE_RECORD_NOTE, "次の週にもう1回記録すると、差が出ます");
});

// ---- year display ----

test("the year is written only when it is not this year", () => {
  assert.equal(core.formatWeekLabel("2026-11-02", "2026-11-05"), "11月2日の週");
  assert.equal(core.formatWeekLabel("2026-12-28", "2027-01-05"), "2026年12月28日の週");
  assert.equal(core.formatWeekLabel("2026-12-28", "2026-12-30"), "12月28日の週");
  assert.equal(core.formatWeekLabel("2026-12-28", "2027-01-02"), "2026年12月28日の週"); // judged by Monday
  assert.equal(core.formatWeekLabelWithDay("2026-11-02", "2026-11-05"), "11月2日（月）から始まる週");
  assert.equal(core.formatWeekLabelWithDay("2025-11-03", "2026-11-05"), "2025年11月3日（月）から始まる週");
  assert.equal(core.formatWeekLabelWithDay("2026-12-28", "2027-01-02"), "2026年12月28日（月）から始まる週");
  assert.equal(core.formatDate("2027-01-01", "2027-01-05"), "1月1日"); // a single date uses its own year
  assert.equal(core.formatDate("2026-12-31", "2027-01-05"), "2026年12月31日");
  assert.equal(core.formatWeekRange("2026-11-02", "2026-11-05"), "11月2日〜8日");
  assert.equal(core.formatWeekRange("2026-10-26", "2026-11-05"), "10月26日〜11月1日");
  assert.equal(core.formatWeekRange("2026-12-28", "2026-12-30"), "12月28日〜1月3日");
  assert.equal(core.formatWeekRange("2026-12-28", "2027-01-05"), "2026年12月28日〜2027年1月3日");
  assert.equal(core.formatWeekRange("2025-11-03", "2026-11-05"), "2025年11月3日〜9日");
});

test("a record on a Wednesday is shown as the week starting on Monday", () => {
  const week = core.weekOf("2026-11-04");
  assert.equal(core.formatWeekLabelWithDay(week, "2026-11-04"), "11月2日（月）から始まる週");
  assert.equal(core.formatWeekRange(week, "2026-11-04"), "11月2日〜8日"); // the history row includes 11月4日
  assert.equal(core.formatWeekRange(core.weekOf("2026-11-01"), "2026-11-04"), "10月26日〜11月1日");
});

// ---- chart ----

test("chart axis follows the 2 kg minimum with the extra 0.1 kg on top", () => {
  const model = core.chartModel([r("2026-10-12", 63.0), r("2026-10-26", 62.9), r("2026-11-02", 62.7)], "2026-11-02");
  assert.equal(model.yTop, "63.9");
  assert.equal(model.yBottom, "61.9");
  assert.equal(model.xFirst, "10月12日");
  assert.equal(model.xLast, "11月2日");
  assert.equal(model.truncated, false);
  assert.equal(model.label, "体重の推移。10月12日の週 63.0 kg から、11月2日の週 62.7 kg まで、3件の記録");
  // Weeks are evenly spaced, and the skipped week still takes its width.
  const [a, b, c] = model.points;
  assert.ok(Math.abs(b.x - a.x - 2 * (c.x - b.x)) < 0.05);
  assert.equal(a.x, model.plot.left);
  assert.equal(c.x, model.plot.right);
  assert.deepEqual(model.points.map((p) => p.latest), [false, false, true]);
});

test("chart axis keeps the 0.5 kg margin when the range is already wide", () => {
  const model = core.chartModel([r("2026-10-05", 64.0), r("2026-10-12", 61.0)], "2026-11-02");
  assert.equal(model.yTop, "64.5");
  assert.equal(model.yBottom, "60.5");
});

test("chart with one record puts the point in the middle", () => {
  const model = core.chartModel([r("2026-11-02", 62.7)], "2026-11-02");
  assert.equal(model.points.length, 1);
  assert.equal(model.points[0].x, (model.plot.left + model.plot.right) / 2);
  assert.equal(model.yTop, "63.7");
  assert.equal(model.yBottom, "61.7");
  assert.equal(model.label, "体重の推移。11月2日の週 62.7 kg、1件の記録");
  assert.equal(core.chartModel([], "2026-11-02"), null);
});

test("chart shows the last 52 weeks counted from the latest record", () => {
  const records = [];
  for (let i = 0; i < 53; i++) {
    const date = new Date(Date.UTC(2025, 10, 3) + i * 7 * 86400000).toISOString().slice(0, 10);
    records.push(r(date, 62 + (i % 5) / 10));
  }
  const model = core.chartModel(records, "2026-11-20");
  assert.equal(model.points.length, 52);
  assert.equal(model.truncated, true);
  assert.equal(model.points[0].week, "2025-11-10");
  assert.equal(model.xFirst, "2025年11月10日");
  assert.equal(model.xLast, "11月2日");
  const exact = core.chartModel(records.slice(1), "2026-11-20");
  assert.equal(exact.truncated, false);
});

// ---- backup ----

const TODAY = "2026-11-02";
const backup = (fields) => JSON.stringify({ app: "weekly-weight", version: 1, exportedAt: "x", ...fields });

test("a backup round-trips and has only the four fields", () => {
  const records = [r("2026-10-12", 63), r("2026-10-26", 62.9)];
  const text = core.buildBackup(records, new Date(2026, 10, 2, 20, 15, 0));
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data), ["app", "version", "exportedAt", "records"]);
  assert.match(data.exportedAt, /^2026-11-02T20:15:00[+-]\d{2}:\d{2}$/);
  assert.deepEqual(core.parseBackup(text, TODAY), { ok: true, records });
  assert.equal(core.backupFileName(TODAY), "weekly-weight-2026-11-02.json");
});

test("backup check: unreadable", () => {
  assert.deepEqual(core.parseBackup("not json", TODAY), { ok: false, error: "UNREADABLE" });
  const big = backup({ records: [r("2026-10-12", 63)], pad: "x".repeat(1024 * 1024) });
  assert.deepEqual(core.parseBackup(big, TODAY), { ok: false, error: "UNREADABLE" });
});

test("backup check: wrong format or version", () => {
  const wrong = (text) => assert.deepEqual(core.parseBackup(text, TODAY), { ok: false, error: "WRONG_FORMAT" });
  wrong("[]");
  wrong("null");
  wrong("62");
  wrong(backup({ app: "other", records: [r("2026-10-12", 63)] }));
  wrong(backup({ version: 2, records: [r("2026-10-12", 63)] }));
  wrong(backup({ version: "1", records: [r("2026-10-12", 63)] }));
  wrong(backup({ records: "none" }));
  wrong(backup({}));
  wrong(backup({ records: [] }));
  // The prototype's format is not accepted.
  wrong(JSON.stringify({ entries: [r("2026-10-12", 63)], settings: {} }));
  const many = [];
  for (let i = 0; i < 5001; i++) many.push(r("2026-10-12", 63));
  wrong(backup({ records: many }));
});

test("backup check: a bad record reports its position in the file, before sorting", () => {
  const bad = (record, at = 2) => {
    const records = [r("2026-10-26", 62.9), r("2026-10-12", 63.0), r("2026-10-05", 63.1)];
    records.splice(at - 1, 0, record);
    assert.deepEqual(core.parseBackup(backup({ records }), TODAY), { ok: false, error: "BAD_RECORD", index: at });
  };
  bad(r("2026-02-30", 62.4));
  bad(r("2026/10/19", 62.4));
  bad(r("2026-11-03", 62.4)); // future
  bad(r("2026-10-19", "62.4"));
  bad(r("2026-10-19", 62.45));
  bad(r("2026-10-19", 19.9));
  bad(r("2026-10-19", 400.1));
  bad(r("2026-10-19", null));
  bad(null, 4);
  bad([], 1);
  bad({ date: "2026-10-19" });
});

test("backup check: two records in one week", () => {
  const text = backup({ records: [r("2026-10-12", 63.0), r("2026-10-26", 62.9), r("2026-10-18", 62.8)] });
  assert.deepEqual(core.parseBackup(text, TODAY), { ok: false, error: "DUPLICATE_WEEK" });
});

test("backup check: accepted files are sorted and unknown fields dropped", () => {
  const text = backup({
    extra: true,
    records: [{ date: "2026-10-26", kg: 62.9, note: "x" }, r("2026-10-12", 63), r("2026-11-02", 400)],
  });
  assert.deepEqual(core.parseBackup(text, TODAY), {
    ok: true,
    records: [r("2026-10-12", 63), r("2026-10-26", 62.9), r("2026-11-02", 400)],
  });
  const full = [];
  for (let i = 0; i < 5000; i++) {
    full.push(r(new Date(Date.UTC(2026, 9, 26) - i * 7 * 86400000).toISOString().slice(0, 10), 62.5));
  }
  const result = core.parseBackup(backup({ records: full }), TODAY);
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 5000);
});

// ---- storage ----

const KEY = core.STORAGE_KEY;
const saved = (records) => JSON.stringify({ version: 1, records });

test("loading: missing key is zero records, the prototype key is not read", () => {
  const storage = fakeStorage({ "weekly-weight": '{"entries":[]}' });
  assert.deepEqual(core.loadRecords(storage), { state: "empty", records: [] });
  assert.deepEqual(storage.calls.get, [KEY]);
  assert.deepEqual(storage.calls.set, []);
  assert.equal(KEY, "weekly-weight-v1");
});

test("loading: valid data", () => {
  const storage = fakeStorage({ [KEY]: saved([r("2026-10-26", 62.9), r("2026-10-12", 63.0)]) });
  assert.deepEqual(core.loadRecords(storage), {
    state: "ok",
    records: [r("2026-10-12", 63.0), r("2026-10-26", 62.9)],
  });
});

test("loading: broken data is reported and never written", () => {
  const cases = [
    "{oops",
    "[]",
    JSON.stringify({ version: 2, records: [r("2026-10-12", 63)] }),
    saved([]),
    saved([r("2026-10-12", 63), r("2026-10-13", 62.9)]),
    saved([r("2026-10-12", "63")]),
  ];
  for (const text of cases) {
    const storage = fakeStorage({ [KEY]: text });
    assert.deepEqual(core.loadRecords(storage), { state: "broken" });
    assert.equal(storage.data[KEY], text);
    assert.deepEqual(storage.calls.set, []);
  }
});

test("starting over from broken data removes only the records key, after confirming", () => {
  const original = "{oops";
  const storage = fakeStorage({
    [KEY]: original,
    [core.LAST_BACKUP_KEY]: "2026-10-05",
    "weekly-weight": "prototype",
  });
  assert.equal(core.loadRecords(storage).state, "broken");
  assert.deepEqual(storage.calls.remove, []); // loading never removes
  assert.equal(core.discardSavedData(storage), true);
  assert.deepEqual(storage.calls.remove, [KEY]);
  assert.deepEqual(storage.calls.set, []);
  assert.deepEqual(core.loadRecords(storage), { state: "empty", records: [] });
  assert.equal(storage.data[core.LAST_BACKUP_KEY], "2026-10-05");
  assert.equal(storage.data["weekly-weight"], "prototype");
  // Recording works again from zero records.
  assert.equal(core.saveRecords(storage, [r("2026-11-02", 62.7)]), true);
  assert.equal(core.loadRecords(storage).state, "ok");
});

test("starting over reports failure and leaves the broken data as it was", () => {
  for (const option of [{ failRemove: true }, { ignoreRemove: true }]) {
    const storage = fakeStorage({ [KEY]: "{oops" }, option);
    assert.equal(core.discardSavedData(storage), false);
    assert.equal(storage.data[KEY], "{oops");
    assert.equal(core.loadRecords(storage).state, "broken");
  }
});

test("broken saved data stays byte for byte until the replacement is confirmed", () => {
  const original = '{"version":1,"records":[{"date":"2026-10-12","kg":"x"}]';
  const storage = fakeStorage({ [KEY]: original, other: "keep" });
  assert.equal(core.loadRecords(storage).state, "broken");
  const file = core.parseBackup(backup({ records: [r("2026-10-12", 63.0), r("2026-10-19", 62.6)] }), TODAY);
  assert.equal(file.ok, true);
  assert.equal(core.loadRecords(storage).state, "broken"); // reloading before confirming
  assert.equal(storage.data[KEY], original);
  assert.deepEqual(storage.calls.set, []);
  // Confirming is the only write.
  assert.equal(core.saveRecords(storage, file.records), true);
  assert.deepEqual(storage.calls.set, [KEY]);
  assert.deepEqual(core.loadRecords(storage), { state: "ok", records: file.records });
  assert.equal(storage.data.other, "keep");
});

test("storage that cannot be looked up or read is 'unavailable', and nothing is written", () => {
  // Looking up window.localStorage throws.
  const blockedWindow = {
    get localStorage() {
      throw new Error("SecurityError");
    },
  };
  const storage = core.openStorage(blockedWindow);
  assert.equal(storage, null);
  assert.deepEqual(core.loadRecords(storage), { state: "unavailable" });
  // getItem throws. The saved text is not touched and nothing is set.
  const original = saved([r("2026-10-12", 63.0)]);
  const failing = fakeStorage({ [KEY]: original }, { failGet: true });
  assert.deepEqual(core.loadRecords(failing), { state: "unavailable" });
  assert.deepEqual(failing.calls.get, [KEY]);
  assert.deepEqual(failing.calls.set, []);
  assert.equal(failing.data[KEY], original);
  // A normal window gives its storage back.
  const plain = fakeStorage();
  assert.equal(core.openStorage({ localStorage: plain }), plain);
});

// ---- the clock went back (saved dates after today) ----

// Saved on a later day; the device clock now says 2026-11-02.
const LATER = [r("2026-10-26", 62.9), r("2026-11-09", 62.6), r("2026-11-16", 62.4)];

test("clock went back: saved future dates load as normal records and recording still works", () => {
  const original = saved(LATER);
  const storage = fakeStorage({ [KEY]: original });
  const loaded = core.loadRecords(storage);
  assert.deepEqual(loaded, { state: "ok", records: LATER });
  assert.equal(storage.data[KEY], original); // not rewritten on load
  // Recording today is still checked against today, and works.
  assert.equal(core.checkDate(TODAY, TODAY).ok, true);
  assert.equal(core.checkDate("2026-11-03", TODAY).error, "FUTURE");
  const next = core.upsertRecord(loaded.records, r(TODAY, 62.7));
  assert.equal(core.saveRecords(storage, next), true);
  assert.deepEqual(core.loadRecords(storage), {
    state: "ok",
    records: [r("2026-10-26", 62.9), r("2026-11-02", 62.7), r("2026-11-09", 62.6), r("2026-11-16", 62.4)],
  });
});

test("clock went back: streak, differences and chart still give values", () => {
  const records = [r("2026-10-26", 62.9), r("2026-11-02", 62.7), r("2026-11-09", 62.6), r("2026-11-16", 62.4)];
  assert.equal(core.streak(records, TODAY), 4);
  const summary = core.summarize(records, TODAY);
  assert.equal(summary.count, 4);
  assert.equal(summary.latest.week, "2026-11-16");
  assert.equal(summary.latest.diffTenths, -2);
  assert.equal(summary.latest.gapWeeks, 1);
  assert.equal(summary.latest.startDiffTenths, -5);
  assert.deepEqual(core.buildRows(records).map((row) => row.diffTenths), [null, -2, -1, -2]);
  const model = core.chartModel(records, TODAY);
  assert.notEqual(model, null);
  assert.equal(model.points.length, 4);
  assert.equal(model.xLast, "11月16日");
  assert.equal(model.yTop, "63.7"); // 62.4〜62.9, +0.5 each side, widened to 2 kg
  assert.equal(model.yBottom, "61.7");
});

test("clock went back: a future date in a backup file is still rejected", () => {
  const text = backup({ records: [r("2026-10-26", 62.9), r("2026-11-09", 62.6)] });
  assert.deepEqual(core.parseBackup(text, TODAY), { ok: false, error: "BAD_RECORD", index: 2 });
  // The same records are fine once today is later.
  assert.equal(core.parseBackup(text, "2026-11-09").ok, true);
  assert.throws(() => core.parseBackup(text), TypeError);
});

test("a failed save reports failure and leaves the stored data as it was", () => {
  const before = saved([r("2026-10-12", 63.0)]);
  const storage = fakeStorage({ [KEY]: before }, { failSet: true });
  assert.equal(core.saveRecords(storage, [r("2026-10-12", 63.0), r("2026-10-19", 62.6)]), false);
  assert.equal(storage.data[KEY], before);
  assert.equal(core.saveRecords(null, []), false);
  assert.equal(core.saveRecords(fakeStorage(), [r("2026-10-12", 63.0)]), true);
});

test("the last backup date is kept apart from the records", () => {
  const storage = fakeStorage();
  assert.equal(core.loadLastBackup(storage), null);
  assert.equal(core.saveLastBackup(storage, TODAY), true);
  assert.equal(core.loadLastBackup(storage), TODAY);
  assert.equal(storage.data[core.LAST_BACKUP_KEY], TODAY);
  assert.equal(storage.data[KEY], undefined);
  assert.equal(core.loadLastBackup(fakeStorage({ [core.LAST_BACKUP_KEY]: "nonsense" })), null);
  assert.equal(core.saveLastBackup(fakeStorage({}, { failSet: true }), TODAY), false);
  assert.equal(core.loadLastBackup(null), null);
});

test("backup texts say where the backup goes and do not blame", () => {
  assert.equal(
    core.backupDoneText(core.backupFileName("2026-11-02")),
    "バックアップを作りました（weekly-weight-2026-11-02.json）。ふつうは、スマホでは「ファイル」アプリの「ダウンロード」、パソコンでは「ダウンロード」フォルダに入ります。",
  );
  const none = core.lastBackupText("empty", fakeStorage(), TODAY);
  assert.ok(!/まだ|ません/.test(none), none);
});

test("the 'kept only in this browser' text is shown in every state but unavailable", () => {
  for (const state of ["empty", "ok", "broken"]) assert.equal(core.showsStorageExplanation(state), true);
  assert.equal(core.showsStorageExplanation("unavailable"), false);
  // Both ways of being unavailable lead there.
  assert.equal(core.showsStorageExplanation(core.loadRecords(core.openStorage({ get localStorage() { throw new Error("blocked"); } })).state), false);
  assert.equal(core.showsStorageExplanation(core.loadRecords(fakeStorage({}, { failGet: true })).state), false);
});

test("last backup line: hidden and the key not read only when storage is unavailable", () => {
  const made = { [core.LAST_BACKUP_KEY]: "2026-10-26" };
  for (const state of ["empty", "ok", "broken"]) {
    assert.equal(core.lastBackupText(state, fakeStorage(made), TODAY), "最後にバックアップを作った日：10月26日");
    assert.equal(core.lastBackupText(state, fakeStorage(), TODAY), "バックアップを作ると、ここに作った日が出ます。");
  }
  assert.equal(
    core.lastBackupText("ok", fakeStorage({ [core.LAST_BACKUP_KEY]: "2025-12-29" }), TODAY),
    "最後にバックアップを作った日：2025年12月29日",
  );

  const blocked = fakeStorage(made, { failGet: true });
  assert.equal(core.lastBackupText("unavailable", blocked, TODAY), null);
  assert.deepEqual(blocked.calls, { get: [], set: [], remove: [] });
  assert.equal(core.lastBackupText("unavailable", null, TODAY), null);
});

// ---- design 8 (2026-11-03): the week line, the overwrite texts, the history hint ----

test("week line under the date: Monday to Sunday of the date's week, with （月） and （日）", () => {
  const t = "2026-11-09";
  assert.equal(core.weekNoticeText("2026-11-02", t), "この日付は11月2日（月）〜8日（日）の週の記録になります。"); // Monday
  assert.equal(core.weekNoticeText("2026-11-04", t), "この日付は11月2日（月）〜8日（日）の週の記録になります。"); // Wednesday
  assert.equal(core.weekNoticeText("2026-11-08", t), "この日付は11月2日（月）〜8日（日）の週の記録になります。"); // Sunday
  assert.equal(core.weekNoticeText("2026-11-09", t), "この日付は11月9日（月）〜15日（日）の週の記録になります。"); // today
  // Across months: the Sunday gets its month.
  assert.equal(core.weekNoticeText("2026-11-01", t), "この日付は10月26日（月）〜11月1日（日）の週の記録になります。");
  assert.equal(core.weekNoticeText("2026-10-28", t), "この日付は10月26日（月）〜11月1日（日）の週の記録になります。");
  // Leap years: 2月29日 is inside the week, and the week after it starts in March.
  assert.equal(core.weekNoticeText("2028-02-29", "2028-03-01"), "この日付は2月28日（月）〜3月5日（日）の週の記録になります。");
  assert.equal(core.weekNoticeText("2028-03-01", "2028-03-01"), "この日付は2月28日（月）〜3月5日（日）の週の記録になります。");
  assert.equal(core.weekNoticeText("2024-03-03", "2024-03-04"), "この日付は2月26日（月）〜3月3日（日）の週の記録になります。");
  // Not a leap year: 2月28日 is followed by 3月1日.
  assert.equal(core.weekNoticeText("2027-03-01", "2027-03-02"), "この日付は3月1日（月）〜7日（日）の週の記録になります。");
  assert.equal(core.weekNoticeText("2027-02-28", "2027-03-02"), "この日付は2月22日（月）〜28日（日）の週の記録になります。");
});

test("week line: the year follows the design's year rule for ranges", () => {
  // The Monday's year decides, even when the date itself is in this year; the Sunday
  // gets a year only when the Monday has one and the years differ.
  assert.equal(core.weekNoticeText("2027-01-03", "2027-01-05"), "この日付は2026年12月28日（月）〜2027年1月3日（日）の週の記録になります。");
  assert.equal(core.weekNoticeText("2026-12-31", "2027-01-05"), "この日付は2026年12月28日（月）〜2027年1月3日（日）の週の記録になります。");
  // Seen in the Monday's year: no year at all, the Sunday gets its month.
  assert.equal(core.weekNoticeText("2026-12-31", "2026-12-31"), "この日付は12月28日（月）〜1月3日（日）の週の記録になります。");
  assert.equal(core.weekNoticeText("2027-01-04", "2027-01-05"), "この日付は1月4日（月）〜10日（日）の週の記録になります。");
  // A past year inside one year: the year is written once, on the Monday.
  assert.equal(core.weekNoticeText("2025-11-05", "2026-11-09"), "この日付は2025年11月3日（月）〜9日（日）の週の記録になります。");
  assert.equal(core.weekNoticeText("2025-12-03", "2026-11-09"), "この日付は2025年12月1日（月）〜7日（日）の週の記録になります。");
});

test("week line: no line for an empty, unreal or future date", () => {
  for (const date of ["", null, undefined, "2026-02-30", "2026-13-01", "abc"]) {
    assert.equal(core.weekNoticeText(date, "2026-11-09"), null, String(date));
  }
  assert.equal(core.weekNoticeText("2026-11-10", "2026-11-09"), null);
});

test("week line: the same in every time zone", () => {
  const script = `
    const c = require(${JSON.stringify(path.join(__dirname, "core.js"))});
    process.stdout.write(JSON.stringify([c.weekNoticeText("2026-11-08", "2026-11-09"), c.weekNoticeText("2026-12-31", "2027-01-05")]));
  `;
  for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    const out = execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
    assert.deepEqual(
      JSON.parse(out),
      ["この日付は11月2日（月）〜8日（日）の週の記録になります。", "この日付は2026年12月28日（月）〜2027年1月3日（日）の週の記録になります。"],
      tz,
    );
  }
});

test("overwrite notice before recording: the existing record of the date's week, or nothing", () => {
  const records = [r("2026-10-26", 62.9), r("2026-11-03", 62.7)];
  assert.equal(
    core.overwriteNoticeText(records, "2026-11-08", "2026-11-09"),
    "この週（11月2日〜8日）には 62.7 kg の記録があります。記録すると、この週の記録だけが新しい体重に置き換わります。ほかの週の記録はそのまま残ります。",
  );
  assert.equal(core.overwriteNoticeText(records, "2026-11-09", "2026-11-09"), null);
  assert.equal(core.overwriteNoticeText(records, "", "2026-11-09"), null);
  assert.equal(core.overwriteNoticeText([], "2026-11-08", "2026-11-09"), null);
  assert.equal(
    core.overwriteNoticeText([r("2026-12-29", 63.0)], "2027-01-03", "2027-01-05"),
    "この週（2026年12月28日〜2027年1月3日）には 63.0 kg の記録があります。記録すると、この週の記録だけが新しい体重に置き換わります。ほかの週の記録はそのまま残ります。",
  );
});

test("overwrite line after recording: the old and the new value, the old one taken before upsert", () => {
  const records = [r("2026-10-26", 62.9), r("2026-11-03", 62.9)];
  const typed = core.parseKgInput("62,7");
  const existing = core.findSameWeek(records, "2026-11-05");
  const next = core.upsertRecord(records, { date: "2026-11-05", kg: typed.kg });
  // upsertRecord does not change the record the old value is read from.
  assert.deepEqual(existing, r("2026-11-03", 62.9));
  assert.deepEqual(core.findSameWeek(next, "2026-11-05"), r("2026-11-05", 62.7));
  assert.equal(
    core.overwriteDoneText("2026-11-05", existing.kg, typed.kg, "2026-11-09"),
    "11月2日〜8日の週の記録を 62.9 kg から 62.7 kg に置き換えました。",
  );
});

test("overwrite line after recording: same values, whole numbers and a year-crossing week", () => {
  assert.equal(
    core.overwriteDoneText("2026-11-02", 62.7, 62.7, "2026-11-09"),
    "11月2日〜8日の週の記録を 62.7 kg から 62.7 kg に置き換えました。",
  );
  assert.equal(
    core.overwriteDoneText("2026-11-02", 63, 64, "2026-11-09"),
    "11月2日〜8日の週の記録を 63.0 kg から 64.0 kg に置き換えました。",
  );
  assert.equal(
    core.overwriteDoneText("2027-01-02", 63.1, 63.0, "2027-01-05"),
    "2026年12月28日〜2027年1月3日の週の記録を 63.1 kg から 63.0 kg に置き換えました。",
  );
  assert.equal(
    core.overwriteDoneText("2026-10-30", 62.9, 62.8, "2026-11-09"),
    "10月26日〜11月1日の週の記録を 62.9 kg から 62.8 kg に置き換えました。",
  );
});

test("the history hint and the date field's description order", () => {
  assert.equal(core.HISTORY_HINT, "同じ週の記録は、もう一度記録すると直せます。");
  assert.equal(core.dateDescribedBy({ week: true, overwrite: true, error: true }), "week-notice overwrite date-error");
  assert.equal(core.dateDescribedBy({ week: true, overwrite: false, error: false }), "week-notice");
  assert.equal(core.dateDescribedBy({ week: false, overwrite: true, error: true }), "overwrite date-error");
  assert.equal(core.dateDescribedBy({ week: false, overwrite: false, error: true }), "date-error");
  assert.equal(core.dateDescribedBy({ week: false, overwrite: false, error: false }), "");
});
