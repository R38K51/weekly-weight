const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("./core.js");

// Runs app.js against a very small fake page, to check what the screen code
// writes. All weights and dates in this file are made up for testing.

const APP = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const TODAY = "2026-11-04";
// Elements start hidden as they are in index.html.
const HIDDEN_AT_START = new Set(
  [...fs.readFileSync(path.join(__dirname, "index.html"), "utf8").matchAll(/<[^>]*\sid="([^"]+)"[^>]*>/g)]
    .filter((match) => /\shidden[\s>]/.test(match[0]))
    .map((match) => match[1]),
);

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.max = "";
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.ownText = "";
    this.textWrites = 0;
  }
  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }
  set textContent(text) {
    this.textWrites += 1;
    this.children = [];
    this.ownText = String(text);
  }
  // Enough of a table for the history rows.
  get tHead() {
    return this.children[0];
  }
  get tBodies() {
    return this.children.slice(1);
  }
  get childElementCount() {
    return this.children.length;
  }
  append(...nodes) {
    for (const node of nodes) this.children.push(typeof node === "string" ? Object.assign(new FakeElement(), { ownText: node }) : node);
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.ownText = "";
    this.append(...nodes);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }
  fire(type) {
    for (const handler of this.listeners[type] ?? []) handler({ type, target: this, preventDefault() {} });
  }
  focus() {}
  click() {
    this.fire("click");
  }
  remove() {}
}

class FixedDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(`${TODAY}T03:00:00Z`);
    else super(...args);
  }
  getTimezoneOffset() {
    return 0;
  }
  static now() {
    return new FixedDate().getTime();
  }
}

function openPage(saved = {}, options = {}) {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) {
      const node = new FakeElement(id);
      node.hidden = HIDDEN_AT_START.has(id);
      elements.set(id, node);
    }
    return elements.get(id);
  };
  const data = { ...saved };
  const localStorage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
  const document = {
    body: new FakeElement("body"),
    getElementById: byId,
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
    querySelectorAll: () => [],
  };
  const window = { localStorage };
  // Only for the chart tests: the shown width of the chart, resizing and frames.
  const frames = [];
  const windowListeners = {};
  if (options.chartWidth !== undefined) byId("chart").clientWidth = options.chartWidth;
  // Only for the large text tests: the root text size the browser reports.
  if (options.rootFontPx !== undefined) {
    document.documentElement = {};
    window.getComputedStyle = () => ({ fontSize: `${options.rootFontPx}px` });
  }
  if (options.windowEvents) {
    window.addEventListener = (type, handler) => (windowListeners[type] ??= []).push(handler);
    window.requestAnimationFrame = (callback) => frames.push(callback);
  }
  const context = vm.createContext({
    WeeklyCore: core,
    document,
    window,
    Date: FixedDate,
    Blob: class {},
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(APP, context);
  const $ = byId;
  return {
    $,
    typeKg(text) {
      // One input event per character, like typing on a keyboard.
      for (let i = 1; i <= text.length; i += 1) {
        $("kg").value = text.slice(0, i);
        $("kg").fire("input");
      }
    },
    setDate(value) {
      $("date").value = value;
      $("date").fire("input");
      $("date").fire("change");
    },
    submit() {
      $("entry-form").fire("submit");
    },
    resize(chartWidth) {
      $("chart").clientWidth = chartWidth;
      for (const handler of windowListeners.resize ?? []) handler({ type: "resize" });
    },
    runFrames() {
      const count = frames.length;
      for (const callback of frames.splice(0)) callback();
      return count;
    },
    chartSvg() {
      return $("chart").children[0];
    },
  };
}

const withThisWeek = () => ({
  [core.STORAGE_KEY]: JSON.stringify({ version: 1, records: [{ date: "2026-11-02", kg: 62.7 }] }),
});

test("the fake page opens with this week's overwrite notice (checks the test page itself)", () => {
  assert.ok(["overwrite", "week-notice", "date-error", "kg-error"].every((id) => HIDDEN_AT_START.has(id)));
  const page = openPage(withThisWeek());
  assert.equal(page.$("date-error").hidden, true);
  assert.equal(page.$("overwrite").hidden, false);
  assert.match(page.$("overwrite").textContent, /62\.7 kg の記録があります/);
  assert.equal(page.$("week-notice").hidden, false);
});

test("typing the weight does not write the same overwrite notice again for each key", () => {
  const page = openPage(withThisWeek());
  const box = page.$("overwrite");
  const text = box.textContent;
  const writes = box.textWrites;
  page.typeKg("62.5");
  assert.equal(box.textWrites, writes, "the live region was rewritten while its text stayed the same");
  assert.equal(box.textContent, text);
  assert.equal(box.hidden, false);
  page.$("kg").fire("blur");
  assert.equal(box.textWrites, writes);
});

test("stepping the date inside the same week does not write the overwrite notice again", () => {
  const page = openPage(withThisWeek());
  const box = page.$("overwrite");
  const writes = box.textWrites;
  for (const day of ["2026-11-03", "2026-11-02", "2026-11-03", "2026-11-04"]) page.setDate(day);
  assert.equal(box.textWrites, writes);
  assert.equal(box.hidden, false);
  // Moving to a week without a record hides it; coming back writes it once.
  page.setDate("2026-10-30");
  assert.equal(box.hidden, true);
  page.setDate("2026-11-02");
  assert.equal(box.hidden, false);
  assert.equal(box.textWrites, writes + 2);
});

test("the overwrite notice still comes back after recording, at the first key", () => {
  const page = openPage(withThisWeek());
  page.typeKg("62.5");
  page.submit();
  assert.equal(page.$("overwrite").hidden, true);
  assert.match(page.$("done").textContent, /62\.7 kg から 62\.5 kg に置き換えました。/);
  page.typeKg("6");
  assert.equal(page.$("done").childElementCount, 0);
  assert.equal(page.$("overwrite").hidden, false);
  assert.match(page.$("overwrite").textContent, /62\.5 kg の記録があります/);
});

test("the week line is not rewritten when the date moves within the same week", () => {
  const page = openPage(withThisWeek());
  const box = page.$("week-notice");
  const writes = box.textWrites;
  page.setDate("2026-11-03");
  page.setDate("2026-11-02");
  assert.equal(box.textWrites, writes);
  page.setDate("2026-10-30");
  assert.equal(box.textWrites, writes + 1);
  assert.equal(box.textContent, "この日付は10月26日（月）〜11月1日（日）の週の記録になります。");
});

test("the date's aria-describedby is not set again with the same value", () => {
  const page = openPage(withThisWeek());
  const date = page.$("date");
  assert.equal(date.getAttribute("aria-describedby"), "week-notice overwrite");
  let sets = 0;
  const original = date.setAttribute.bind(date);
  date.setAttribute = (name, value) => {
    if (name === "aria-describedby") sets += 1;
    original(name, value);
  };
  page.typeKg("62.5");
  page.setDate("2026-11-03");
  assert.equal(sets, 0);
});

test("changing the date clears the future-date error, and the week line stands alone", () => {
  const page = openPage();
  page.typeKg("62.0");
  page.setDate("2026-11-10");
  page.submit();
  assert.equal(page.$("date-error").hidden, false);
  assert.equal(page.$("date-error").textContent, "今日までの日付を選んでください。");
  assert.equal(page.$("date").getAttribute("aria-invalid"), "true");
  assert.equal(page.$("week-notice").hidden, true);

  page.setDate("2026-10-30");
  assert.equal(page.$("date-error").hidden, true);
  assert.equal(page.$("date-error").textContent, "");
  assert.equal(page.$("date").getAttribute("aria-invalid"), null);
  assert.equal(page.$("week-notice").hidden, false);
  assert.equal(page.$("week-notice").textContent, "この日付は10月26日（月）〜11月1日（日）の週の記録になります。");
  assert.equal(page.$("date").getAttribute("aria-describedby"), "week-notice");
  // The weight typed before is kept.
  assert.equal(page.$("kg").value, "62.0");
});

test("a wrong date still gets its error on the next 記録する", () => {
  const page = openPage();
  page.typeKg("62.0");
  page.setDate("2026-11-10");
  page.submit();
  page.setDate("2026-11-12");
  assert.equal(page.$("date-error").hidden, true);
  page.submit();
  assert.equal(page.$("date-error").hidden, false);
  assert.equal(page.$("date-error").textContent, "今日までの日付を選んでください。");
  page.setDate("");
  page.submit();
  assert.equal(page.$("date-error").textContent, "日付を選んでください。");
  assert.equal(page.$("date").getAttribute("aria-describedby"), "date-error");
});

test("changing the date also clears the empty-date error", () => {
  const page = openPage();
  page.typeKg("62.0");
  page.setDate("");
  page.submit();
  assert.equal(page.$("date-error").textContent, "日付を選んでください。");
  page.setDate("2026-11-04");
  assert.equal(page.$("date-error").hidden, true);
  page.submit();
  assert.equal(page.$("date-error").hidden, true);
  assert.match(page.$("done").textContent, /記録しました。/);
});

// ---- 2026-11-04: the weight error goes away when the weight is changed ----

test("changing the weight clears the weight error, without a new error while typing", () => {
  const page = openPage();
  page.typeKg("abc");
  page.submit();
  assert.equal(page.$("kg-error").hidden, false);
  assert.equal(page.$("kg-error").textContent, "数字で入れてください。例：62.4");
  assert.equal(page.$("kg").getAttribute("aria-invalid"), "true");
  assert.equal(page.$("kg").getAttribute("aria-describedby"), "kg-error");

  // Still not a number after the first key: nothing new is shown while typing.
  page.$("kg").value = "abc6";
  page.$("kg").fire("input");
  assert.equal(page.$("kg-error").hidden, true);
  assert.equal(page.$("kg-error").textContent, "");
  assert.equal(page.$("kg").getAttribute("aria-invalid"), null);
  assert.equal(page.$("kg").getAttribute("aria-describedby"), null);
  page.typeKg("62.");
  assert.equal(page.$("kg-error").hidden, true);
  // The value typed is kept.
  assert.equal(page.$("kg").value, "62.");
});

test("a change event alone also clears the weight error", () => {
  const page = openPage();
  page.submit();
  assert.equal(page.$("kg-error").textContent, "体重を入れてください。");
  page.$("kg").value = "62.5";
  page.$("kg").fire("change");
  assert.equal(page.$("kg-error").hidden, true);
  assert.equal(page.$("kg").getAttribute("aria-invalid"), null);
});

test("a weight that is still wrong gets its error again on the next 記録する", () => {
  const page = openPage();
  page.typeKg("abc");
  page.submit();
  page.typeKg("62.45");
  assert.equal(page.$("kg-error").hidden, true);
  page.submit();
  assert.equal(page.$("kg-error").hidden, false);
  assert.equal(page.$("kg-error").textContent, "小数は第1位までで入れてください。例：62.4");
  assert.equal(page.$("kg").getAttribute("aria-invalid"), "true");
  assert.equal(page.$("kg").getAttribute("aria-describedby"), "kg-error");
  page.typeKg("62.4");
  page.submit();
  assert.equal(page.$("kg-error").hidden, true);
  assert.match(page.$("done").textContent, /記録しました。/);
});

// ---- 2026-11-07: the chart is drawn at its shown width (design review, 案2) ----

const twoRecords = () => ({
  [core.STORAGE_KEY]: JSON.stringify({
    version: 1,
    records: [
      { date: "2026-10-12", kg: 63.4 },
      { date: "2026-11-02", kg: 62.7 },
    ],
  }),
});

const chartTexts = (svgNode) => svgNode.children.filter((child) => child.ownText !== "" && "text-anchor" in child.attributes);

test("without a readable width, the chart is drawn at 320 x 200 as before", () => {
  const page = openPage(twoRecords());
  const root = page.chartSvg();
  assert.equal(root.getAttribute("viewBox"), "0 0 320 200");
  const expected = core.chartModel(JSON.parse(twoRecords()[core.STORAGE_KEY]).records, TODAY);
  const line = root.children.find((child) => child.getAttribute("points") !== null);
  assert.equal(line.getAttribute("points"), expected.points.map((p) => `${p.x},${p.y}`).join(" "));
  assert.equal(root.getAttribute("aria-label"), expected.label);
});

test("the chart uses its shown width, so the picture is not scaled up", () => {
  const page = openPage(twoRecords(), { chartWidth: 494 });
  const root = page.chartSvg();
  assert.equal(root.getAttribute("viewBox"), "0 0 494 247");
  // The width and height stay inside 280-640 and 180-300.
  assert.equal(openPage(twoRecords(), { chartWidth: 254 }).chartSvg().getAttribute("viewBox"), "0 0 280 180");
  assert.equal(openPage(twoRecords(), { chartWidth: 900 }).chartSvg().getAttribute("viewBox"), "0 0 640 300");
  // The axis texts, the colours and the dot sizes do not change.
  const texts = chartTexts(root).map((child) => child.ownText);
  const expected = core.chartModel(JSON.parse(twoRecords()[core.STORAGE_KEY]).records, TODAY);
  assert.deepEqual(texts, [expected.yTop, expected.yBottom, expected.xFirst, expected.xLast]);
  const dots = root.children.filter((child) => child.getAttribute("r") !== null).map((child) => child.getAttribute("r"));
  assert.deepEqual(dots, ["4", "6"]);
  assert.equal(root.getAttribute("role"), "img");
});

test("the chart is drawn again only when its width changes by 8 px or more, once per frame", () => {
  const page = openPage(twoRecords(), { chartWidth: 494, windowEvents: true });
  const first = page.chartSvg();
  page.resize(500);
  assert.equal(page.runFrames(), 1);
  assert.equal(page.chartSvg(), first, "a 6 px change does not redraw");
  page.resize(324);
  page.resize(330);
  page.resize(324);
  assert.equal(page.runFrames(), 1, "resize events in one frame are drawn once");
  assert.notEqual(page.chartSvg(), first);
  assert.equal(page.chartSvg().getAttribute("viewBox"), "0 0 324 180");
  // Redrawing does not touch the saved records.
  assert.equal(page.$("history").textContent.includes("62.7"), true);
});

test("the chart is not drawn on resize while the saved data cannot be read", () => {
  const page = openPage({ [core.STORAGE_KEY]: "{not json" }, { chartWidth: 494, windowEvents: true });
  assert.equal(page.$("chart-section").hidden, true);
  page.resize(324);
  page.runFrames();
  assert.equal(page.$("chart").children.length, 0);
});

// ---- 2026-11-08: large text (200%) and a year in the first week (test result, 軽2) ----

// 53 made-up weeks from 2025-11-03 to 2026-11-02; the chart shows the last 52,
// so its first label has a year ("2025年11月10日").
const yearWeeks = () => {
  const records = [];
  for (let i = 0; i < 53; i += 1) {
    const day = new Date(Date.UTC(2025, 10, 3) + i * 7 * 86400000);
    records.push({ date: day.toISOString().slice(0, 10), kg: 60 + (i % 10) / 10 });
  }
  return { [core.STORAGE_KEY]: JSON.stringify({ version: 1, records }) };
};

// The horizontal lines (top and bottom of the plot); the week ticks are vertical.
const baselines = (svgNode) =>
  svgNode.children.filter((child) => child.getAttribute("y1") !== null && child.getAttribute("y1") === child.getAttribute("y2"));
const ticks = (svgNode) =>
  svgNode.children.filter((child) => child.getAttribute("x1") !== null && child.getAttribute("x1") === child.getAttribute("x2"));

function axisTexts(root) {
  const [yTop, yBottom, xFirst, xLast] = chartTexts(root).map((child) => ({
    text: child.ownText,
    x: Number(child.getAttribute("x")),
    y: Number(child.getAttribute("y")),
  }));
  // The lower of the two horizontal lines is the bottom of the plot.
  const plotBottom = Math.max(...baselines(root).map((line) => Number(line.getAttribute("y1"))));
  return { yTop, yBottom, xFirst, xLast, plotBottom, viewBox: root.getAttribute("viewBox") };
}

test("at the standard text size, the year labels stay on one row as before", () => {
  const axis = axisTexts(openPage(yearWeeks(), { chartWidth: 324, rootFontPx: 16 }).chartSvg());
  assert.equal(axis.xFirst.text, "2025年11月10日");
  assert.equal(axis.viewBox, "0 0 324 180");
  assert.equal(axis.plotBottom, 180 - 36);
  assert.equal(axis.xFirst.y, 172);
  assert.equal(axis.xLast.y, 172);
});

test("with 200% text on a narrow chart, the last week label goes under the first", () => {
  const font = 32 * 0.875;
  const axis = axisTexts(openPage(yearWeeks(), { chartWidth: 324, rootFontPx: 32 }).chartSvg());
  assert.equal(axis.xFirst.text, "2025年11月10日");
  assert.equal(axis.xLast.text, "11月2日");
  // One more row: the picture is taller by the row, and the rows do not touch.
  assert.ok(axis.xLast.y - axis.xFirst.y >= font * 1.3, "the two week labels are on separate rows");
  const height = Number(axis.viewBox.split(" ")[3]);
  assert.ok(height > 180);
  assert.equal(axis.xLast.y, height - 8);
  // The lower weight label and the first week label do not touch either.
  assert.ok(axis.xFirst.y - axis.yBottom.y >= font * 1.3, "the lower y label is above the week labels");
});

test("with 200% text on a wide chart, the labels stay on one row with room under the y label", () => {
  const font = 32 * 0.875;
  const axis = axisTexts(openPage(yearWeeks(), { chartWidth: 638, rootFontPx: 32 }).chartSvg());
  assert.equal(axis.viewBox, "0 0 638 300");
  assert.equal(axis.xFirst.y, axis.xLast.y);
  assert.ok(axis.xFirst.y - axis.yBottom.y >= font * 1.3, "the lower y label is above the week labels");
});

// ---- 2026-11-08: no frame around the chart (design review 2, fix 5) ----

test("the chart has no frame, only a top and a bottom line across the plot", () => {
  const root = openPage(twoRecords(), { chartWidth: 494 }).chartSvg();
  // No rectangle: nothing with a width and a height.
  assert.equal(root.children.filter((child) => child.getAttribute("height") !== null).length, 0);
  const lines = baselines(root);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(line.getAttribute("y1"), line.getAttribute("y2"), "the line is horizontal");
    assert.equal(line.getAttribute("stroke"), "var(--line)");
    assert.equal(line.getAttribute("stroke-width"), "1");
  }
  const ys = lines.map((line) => Number(line.getAttribute("y1")));
  assert.equal(new Set(ys).size, 2, "one at the top, one at the bottom");
  const xs = lines.map((line) => [Number(line.getAttribute("x1")), Number(line.getAttribute("x2"))]);
  assert.equal(xs[0][0], xs[1][0]);
  assert.equal(xs[0][1], xs[1][1]);
  assert.ok(xs[0][1] > xs[0][0]);
  // The lines run from the first week to the last week, the width of the plot.
  const poly = root.children.find((child) => child.getAttribute("points") !== null);
  const pointXs = poly.getAttribute("points").split(" ").map((p) => Number(p.split(",")[0]));
  assert.deepEqual(xs[0], [pointXs[0], pointXs[pointXs.length - 1]]);
  assert.equal(poly.getAttribute("stroke-width"), "2.5");
  assert.equal(poly.getAttribute("stroke-linejoin"), "round");
  assert.equal(poly.getAttribute("stroke-linecap"), "round");
  // The axis labels sit next to the two lines.
  const [yTop, yBottom] = chartTexts(root);
  assert.ok(Number(yTop.getAttribute("y")) > Math.min(...ys) && Number(yTop.getAttribute("y")) < Math.min(...ys) + 20);
  assert.ok(Number(yBottom.getAttribute("y")) > Math.max(...ys) && Number(yBottom.getAttribute("y")) < Math.max(...ys) + 20);
});

test("one record: still no frame, the two lines and one dot", () => {
  const root = openPage(withThisWeek(), { chartWidth: 494 }).chartSvg();
  assert.equal(root.children.filter((child) => child.getAttribute("height") !== null).length, 0);
  assert.equal(baselines(root).length, 2);
  assert.equal(root.children.filter((child) => child.getAttribute("r") !== null).length, 1);
});

// ---- 2026-11-08: the unit is smaller, and a tick for every week (design review 2, additions 3a and 3c) ----

const twelveWeeks = () => {
  const records = [];
  for (let i = 0; i < 12; i += 1) {
    const day = new Date(Date.UTC(2026, 7, 17) + i * 7 * 86400000);
    records.push({ date: day.toISOString().slice(0, 10), kg: 66 - i / 10 });
  }
  return { [core.STORAGE_KEY]: JSON.stringify({ version: 1, records }) };
};

test("a weight card shows the number and a smaller kg; the text stays the same", () => {
  const page = openPage(twoRecords());
  const cards = page.$("numbers").children[0].children;
  const values = cards.map((box) => box.children[1]);
  // 最新の体重: "62.7 kg", with the unit in its own span.
  assert.equal(values[0].textContent, "62.7 kg");
  const unit = values[0].children.find((child) => child.getAttribute("class") === "unit");
  assert.equal(unit.textContent, "kg");
  assert.equal(values[0].children[0].textContent, "62.7 ");
  // The differences keep their spoken text and get the same unit.
  assert.equal(values[1].textContent, `${core.formatDiff(-7)} kg`);
  assert.ok(values[1].getAttribute("aria-label"));
  assert.equal(values[1].children.filter((child) => child.getAttribute("class") === "unit").length, 1);
  // The streak in weeks has no kg and no unit span.
  assert.equal(values[3].children.filter((child) => child.getAttribute("class") === "unit").length, 0);
});

test("one record: the dash cards have no unit span", () => {
  const page = openPage(withThisWeek());
  const values = page.$("numbers").children[0].children.map((box) => box.children[1]);
  assert.equal(values[0].textContent, "62.7 kg");
  assert.equal(values[1].textContent, "—");
  assert.equal(values[1].children.length, 0);
});

test("the chart has a 6 px tick under the bottom line for every week with a record", () => {
  const root = openPage(twelveWeeks(), { chartWidth: 494 }).chartSvg();
  const bottom = Math.max(...baselines(root).map((line) => Number(line.getAttribute("y1"))));
  const dots = root.children.filter((child) => child.getAttribute("r") !== null);
  const marks = ticks(root);
  assert.equal(marks.length, 12);
  assert.deepEqual(marks.map((m) => m.getAttribute("x1")), dots.map((d) => d.getAttribute("cx")));
  for (const m of marks) {
    assert.equal(Number(m.getAttribute("y1")), bottom);
    assert.equal(Number(m.getAttribute("y2")), bottom + 6);
    assert.equal(m.getAttribute("stroke"), "var(--muted)");
    assert.equal(m.getAttribute("stroke-width"), "1");
  }
  // The ticks stay above the week labels.
  const [, , xFirst] = chartTexts(root);
  assert.ok(bottom + 6 < Number(xFirst.getAttribute("y")) - 14 * 0.8);
  // The words read out do not change.
  assert.match(root.getAttribute("aria-label"), /12件の記録/);
});

test("ticks: one record has one tick, a skipped week has none, 53 weeks show 52", () => {
  const one = openPage(withThisWeek(), { chartWidth: 494 }).chartSvg();
  assert.equal(ticks(one).length, 1);
  // twoRecords skips two weeks between its records: still two ticks.
  assert.equal(ticks(openPage(twoRecords(), { chartWidth: 494 }).chartSvg()).length, 2);
  assert.equal(ticks(openPage(yearWeeks(), { chartWidth: 494 }).chartSvg()).length, 52);
});
