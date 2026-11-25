// 桌宠的纯函数（tests/verify.cjs 直接测）。精灵图统一用 8 列 x 11 行的格式，行含义见 controller.js 的 ROWS。

function petMood({ awaiting, working, error }) {
  if (awaiting) return "waiting";
  if (error) return "failed";
  if (working) return "running";
  return "idle";
}

// 看向行：0 度朝上、顺时针 16 个方向，落在第 9、10 行。
function lookFrame(dx, dy) {
  if (Math.hypot(dx, dy) <= 1) return null;
  const idx = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 / 22.5) % 16;
  return { row: 9 + Math.floor(idx / 8), col: idx % 8 };
}

// 比较前后两份子代理列表得出要播的事件。seat=true 表示刚进入这个会话：已在跑的直接落座，不跑过来。
// prev: Map<id, { petId, status }>，只记进行中的子代理；prevDone: Set<id>，记上次已见的终态以区分新完成的子代理。
function subagentEvents(prev, list, seat, petOf, prevDone) {
  const ACTIVE = new Set(["pending", "running", "waiting"]);
  const FAILED = new Set(["failed", "cancelled", "interrupted"]);
  const next = new Map();
  const done = new Set();
  const events = [];
  const seen = new Set();
  for (const s of list || []) {
    if (!s || s.id == null) continue;
    seen.add(s.id);
    const was = prev.get(s.id);
    if (ACTIVE.has(s.status)) {
      const petId = was ? was.petId : petOf(s.driver, s.model ?? s.modelSelection?.model);
      if (!petId) continue; // 这个 agent 设成了不显示桌宠
      next.set(s.id, { petId, status: s.status });
      if (!was) events.push({ type: seat ? "seat" : "arrive", id: s.id, petId, status: s.status });
      else if (was.status !== s.status) events.push({ type: "status", id: s.id, petId, status: s.status });
    } else {
      done.add(s.id);
      if (was) {
        events.push({ type: "finish", id: s.id, petId: was.petId, ok: !FAILED.has(s.status) });
      } else if (!seat && prevDone && !prevDone.has(s.id)) {
        // 离开或两次渲染之间既启动又完成的子代理：补出进场与收工，跳过上次已见的历史终态。
        const petId = petOf(s.driver, s.model ?? s.modelSelection?.model);
        if (petId) {
          events.push({ type: "arrive", id: s.id, petId, status: "running" });
          events.push({ type: "finish", id: s.id, petId, ok: !FAILED.has(s.status) });
        }
      }
    }
  }
  // 从列表里消失的：悄悄离开，不击掌。
  for (const [id, was] of prev) if (!seen.has(id)) events.push({ type: "finish", id, petId: was.petId, ok: true, quiet: true });
  return { next, done, events };
}

/** 回到看过的会话：上次在的子代理先原样落座，离开期间的变化（含既启动又完成的）再按动画补播。 */
function resumeSubagents(seen, list, petOf, prevDone = new Set()) {
  const { next, done, events } = subagentEvents(seen, list, false, petOf, prevDone);
  const seats = [...seen].map(([id, v]) => ({ type: "seat", id, petId: v.petId, status: v.status }));
  return { next, done, events: [...seats, ...events] };
}

/** 后台完成（和边缘光同一判断）：会话在窗口不在前台时正常跑完，宠物跳一下。 */
function backgroundFinish(pending, prev, cur, focused) {
  if (!prev || prev.key !== cur.key || cur.working || cur.awaiting || cur.error || focused) return { pending: false, done: false };
  if (!pending && !prev.working) return { pending: false, done: false };
  if (cur.runStatus === "completed") return { pending: false, done: true };
  return { pending: !["failed", "interrupted", "cancelled"].includes(cur.runStatus), done: false };
}

const DEFAULT_MAP = { codex: "codex", claudeAgent: "claude", antigravity: "gemini", "*": "codex" };

/**
 * 按会话的 harness（provider driver）选宠物；map 里没有这个 driver 时按模型名找 Claude / Gemini 的设置，再用 "*"。
 * 值为 "none" 表示不显示，"auto" 表示按模型名；选中的宠物被删了就退回 codex。
 */
function petFor(driver, model, map, has) {
  let id = driver && Object.hasOwn(map, driver) ? map[driver] : undefined;
  if (id === "auto") id = undefined; // 设置里明确选了“按模型名”，不用默认对应
  if (id === undefined) {
    const m = String(model || "").toLowerCase();
    if (/claude|opus|sonnet|haiku|fable/.test(m)) id = map.claudeAgent;
    else if (/gemini/.test(m)) id = map.antigravity;
  }
  if (id === undefined) id = map["*"];
  if (id === "none" || id == null) return null;
  return has(id) ? id : has("codex") ? "codex" : null;
}

const PET_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const VAR_NAME_RE = /^--t3x-(pet|sub)-[\w-]+$/;
// 值只允许 CSS 值里常见的字符，拒绝 ; { } < > \ 和引号，防止从变量里跳出规则；
// 再拒绝 url( / image( / image-set( 和 //，变量被当作背景时不能去加载外部图片。
const VAR_VALUE_RE = /^[\w\s#%.,()/*+-]+$/;
const VAR_FETCH_RE = /url\(|image(-set)?\(|\/\//i;

/** 把 pet 定义（可能来自用户导入）清洗成控制器能用的结构；不合法抛错。 */
function cleanPet(raw, t = (zh) => zh) {
  if (!raw || typeof raw !== "object") throw new Error(t("宠物定义不是对象", "The pet definition must be an object"));
  if (typeof raw.id !== "string" || !PET_ID_RE.test(raw.id)) throw new Error(t("宠物 id 只能用小写字母、数字和连字符，最多 32 个字符", "The pet ID may contain only lowercase letters, digits, and hyphens, up to 32 characters"));
  if (typeof raw.sheet !== "string" || !/^data:image\/(webp|png|gif);base64,[A-Za-z0-9+/=]+$/.test(raw.sheet)) throw new Error(t("精灵图需要是 webp / png / gif", "The sprite sheet must be a WebP, PNG, or GIF image"));
  const vars = (v) => Object.fromEntries(Object.entries(v ?? {}).filter(([k, val]) => VAR_NAME_RE.test(k) && typeof val === "string" && VAR_VALUE_RE.test(val) && !VAR_FETCH_RE.test(val)));
  const scale = Number(raw.scale);
  const badge = Number(raw.badgeBottom);
  return {
    id: raw.id,
    name: String(raw.name || raw.id).slice(0, 40),
    sheet: raw.sheet,
    vars: { ...vars(raw.vars), ...(Number.isFinite(scale) && scale >= 0.5 && scale <= 2 ? { "--t3x-pet-scale": String(scale) } : {}) },
    darkVars: vars(raw.darkVars),
    pixelFx: raw.pixelFx === true,
    smooth: raw.smooth === true,
    badgeBottom: Number.isFinite(badge) && badge >= 0 && badge <= 120 ? badge : 54,
  };
}

/** 每只宠物一组规则；放在扩展样式之后注入，覆盖 .t3x-pet 上的默认变量。 */
function petCss(pet) {
  const decl = (v) => Object.entries(v).map(([k, val]) => `${k}:${val}`).join(";");
  const sel = `.t3x-pet[data-pet="${pet.id}"]`;
  return `${sel}{${decl(pet.vars)}}html.dark ${sel}{${decl(pet.darkVars)}}`;
}

/** 判断松手位置是否落在某只可互动宠物附近；多只都在范围内时选最近的一只。 */
function findBumpTarget(x, others, hitDist = 46) {
  let best = null;
  let bestDist = Infinity;
  for (const o of others || []) {
    const d = Math.abs(o.x - x);
    if (d <= hitDist && d < bestDist) {
      best = o;
      bestDist = d;
    }
  }
  return best;
}

/** 计算双宠互动时的面对面站位，以及互动后互不重叠的分开站位（并尽量避开其他宠物）。 */
function resolveBumpPositions({ moverX, moverFromX = moverX, targetX, span, others = [], kissGap = 30, minGap = 50 }) {
  const max = Math.max(0, Number(span) || 0);
  const clamp = (v) => Math.max(0, Math.min(max, v));
  const tx = clamp(targetX);
  const mx = clamp(moverX);
  const clearOfOthers = (x, gap) => others.every((o) => Math.abs(o - x) >= gap);

  // 优先保持拖动过来那一侧，重合时按起拖侧，避免互动瞬间互相穿身。
  let side = mx !== tx ? (mx < tx ? -1 : 1) : moverFromX !== tx ? (moverFromX < tx ? -1 : 1) : tx > max / 2 ? -1 : 1;
  let meetTargetX = tx;
  let meetMoverX = tx + side * kissGap;
  if (meetMoverX < 0 || meetMoverX > max) {
    const flipped = tx - side * kissGap;
    if (flipped >= 0 && flipped <= max) {
      side = -side;
      meetMoverX = flipped;
    } else if (max <= kissGap) {
      meetMoverX = side < 0 ? 0 : max;
      meetTargetX = side < 0 ? max : 0;
    } else {
      meetMoverX = clamp(meetMoverX);
      meetTargetX = clamp(meetMoverX - side * kissGap);
    }
  }

  // 分开时尽量让被碰到的宠物留在原地，主动拖来的宠物退开到不重叠且不撞第三只的位置。
  const sep = Math.min(minGap, max);
  const candList = [
    tx + side * sep,
    tx - side * sep,
    tx + side * sep * 2,
    tx - side * sep * 2,
    tx + side * sep * 3,
    tx - side * sep * 3,
  ];
  for (const x of candList) {
    if (x >= 0 && x <= max && Math.abs(x - tx) >= sep - 0.5 && clearOfOthers(x, minGap - 4)) {
      return { meetMoverX, meetTargetX, afterMoverX: x, afterTargetX: tx, side };
    }
  }

  // 单侧退不开或被第三只挡住：先试同侧双双微让一步，保证至少这两只不重叠。
  const mid = (meetMoverX + meetTargetX) / 2;
  let left = clamp(mid - sep / 2);
  let right = left + sep;
  if (right > max) {
    right = max;
    left = Math.max(0, max - sep);
  }
  const pairMover = side < 0 ? left : right;
  const pairTarget = side < 0 ? right : left;
  if (clearOfOthers(pairMover, minGap - 4) && clearOfOthers(pairTarget, minGap - 4)) {
    return { meetMoverX, meetTargetX, afterMoverX: pairMover, afterTargetX: pairTarget, side };
  }

  // 兜底：选在边界内、距 target 至少 sep 且离其他宠物最远的候选点。
  const valid = candList.filter((x) => x >= 0 && x <= max && Math.abs(x - tx) >= sep - 0.5);
  if (valid.length) {
    let pick = valid[0];
    let bestClear = -1;
    for (const x of valid) {
      const clear = others.length ? Math.min(...others.map((o) => Math.abs(o - x))) : Infinity;
      if (clear > bestClear) {
        bestClear = clear;
        pick = x;
      }
    }
    return { meetMoverX, meetTargetX, afterMoverX: pick, afterTargetX: tx, side };
  }
  return { meetMoverX, meetTargetX, afterMoverX: pairMover, afterTargetX: pairTarget, side };
}

/** 按主宠位置和可用跨度找第一个空闲座位；满员或舞台过窄时返回 undefined。 */
function findFreeSeat({ mainX, span, occupied = [], total = occupied.length, max = 3, gap = 50 }) {
  if (total >= max) return undefined;
  const maxX = Math.max(0, Number(span) || 0);
  const candidates = [1, -1, 2, -2, 3, -3].map((k) => mainX + k * gap).filter((x) => x >= 0 && x <= maxX);
  return candidates.find((x) => !occupied.some((ox) => Math.abs(ox - x) < gap / 2));
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    petMood,
    lookFrame,
    subagentEvents,
    resumeSubagents,
    backgroundFinish,
    petFor,
    cleanPet,
    petCss,
    findBumpTarget,
    resolveBumpPositions,
    findFreeSeat,
    DEFAULT_MAP,
  };
}
