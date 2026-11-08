// Calculations for 週イチ体重. No DOM, no clock, no direct storage access,
// so Node can test it and the page can load it with a plain <script>.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WeeklyCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
  const MIN_TENTHS = 200;
  const MAX_TENTHS = 4000;
  const MAX_RECORDS = 5000;
  const MAX_BACKUP_BYTES = 1024 * 1024;
  const CHART_WEEKS = 52;
  const MINUS = "−";

  const STORAGE_KEY = "weekly-weight-v1";
  const LAST_BACKUP_KEY = "weekly-weight-last-backup";

  // ---- dates and weeks (strings are treated as UTC days, so time zones do not matter) ----

  function toUtc(date) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const ms = Date.parse(date + "T00:00:00Z");
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : NaN;
  }

  function fromUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function isRealDate(date) {
    return !Number.isNaN(toUtc(date));
  }

  // The Monday of the date's week, as YYYY-MM-DD.
  function weekOf(date) {
    const ms = toUtc(date);
    const fromMonday = (new Date(ms).getUTCDay() + 6) % 7;
    return fromUtc(ms - fromMonday * DAY_MS);
  }

  function weeksBetween(earlierWeek, laterWeek) {
    return Math.round((toUtc(laterWeek) - toUtc(earlierWeek)) / WEEK_MS);
  }

  function addWeeks(week, count) {
    return fromUtc(toUtc(week) + count * WEEK_MS);
  }

  const toTenths = (kg) => Math.round(kg * 10);

  // ---- input ----

  function normalizeInput(text) {
    return String(text ?? "")
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[．，,]/g, ".")
      .replace(/[－−]/g, "-")
      .replace(/[\s　]/g, "");
  }

  // Order of checks: empty, not a number, two or more decimals, out of range.
  function parseKgInput(text) {
    const value = normalizeInput(text);
    if (value === "") return { ok: false, error: "EMPTY" };
    const match = /^-?\d+(?:\.(\d+))?$/.exec(value);
    if (!match) return { ok: false, error: "NOT_NUMBER" };
    if (match[1] && match[1].length > 1) return { ok: false, error: "DECIMALS" };
    const tenths = toTenths(Number(value));
    if (tenths < MIN_TENTHS || tenths > MAX_TENTHS) return { ok: false, error: "RANGE" };
    return { ok: true, kg: tenths / 10 };
  }

  // One quiet line after recording, when the input had to be fixed to be read
  // (full-width digits, a comma, spaces inside...). null for plain input like
  // "62.9" or "62"; writing 62 as 62.0 is not a fix.
  function inputCorrectionText(text, kg) {
    const raw = String(text ?? "").trim();
    if (/^\d+(\.\d)?$/.test(raw)) return null;
    return `入力の「${raw}」は ${formatKgNumber(kg)} として記録しました。`;
  }

  function checkDate(date, today) {
    if (!date || !isRealDate(date)) return { ok: false, error: "EMPTY" };
    if (date > today) return { ok: false, error: "FUTURE" };
    return { ok: true };
  }

  // ---- records ----

  function findSameWeek(records, date) {
    if (!isRealDate(date)) return null;
    const week = weekOf(date);
    return records.find((record) => weekOf(record.date) === week) ?? null;
  }

  // One record per week. Returns a new array sorted by date; the input is not changed.
  function upsertRecord(records, record) {
    const week = weekOf(record.date);
    return [...records.filter((item) => weekOf(item.date) !== week), { date: record.date, kg: record.kg }].sort(
      (a, b) => a.date.localeCompare(b.date),
    );
  }

  // One row per week, oldest first. Differences are in tenths of a kg.
  function buildRows(records) {
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    const startTenths = sorted.length ? toTenths(sorted[0].kg) : 0;
    return sorted.map((record, index) => {
      const week = weekOf(record.date);
      const tenths = toTenths(record.kg);
      const previous = index > 0 ? sorted[index - 1] : null;
      const previousWeek = previous ? weekOf(previous.date) : null;
      return {
        date: record.date,
        week,
        kg: record.kg,
        tenths,
        previous: previous ? { week: previousWeek, kg: previous.kg } : null,
        diffTenths: previous ? tenths - toTenths(previous.kg) : null,
        gapWeeks: previous ? weeksBetween(previousWeek, week) : null,
        startDiffTenths: index > 0 ? tenths - startTenths : null,
      };
    });
  }

  // Weeks in a row ending at the latest record's week. The current week not being
  // entered yet does not break it; a latest record two or more weeks ago gives null.
  function streak(records, today) {
    if (!records.length) return null;
    const weeks = new Set(records.map((record) => weekOf(record.date)));
    const latest = [...weeks].sort().pop();
    if (weeksBetween(latest, weekOf(today)) > 1) return null;
    let count = 0;
    let cursor = latest;
    while (weeks.has(cursor)) {
      count += 1;
      cursor = addWeeks(cursor, -1);
    }
    return count;
  }

  function summarize(records, today) {
    const rows = buildRows(records);
    const latest = rows[rows.length - 1] ?? null;
    return {
      count: rows.length,
      latest,
      start: rows[0] ?? null,
      streak: streak(records, today),
    };
  }

  // The week to record next: the later of this week and the week after the latest
  // record. null when there are no records. No reminder is sent anywhere; this is
  // only a line on the screen.
  function nextRecordWeek(records, today) {
    if (!records.length) return null;
    const latest = records.map((record) => weekOf(record.date)).sort().pop();
    const afterLatest = addWeeks(latest, 1);
    const thisWeek = weekOf(today);
    return afterLatest > thisWeek ? afterLatest : thisWeek;
  }

  // ---- formatting ----

  function yearOf(date) {
    return Number(date.slice(0, 4));
  }

  function monthDay(date) {
    return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  }

  // A single date: the year is written when it is not this year.
  function formatDate(date, today) {
    return yearOf(date) === yearOf(today) ? monthDay(date) : `${yearOf(date)}年${monthDay(date)}`;
  }

  // A week is judged by its Monday's year.
  function formatWeekStart(week, today) {
    return formatDate(week, today);
  }

  function formatWeekLabel(week, today) {
    return `${formatWeekStart(week, today)}の週`;
  }

  // "11月2日（月）から始まる週": says the week starts on Monday, so a record made
  // on 11月4日 showing 11月2日 does not look shifted.
  function formatWeekLabelWithDay(week, today) {
    return `${formatWeekStart(week, today)}（月）から始まる週`;
  }

  // From a Monday to a Sunday, as two parts: "11月2日〜" and "8日". The year follows
  // the Monday; the Sunday gets a year only when the Monday has one and the years differ.
  // With days, "（月）" and "（日）" follow the two dates (the week line, design 8-A).
  function rangeParts(monday, sunday, today, withDays = false) {
    const start = formatWeekStart(monday, today);
    const withYear = yearOf(monday) !== yearOf(today);
    let endText;
    if (withYear && yearOf(sunday) !== yearOf(monday)) endText = `${yearOf(sunday)}年${monthDay(sunday)}`;
    else if (sunday.slice(0, 7) !== monday.slice(0, 7)) endText = monthDay(sunday);
    else endText = `${Number(sunday.slice(8, 10))}日`;
    return withDays ? [`${start}（月）〜`, `${endText}（日）`] : [`${start}〜`, endText];
  }

  function formatRange(monday, sunday, today) {
    return rangeParts(monday, sunday, today).join("");
  }

  function sundayOf(week) {
    return fromUtc(toUtc(addWeeks(week, 1)) - DAY_MS);
  }


  // "11月2日〜8日", "10月26日〜11月1日", "2026年12月28日〜2027年1月3日".
  function formatWeekRange(week, today) {
    return formatRange(week, sundayOf(week), today);
  }

  function nextRecordText(records, today) {
    const week = nextRecordWeek(records, today);
    if (week === null) return null;
    const thisWeek = week === weekOf(today) ? "（今週）" : "";
    return `次の記録は、${formatWeekLabelWithDay(week, today)}${thisWeek}です。`;
  }

  // ---- texts around the form (design 8, A and B) ----

  // The line under the date field: which week the date belongs to, Monday to Sunday,
  // "11月2日（月）〜8日（日）の週". null when the date is empty, not a real day, or
  // after today (no line; the error says why on submit).
  function weekNoticeText(date, today) {
    if (!isRealDate(date) || !isRealDate(today) || date > today) return null;
    const week = weekOf(date);
    return `この日付は${rangeParts(week, sundayOf(week), today, true).join("")}の週の記録になります。`;
  }

  // Before recording: the week of the date already has a record. Says that only this
  // week's record is replaced and the other weeks stay. null when it has not.
  function overwriteNoticeText(records, date, today) {
    const existing = findSameWeek(records, date);
    if (!existing) return null;
    return `この週（${formatWeekRange(weekOf(existing.date), today)}）には ${formatKg(existing.kg)} の記録があります。記録すると、この週の記録だけが新しい体重に置き換わります。ほかの週の記録はそのまま残ります。`;
  }

  // After recording over a week: the old and the new value, as a fact only.
  // The same sentence is used when both values are equal.
  function overwriteDoneText(date, oldKg, newKg, today) {
    return `${formatWeekRange(weekOf(date), today)}の週の記録を ${formatKg(oldKg)} から ${formatKg(newKg)} に置き換えました。`;
  }

  // Above the history table. Says how to fix a week; nothing can be removed.
  const HISTORY_HINT = "同じ週の記録は、もう一度記録すると直せます。";

  // aria-describedby of the date field: the week line, the overwrite notice, then the error.
  function dateDescribedBy(shown) {
    const ids = [];
    if (shown.week) ids.push("week-notice");
    if (shown.overwrite) ids.push("overwrite");
    if (shown.error) ids.push("date-error");
    return ids.join(" ");
  }

  // Shown under "—" while there is only one record.
  const ONE_RECORD_NOTE = "次の週にもう1回記録すると、差が出ます";

  // The number only, for the history table where the unit is in the header.
  function formatKgNumber(kg) {
    return (toTenths(kg) / 10).toFixed(1);
  }

  function formatKg(kg) {
    return `${formatKgNumber(kg)} kg`;
  }

  function formatDiff(tenths) {
    const abs = (Math.abs(tenths) / 10).toFixed(1);
    if (tenths === 0) return `±${abs}`;
    return `${tenths > 0 ? "+" : MINUS}${abs}`;
  }

  function spokenDiff(label, tenths) {
    const abs = (Math.abs(tenths) / 10).toFixed(1);
    const sign = tenths === 0 ? "プラスマイナス" : tenths > 0 ? "プラス" : "マイナス";
    return `${label} ${sign} ${abs} キログラム`;
  }

  // ---- weeks without a record ----
  // A count of weeks before is not written: it reads like the streak ("連続 2 週").
  // The compared week is named by its date instead, and the empty weeks get a row.

  function hasGap(row) {
    return row.gapWeeks !== null && row.gapWeeks > 1;
  }

  function previousDiffLabel(row) {
    return hasGap(row) ? "前回との差（記録のない週をはさむ）" : "前回との差";
  }

  // History rows, newest first. diffNote follows the difference when weeks were
  // skipped; gapBelow is the line for the skipped weeks, shown under the row.
  function historyRows(records, today) {
    return buildRows(records)
      .map((row) => {
        if (!hasGap(row)) return { ...row, diffNote: "", gapBelow: null };
        const firstEmpty = addWeeks(row.previous.week, 1);
        const lastEmptySunday = fromUtc(toUtc(row.week) - DAY_MS);
        return {
          ...row,
          diffNote: `（${formatWeekLabel(row.previous.week, today)}と比べた差）`,
          gapBelow: `${formatRange(firstEmpty, lastEmptySunday, today)}は記録なし`,
        };
      })
      .reverse();
  }

  // ---- chart ----

  function chartModel(records, today, size = {}) {
    const width = size.width ?? 320;
    const height = size.height ?? 200;
    const left = size.left ?? 56;
    const right = size.right ?? 12;
    const top = size.top ?? 16;
    const bottom = size.bottom ?? 40;
    const rows = buildRows(records);
    if (!rows.length) return null;

    const latestWeek = rows[rows.length - 1].week;
    const firstAllowed = addWeeks(latestWeek, -(CHART_WEEKS - 1));
    const shown = rows.filter((row) => row.week >= firstAllowed);
    const truncated = shown.length < rows.length;

    const values = shown.map((row) => row.tenths);
    let low = Math.min(...values) - 5;
    let high = Math.max(...values) + 5;
    if (high - low < 20) {
      const missing = 20 - (high - low);
      low -= Math.floor(missing / 2);
      high += missing - Math.floor(missing / 2);
    }

    const firstWeek = shown[0].week;
    const span = weeksBetween(firstWeek, latestWeek);
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const x = (week) => (span === 0 ? left + plotWidth / 2 : left + (weeksBetween(firstWeek, week) / span) * plotWidth);
    const y = (tenths) => top + ((high - tenths) / (high - low)) * plotHeight;
    const points = shown.map((row, index) => ({
      week: row.week,
      kg: row.kg,
      x: round2(x(row.week)),
      y: round2(y(row.tenths)),
      latest: index === shown.length - 1,
    }));

    const first = shown[0];
    const last = shown[shown.length - 1];
    const label =
      shown.length === 1
        ? `体重の推移。${formatWeekLabel(last.week, today)} ${formatKg(last.kg)}、1件の記録`
        : `体重の推移。${formatWeekLabel(first.week, today)} ${formatKg(first.kg)} から、` +
          `${formatWeekLabel(last.week, today)} ${formatKg(last.kg)} まで、${shown.length}件の記録`;

    return {
      width,
      height,
      plot: { left, right: width - right, top, bottom: height - bottom },
      points,
      yTop: (high / 10).toFixed(1),
      yBottom: (low / 10).toFixed(1),
      xFirst: formatWeekStart(first.week, today),
      xLast: formatWeekStart(last.week, today),
      truncated,
      label,
    };
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  // ---- backup and storage ----

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // Local time with the offset, e.g. 2026-11-02T20:15:00+09:00.
  function localTimestamp(now) {
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return (
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
      `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
  }

  function backupFileName(today) {
    return `weekly-weight-${today}.json`;
  }

  function buildBackup(records, now) {
    return JSON.stringify(
      {
        app: "weekly-weight",
        version: 1,
        exportedAt: localTimestamp(now),
        records: records.map((record) => ({ date: record.date, kg: record.kg })),
      },
      null,
      2,
    );
  }

  function byteLength(text) {
    let bytes = 0;
    for (const char of text) {
      const code = char.codePointAt(0);
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
  }

  // latestDate: the last allowed date, or null for no limit (the saved data).
  function isValidRecord(record, latestDate) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) return false;
    if (!isRealDate(record.date)) return false;
    if (latestDate !== null && record.date > latestDate) return false;
    const kg = record.kg;
    if (typeof kg !== "number" || !Number.isFinite(kg)) return false;
    if (!/^\d+(\.\d)?$/.test(String(kg))) return false;
    const tenths = toTenths(kg);
    return tenths >= MIN_TENTHS && tenths <= MAX_TENTHS;
  }

  // Checks a list of records the same way for backups and for the saved data.
  // Backups pass today as latestDate; the saved data passes null, so a date that
  // became "future" after the clock went back is still a normal record.
  function checkRecords(list, latestDate) {
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_RECORDS) {
      return { ok: false, error: "WRONG_FORMAT" };
    }
    for (let i = 0; i < list.length; i++) {
      if (!isValidRecord(list[i], latestDate)) return { ok: false, error: "BAD_RECORD", index: i + 1 };
    }
    const weeks = new Set();
    for (const record of list) {
      const week = weekOf(record.date);
      if (weeks.has(week)) return { ok: false, error: "DUPLICATE_WEEK" };
      weeks.add(week);
    }
    const records = list
      .map((record) => ({ date: record.date, kg: record.kg }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, records };
  }

  // Returns { ok: true, records } or { ok: false, error, index? }. Never partial.
  function parseBackup(text, today) {
    if (typeof text !== "string" || byteLength(text) > MAX_BACKUP_BYTES) return { ok: false, error: "UNREADABLE" };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "UNREADABLE" };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "WRONG_FORMAT" };
    if (data.app !== "weekly-weight" || data.version !== 1) return { ok: false, error: "WRONG_FORMAT" };
    // Backups always keep the "today or earlier" check.
    if (!isRealDate(today)) throw new TypeError("parseBackup needs today as YYYY-MM-DD");
    return checkRecords(data.records, today);
  }

  // Returns window.localStorage, or null when even looking it up throws
  // (the browser does not allow this page to store data).
  function openStorage(win) {
    try {
      return win.localStorage ?? null;
    } catch {
      return null;
    }
  }

  // Reads the saved records. Never writes.
  // { state: "empty", records: [] } when the key is missing,
  // { state: "ok", records } when valid,
  // { state: "unavailable" } when the storage cannot be looked up or read,
  // { state: "broken" } when the saved data is there but does not pass the checks.
  // Dates after today are not checked here (see checkRecords).
  function loadRecords(storage) {
    if (!storage) return { state: "unavailable" };
    let text;
    try {
      text = storage.getItem(STORAGE_KEY);
    } catch {
      return { state: "unavailable" };
    }
    if (text === null || text === undefined) return { state: "empty", records: [] };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { state: "broken" };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data) || data.version !== 1) {
      return { state: "broken" };
    }
    const checked = checkRecords(data.records, null);
    return checked.ok ? { state: "ok", records: checked.records } : { state: "broken" };
  }

  // Returns true only when the new content was stored.
  function saveRecords(storage, records) {
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, records: records.map((record) => ({ date: record.date, kg: record.kg })) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  // Only for saved data that could not be read ("broken"), after the user confirms.
  // Removes the records key and nothing else (not the last-backup date, not the
  // prototype key). Returns true only when the key is gone afterwards.
  function discardSavedData(storage) {
    try {
      storage.removeItem(STORAGE_KEY);
      return storage.getItem(STORAGE_KEY) === null;
    } catch {
      return false;
    }
  }

  function loadLastBackup(storage) {
    try {
      const value = storage.getItem(LAST_BACKUP_KEY);
      return isRealDate(value) ? value : null;
    } catch {
      return null;
    }
  }

  function saveLastBackup(storage, today) {
    try {
      storage.setItem(LAST_BACKUP_KEY, today);
      return true;
    } catch {
      return false;
    }
  }

  // The line right under the backup heading. Returns null (no line) when the storage is
  // "unavailable"; in that state the last-backup key is not read at all.
  function lastBackupText(loadState, storage, today) {
    if (loadState === "unavailable") return null;
    const date = loadLastBackup(storage);
    return date ? `最後にバックアップを作った日：${formatDate(date, today)}` : "バックアップを作ると、ここに作った日が出ます。";
  }

  // Shown after "バックアップを保存". The page cannot see where the browser put it,
  // so it says where it usually is.
  function backupDoneText(fileName) {
    return (
      `バックアップを作りました（${fileName}）。` +
      "ふつうは、スマホでは「ファイル」アプリの「ダウンロード」、パソコンでは「ダウンロード」フォルダに入ります。"
    );
  }

  // Whether to show the text saying the records are kept only in this browser.
  // In the "unavailable" state nothing can be kept, so that text is not shown;
  // only the sentences saying nothing is sent out stay.
  function showsStorageExplanation(loadState) {
    return loadState !== "unavailable";
  }

  return {
    STORAGE_KEY,
    LAST_BACKUP_KEY,
    MAX_BACKUP_BYTES,
    lastBackupText,
    backupDoneText,
    showsStorageExplanation,
    nextRecordWeek,
    nextRecordText,
    ONE_RECORD_NOTE,
    weekNoticeText,
    overwriteNoticeText,
    overwriteDoneText,
    HISTORY_HINT,
    dateDescribedBy,
    weekOf,
    isRealDate,
    parseKgInput,
    inputCorrectionText,
    checkDate,
    findSameWeek,
    upsertRecord,
    buildRows,
    streak,
    summarize,
    formatDate,
    formatWeekLabel,
    formatWeekLabelWithDay,
    formatWeekRange,
    historyRows,
    previousDiffLabel,
    formatKg,
    formatKgNumber,
    formatDiff,
    spokenDiff,
    chartModel,
    buildBackup,
    backupFileName,
    parseBackup,
    openStorage,
    loadRecords,
    saveRecords,
    discardSavedData,
    loadLastBackup,
    saveLastBackup,
  };
});
