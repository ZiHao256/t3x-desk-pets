// 桌宠：每个 agent 一只，站在主输入框上沿；子代理各派一只到旁边干活。
// 宠物 = 内置（Codex + pets.js 里的 BUNDLED_PETS，精灵图在 pets/）+ 本机素材（构建时并入 local/，不公开）+ 设置里自己添加的；agent → 宠物的对应关系也在设置里改。
const { React } = host;

function bundledPets() {
  const list = [
    { id: "codex", name: "Codex", sheet: host.files.url("pets/codex/sheet.webp"), vars: { "--t3x-pet-scale": "1.1" }, source: "builtin" },
    ...BUNDLED_PETS.map((p) => ({ ...p, sheet: host.files.url(`pets/${p.id}/sheet.webp`), source: "builtin" })),
  ];
  for (const path of host.files.list()) {
    const m = /^local\/([^/]+)\/pet\.json$/.exec(path);
    if (m) list.push({ ...JSON.parse(host.files.text(path)), id: m[1], sheet: host.files.url(`local/${m[1]}/sheet.webp`), source: "local" });
  }
  return list;
}

const pets = new Map();
let removePetStyles = null;

// 内置和自定义宠物合在一起；自定义的同 id 覆盖内置的。每只宠物生成一组 CSS 变量规则。
function rebuild() {
  pets.clear();
  const custom = host.storage.get("custom", []).map((p) => ({ ...p, source: "custom" }));
  for (const raw of [...bundledPets(), ...custom]) {
    try {
      pets.set(raw.id, { ...cleanPet(raw), source: raw.source });
    } catch (error) {
      console.warn("[desk-pets] 跳过无效的宠物", raw?.id, error.message);
    }
  }
  removePetStyles?.();
  removePetStyles = host.style([...pets.values()].map(petCss).join("\n"));
}
rebuild();

const has = (id) => pets.has(id);
const currentMap = () => ({ ...DEFAULT_MAP, ...host.storage.get("map", {}) });
const controller = createPetController({
  catalog: { get: (id) => pets.get(id) },
  position: { get: () => host.storage.get("x", 0.9), set: (v) => host.storage.set("x", v) },
});

// 扩展级宠物库/映射版本：卸载聊天视图后再改设置，重挂时仍能识别旧缓存已失效。
let catalogVersion = 0;
const catalogListeners = new Set();
const seenSubs = new Map();
function bumpCatalog() {
  catalogVersion += 1;
  seenSubs.clear();
  for (const fn of catalogListeners) fn(catalogVersion);
}

const offCustom = host.storage.subscribe("custom", () => {
  rebuild();
  bumpCatalog();
  controller.refresh();
});
const offMap = host.storage.subscribe("map", bumpCatalog);

// 对应关系或宠物库变了，聊天视图里的组件要重新选宠物。
function useCatalogVersion() {
  const [version, setVersion] = React.useState(() => catalogVersion);
  React.useEffect(() => {
    setVersion(catalogVersion);
    catalogListeners.add(setVersion);
    return () => catalogListeners.delete(setVersion);
  }, []);
  return version;
}

// 每个会话最后看到的子代理（只记最近 20 个会话），切回来时补播离开期间的进出场。
function rememberSubs(key, version, map, done) {
  if (key == null) return;
  seenSubs.delete(key);
  seenSubs.set(key, { version, map, done });
  if (seenSubs.size > 20) seenSubs.delete(seenSubs.keys().next().value);
}

function PetsOverlay({ embedded, driver, model, threadKey, awaiting, working, error, runStatus, subagents }) {
  const catalogVersion = useCatalogVersion();
  const petId = petFor(driver, model, currentMap(), has);
  const mood = petMood({ awaiting, working: !!working, error: !!error });
  const prevRef = React.useRef(null);
  const pendingRef = React.useRef(false);
  const [visible, setVisible] = React.useState(() => controller.enabled());
  React.useEffect(() => {
    const sync = () => setVisible(controller.enabled());
    window.addEventListener("t3x-pets-change", sync);
    return () => window.removeEventListener("t3x-pets-change", sync);
  }, []);
  React.useEffect(() => {
    if (embedded || !visible) return;
    if (petId) controller.update({ petId, mood });
    else controller.clear(); // 这个 agent 设成了不显示
  }, [embedded, petId, mood, visible]);
  React.useEffect(() => {
    const cur = { key: threadKey, working: !!working, awaiting, error: !!error, runStatus };
    const prev = prevRef.current;
    prevRef.current = cur;
    const next = backgroundFinish(pendingRef.current, prev, cur, false);
    pendingRef.current = next.pending;
    if (next.done && !embedded) controller.celebrate();
  }, [threadKey, working, awaiting, error, runStatus]);
  // 子代理：第一次进入会话时已在跑的直接落座，之后的变化才播跑来、击掌等动画；回到看过的会话时补播离开期间的变化。
  // 投影可能比 threadKey 晚到：没拿到列表前只清掉上个会话的子宠物，拿到首份列表再落座。
  // 对应关系或宠物库变了也按新进会话处理：已有的子宠物按新设置重新落座。
  const subsRef = React.useRef({ ready: false, cleared: false, key: undefined, version: catalogVersion, map: new Map(), done: new Set() });
  React.useEffect(() => {
    if (embedded) return;
    const cur = subsRef.current;
    if (!visible) {
      subsRef.current = { ready: false, cleared: true, key: undefined, version: catalogVersion, map: new Map(), done: new Set() }; // 叫回来时全部直接落座
      seenSubs.clear();
      return;
    }
    if (subagents == null) {
      if (cur.ready || !cur.cleared) controller.subagents([], true);
      subsRef.current = { ready: false, cleared: true, key: undefined, version: catalogVersion, map: new Map(), done: new Set() };
      return;
    }
    const entering = !cur.ready || cur.key !== threadKey;
    const fresh = entering || cur.version !== catalogVersion;
    const petOf = (d, m) => petFor(d, m, currentMap(), has);
    // 宠物库或对应关系改过之后，seenSubs 已清空且版本递增，旧记录不会复用。
    const remembered = entering && threadKey != null ? seenSubs.get(threadKey) : undefined;
    const seen = remembered && remembered.version === catalogVersion ? remembered : undefined;
    const { next, done, events } = seen
      ? resumeSubagents(seen.map, subagents, petOf, seen.done)
      : subagentEvents(fresh ? new Map() : cur.map, subagents, fresh, petOf, fresh ? undefined : cur.done);
    subsRef.current = { ready: true, cleared: true, key: threadKey, version: catalogVersion, map: next, done };
    rememberSubs(threadKey, catalogVersion, next, done);
    if (fresh || events.length) controller.subagents(events, fresh);
  }, [embedded, threadKey, subagents, visible, catalogVersion]);
  React.useEffect(
    () => () => {
      if (!embedded) controller.detach();
    },
    [embedded],
  );
  return null;
}

host.register("chat.overlay", PetsOverlay);
host.settings(PetSettings);

return () => {
  offCustom();
  offMap();
  catalogListeners.clear();
  seenSubs.clear();
  controller.dispose();
};
