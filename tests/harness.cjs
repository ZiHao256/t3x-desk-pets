"use strict";
// 桌宠状态机测试用的替身：最小 DOM、可控时钟，加载 logic.js / subpets.js / controller.js 得到 createPetController。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

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

module.exports = { createPetsHarness };
