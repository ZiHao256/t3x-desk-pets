// 桌宠设置：每个 agent 用哪只宠物；宠物库里增删改自己的宠物。
const h = host.h;
const agentLabels = () => ({
  codex: "Codex",
  claudeAgent: "Claude",
  antigravity: host.t("Antigravity（Gemini）", "Antigravity (Gemini)"),
  cursor: "Cursor",
  opencode: "OpenCode",
  "*": host.t("其他 agent", "Other agents"),
});
const SHEET_MAX_BYTES = 2 * 1024 * 1024;
const SHEET_MAX_SIDE = 4096; // 解码前先看尺寸，挡住体积小、像素特别多的图

/** 读用户选的精灵图：限制大小、格式和 8x11 的比例，返回 data URL。 */
async function readSheet(file) {
  if (!/^image\/(webp|png|gif)$/.test(file.type)) {
    throw new Error(host.t("精灵图需要是 webp / png / gif", "The sprite sheet must be a WebP, PNG, or GIF image"));
  }
  if (file.size > SHEET_MAX_BYTES) {
    throw new Error(host.t("精灵图不能超过 2 MB", "The sprite sheet must be at most 2 MB"));
  }
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
  if (w > SHEET_MAX_SIDE || hgt > SHEET_MAX_SIDE) {
    throw new Error(
      host.t(
        `精灵图太大（${w}x${hgt}），边长不能超过 ${SHEET_MAX_SIDE}`,
        `The sprite sheet is too large (${w}×${hgt}). Each side must be at most ${SHEET_MAX_SIDE} pixels.`,
      ),
    );
  }
  // 8 列 x 11 行，每格 192x208 的等比例缩放：能整除，且单格宽高比一致
  const cellW = w / 8;
  const cellH = hgt / 11;
  if (w % 8 || hgt % 11 || Math.abs(cellW / cellH - 192 / 208) > 0.01) {
    throw new Error(
      host.t(
        `精灵图需要 8 列 x 11 行、每格 192x208 的比例（例如 1536x2288），这张是 ${w}x${hgt}`,
        `Use an 8-column by 11-row sprite sheet with a 192:208 cell aspect ratio (for example, 1536×2288). This image is ${w}×${hgt}.`,
      ),
    );
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

function Thumb({ pet, className = "" }) {
  return h("span", {
    className: className ? `t3x-pet-thumb ${className}` : "t3x-pet-thumb",
    "data-smooth": pet.smooth ? "" : undefined,
    style: { backgroundImage: `url(${pet.sheet})` },
  });
}

function PetForm({ ui, initial, onDone }) {
  host.useLang();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [scale, setScale] = React.useState(String(Number(initial?.vars?.["--t3x-pet-scale"] ?? 1)));
  const [pixel, setPixel] = React.useState(!initial?.smooth);
  const [pixelFx, setPixelFx] = React.useState(initial?.pixelFx === true);
  const [sheet, setSheet] = React.useState(initial?.sheet ?? null);
  const [fileName, setFileName] = React.useState("");
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false); // 读图或保存中：不能保存
  const fileRef = React.useRef(null);
  const pickSeq = React.useRef(0); // 连续选了几张图时只认最后一张
  const idRef = React.useRef(initial?.id ?? `my-${Date.now().toString(36)}`); // 保存失败重试不会多出一只

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const seq = ++pickSeq.current;
    setError(null);
    setBusy(true);
    readSheet(f)
      .then(
        (url) => {
          if (seq !== pickSeq.current) return;
          setSheet(url);
          setFileName(f.name);
        },
        (err) => seq === pickSeq.current && setError(err.message),
      )
      .finally(() => seq === pickSeq.current && setBusy(false));
  };

  const save = async () => {
    if (busy) return;
    try {
      if (!name.trim()) throw new Error(host.t("请填写宠物名称", "Enter a name for the pet"));
      if (!sheet) throw new Error(host.t("请选择精灵图", "Choose a sprite sheet"));
      const numScale = Number(scale);
      if (!Number.isFinite(numScale) || numScale < 0.5 || numScale > 2) {
        throw new Error(host.t("缩放比例需在 0.5 到 2.0 之间", "Scale must be between 0.5 and 2.0"));
      }
      const custom = host.storage.get("custom", []);
      const id = idRef.current;
      const def = cleanPet(
        { ...(initial ?? {}), id, name: name.trim(), sheet, scale: numScale, smooth: !pixel, pixelFx },
        host.t,
      );
      setBusy(true);
      await host.storage.set("custom", [...custom.filter((p) => p.id !== id), def]); // 写盘成功再关表单
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const sectionTitle = initial
    ? host.t(`编辑桌宠：${initial.name}`, `Edit desk pet: ${initial.name}`)
    : host.t("添加桌宠", "Add desk pet");

  return h(
    ui.Section,
    { title: sectionTitle, className: "t3x-pet-form-section" },
    h(ui.Row, {
      title: host.t("名称", "Name"),
      description: host.t("显示在宠物库与选择列表中的名字（最多 40 字）", "Display name shown in the pet library and menus (up to 40 characters)"),
      control: h(ui.Input, {
        size: "sm",
        className: "w-full sm:w-56",
        maxLength: 40,
        placeholder: host.t("例如：小橘猫", "e.g. Pixel Cat"),
        value: name,
        "aria-label": host.t("名称", "Name"),
        onChange: (e) => {
          setName(e.target.value);
          setError(null);
        },
      }),
    }),
    h(ui.Row, {
      title: host.t("精灵图", "Sprite sheet"),
      description: host.t(
        "8 列 × 11 行、每格 192×208 比例（如 1536×2288），支持 WebP / PNG / GIF，不超过 2 MB",
        "8 columns × 11 rows with a 192:208 cell ratio (e.g. 1536×2288). WebP, PNG, or GIF, up to 2 MB.",
      ),
      control: h(
        "div",
        { className: "t3x-pet-file-ctrl" },
        h("input", {
          ref: fileRef,
          type: "file",
          hidden: true,
          accept: "image/webp,image/png,image/gif",
          onChange: onPickFile,
        }),
        sheet
          ? h(
              "div",
              { className: "t3x-pet-file-preview" },
              h(Thumb, { pet: { sheet, smooth: !pixel }, className: "t3x-pet-thumb-sm" }),
              h(
                "span",
                { className: "t3x-pet-file-name", title: fileName || undefined },
                fileName || host.t("已加载精灵图", "Sprite sheet loaded"),
              ),
            )
          : h("span", { className: "t3x-pet-file-empty" }, host.t("未选择文件", "No file selected")),
        h(
          ui.Button,
          {
            type: "button",
            size: "xs",
            variant: "outline",
            onClick: () => fileRef.current?.click(),
          },
          sheet ? host.t("更换图片…", "Replace image…") : host.t("选择图片…", "Choose image…"),
        ),
      ),
    }),
    h(ui.Row, {
      title: host.t("缩放比例", "Scale"),
      description: host.t("调整桌宠在输入框上方的显示大小（0.5 – 2.0）", "Display size above the composer (0.5 – 2.0)"),
      control: h(ui.Input, {
        size: "sm",
        font: "mono",
        type: "number",
        min: 0.5,
        max: 2,
        step: 0.05,
        className: "w-24",
        value: scale,
        "aria-label": host.t("缩放比例", "Scale"),
        onChange: (e) => {
          setScale(e.target.value);
          setError(null);
        },
      }),
    }),
    h(ui.Row, {
      title: host.t("像素画", "Pixel art"),
      description: host.t("放大时保持锐利像素边缘，不进行平滑模糊", "Keep edges crisp when scaled up instead of smoothing"),
      control: h(ui.Switch, {
        checked: pixel,
        onCheckedChange: (checked) => setPixel(!!checked),
        "aria-label": host.t("像素画", "Pixel art"),
      }),
    }),
    h(ui.Row, {
      title: host.t("像素风粒子特效", "Pixel-art particles"),
      description: host.t("互动与庆祝时使用方形像素粒子", "Use square pixel particles during interactions and celebrations"),
      control: h(ui.Switch, {
        checked: pixelFx,
        onCheckedChange: (checked) => setPixelFx(!!checked),
        "aria-label": host.t("像素风粒子特效", "Pixel-art particles"),
      }),
    }),
    h(
      "div",
      { className: "t3x-pet-form-foot" },
      h("div", { className: "t3x-pet-form-error" }, error ? h("p", { className: "t3x-error", role: "alert" }, error) : null),
      h(
        "div",
        { className: "t3x-pet-form-actions" },
        h(ui.Button, { type: "button", size: "xs", variant: "ghost", onClick: onDone }, host.t("取消", "Cancel")),
        h(ui.Button, { type: "button", size: "xs", variant: "default", disabled: busy, onClick: save }, host.t("保存", "Save")),
      ),
    ),
  );
}

function PetSettings({ ui }) {
  host.useLang();
  const saved = host.storage.use("map", {});
  host.storage.use("custom", []);
  const [editing, setEditing] = React.useState(null); // null | "new" | 宠物 id
  const map = { ...DEFAULT_MAP, ...saved };
  const list = [...pets.values()];
  const sourceLabels = {
    builtin: host.t("内置", "Built-in"),
    local: host.t("本机", "Local"),
    custom: host.t("自定义", "Custom"),
  };

  // “按模型名”存成 auto：直接删键的话，Codex / Claude / Antigravity 又会回到默认对应。
  const setAgent = (key, value) => {
    if (!value) return;
    host.storage.set("map", { ...saved, [key]: value });
  };
  // 默认对应的宠物不在库里（比如没有本机素材）时显示成“按模型名”，和实际行为一致；
  // "*" 没有“按模型名”选项，兜底回 codex（或库中第一只 / 不显示）。
  const shown = (key) => {
    const v = map[key];
    if (v === "none" || pets.has(v)) return v;
    if (key !== "*") return "auto";
    return pets.has("codex") ? "codex" : list[0]?.id ?? "none";
  };
  const choiceLabel = (val) => {
    if (val === "auto") return host.t("按模型名 / 同其他 agent", "By model name / fallback");
    if (val === "none") return host.t("不显示", "Hide pet");
    return pets.get(val)?.name ?? val;
  };
  const remove = (pet) => {
    if (!window.confirm(host.t(`删除宠物“${pet.name}”？`, `Delete “${pet.name}”?`))) return;
    if (editing === pet.id) setEditing(null);
    // 引用它的对应关系一起删掉，回到默认对应；否则 petFor 会退回 codex，而设置里显示成“按模型名”。
    const map = host.storage.get("map", {});
    host.storage.set("map", Object.fromEntries(Object.entries(map).filter(([, v]) => v !== pet.id)));
    host.storage.set(
      "custom",
      host.storage.get("custom", []).filter((p) => p.id !== pet.id),
    );
  };

  return h(
    "div",
    { className: "t3x-pet-settings" },
    h(
      ui.Section,
      { title: host.t("每个 agent 用哪只", "Pet for each agent") },
      agentKeys().map((key) => {
        const value = shown(key);
        const label = agentLabel(key);
        return h(ui.Row, {
          key,
          title: label,
          description:
            key === "*"
              ? host.t("未单独指定宠物的 agent 会默认使用这只", "Default pet for agents without a specific assignment")
              : undefined,
          control: h(
            ui.Select,
            { value, onValueChange: (v) => setAgent(key, v) },
            h(
              ui.SelectTrigger,
              { size: "sm", className: "w-full sm:w-52", "aria-label": label },
              h(ui.SelectValue, null, choiceLabel(value)),
            ),
            h(
              ui.SelectPopup,
              { align: "end", alignItemWithTrigger: false },
              key === "*"
                ? null
                : h(ui.SelectItem, { value: "auto" }, host.t("按模型名 / 同其他 agent", "By model name / fallback")),
              list.map((p) => h(ui.SelectItem, { key: p.id, value: p.id }, p.name)),
              h(ui.SelectItem, { value: "none" }, host.t("不显示", "Hide pet")),
            ),
          ),
        });
      }),
    ),
    editing
      ? h(PetForm, {
          key: editing,
          ui,
          initial: editing === "new" ? null : pets.get(editing),
          onDone: () => setEditing(null),
        })
      : null,
    h(
      ui.Section,
      {
        title: host.t("宠物库", "Pet library"),
        headerAction: !editing
          ? h(
              ui.Button,
              { size: "xs", variant: "outline", onClick: () => setEditing("new") },
              host.t("添加桌宠", "Add desk pet"),
            )
          : null,
      },
      h(
        "div",
        { className: "t3x-pet-library-body" },
        h(
          "div",
          { className: "t3x-pet-grid" },
          list.map((p) =>
            h(
              "article",
              {
                key: p.id,
                className: "t3x-pet-card",
                "data-source": p.source,
                "data-editing": editing === p.id ? "true" : undefined,
              },
              h(
                "div",
                { className: "t3x-pet-card-top" },
                h("span", { className: `t3x-pet-source t3x-pet-source-${p.source}` }, sourceLabels[p.source] ?? p.source),
              ),
              h("div", { className: "t3x-pet-stage-preview" }, h(Thumb, { pet: p })),
              h("span", { className: "t3x-pet-name", title: p.name }, p.name),
              p.source === "custom"
                ? h(
                    "div",
                    { className: "t3x-pet-actions" },
                    h(ui.Button, { size: "xs", variant: "ghost", onClick: () => setEditing(p.id) }, host.t("编辑", "Edit")),
                    h(
                      ui.Button,
                      { size: "xs", variant: "ghost", className: "t3x-btn-danger", onClick: () => remove(p) },
                      host.t("删除", "Delete"),
                    ),
                  )
                : null,
            ),
          ),
        ),
      ),
    ),
  );
}
