"use strict";
// 桌宠扩展的测试：选宠、拖动碰头、子代理进出场、映射缓存、宠物定义清洗。
// 用法：npm test（不依赖任何 npm 包，Node 22+）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const pets = require("../logic.js");

// 和宿主（T3 Code Extensions 的 lib/build.cjs）一样把扩展读成 { 路径: 内容 }：清单和脚本、样式是文本，素材是 data URL。
const MIME = { ".webp": "image/webp", ".png": "image/png", ".gif": "image/gif" };
function readFiles() {
  const text = read("plugin.json");
  const manifest = JSON.parse(text);
  const files = { "plugin.json": text };
  for (const p of [].concat(manifest.entries.web ?? [], manifest.entries.styles ?? [])) files[p] = read(p);
  for (const p of manifest.assets ?? []) files[p] = `data:${MIME[path.extname(p)] ?? "application/octet-stream"};base64,${fs.readFileSync(path.join(ROOT, p)).toString("base64")}`;
  return { manifest, files };
}

// 测试按登记顺序在文件末尾依次执行，支持 async。
let passed = 0;
const queue = [];
function test(name, fn) {
  queue.push([name, fn]);
}

// 扩展脚本作为 function(host){…} 的函数体执行，这里只检查能编译。
test("脚本能编译", () => {
  const m = JSON.parse(read("plugin.json"));
  new Function("host", [].concat(m.entries.web).map(read).join("\n;\n"));
});

test("桌宠：agent → 宠物", () => {
  const has = (id) => ["codex", "claude"].includes(id);
  const map = { ...pets.DEFAULT_MAP };
  assert.equal(pets.petFor("claudeAgent", "", map, has), "claude");
  assert.equal(pets.petFor("antigravity", "", map, has), "codex"); // gemini 不在库里，退回 codex
  assert.equal(pets.petFor("opencode", "claude-sonnet-5", map, has), "claude"); // 未知 harness 按模型名
  assert.equal(pets.petFor("opencode", "gpt", map, has), "codex");
  // 右键菜单“换一只”在没有 driver 时写 modelKey 给出的那项，写完 petFor 要能选中它
  assert.deepEqual([pets.modelKey("claude-opus-5"), pets.modelKey("gemini-4"), pets.modelKey("gpt"), pets.modelKey(null)].join(), "claudeAgent,antigravity,*,*");
  assert.equal(pets.petFor(null, "claude-opus-5", { ...map, [pets.modelKey("claude-opus-5")]: "codex" }, has), "codex");
  assert.equal(pets.petFor("cursor", "", { ...map, cursor: "none" }, has), null);
  assert.equal(pets.petFor("cursor", "", { ...map, "*": "none" }, has), null);
  assert.equal(pets.petFor("claudeAgent", "gpt", { ...map, claudeAgent: "auto" }, has), "codex"); // 明确选“按模型名”不回到默认
  const { events } = pets.subagentEvents(new Map(), [{ id: 1, status: "running", driver: "cursor" }, { id: 2, status: "running", driver: "codex" }], false, (d) =>
    pets.petFor(d, "", { ...map, cursor: "none" }, has),
  );
  assert.deepEqual(events.map((e) => [e.id, e.petId]), [[2, "codex"]]);
  // 回到看过的会话：a 原样落座后补播收工，b 是离开期间新派出的，跑进来
  const seen = new Map([["a", { petId: "codex", status: "running" }]]);
  const back = pets.resumeSubagents(seen, [{ id: "a", status: "completed" }, { id: "b", status: "running", driver: "codex" }], () => "codex");
  assert.deepEqual(back.events.map((e) => `${e.type}:${e.id}`), ["seat:a", "finish:a", "arrive:b"]);
  assert.deepEqual([...back.next.keys()], ["b"]);

  // 离开期间既启动又完成的子代理也要补播进场与收工，但不能重播上次已见的历史终态
  const firstVisit = pets.subagentEvents(
    new Map(),
    [{ id: "old", status: "completed", driver: "codex" }, { id: "a", status: "running", driver: "codex" }],
    true,
    () => "codex",
  );
  assert.deepEqual(firstVisit.events.map((e) => `${e.type}:${e.id}`), ["seat:a"]);
  assert(firstVisit.done.has("old"));
  const backWithShort = pets.resumeSubagents(
    firstVisit.next,
    [
      { id: "old", status: "completed", driver: "codex" },
      { id: "a", status: "completed", driver: "codex" },
      { id: "x", status: "completed", driver: "codex" },
      { id: "y", status: "failed", driver: "codex" },
      { id: "skip", status: "completed", driver: "cursor" },
    ],
    (d) => (d === "cursor" ? null : "codex"),
    firstVisit.done,
  );
  assert.deepEqual(
    backWithShort.events.map((e) => `${e.type}:${e.id}:${e.ok ?? ""}`),
    ["seat:a:", "finish:a:true", "arrive:x:", "finish:x:true", "arrive:y:", "finish:y:false"],
  );
  // 再次切回时不重播任何已见终态
  const backAgain = pets.resumeSubagents(
    backWithShort.next,
    [
      { id: "old", status: "completed", driver: "codex" },
      { id: "a", status: "completed", driver: "codex" },
      { id: "x", status: "completed", driver: "codex" },
    ],
    () => "codex",
    backWithShort.done,
  );
  assert.deepEqual(backAgain.events, []);

  // 座位计算：窄舞台满座、加宽腾座、离场占名额、拖动腾座
  assert.equal(pets.findFreeSeat({ mainX: 126, span: 140, occupied: [76, 26], total: 2 }), undefined);
  assert.equal(pets.findFreeSeat({ mainX: 482, span: 536, occupied: [76, 26], total: 2 }), 532);
  assert.equal(pets.findFreeSeat({ mainX: 300, span: 600, occupied: [350, 250], total: 3 }), undefined);
  assert.equal(pets.findFreeSeat({ mainX: 126, span: 140, occupied: [10, 26], total: 2 }), 76);
});

test("桌宠：上下文用量优先按压缩阈值计算并分档", () => {
  assert.equal(pets.contextFill(null), 0);
  assert.equal(pets.contextFill({ usedTokens: 80, maxTokens: null, usedPercentage: 80 }), 0);
  assert.equal(pets.contextFill({ usedTokens: 80, maxTokens: null, autoCompactThreshold: 100 }), 0.8);
  assert.equal(pets.contextFill({ usedTokens: 80, maxTokens: 200, autoCompactThreshold: 100 }), 0.8);
  assert.equal(pets.contextFill({ usedTokens: 80, maxTokens: 200, autoCompactThreshold: 0 }), 0.4);
  for (const maxTokens of [0, -1, Infinity, NaN]) assert.equal(pets.contextFill({ usedTokens: 80, maxTokens }), 0);
  assert.equal(pets.contextFill({ usedTokens: -1, maxTokens: 100 }), 0);
  assert.equal(pets.contextFill({ usedTokens: 120, maxTokens: 100 }), 1);
  assert.deepEqual([0, 0.799, 0.8, 0.949, 0.95, 1].map(pets.fillLevel), [undefined, undefined, "high", "high", "full", "full"]);
});

test("桌宠：压缩结束仅在原会话松气", () => {
  const start = pets.compactState(null, "a", true);
  assert.equal(start.phase, "squeeze");
  const end = pets.compactState(start, "a", false);
  assert.equal(end.phase, "pop");
  assert.equal(pets.compactState(end, "a", false).phase, "pop");
  assert.equal(pets.compactState(end, "a", false, true).phase, undefined);
  assert.equal(pets.compactState(start, "b", false).phase, undefined);
  assert.equal(pets.compactState(end, "b", false).phase, undefined);
  const switched = pets.compactState(start, "b", true);
  assert.equal(switched.phase, "squeeze");
  const idle = pets.compactState(switched, "b", false);
  assert.equal(idle.phase, "pop", "A 压缩中切到也在压缩的 B：B 压完照样松气");
  assert.equal(pets.compactState(pets.compactState(idle, "b", true), "b", false).phase, "pop");
});

test("桌宠：拖动碰头判定与分开站位", () => {
  const list = [{ id: "a", x: 100 }, { id: "b", x: 220 }];
  assert.equal(pets.findBumpTarget(120, list)?.id, "a");
  assert.equal(pets.findBumpTarget(146, list)?.id, "a");
  assert.equal(pets.findBumpTarget(160, list), null);
  assert.equal(pets.findBumpTarget(190, [{ id: "a", x: 160 }, { id: "b", x: 205 }])?.id, "b"); // 多只命中选最近

  // 普通从左侧拖来：贴近到 30px，结束后退开到 50px 不重叠
  const normal = pets.resolveBumpPositions({ moverX: 295, moverFromX: 120, targetX: 300, span: 600 });
  assert.deepEqual([normal.meetMoverX, normal.meetTargetX, normal.afterMoverX, normal.afterTargetX, normal.side], [270, 300, 250, 300, -1]);

  // 完全重合时按起拖方向决定左右
  const overlap = pets.resolveBumpPositions({ moverX: 300, moverFromX: 420, targetX: 300, span: 600 });
  assert.equal(overlap.side, 1);
  assert.equal(overlap.meetMoverX, 330);
  assert.equal(overlap.afterMoverX, 350);

  // 靠左边缘不够站：自动翻到右侧，保证都在边界内且不重叠
  const edge = pets.resolveBumpPositions({ moverX: 10, moverFromX: 0, targetX: 20, span: 600 });
  assert.equal(edge.side, 1);
  assert.equal(edge.meetMoverX, 50);
  assert.equal(edge.afterMoverX, 70);

  // 避让第三只宠物：左侧 250 被占时改退到右侧 350
  const third = pets.resolveBumpPositions({ moverX: 290, moverFromX: 200, targetX: 300, span: 600, others: [250] });
  assert.equal(third.afterTargetX, 300);
  assert.equal(third.afterMoverX, 350);
  assert(Math.abs(third.afterMoverX - 250) >= 50);

  // 极窄舞台不越界
  const narrow = pets.resolveBumpPositions({ moverX: 10, moverFromX: 0, targetX: 20, span: 40 });
  assert(narrow.meetMoverX >= 0 && narrow.meetMoverX <= 40);
  assert(narrow.afterMoverX >= 0 && narrow.afterMoverX <= 40);
  assert(narrow.afterTargetX >= 0 && narrow.afterTargetX <= 40);
  assert.equal(Math.abs(narrow.afterMoverX - narrow.afterTargetX), 40);
});

// 最小 DOM + 可控时钟替身，用于回归桌宠状态机（离场、碰头、指针、补播、布局读取、rAF 清理）。
function createPetsHarness({ stageWidth = 600, focused = true, hidden = false, quiet = () => false } = {}) {
  let now = 0;
  let nextTimerId = 1;
  let nextRafId = 1;
  const timers = new Map();
  const rafs = new Map();
  const storageMap = new Map();
  const storageSubs = new Map();
  const sessionMap = new Map();
  const docListeners = new Map();
  const winListeners = new Map();
  let resizeCb = null;
  let offsetWidthReads = 0;
  let captureShouldThrow = false;

  const addL = (map, type, fn) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  };
  const rmL = (map, type, fn) => map.get(type)?.delete(fn);
  const fireL = (map, type, ev = {}) => {
    for (const fn of [...(map.get(type) ?? [])]) fn(ev);
  };

  class FakeEl {
    constructor(tag = "div") {
      this.tag = tag;
      this.className = "";
      this.dataset = {};
      this.style = {
        setProperty(k, v) {
          this[k] = v;
        },
      };
      this.children = [];
      this.parentElement = null;
      this.listeners = new Map();
      this.captured = new Set();
      this.textContent = "";
      this._connected = false;
    }
    get isConnected() {
      return this._connected;
    }
    get clientWidth() {
      return this.className === "t3x-pet-stage" ? stageWidth : 64;
    }
    get offsetWidth() {
      if (this.className === "t3x-pet") offsetWidthReads += 1;
      return 64;
    }
    setAttribute(key, value) {
      (this.attributes ??= {})[key] = value;
    }
    closest() {
      return null;
    }
    getBoundingClientRect() {
      return { left: Number.parseFloat(this.style.left) || 0, top: 0, width: 64, height: 69 };
    }
    _setConnected(v) {
      this._connected = v;
      for (const c of this.children) c._setConnected(v);
    }
    appendChild(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      this.children.push(child);
      child._setConnected(this._connected);
      return child;
    }
    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    }
    prepend(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      this.children.unshift(child);
      child._setConnected(this._connected);
      return child;
    }
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentElement = null;
      child._setConnected(false);
    }
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    }
    addEventListener(type, fn) {
      addL(this.listeners, type, fn);
    }
    removeEventListener(type, fn) {
      rmL(this.listeners, type, fn);
    }
    dispatch(type, ev = {}) {
      fireL(this.listeners, type, { target: this, preventDefault() {}, button: 0, pointerId: 1, clientX: 0, ...ev });
    }
    setPointerCapture(id) {
      if (captureShouldThrow) throw new Error("capture failed");
      this.captured.add(id);
    }
    hasPointerCapture(id) {
      return this.captured.has(id);
    }
    releasePointerCapture(id) {
      this.captured.delete(id);
    }
  }

  const hostEl = new FakeEl("div");
  hostEl._connected = true;
  const doc = {
    get hidden() {
      return hidden;
    },
    hasFocus: () => focused,
    createElement: (tag) => new FakeEl(tag),
    addEventListener: (t, fn) => addL(docListeners, t, fn),
    removeEventListener: (t, fn) => rmL(docListeners, t, fn),
  };
  const win = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (t, fn) => addL(winListeners, t, fn),
    removeEventListener: (t, fn) => rmL(winListeners, t, fn),
    dispatchEvent: (ev) => fireL(winListeners, ev.type, ev),
  };

  const ctx = vm.createContext({
    window: win,
    document: doc,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    getComputedStyle: () => ({ position: "relative" }),
    ResizeObserver: class ResizeObserver {
      constructor(cb) {
        resizeCb = cb;
      }
      observe() {}
      disconnect() {
        resizeCb = null;
      }
    },
    sessionStorage: {
      getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
      setItem: (k, v) => sessionMap.set(k, String(v)),
      removeItem: (k) => sessionMap.delete(k),
    },
    performance: { now: () => now },
    setTimeout: (fn, ms = 0) => {
      const id = nextTimerId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => {
      const id = nextRafId++;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => rafs.delete(id),
    console,
  });

  const code = ["logic.js", "subpets.js", "controller.js"].map(read).join("\n;\n");
  const createPetController = vm.runInContext(`(function(){"use strict";\n${code}\nreturn createPetController;})()`, ctx);
  const catalog = {
    get: (id) => ({ id, sheet: "data:image/webp;base64,AA", badgeBottom: 54 }),
  };
  let posVal = 0.9;
  const ctrl = createPetController({
    catalog,
    position: { get: () => posVal, set: (v) => (posVal = v) },
    quiet,
    onMenu: () => ctrl.hide(),
    composer: () => hostEl,
  });

  const stage = () => hostEl.children.find((c) => c.className === "t3x-pet-stage") ?? null;
  const petEls = () => (stage()?.children ?? []).filter((c) => c.className === "t3x-pet");
  const mainEls = () => petEls().filter((c) => c.dataset.role !== "sub");
  const subEls = () => petEls().filter((c) => c.dataset.role === "sub");
  const badgeEl = () => (stage()?.children ?? []).find((c) => c.className === "t3x-pet-badge") ?? null;

  function stepRaf(dt = 16) {
    now += dt;
    const batch = [...rafs.entries()];
    rafs.clear();
    for (const [, fn] of batch) fn(now);
  }
  function advance(ms) {
    const end = now + ms;
    while (true) {
      let nextId = null;
      let nextAt = Infinity;
      for (const [id, t] of timers) {
        if (t.at <= end && t.at < nextAt) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      now = nextAt;
      const t = timers.get(nextId);
      timers.delete(nextId);
      t.fn();
    }
    now = end;
  }
  function finishAnim(el) {
    const body = el.children.find((c) => c.className === "t3x-pet-body");
    body.dispatch("animationend", { target: body, animationName: `t3x-pet-${el.dataset.motion}` });
  }

  return {
    ctrl,
    timers,
    rafs,
    stage,
    petEls,
    mainEls,
    subEls,
    badgeEl,
    stepRaf,
    advance,
    finishAnim,
    setFocus(v) {
      focused = v;
      if (v) fireL(winListeners, "focus");
    },
    setHidden(v) {
      hidden = v;
      if (!v) fireL(docListeners, "visibilitychange");
    },
    setStageWidth(w) {
      stageWidth = w;
      resizeCb?.();
    },
    setCaptureThrow(v) {
      captureShouldThrow = v;
    },
    resetOffsetReads() {
      offsetWidthReads = 0;
    },
    getOffsetReads: () => offsetWidthReads,
    storageMap,
    storageSubs,
  };
}

test("桌宠：主宠物的用量、切会话、换宠与定时清理", () => {
  let calm = false;
  const h = createPetsHarness({ quiet: () => calm });
  const fill = "--t3x-pet-fill";
  h.ctrl.update({ petId: "codex", mood: "idle" });
  h.ctrl.updateSwell("a", 0.799, false);
  h.advance(0);
  const main = h.mainEls()[0];
  assert.equal(main.children.at(-2).className, "t3x-pet-fx");
  assert.equal(main.children.at(-1).className, "t3x-pet-puff");
  assert.equal(main.children.at(-1).attributes["aria-hidden"], "true");
  assert.equal(main.style[fill], "0.799");
  assert.equal(main.dataset.swellSnap, "");
  h.stepRaf();
  assert.equal(main.dataset.swellSnap, "");
  h.stepRaf();
  assert.equal(main.dataset.swellSnap, undefined);
  h.ctrl.updateSwell("a", 0.8, false);
  assert.equal(main.style[fill], "0.799");
  assert.equal(main.dataset.fill, "high");
  h.ctrl.updateSwell("a", 0.806, true);
  assert.equal(main.style[fill], "0.806");
  assert.equal(main.dataset.compact, "squeeze");
  h.ctrl.updateSwell("b", 0.809, false);
  assert.equal(main.style[fill], "0.809");
  assert.equal(main.dataset.swellSnap, "");
  assert.equal(main.dataset.compact, undefined);
  h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
  calm = true;
  h.ctrl.syncCalm();
  assert.equal(main.dataset.calm, "");
  const sub = h.subEls()[0];
  assert.equal(sub.style[fill], undefined);
  for (const key of ["fill", "swellSnap", "compact", "calm"]) assert.equal(sub.dataset[key], undefined);
  assert.equal(sub.children.some((child) => child.className === "t3x-pet-puff"), false);

  h.ctrl.updateSwell("b", 0.97, true);
  h.ctrl.update({ petId: "claude", mood: "idle" });
  h.advance(120);
  const replacement = h.mainEls().at(-1);
  assert.equal(replacement.dataset.compact, "squeeze");
  assert.equal(replacement.dataset.calm, "");
  assert.equal(replacement.dataset.fill, "full");
  assert.equal(replacement.style[fill], "0.97");
  h.ctrl.updateSwell("b", 0.21, false);
  assert.equal(replacement.dataset.compact, "pop");
  assert.equal(replacement.dataset.fill, undefined);
  h.advance(600);
  h.ctrl.refresh();
  h.advance(120);
  const rebuilt = h.mainEls().at(-1);
  assert.equal(rebuilt.style[fill], "0.21");
  assert.equal(rebuilt.dataset.compact, "pop");
  calm = false;
  h.ctrl.syncCalm();
  assert.equal(rebuilt.dataset.calm, undefined);
  h.advance(379);
  assert.equal(rebuilt.dataset.compact, "pop");
  h.advance(1);
  assert.equal(rebuilt.dataset.compact, undefined);

  // 换输入框时宠物短暂脱离文档：这期间切到的新会话状态也要写上，重挂后不能还是旧会话的样子
  rebuilt._connected = false;
  h.ctrl.updateSwell("d", 0.12, false);
  assert.equal(rebuilt.style[fill], "0.12");
  assert.equal(rebuilt.dataset.compact, undefined);
  rebuilt._connected = true;

  h.ctrl.updateSwell("c", 1, true);
  h.ctrl.updateSwell("c", 0.2, false);
  h.ctrl.dispose();
  assert.equal(h.timers.size, 0);
  assert.equal(h.rafs.size, 0);
});

test("桌宠：离场、碰头、指针、补播、布局与 rAF 回归", () => {
  // 1. 拖动中切换主宠，松手不会复活旧主宠，dispose 后计时器清零
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const oldMain = h.mainEls()[0];
    h.finishAnim(oldMain);
    oldMain.dispatch("pointerdown", { pointerId: 1, clientX: 500 });
    oldMain.dispatch("pointermove", { pointerId: 1, clientX: 460 });
    h.ctrl.update({ petId: "claude", mood: "idle" }); // 旧主宠开始离场
    oldMain.dispatch("pointerup", { pointerId: 1, clientX: 460 });
    assert.match(oldMain.dataset.motion, /^exit-/);
    h.ctrl.dispose();
    assert.equal(h.timers.size, 0, "dispose 后不应残留计时器");
    assert.equal(h.rafs.size, 0, "dispose 后不应残留 rAF");
  }

  // 1b. 拖动子宠物期间代理消失（quiet），松手不会复活或泄漏 exiting 名额
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    const sub = h.subEls()[0];
    h.finishAnim(sub);
    sub.dispatch("pointerdown", { pointerId: 2, clientX: 400 });
    sub.dispatch("pointermove", { pointerId: 2, clientX: 360 });
    h.ctrl.subagents([{ type: "finish", id: "s1", ok: true, quiet: true }], false);
    assert.equal(sub.dataset.motion, "exit-blink");
    sub.dispatch("pointerup", { pointerId: 2, clientX: 360 });
    assert.equal(sub.dataset.motion, "exit-blink");
    h.finishAnim(sub);
    assert.equal(h.subEls().length, 0);
    h.ctrl.dispose();
  }

  // 2. 碰头期间右键隐藏，主宠正常离场销毁，不留屏幕也不留计时器
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    h.finishAnim(main);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    const sub = h.subEls()[0];
    h.finishAnim(sub);
    const subX = Number.parseFloat(sub.style.left);
    const mainX = Number.parseFloat(main.style.left);
    sub.dispatch("pointerdown", { pointerId: 3, clientX: subX });
    sub.dispatch("pointermove", { pointerId: 3, clientX: mainX });
    sub.dispatch("pointerup", { pointerId: 3, clientX: mainX });
    assert.equal(main.dataset.motion, "bump");
    assert.equal(sub.dataset.motion, "bump");
    main.dispatch("contextmenu", {});
    assert.match(main.dataset.motion, /^exit-/);
    h.advance(1600);
    assert.equal(h.petEls().length, 0);
    h.ctrl.dispose();
    assert.equal(h.timers.size, 0);
  }

  // 3. lostpointercapture 恢复待播告别；pointercancel 不触发碰头；捕获失败回滚
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    h.finishAnim(main);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    const sub = h.subEls()[0];
    h.finishAnim(sub);

    // 捕获抛错时回滚，不残留 dragging
    h.setCaptureThrow(true);
    sub.dispatch("pointerdown", { pointerId: 10, clientX: 400 });
    h.setCaptureThrow(false);
    sub.dispatch("pointermove", { pointerId: 10, clientX: 350 });
    assert.equal(sub.dataset.motion, "idle");

    // 拖到主宠上方触发 pointercancel：绝不进入 bump
    const subX = Number.parseFloat(sub.style.left);
    const mainX = Number.parseFloat(main.style.left);
    sub.dispatch("pointerdown", { pointerId: 11, clientX: subX });
    sub.dispatch("pointermove", { pointerId: 11, clientX: mainX });
    sub.dispatch("pointercancel", { pointerId: 11, clientX: mainX });
    assert.notEqual(sub.dataset.motion, "bump");
    assert.notEqual(main.dataset.motion, "bump");
    h.finishAnim(sub);

    // 拖动中收工后丢失捕获：接续告别离场
    sub.dispatch("pointerdown", { pointerId: 12, clientX: subX });
    sub.dispatch("pointermove", { pointerId: 12, clientX: subX - 20 });
    h.ctrl.subagents([{ type: "finish", id: "s1", ok: true }], false);
    assert.equal(sub.dataset.motion, "drag");
    sub.dispatch("lostpointercapture", { pointerId: 12 });
    assert(["highfive", "greet"].includes(sub.dataset.motion), `丢失捕获后应接续告别，实际 ${sub.dataset.motion}`);
    h.ctrl.dispose();
  }

  // 4. 已经按住的主宠不能被另一只当成碰头目标
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    h.finishAnim(main);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    const sub = h.subEls()[0];
    h.finishAnim(sub);
    const subX = Number.parseFloat(sub.style.left);
    const mainX = Number.parseFloat(main.style.left);
    main.dispatch("pointerdown", { pointerId: 1, clientX: mainX }); // 只按住未移动
    sub.dispatch("pointerdown", { pointerId: 2, clientX: subX });
    sub.dispatch("pointermove", { pointerId: 2, clientX: mainX });
    sub.dispatch("pointerup", { pointerId: 2, clientX: mainX });
    assert.notEqual(main.dataset.motion, "bump");
    assert.notEqual(sub.dataset.motion, "bump");
    main.dispatch("pointerup", { pointerId: 1, clientX: mainX });
    h.ctrl.dispose();
  }

  // 5. 后台依次完成四只子代理，回前台后四只全部依次出现并完成告别
  {
    const h = createPetsHarness();
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.setFocus(false);
    let spawned = 0;
    const stageEl = h.stage();
    const origAppend = stageEl.appendChild.bind(stageEl);
    stageEl.appendChild = (c) => {
      if (c.className === "t3x-pet" && c.dataset.role === "sub") spawned += 1;
      return origAppend(c);
    };
    for (const id of ["a", "b", "c", "d"]) {
      h.ctrl.subagents([{ type: "arrive", id, petId: "codex", status: "running" }], false);
      h.ctrl.subagents([{ type: "finish", id, ok: true }], false);
    }
    assert.equal(spawned, 0);
    h.setFocus(true);
    assert.equal(spawned, 3);
    for (let i = 0; i < 120; i++) {
      h.stepRaf(20);
      h.advance(100);
    }
    assert.equal(spawned, 4, "第四只子代理应在腾出座位后补播");
    assert.equal(h.subEls().length, 0);
    h.ctrl.dispose();
  }

  // 6. 后台完成任务，回到前台时主宠仍在入场动画中：庆祝不能丢失，入场结束后播放跳跃
  {
    const h = createPetsHarness();
    h.setFocus(false);
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    assert.match(main.dataset.motion, /^enter-/);
    h.ctrl.celebrate();
    h.setFocus(true); // 主宠还在入场中
    const sprite = main.children.find((c) => c.className === "t3x-pet-body").children[0];
    h.finishAnim(main); // 入场结束 -> settle 应立刻消费 missedCheer 播放 jumping（第 4 行）
    assert.equal(sprite.style.backgroundPosition, "0% 40%", "入场结束后应播放积攒的庆祝跳跃");
    h.ctrl.dispose();
  }

  // 9. 输入框从 204px 加宽到 600px 后，+1 中的子宠物自动补入座位
  {
    const h = createPetsHarness({ stageWidth: 204 });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.ctrl.subagents(
      [
        { type: "seat", id: "a", petId: "codex", status: "running" },
        { type: "seat", id: "b", petId: "codex", status: "running" },
        { type: "seat", id: "c", petId: "codex", status: "running" },
      ],
      true,
    );
    assert.equal(h.subEls().length, 2);
    assert.equal(h.badgeEl()?.textContent, "+1");
    h.setStageWidth(600);
    assert.equal(h.subEls().length, 3);
    assert.equal(h.badgeEl(), null);
    h.ctrl.dispose();
  }

  // 10. 三只子宠落座时，一次主宠 pointermove 只读一次主宠 offsetWidth；碰头分开动画期间不读布局
  {
    const h = createPetsHarness({ stageWidth: 600 });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    const main = h.mainEls()[0];
    h.finishAnim(main);
    h.ctrl.subagents(
      [
        { type: "seat", id: "a", petId: "codex", status: "running" },
        { type: "seat", id: "b", petId: "codex", status: "running" },
        { type: "seat", id: "c", petId: "codex", status: "running" },
      ],
      true,
    );
    for (const s of h.subEls()) h.finishAnim(s);
    const mx = Number.parseFloat(main.style.left);
    main.dispatch("pointerdown", { pointerId: 1, clientX: mx });
    h.resetOffsetReads();
    main.dispatch("pointermove", { pointerId: 1, clientX: mx - 20 });
    assert.equal(h.getOffsetReads(), 1, "单次主宠移动只应读取一次 offsetWidth");
    main.dispatch("pointerup", { pointerId: 1, clientX: mx - 20 });
    h.finishAnim(main);

    // 碰头分开 rAF 期间不读 offsetWidth
    const sub = h.subEls()[0];
    const sx = Number.parseFloat(sub.style.left);
    const curMx = Number.parseFloat(main.style.left);
    sub.dispatch("pointerdown", { pointerId: 2, clientX: sx });
    sub.dispatch("pointermove", { pointerId: 2, clientX: curMx });
    sub.dispatch("pointerup", { pointerId: 2, clientX: curMx });
    h.finishAnim(main);
    h.finishAnim(sub);
    h.resetOffsetReads();
    h.stepRaf(50);
    h.stepRaf(50);
    assert.equal(h.getOffsetReads(), 0, "碰头分开过渡帧不应读取 offsetWidth");
    h.ctrl.dispose();
  }

  // 11. 子宠入场 rAF 在 dispose 时被主动取消
  {
    const h = createPetsHarness({ stageWidth: 600 });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.stepRaf();
    h.stepRaf();
    h.finishAnim(h.mainEls()[0]);
    h.ctrl.subagents(
      [
        { type: "arrive", id: "a", petId: "codex", status: "running" },
        { type: "arrive", id: "b", petId: "codex", status: "running" },
      ],
      false,
    );
    assert.equal(h.rafs.size, 2);
    h.ctrl.dispose();
    assert.equal(h.rafs.size, 0, "dispose 后子宠入场 rAF 应全部取消");
  }
});

test("桌宠：卸载聊天视图期间改映射会使 seenSubs 失效", () => {
  const ext = readFiles();
  const code = [].concat(ext.manifest.entries.web).map((p) => ext.files[p]).join("\n;\n");
  const storage = new Map();
  const subs = new Map();
  const dispatched = [];
  let Overlay = null;

  function makeReact() {
    let states = [];
    let refs = [];
    let effects = [];
    let si = 0;
    let ri = 0;
    return {
      begin() {
        si = 0;
        ri = 0;
        effects = [];
      },
      flush() {
        for (const fn of effects) fn();
      },
      useState(init) {
        const idx = si++;
        if (states.length <= idx) states.push(typeof init === "function" ? init() : init);
        return [states[idx], (v) => (states[idx] = typeof v === "function" ? v(states[idx]) : v)];
      },
      useRef(init) {
        const idx = ri++;
        if (refs.length <= idx) refs.push({ current: init });
        return refs[idx];
      },
      useEffect(fn) {
        effects.push(fn);
      },
      useReducer: () => [],
      reset() {
        states = [];
        refs = [];
        effects = [];
      },
    };
  }
  const react = makeReact();
  const ctx = vm.createContext({
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    document: {
      hidden: false,
      hasFocus: () => true,
      createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() {} }),
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    console,
  });
  const hostObj = {
    id: "desk-pets",
    React: react,
    h: () => null,
    register: (slot, c) => {
      if (slot === "chat.overlay") Overlay = c;
    },
    settings() {},
    storage: {
      get: (k, f) => (storage.has(k) ? storage.get(k) : f),
      set: (k, v) => {
        storage.set(k, v);
        for (const fn of subs.get(k) ?? []) fn();
      },
      subscribe: (k, fn) => {
        if (!subs.has(k)) subs.set(k, new Set());
        subs.get(k).add(fn);
        return () => subs.get(k).delete(fn);
      },
      use: (k, f) => (storage.has(k) ? storage.get(k) : f),
    },
    files: { list: () => Object.keys(ext.files), text: (p) => ext.files[p], url: (p) => (ext.files[p]?.startsWith("data:") ? ext.files[p] : null) },
    style: () => () => {},
    onDispose() {},
    chat: { last: () => null },
    dom: { composer: () => null, modelPicker: () => null },
    confirm: async () => true,
  };
  const cleanup = vm.runInContext(
    `(function(host){"use strict";\n${code.replace('host.register("chat.overlay", PetsOverlay);', 'host.register("chat.overlay", PetsOverlay); globalThis.__ctrl = controller;')}\n})`,
    ctx,
  )(hostObj);
  ctx.__ctrl.subagents = (events, fresh) => dispatched.push({ events, fresh });

  const renderOverlay = (props) => {
    react.begin();
    Overlay(props);
    react.flush();
  };
  const props = { embedded: false, driver: "codex", model: "", threadKey: "t1", awaiting: false, working: false, error: false, runStatus: "idle", subagents: [{ id: "c1", status: "running", driver: "cursor" }] };
  renderOverlay(props);
  assert.deepEqual(Array.from(dispatched.at(-1).events, (e) => `${e.type}:${e.id}`), ["seat:c1"]);
  // 卸载聊天视图（重置组件 state/ref），在设置页把 cursor 设为不显示，再重挂
  react.reset();
  hostObj.storage.set("map", { cursor: "none" });
  renderOverlay(props);
  assert.equal(dispatched.at(-1).events.length, 0, "改映射后重挂不应复用旧 seenSubs 发出 seat");
  cleanup();
});

test("桌宠设置：删除宠物要确认，确认期间这只被改过就不删", async () => {
  const ext = readFiles();
  const code = [].concat(ext.manifest.entries.web).map((p) => ext.files[p]).join("\n;\n");
  const storage = new Map();
  const subs = new Map();
  const set = (k, v) => {
    storage.set(k, v);
    for (const fn of subs.get(k) ?? []) fn();
  };
  const petA = { id: "my-a", name: "A", sheet: "data:image/webp;base64,AAAA" };
  let confirm = async () => true;
  let Settings = null;
  const hook = (v) => [typeof v === "function" ? v() : v, () => {}];
  const hostObj = {
    id: "desk-pets",
    React: { useState: hook, useRef: (v) => ({ current: v }), useEffect() {}, useMemo: (fn) => fn(), useCallback: (fn) => fn, useReducer: () => [0, () => {}] },
    h: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    register() {},
    settings: (c) => (Settings = c),
    storage: {
      get: (k, f) => (storage.has(k) ? storage.get(k) : f),
      set,
      subscribe: (k, fn) => {
        if (!subs.has(k)) subs.set(k, new Set());
        subs.get(k).add(fn);
        return () => subs.get(k).delete(fn);
      },
      use: (k, f) => (storage.has(k) ? storage.get(k) : f),
    },
    files: { list: () => Object.keys(ext.files), text: (p) => ext.files[p], url: (p) => (ext.files[p]?.startsWith("data:") ? ext.files[p] : null) },
    style: () => () => {},
    onDispose() {},
    chat: { last: () => null },
    dom: { composer: () => null, modelPicker: () => null },
    confirm: (...args) => confirm(...args),
    contextMenu: async () => null,
    openSettings() {},
    lang: () => "zh",
    useLang: () => "zh",
    t: (zh) => zh,
  };
  const ctx = vm.createContext({
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    document: { hidden: false, hasFocus: () => true, createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() {} }), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    console,
  });
  const reset = () => {
    set("custom", [petA]);
    set("map", { codex: "my-a" });
  };
  reset();
  vm.runInContext(`(function(host){"use strict";\n${code}\n})`, ctx)(hostObj);
  const ui = new Proxy({}, { get: (_, name) => name });
  const deleteButton = () => {
    const found = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      if (n.props?.className?.includes?.("t3x-btn-danger")) found.push(n);
      for (const v of Object.values(n.props ?? {})) if (v && typeof v === "object") walk(v);
      walk(n.children);
    };
    walk(Settings({ ui }));
    assert.equal(found.length, 1, "只有自定义宠物有删除按钮");
    return found[0].props.onClick;
  };

  confirm = async () => false;
  await deleteButton()();
  assert.equal(storage.get("custom").length, 1, "取消不删");

  confirm = async () => {
    throw new Error("确认框不可用");
  };
  await deleteButton()();
  assert.equal(storage.get("custom").length, 1, "确认框出错不删，也不抛出未处理的 Promise");

  confirm = async () => (set("custom", [{ ...petA, name: "A2" }]), true);
  await deleteButton()();
  assert.equal(storage.get("custom")[0]?.name, "A2", "确认期间被改过就不按旧的删");
  assert.equal(storage.get("map").codex, "my-a");

  reset();
  confirm = async (message, options) => (assert.equal(options?.variant, "destructive"), true);
  await deleteButton()();
  assert.deepEqual(storage.get("custom"), []);
  assert.equal(storage.get("map").codex, undefined, "引用它的对应关系一起删掉");
});

test("桌宠：导入的宠物定义要清洗", () => {
  const sheet = "data:image/webp;base64,AAAA";
  const p = pets.cleanPet({ id: "my-1", name: "x", sheet, scale: 1.2, vars: { "--t3x-pet-sink": "4px", "--evil": "1", "--t3x-pet-fx-beam": "red;}body{display:none" } });
  assert.deepEqual(p.vars, { "--t3x-pet-sink": "4px", "--t3x-pet-scale": "1.2" });
  const fetchy = pets.cleanPet({ id: "x2", sheet, vars: { "--t3x-pet-fx-beam": "url(//evil.example/a.png)", "--t3x-pet-fx-sparks": "image-set(a 1x)" } });
  assert.deepEqual(fetchy.vars, {}, "变量里不能引用外部图片");
  assert.throws(() => pets.cleanPet({ id: 'x"]{', sheet }), /id/);
  assert.throws(() => pets.cleanPet({ id: "ok", sheet: "javascript:alert(1)" }), /精灵图/);
  assert.throws(() => pets.cleanPet({ id: "ok", sheet: "data:image/png;base64,AA)\"" }), /精灵图/);
  assert.match(pets.petCss(p), /^\.t3x-pet\[data-pet="my-1"\]\{--t3x-pet-sink:4px;--t3x-pet-scale:1\.2\}html\.dark/);
  // 随扩展发布的宠物，变量全部是合法值，清洗后一个不少
  const bundled = vm.runInNewContext(`${read("pets.js")};BUNDLED_PETS`);
  assert.equal(bundled.map((p) => p.id).join(","), "claude,gemini");
  for (const def of bundled) {
    const id = def.id;
    const clean = pets.cleanPet({ ...def, sheet });
    assert.equal(Object.keys(clean.vars).length, Object.keys(def.vars).length, id);
    assert.equal(Object.keys(clean.darkVars).length, Object.keys(def.darkVars ?? {}).length, id);
  }
});

// 宿主用 function(host){"use strict"; …} 包住扩展代码；这里在 vm 里做同样的事，并给最少的 DOM 替身。

(async () => {
  for (const [name, fn] of queue) {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  }
  console.log(`\n全部通过（${passed} 项）`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
