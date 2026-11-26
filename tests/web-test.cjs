"use strict";
// 在 vm 里跑整个扩展（和宿主一样包成 function(host){"use strict"; …}，给最少的 DOM 替身）：聊天视图卸载期间的映射缓存、设置页删除宠物。
const assert = require("node:assert/strict");
const vm = require("node:vm");

module.exports = ({ test, readFiles }) => {
  test("桌宠：卸载聊天视图期间改映射会使 seenSubs 失效；在等你的子代理举牌子，点了跳到它的会话", () => {
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
        useMemo: (fn) => fn(),
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
    let threads = [];
    const opened = [];
    const hostObj = {
      id: "desk-pets",
      React: react,
      h: () => null,
      t: (zh) => zh,
      agent: { useThreads: () => threads, open: (ref) => opened.push(ref) },
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
    const signed = [];
    ctx.__ctrl.signs = (next) => signed.push(next);

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
    assert.equal(signed.at(-1).size, 0, "没人在等你就不举牌子");

    // 子代理 c2、c3 各有自己的会话；c2 的在等批准，c3 的在等回答，c4 是模型自带的（没有 childThreadId），旧宿主没有 needs 的 c5 不算
    threads = [
      { environmentId: "env-1", threadId: "child-2", needs: "approval" },
      { environmentId: "env-1", threadId: "child-3", needs: "input" },
      { environmentId: "env-1", threadId: "child-5" },
    ];
    renderOverlay({
      ...props,
      subagents: [
        { id: "c2", status: "waiting", childThreadId: "child-2" },
        { id: "c3", status: "waiting", childThreadId: "child-3" },
        { id: "c4", status: "waiting", childThreadId: null },
        { id: "c5", status: "running", childThreadId: "child-5" },
      ],
    });
    const signs = signed.at(-1);
    assert.deepEqual([...signs.keys()], ["c2", "c3"]);
    assert.deepEqual([signs.get("c2").label, signs.get("c3").label], ["等你批准", "等你回复"]);
    signs.get("c2").open();
    assert.deepEqual(opened.map((r) => ({ ...r })), [{ environmentId: "env-1", threadId: "child-2" }], "点牌子跳到子代理自己的会话"); // vm 里建的对象，拷一份再比
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
};
