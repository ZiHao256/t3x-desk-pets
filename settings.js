// 桌宠设置：每个 agent 用哪只宠物；宠物库里增删改自己的宠物。
const h = host.h;
const agentLabels = () => ({ codex: "Codex", claudeAgent: "Claude", antigravity: host.t("Antigravity（Gemini）", "Antigravity (Gemini)"), cursor: "Cursor", opencode: "OpenCode", "*": host.t("其他 agent", "Other agents") });
const SHEET_MAX_BYTES = 2 * 1024 * 1024;
const SHEET_MAX_SIDE = 4096; // 解码前先看尺寸，挡住体积小、像素特别多的图

/** 读用户选的精灵图：限制大小、格式和 8x11 的比例，返回 data URL。 */
async function readSheet(file) {
  if (!/^image\/(webp|png|gif)$/.test(file.type)) throw new Error(host.t("精灵图需要是 webp / png / gif", "The sprite sheet must be a WebP, PNG, or GIF image"));
  if (file.size > SHEET_MAX_BYTES) throw new Error(host.t("精灵图不能超过 2 MB", "The sprite sheet must be at most 2 MB"));
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(host.t("图片读不出来", "Couldn’t read the image")));
    img.src = url;
  });
  const w = img.naturalWidth;
  const hgt = img.naturalHeight;
  if (w > SHEET_MAX_SIDE || hgt > SHEET_MAX_SIDE) throw new Error(host.t(`精灵图太大（${w}x${hgt}），边长不能超过 ${SHEET_MAX_SIDE}`, `The sprite sheet is too large (${w}×${hgt}). Each side must be at most ${SHEET_MAX_SIDE} pixels.`));
  // 8 列 x 11 行，每格 192x208 的等比例缩放：能整除，且单格宽高比一致
  const cellW = w / 8;
  const cellH = hgt / 11;
  if (w % 8 || hgt % 11 || Math.abs(cellW / cellH - 192 / 208) > 0.01) {
    throw new Error(host.t(`精灵图需要 8 列 x 11 行、每格 192x208 的比例（例如 1536x2288），这张是 ${w}x${hgt}`, `Use an 8-column by 11-row sprite sheet with a 192:208 cell aspect ratio (for example, 1536×2288). This image is ${w}×${hgt}.`));
  }
  return url;
}

function agentKeys() {
  const seen = new Set(["codex", "claudeAgent", "antigravity"]);
  for (const p of host.chat.last()?.providers ?? []) if (p?.driver) seen.add(p.driver);
  for (const k of Object.keys(host.storage.get("map", {}))) if (k !== "*") seen.add(k);
  return [...seen, "*"];
}

function agentLabel(key) {
  const provider = (host.chat.last()?.providers ?? []).find((p) => p?.driver === key);
  return agentLabels()[key] ?? provider?.displayName ?? provider?.label ?? key;
}

function Thumb({ pet }) {
  return h("span", { className: "t3x-pet-thumb", "data-smooth": pet.smooth ? "" : undefined, style: { backgroundImage: `url(${pet.sheet})` } });
}

function PetForm({ ui, initial, onDone }) {
  host.useLang();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [scale, setScale] = React.useState(String(Number(initial?.vars?.["--t3x-pet-scale"] ?? 1)));
  const [pixel, setPixel] = React.useState(!initial?.smooth);
  const [pixelFx, setPixelFx] = React.useState(initial?.pixelFx === true);
  const [sheet, setSheet] = React.useState(initial?.sheet ?? null);
  const [error, setError] = React.useState(null);
  const save = () => {
    try {
      if (!name.trim()) throw new Error(host.t("请填名字", "Enter a name"));
      if (!sheet) throw new Error(host.t("请选择精灵图", "Choose a sprite sheet"));
      const custom = host.storage.get("custom", []);
      const id = initial?.id ?? `my-${Date.now().toString(36)}`;
      const def = cleanPet({ ...(initial ?? {}), id, name: name.trim(), sheet, scale: Number(scale), smooth: !pixel, pixelFx }, host.t);
      host.storage.set("custom", [...custom.filter((p) => p.id !== id), def]);
      onDone();
    } catch (e) {
      setError(e.message);
    }
  };
  return h(
    "div",
    { className: "t3x-pet-form" },
    h("label", null, host.t("名字", "Name"), h("input", { className: "t3x-pet-input", value: name, maxLength: 40, onChange: (e) => setName(e.target.value) })),
    h(
      "label",
      null,
      host.t("精灵图（8 列 x 11 行）", "Sprite sheet (8 columns × 11 rows)"),
      h("input", {
        type: "file",
        accept: "image/webp,image/png,image/gif",
        onChange: (e) => {
          const f = e.target.files?.[0];
          if (f) readSheet(f).then(setSheet, (err) => setError(err.message));
        },
      }),
    ),
    h("label", null, host.t("缩放", "Scale"), h("input", { className: "t3x-pet-input t3x-pet-num", type: "number", min: 0.5, max: 2, step: 0.05, value: scale, onChange: (e) => setScale(e.target.value) })),
    h("label", { className: "t3x-pet-check" }, h("input", { type: "checkbox", checked: pixel, onChange: (e) => setPixel(e.target.checked) }), host.t("像素画（放大不模糊）", "Pixel art (keep edges sharp when enlarged)")),
    h("label", { className: "t3x-pet-check" }, h("input", { type: "checkbox", checked: pixelFx, onChange: (e) => setPixelFx(e.target.checked) }), host.t("像素风粒子特效", "Pixel-art particles")),
    error ? h("p", { className: "t3x-error" }, error) : null,
    h("div", { className: "t3x-pet-actions" }, h(ui.Button, { size: "xs", onClick: save }, host.t("保存", "Save")), h(ui.Button, { size: "xs", variant: "ghost", onClick: onDone }, host.t("取消", "Cancel"))),
  );
}

function PetSettings({ ui }) {
  host.useLang();
  const saved = host.storage.use("map", {});
  host.storage.use("custom", []);
  const [editing, setEditing] = React.useState(null); // null | "new" | 宠物 id
  const map = { ...DEFAULT_MAP, ...saved };
  const list = [...pets.values()];
  const sourceLabels = { builtin: host.t("内置", "Built in"), local: host.t("本机", "Local"), custom: host.t("自定义", "Custom") };
  // “按模型名”存成 auto：直接删键的话，Codex / Claude / Antigravity 又会回到默认对应。
  const setAgent = (key, value) => host.storage.set("map", { ...saved, [key]: value || "auto" });
  // 默认对应的宠物不在库里（比如没有本机素材）时显示成“按模型名”，和实际行为一致。
  const shown = (key) => (map[key] === "none" || pets.has(map[key]) ? map[key] : "");
  const remove = (pet) => {
    if (!window.confirm(host.t(`删除宠物“${pet.name}”？`, `Delete “${pet.name}”?`))) return;
    host.storage.set("custom", host.storage.get("custom", []).filter((p) => p.id !== pet.id));
  };
  return h(
    "div",
    { className: "t3x-pet-settings" },
    h("div", { className: "t3x-pet-head" }, h("span", null, host.t("每个 agent 用哪只", "Pet for each agent")), h(ui.Button, { size: "xs", variant: "ghost", onClick: () => controller.unhide() }, host.t("叫回右键隐藏的桌宠", "Recall pets hidden by right-clicking"))),
    h(
      "div",
      { className: "t3x-pet-map" },
      agentKeys().map((key) =>
        h(
          "label",
          { key, className: "t3x-pet-map-row" },
          h("span", null, agentLabel(key)),
          h(
            "select",
            { className: "t3x-pet-input", value: shown(key), onChange: (e) => setAgent(key, e.target.value) },
            key === "*" ? null : h("option", { value: "" }, host.t("按模型名 / 同其他 agent", "By model name / same as other agents")),
            list.map((p) => h("option", { key: p.id, value: p.id }, p.name)),
            h("option", { value: "none" }, host.t("不显示", "Hide pet")),
          ),
        ),
      ),
    ),
    h("div", { className: "t3x-pet-head" }, h("span", null, host.t("宠物库", "Pet library")), h(ui.Button, { size: "xs", variant: "outline", onClick: () => setEditing("new") }, host.t("添加桌宠", "Add desk pet"))),
    editing ? h(PetForm, { key: editing, ui, initial: editing === "new" ? null : pets.get(editing), onDone: () => setEditing(null) }) : null,
    h(
      "div",
      { className: "t3x-pet-grid" },
      list.map((p) =>
        h(
          "div",
          { key: p.id, className: "t3x-pet-card" },
          h(Thumb, { pet: p }),
          h("span", { className: "t3x-pet-name" }, p.name),
          h("span", { className: "t3x-meta" }, sourceLabels[p.source]),
          p.source === "custom"
            ? h(
                "div",
                { className: "t3x-pet-actions" },
                h(ui.Button, { size: "xs", variant: "ghost", onClick: () => setEditing(p.id) }, host.t("编辑", "Edit")),
                h(ui.Button, { size: "xs", variant: "ghost", onClick: () => remove(p) }, host.t("删除", "Delete")),
              )
            : null,
        ),
      ),
    ),
  );
}
