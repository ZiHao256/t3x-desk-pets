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
  assert.equal(pets.petFor("opencode", "gpt", map, has), "codex"); // 鲸鱼娘不在库里，退回 codex
  const all = (id) => ["codex", "claude", "gemini", "whale"].includes(id);
  assert.deepEqual(["codex", "claudeAgent", "antigravity", "opencode", "cursor"].map((d) => pets.petFor(d, "gpt", map, all)), ["codex", "claude", "gemini", "whale", "whale"]);
  assert.equal(pets.petFor("opencode", "gemini-4", map, all), "gemini"); // 未知 harness 仍先按模型名
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
  // 上限可设置：一侧到边时另一侧接着坐到第 max 个座位
  assert.equal(pets.findFreeSeat({ mainX: 300, span: 600, occupied: [350, 250, 400, 200], total: 4, max: 5 }), 450);
  assert.equal(pets.findFreeSeat({ mainX: 580, span: 600, occupied: [530, 480, 430], total: 3, max: 4 }), 380);
  assert.equal(pets.findFreeSeat({ mainX: 300, span: 600, occupied: [350], total: 1, max: 1 }), undefined);
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

  // 子宠物多（上限可到 10）时一直找到舞台边缘：190 是起拖时空出来的那格
  const crowd = pets.resolveBumpPositions({ moverX: 585, moverFromX: 190, targetX: 590, span: 664, others: [540, 640, 490, 440, 390, 340, 290, 240] });
  assert.equal(crowd.afterMoverX, 190);

  // 极窄舞台不越界
  const narrow = pets.resolveBumpPositions({ moverX: 10, moverFromX: 0, targetX: 20, span: 40 });
  assert(narrow.meetMoverX >= 0 && narrow.meetMoverX <= 40);
  assert(narrow.afterMoverX >= 0 && narrow.afterMoverX <= 40);
  assert(narrow.afterTargetX >= 0 && narrow.afterTargetX <= 40);
  assert.equal(Math.abs(narrow.afterMoverX - narrow.afterTargetX), 40);
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
  assert.equal(bundled.map((p) => p.id).join(","), "claude,gemini,whale");
  for (const def of bundled) {
    const id = def.id;
    const clean = pets.cleanPet({ ...def, sheet });
    assert.equal(Object.keys(clean.vars).length, Object.keys(def.vars).length, id);
    assert.equal(Object.keys(clean.darkVars).length, Object.keys(def.darkVars ?? {}).length, id);
  }
});

require("./controller-test.cjs")(test);
require("./web-test.cjs")({ test, readFiles });
require("./generator-test.cjs")({ test, readFiles, pets });

// 某个测试的 Promise 永远不结束时事件循环会排空，进程照样以 0 退出：没跑完就算失败
process.on("exit", (code) => {
  if (code === 0 && passed < queue.length) {
    console.error(`\n没跑完，卡在：${queue[passed][0]}（${passed}/${queue.length}）`);
    process.exitCode = 1;
  }
});

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
