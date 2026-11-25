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
const isQuiet = () => host.storage.get("quiet", false) === true;
// 主输入框挂着桌宠时的 agent（PetsOverlay 挂载期间）；当前项目或环境停用了桌宠就是 null，右键模型选择器不接管。
let mainAgent = null;
let disposed = false;
const controller = createPetController({
  catalog: { get: (id) => pets.get(id) },
  position: { get: () => host.storage.get("x", 0.9), set: (v) => host.storage.set("x", v) },
  quiet: isQuiet,
  onMenu: (ev) => openMenu(ev, true),
});

// 右键菜单用 T3 自己的菜单样式（host.contextMenu，返回选中项的 id）。onPet：右键的是宠物还是模型选择器。
function menuItems(onPet, agent) {
  const current = petFor(agent.driver, agent.model, currentMap(), has);
  const items = onPet ? [] : [{ id: "toggle", label: host.t("显示桌宠", "Show desk pet"), checked: controller.enabled() }];
  // 图标只能用 T3 菜单内置的几个名字；勾选项自带勾或等宽留白，每项都有图标文字才对齐。
  items.push({ id: "switch", label: host.t("换一只宠物", "Switch pet"), icon: "refresh-cw", children: [...pets.values()].map((p) => ({ id: `pet:${p.id}`, label: p.name, checked: p.id === current })) });
  if (onPet) items.push({ id: "greet", label: host.t("打个招呼", "Say hi"), icon: "message-square" });
  items.push({ id: "quiet", label: host.t("安静模式", "Quiet mode"), checked: isQuiet() });
  items.push({ id: "settings", label: host.t("桌宠设置…", "Desk pet settings…"), icon: "settings", separatorBefore: true });
  if (onPet) items.push({ id: "hide", label: host.t("隐藏桌宠", "Hide desk pet"), icon: "pin-off" }); // 右键模型选择器叫回
  return items;
}

// agent 是打开菜单时的那个：菜单开着的时候换了会话，也改的是当时那个 agent。
function runMenu(choice, agent) {
  if (disposed) return; // 菜单开着时扩展被停用
  if (choice === "hide" || (choice === "toggle" && controller.enabled())) controller.hide();
  else if (choice === "toggle") controller.unhide();
  else if (choice === "greet") controller.greet();
  else if (choice === "quiet") host.storage.set("quiet", !isQuiet());
  else if (choice === "settings") host.openSettings();
  else if (choice?.startsWith("pet:")) {
    // 没有 driver（还没选 harness）时改实际生效的那项，否则按模型名匹配会盖过 "*"。
    host.storage.set("map", { ...host.storage.get("map", {}), [agent.driver ?? modelKey(agent.model)]: choice.slice(4) });
    if (!controller.enabled()) controller.unhide(); // 隐藏时选了一只，就是想看到它
  }
}

function openMenu(ev, onPet) {
  const agent = mainAgent;
  if (!agent) return;
  ev.preventDefault();
  ev.stopPropagation();
  host.contextMenu(menuItems(onPet, agent), { x: ev.clientX, y: ev.clientY }).then(
    (choice) => runMenu(choice, agent),
    (error) => console.error("[desk-pets] 右键菜单出错", error),
  );
}

// 只接管主输入框里的模型选择器（设置页、side chat 里的不管）。
function onContextMenu(ev) {
  const picker = ev.target instanceof Element ? ev.target.closest("[data-chat-provider-model-picker]") : null;
  if (picker?.closest('[data-slot="composer-host"]') && !picker.closest("[data-side-chat-pane]")) openMenu(ev, false);
}
document.addEventListener("contextmenu", onContextMenu, true);

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
    if (embedded) return;
    const agent = { driver, model };
    mainAgent = agent;
    return () => {
      if (mainAgent === agent) mainAgent = null;
    };
  }, [embedded, driver, model]);
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
  disposed = true;
  document.removeEventListener("contextmenu", onContextMenu, true);
  offCustom();
  offMap();
  catalogListeners.clear();
  seenSubs.clear();
  controller.dispose();
};
