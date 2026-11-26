// 让 agent 生成桌宠：写描述、传参考图，选 harness / 模型 / 会话；agent 把精灵图写进扩展的输出目录，
// 这里轮询读回来，进调整页（PetForm + 动作预览）再导入宠物库。进度存在 storage 的 "gen" 里，关掉设置页再打开会接着等。
// 每轮（首次生成、每次修改）写进自己的文件夹 <任务>/r<轮次>/，出现 result.json 就是这一轮做完了；上一版留着，修改失败还能回去。
const GEN_POLL_MS = 4000;
const REF_MAX = 4;
const REF_MAX_BYTES = 10 * 1024 * 1024;
const GEN_ROW_LABELS = [
  ["待机", "Idle"],
  ["向右跑", "Run right"],
  ["向左跑", "Run left"],
  ["挥手", "Wave"],
  ["跳", "Jump"],
  ["失败", "Failed"],
  ["等待", "Waiting"],
  ["干活", "Working"],
  ["审阅", "Review"],
  ["看向 0–157°", "Look 0–157°"],
  ["看向 180–337°", "Look 180–337°"],
];

// 这个页面里有没有生成或修改请求正在发。表单的 busy 关掉重开就没了，靠它挡住第二条：两条一起发时后回来的会盖掉先回来的任务，或者两轮写进同一个文件夹
let sending = false;
const stillSending = () => host.t("上一个请求还在发送，稍等再试", "The previous request is still being sent; try again in a moment");

const roundRel = (job, round = job.round) => `${job.jobId}/r${round}`;
const roundDir = (job, round = job.round) => `${job.base}/${roundRel(job, round)}`;

const readDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(host.t("图片读不出来", "Couldn’t read the image")));
    img.src = url;
  });

/** agent 写的图：检查 8x11、192:208 的比例，缩到 1152x1716（内置宠物的尺寸）转成 WebP，不超过手动上传的 2 MB；像素画用最近邻。 */
async function importSheet(bytes, file, pixel) {
  const type = /\.webp$/i.test(file) ? "image/webp" : /\.gif$/i.test(file) ? "image/gif" : "image/png";
  const img = await loadImage(await readDataUrl(new Blob([bytes], { type })));
  const w = img.naturalWidth;
  const hgt = img.naturalHeight;
  if (w > 4096 || hgt > 4096 || w % 8 || hgt % 11 || Math.abs(w / 8 / (hgt / 11) - 192 / 208) > 0.01) {
    throw new Error(host.t(`生成的图是 ${w}x${hgt}，不是 8 列 x 11 行、每格 192x208 的比例`, `The generated image is ${w}×${hgt}, not 8×11 cells of 192:208`));
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1152;
  canvas.height = 1716;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = !pixel;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of pixel ? [1, 0.92, 0.85] : [0.9, 0.8, 0.7]) {
    const url = canvas.toDataURL("image/webp", quality);
    if (!url.startsWith("data:image/webp")) throw new Error(host.t("这里没法把图片转成 WebP", "Can’t encode WebP here"));
    if (((url.length - url.indexOf(",") - 1) * 3) / 4 <= SHEET_MAX_BYTES) return url;
  }
  throw new Error(host.t("生成的图压缩后仍超过 2 MB，让 agent 减少细节或颜色再试", "The generated image is still over 2 MB after compression; ask the agent for less detail or fewer colors"));
}

/** 按行播放精灵图，调整页用来看每个动作；系统要求减少动态效果时不自动播，一帧一帧点。 */
function SheetPlayer({ sheet, smooth, scale = 1 }) {
  host.useLang();
  const [row, setRow] = React.useState(0);
  const [frame, setFrame] = React.useState(0);
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  React.useEffect(() => {
    setFrame(0);
    if (still) return undefined;
    const timer = setInterval(() => setFrame((f) => (f + 1) % GEN_FRAMES[row]), 150);
    return () => clearInterval(timer);
  }, [row, still]);
  const size = Math.round(96 * Math.min(2, Math.max(0.5, Number(scale) || 1)));
  return h(
    "div",
    { className: "t3x-gen-player" },
    h("span", {
      className: "t3x-gen-stage",
      "data-smooth": smooth ? "" : undefined,
      role: "img",
      "aria-label": host.t(...GEN_ROW_LABELS[row]),
      style: {
        width: `${size}px`,
        height: `${Math.round((size * 208) / 192)}px`,
        backgroundImage: `url(${sheet})`,
        backgroundPosition: `${(frame / 7) * 100}% ${(row / 10) * 100}%`,
      },
    }),
    h(
      "div",
      { className: "t3x-gen-rows", role: "group", "aria-label": host.t("动作", "Animation") },
      GEN_ROW_LABELS.map((label, i) =>
        h("button", { key: i, type: "button", className: "t3x-gen-chip", "aria-pressed": row === i, onClick: () => setRow(i) }, host.t(...label)),
      ),
      still
        ? h("button", { type: "button", className: "t3x-gen-chip", onClick: () => setFrame((f) => (f + 1) % GEN_FRAMES[row]) }, host.t(`下一帧（${frame + 1}/${GEN_FRAMES[row]}）`, `Next frame (${frame + 1}/${GEN_FRAMES[row]})`))
        : null,
    ),
  );
}

function GenForm({ ui, onClose }) {
  host.useLang();
  const providers = host.agent.providers().filter((p) => p.enabled && p.models.length > 0);
  const threads = host.agent.useThreads().filter((t) => !t.archived);
  const projects = host.agent.useProjects();
  const send = host.agent.useSend();
  const scratch = projects.find((p) => p.scratch);
  const here = projects.find((p) => p.projectId === host.chat.last()?.projectId);
  const [name, setName] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [refs, setRefs] = React.useState([]);
  const [reading, setReading] = React.useState(false);
  const [style, setStyle] = React.useState("pixel");
  const [target, setTarget] = React.useState("");
  const [instanceId, setInstanceId] = React.useState("");
  const [model, setModel] = React.useState("");
  const [mode, setMode] = React.useState("");
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef(null);
  const alive = React.useRef(true); // 取消（表单卸载）后，还没发出去的就不发了
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 没选的时候用默认（无项目 > 当前项目 > 第一个）；选过的会话或项目不在了就提示重选，不悄悄换成别的
  const defTarget = `new:${(scratch ?? here ?? projects[0])?.projectId ?? ""}`;
  const effTarget = target || defTarget;
  const thread = effTarget.startsWith("thread:") ? threads.find((t) => t.threadId === effTarget.slice(7)) : null;
  const targetOk = thread != null || projects.some((p) => `new:${p.projectId}` === effTarget);
  const targets = [
    ...projects.map((p) => [`new:${p.projectId}`, p.scratch ? host.t("新会话 · 无项目", "New thread · No project") : host.t(`新会话 · ${p.title}`, `New thread · ${p.title}`)]),
    ...threads.slice(0, 40).map((t) => [`thread:${t.threadId}`, host.t(`已有会话 · ${t.title}`, `Existing · ${t.title}`)]),
  ];
  if (thread && !targets.some(([v]) => v === effTarget)) targets.push([effTarget, host.t(`已有会话 · ${thread.title}`, `Existing · ${thread.title}`)]);
  // 选了已有会话：harness、运行模式跟着那个会话走，模型默认用它当前的
  const provider = effTarget.startsWith("thread:")
    ? providers.find((p) => p.instanceId === thread?.instanceId)
    : (providers.find((p) => p.instanceId === instanceId) ?? providers.find((p) => p.driver === "codex") ?? providers[0]);
  const models = provider?.models ?? [];
  const pick = (want) => models.find((m) => m.id === want)?.id;
  const effModel = pick(model) ?? pick(thread?.model) ?? models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? "";
  const modes = provider?.runtimeModes ?? [];
  const effMode = modes.includes(mode) ? mode : modes.includes("auto") ? "auto" : (modes[0] ?? "");
  const MODE_LABELS = {
    "approval-required": host.t("每步都要批准", "Approve every step"),
    "auto-accept-edits": host.t("自动接受改文件", "Auto-accept edits"),
    auto: host.t("自动（沙箱内）", "Auto (sandboxed)"),
    "full-access": host.t("完全访问", "Full access"),
  };

  const onPick = async (e) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (reading || files.length === 0) return;
    setError(null);
    setReading(true); // 读完之前不能再加图，也不能生成
    try {
      if (refs.length + files.length > REF_MAX) throw new Error(host.t(`参考图最多 ${REF_MAX} 张`, `Up to ${REF_MAX} reference images`));
      const added = [];
      for (const f of files) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) throw new Error(host.t("参考图需要是 PNG / JPEG / WebP / GIF", "Reference images must be PNG, JPEG, WebP or GIF"));
        if (f.size > REF_MAX_BYTES) throw new Error(host.t("每张参考图不能超过 10 MB", "Each reference image must be 10 MB or smaller"));
        added.push({ name: f.name, dataUrl: await readDataUrl(f) });
      }
      setRefs((r) => [...r, ...added]);
    } catch (err) {
      setError(err.message);
    }
    setReading(false);
  };

  const start = async () => {
    if (busy || reading) return;
    setError(null);
    let mine = false;
    try {
      if (!name.trim()) throw new Error(host.t("请填写宠物名称", "Enter a name for the pet"));
      if (!desc.trim() && refs.length === 0) throw new Error(host.t("写一段描述或上传参考图", "Describe the pet or add a reference image"));
      if (!targetOk) throw new Error(host.t("选的会话或项目不在了，重新选一个", "The chosen thread or project is gone; choose again"));
      if (!provider || !effModel) throw new Error(host.t("选一个 harness 和模型", "Choose a harness and model"));
      if (sending) throw new Error(stillSending());
      sending = mine = true;
      setBusy(true);
      const job = { jobId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, base: await host.outputs.dir(), round: 0 };
      if (!alive.current) return;
      const res = await send({
        target: thread ? { threadId: thread.threadId } : { newThread: { projectId: effTarget.slice(4), title: host.t(`生成桌宠：${name.trim()}`, `Desk pet: ${name.trim()}`) } },
        instanceId: provider.instanceId,
        model: effModel,
        runtimeMode: effMode,
        text: genPrompt({ name: name.trim(), description: desc, style, imageCount: refs.length, dir: roundDir(job) }),
        images: refs,
      });
      // 消息已经发出：不管表单还在不在都记下任务，否则 agent 做完了没人接
      await host.storage.set("gen", { ...job, ...res, name: name.trim(), style, state: "running", sentAt: Date.now() });
    } catch (err) {
      if (!alive.current) return;
      setError(err.message);
      setBusy(false);
    } finally {
      if (mine) sending = false;
    }
  };

  const select = (label, value, onChange, items, disabled = false) =>
    h(
      ui.Select,
      { value, onValueChange: (v) => v && onChange(v), disabled },
      h(ui.SelectTrigger, { size: "sm", className: "w-full sm:w-56", "aria-label": label }, h(ui.SelectValue, null, items.find(([v]) => v === value)?.[1] ?? "—")),
      h(ui.SelectPopup, { align: "end", alignItemWithTrigger: false }, items.map(([v, text]) => h(ui.SelectItem, { key: v, value: v }, text))),
    );

  return h(
    ui.Section,
    { title: host.t("用 agent 生成桌宠", "Generate a desk pet with an agent"), className: "t3x-pet-form-section" },
    h(ui.Row, {
      title: host.t("名称", "Name"),
      control: h(ui.Input, { size: "sm", className: "w-full sm:w-56", maxLength: 40, value: name, placeholder: host.t("例如：小鲸鱼", "e.g. Little Whale"), "aria-label": host.t("名称", "Name"), onChange: (e) => setName(e.target.value) }),
    }),
    h(
      "div",
      { className: "t3x-gen-block" },
      h("label", { className: "t3x-gen-label", htmlFor: "t3x-gen-desc" }, host.t("描述", "Description")),
      h("textarea", {
        id: "t3x-gen-desc",
        className: "t3x-gen-textarea",
        rows: 4,
        maxLength: 4000,
        value: desc,
        placeholder: host.t("长什么样、什么性格、有什么标志性的东西，例如：蓝色长发的鲸鱼娘女仆，有鲸鳍耳朵和尾巴", "Looks, personality, signature details, e.g. a whale-girl maid with long blue hair, fin ears and a tail"),
        onChange: (e) => setDesc(e.target.value),
      }),
    ),
    h(ui.Row, {
      title: host.t("参考图", "Reference images"),
      description: host.t(`可选，最多 ${REF_MAX} 张，会作为附件发给 agent`, `Optional, up to ${REF_MAX}; sent to the agent as attachments`),
      control: h(
        "div",
        { className: "t3x-gen-refs" },
        h("input", { ref: fileRef, type: "file", hidden: true, multiple: true, accept: "image/png,image/jpeg,image/webp,image/gif", onChange: onPick }),
        refs.map((r, i) =>
          h("button", { key: i, type: "button", className: "t3x-gen-ref", title: host.t(`移除 ${r.name}`, `Remove ${r.name}`), "aria-label": host.t(`移除 ${r.name}`, `Remove ${r.name}`), onClick: () => setRefs((all) => all.filter((_, j) => j !== i)) }, h("img", { src: r.dataUrl, alt: "" })),
        ),
        refs.length < REF_MAX
          ? h(ui.Button, { type: "button", size: "xs", variant: "outline", disabled: reading, onClick: () => fileRef.current?.click() }, reading ? host.t("读取中…", "Reading…") : host.t("添加图片…", "Add images…"))
          : null,
      ),
    }),
    h(ui.Row, {
      title: host.t("画风", "Style"),
      control: select(host.t("画风", "Style"), style, setStyle, [
        ["pixel", host.t("像素画", "Pixel art")],
        ["smooth", host.t("平滑插画", "Smooth illustration")],
      ]),
    }),
    h(ui.Row, {
      title: host.t("会话", "Thread"),
      description: host.t("新开一个会话，或者发到已有会话里（用那个会话自己的 harness）", "Start a new thread, or send to an existing one (it keeps its own harness)"),
      control: select(host.t("会话", "Thread"), effTarget, setTarget, targets),
    }),
    h(ui.Row, {
      title: "Harness",
      control: select("Harness", provider?.instanceId ?? "", setInstanceId, providers.map((p) => [p.instanceId, p.name]), effTarget.startsWith("thread:")),
    }),
    h(ui.Row, {
      title: host.t("模型", "Model"),
      description: host.t("能生成图片的模型效果最好；不能出图的会用代码画像素画", "Models that can generate images work best; others draw pixel art with code"),
      control: select(host.t("模型", "Model"), effModel, setModel, models.map((m) => [m.id, m.name])),
    }),
    effTarget.startsWith("thread:")
      ? null
      : h(ui.Row, {
          title: host.t("运行模式", "Runtime mode"),
          description: host.t("agent 要往 T3 数据目录里写结果，沙箱模式下可能要你在会话里批准", "The agent writes into the T3 data folder; sandboxed modes may ask you to approve it in the thread"),
          control: select(host.t("运行模式", "Runtime mode"), effMode, setMode, modes.map((m) => [m, MODE_LABELS[m] ?? m])),
        }),
    h(
      "div",
      { className: "t3x-pet-form-foot" },
      h(
        "div",
        { className: "t3x-pet-form-error" },
        error
          ? h("p", { className: "t3x-error", role: "alert" }, error)
          : providers.length === 0
            ? h("p", { className: "t3x-gen-note" }, host.t("先打开一个会话，这里才知道有哪些 harness 可用", "Open a thread first so the available harnesses are known"))
            : null,
      ),
      h(
        "div",
        { className: "t3x-pet-form-actions" },
        h(ui.Button, { type: "button", size: "xs", variant: "ghost", onClick: onClose }, host.t("取消", "Cancel")),
        h(ui.Button, { type: "button", size: "xs", variant: "default", disabled: busy || reading || providers.length === 0, onClick: start }, busy ? host.t("发送中…", "Sending…") : host.t("生成", "Generate")),
      ),
    ),
  );
}

/** 等这一轮的 result.json 出现：读图、转格式，进入调整页。 */
function useGenPoll(job) {
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    setError(null);
    if (job?.state !== "running") return undefined;
    let stop = false;
    let timer = null;
    const tick = async () => {
      try {
        const res = await host.outputs.read(`${roundRel(job)}/result.json`);
        if (res) {
          const meta = parseGenResult(new TextDecoder().decode(res.bytes), host.t);
          const img = await host.outputs.read(`${roundRel(job)}/${meta.sheet}`);
          if (!img) throw new Error(host.t(`result.json 指向的 ${meta.sheet} 不存在`, `${meta.sheet} named in result.json doesn’t exist`));
          const sheet = await importSheet(img.bytes, meta.sheet, job.style === "pixel");
          const now = host.storage.get("gen", null);
          // 写失败也不要紧：重开时还在 running，会从文件再读一次
          if (!stop && now?.jobId === job.jobId && now.round === job.round && now.state === "running") {
            await host.storage.set("gen", { ...now, state: "review", sheet, sheetRound: job.round, notes: meta.notes });
          }
          return;
        }
        if (!stop) setError(null);
      } catch (err) {
        if (!stop) setError(err.message); // agent 可能还在写或会按会话里的反馈重写，继续等
      }
      if (!stop) timer = setTimeout(tick, GEN_POLL_MS);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [job?.jobId, job?.round, job?.state]);
  return error;
}

function GenPanel({ ui, onClose }) {
  host.useLang();
  const job = host.storage.use("gen", null);
  const threads = host.agent.useThreads();
  const send = host.agent.useSend();
  const pollError = useGenPoll(job);
  const [feedback, setFeedback] = React.useState("");
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  if (!job) return h(GenForm, { ui, onClose });
  // 会话 ID 只在一个环境里唯一：换到别的环境后不能把修改发给那边的同名会话
  const thread = threads.find((t) => t.threadId === job.threadId && t.environmentId === job.environmentId);
  const openThread = () => host.agent.open({ environmentId: job.environmentId, threadId: job.threadId });
  // 异步回来以后只改还是同一个任务、同一轮的状态，免得把放弃了的或新开的任务写坏
  const same = (now) => now?.jobId === job.jobId && now.round === job.round && now.state === job.state;
  const discard = async () => {
    setError(null);
    try {
      if (!(await host.confirm(host.t(`放弃生成“${job.name}”？`, `Discard “${job.name}”?`), { variant: "destructive" }))) return;
      if (host.storage.get("gen", null)?.jobId !== job.jobId) return;
      await host.storage.set("gen", null);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };
  const discardButton = h(ui.Button, { type: "button", size: "xs", variant: "ghost", className: "t3x-btn-danger", disabled: busy, onClick: discard }, host.t("放弃", "Discard"));
  const errorLine = error ? h("p", { className: "t3x-error", role: "alert" }, error) : null;

  if (job.state === "review") {
    const revise = async () => {
      if (busy || !feedback.trim()) return;
      setError(null);
      if (sending) return setError(stillSending());
      sending = true;
      setBusy(true);
      try {
        if (!thread) throw new Error(host.t("找不到生成用的会话", "The generation thread is gone"));
        const round = job.round + 1;
        await send({ target: { threadId: thread.threadId }, model: thread.model, text: genRevisePrompt({ feedback, prev: roundDir(job, job.sheetRound), dir: roundDir(job, round) }) });
        const now = host.storage.get("gen", null);
        if (same(now)) await host.storage.set("gen", { ...now, round, state: "running", notes: "", sentAt: Date.now() }); // 上一版的图留着
        setFeedback("");
      } catch (err) {
        setError(err.message);
      } finally {
        sending = false;
      }
      setBusy(false);
    };
    return h(PetForm, {
      key: `${job.jobId}:${job.round}`, // 新一轮的图：重新建表单
      ui,
      draft: { name: job.name, sheet: job.sheet, smooth: job.style !== "pixel", pixelFx: job.style === "pixel" },
      title: host.t(`调整并导入：${job.name}`, `Adjust and import: ${job.name}`),
      onDone: onClose,
      onSaved: async () => {
        if (host.storage.get("gen", null)?.jobId === job.jobId) await host.storage.set("gen", null);
        onClose();
      },
      extra: h(
        "div",
        { className: "t3x-gen-block" },
        job.notes ? h("p", { className: "t3x-gen-note" }, job.notes) : null,
        h("label", { className: "t3x-gen-label", htmlFor: "t3x-gen-feedback" }, host.t("不满意？让 agent 改", "Not quite right? Ask the agent to revise")),
        h("textarea", {
          id: "t3x-gen-feedback",
          className: "t3x-gen-textarea",
          rows: 2,
          maxLength: 2000,
          value: feedback,
          placeholder: host.t("例如：跑步那两行的尾巴不见了；整体再小一点", "e.g. the tail is missing in the running rows; make her a bit smaller"),
          onChange: (e) => setFeedback(e.target.value),
        }),
        h(
          "div",
          { className: "t3x-gen-actions" },
          errorLine,
          discardButton,
          h(ui.Button, { type: "button", size: "xs", variant: "outline", disabled: busy || !feedback.trim(), onClick: revise }, busy ? host.t("发送中…", "Sending…") : host.t("发给 agent 修改", "Send to the agent")),
        ),
      ),
    });
  }

  // 只看这次发出之后结束的那轮，已有会话之前的报错不算
  const stopped = thread && !thread.running && new Date(thread.lastRunCompletedAt ?? NaN).getTime() > job.sentAt;
  const status = thread?.running
    ? host.t("agent 正在生成，通常要十几分钟；它要写 T3 数据目录时可能会在会话里等你批准。可以关掉设置，回来会接着等。", "The agent is working; this usually takes 10–20 minutes. It may wait in the thread for you to approve writing to the T3 data folder. You can close Settings and come back.")
    : stopped && thread.lastError
      ? host.t(`会话出错：${thread.lastError}`, `The thread failed: ${thread.lastError}`)
      : stopped
        ? host.t("agent 停下了，但还没写出结果。去会话里看看它是不是在等你批准或回答。会话如果跑在远程环境，文件写在那台机器上，这里读不到。", "The agent stopped without a result yet. Check the thread: it may be waiting for your approval or answer. If the thread runs in a remote environment, the files are on that machine and can’t be read here.")
        : host.t("等待会话开始…", "Waiting for the thread to start…");
  const backToPrevious = async () => {
    setError(null);
    try {
      const now = host.storage.get("gen", null);
      if (same(now)) await host.storage.set("gen", { ...now, state: "review", notes: "" });
    } catch (err) {
      setError(err.message);
    }
  };
  return h(
    ui.Section,
    { title: host.t(`正在生成：${job.name}`, `Generating: ${job.name}`), className: "t3x-pet-form-section" },
    h("div", { className: "t3x-gen-block" }, h("p", { className: "t3x-gen-status", role: "status" }, status), pollError ? h("p", { className: "t3x-error", role: "alert" }, pollError) : null),
    h(
      "div",
      { className: "t3x-pet-form-foot" },
      h("div", { className: "t3x-pet-form-error" }, errorLine),
      h(
        "div",
        { className: "t3x-pet-form-actions" },
        discardButton,
        job.sheet ? h(ui.Button, { type: "button", size: "xs", variant: "ghost", onClick: backToPrevious }, host.t("用上一版", "Use previous version")) : null,
        h(ui.Button, { type: "button", size: "xs", variant: "ghost", onClick: onClose }, host.t("收起", "Hide")),
        h(ui.Button, { type: "button", size: "xs", variant: "outline", onClick: openThread }, host.t("打开会话", "Open thread")),
      ),
    ),
  );
}
