// 子代理桌宠：主代理派出子代理时，对应宠物跑到主宠物旁打招呼、埋头工作，结束后击掌（或垂头）离开。
// 子宠物落座后有自己的位置，可以单独拖动；主宠物走动时它们留在原地，只转头朝着主宠物。
// ctx: { stage, main, span, create, destroy, place, play, motion, reduced, glance, cheer, badgeBottom }
function createSubPets(ctx) {
  const MAX = 3; // 主宠物两侧最多 3 只（含正在离场的），其余计入 "+N"
  const MAX_REPLAY = 12; // 后台/补播队列上限，避免长时间积压
  const GAP = 50;
  const subs = new Map(); // id -> { id, p, home, status, moving, dragging, bumping, bye, finishOk, leaveTimer, runRaf }
  const exiting = new Set(); // 离场动画中的宠物：仍占名额，reset 时一并清掉
  const extra = new Map(); // 超出上限的运行中代理：id -> { petId, status }
  const replay = []; // 满座期间收工、等前一只离场后顺位补播的队列：[{ id, petId, status, finishOk }]
  const pending = new Map(); // 舞台或主宠物没就绪时先记下：id -> { petId, status, animate, finishOk }
  const farewells = [];
  let current = null; // 正在告别的那只
  let badge = null;

  const rest = (status) => (status === "waiting" ? "waiting" : status === "running" ? "running" : "idle");
  const ready = () => !!(ctx.stage()?.isConnected && ctx.main()?.el.isConnected);
  const toward = (p) => (p.el.dataset.side === "left" ? 1 : -1); // 朝主宠物的方向
  const hasLeaving = () => exiting.size > 0 || [...subs.values()].some((s) => s.bye);
  const stopSub = (s) => {
    cancelAnimationFrame(s.runRaf);
    s.runRaf = 0;
    clearTimeout(s.leaveTimer);
    s.leaveTimer = 0;
  };
  // 新来的坐到主宠物旁边第一个没人的座位；没有空座（输入框太窄或满员）就计入 "+N"。
  const freeSeat = (maxSpan = ctx.span()) =>
    findFreeSeat({
      mainX: ctx.main().x,
      span: maxSpan,
      occupied: [...subs.values()].map((s) => s.home),
      total: subs.size + exiting.size,
      max: MAX,
      gap: GAP,
    });
  const subOf = (p) => [...subs.values()].find((s) => s.p === p);
  const seatAt = (s, x, maxSpan = ctx.span()) => {
    ctx.place(s.p, x, maxSpan);
    const side = s.p.x < ctx.main().x ? "left" : "right";
    const facing = side === "left" ? "right" : "left";
    if (s.p.el.dataset.side !== side) s.p.el.dataset.side = side;
    if (s.p.el.dataset.facing !== facing) s.p.el.dataset.facing = facing;
  };
  // 一次性动作结束：回到静息，并按最新状态播放（动作期间状态可能变了）。
  const settle = (s) => {
    ctx.motion(s.p, "idle");
    if (s.p.state !== s.p.rest) ctx.play(s.p, s.p.rest);
  };
  function enqueueReplay(id, petId, status, finishOk) {
    const i = replay.findIndex((r) => r.id === id);
    if (i >= 0) replay.splice(i, 1);
    replay.push({ id, petId, status, finishOk });
    if (replay.length > MAX_REPLAY) replay.shift();
  }

  function syncBadge() {
    const stage = ctx.stage();
    const m = ctx.main();
    if (!extra.size || !stage || !m) {
      badge?.remove();
      badge = null;
      return;
    }
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "t3x-pet-badge";
      badge.dataset.side = "right";
    }
    if (badge.parentElement !== stage) stage.appendChild(badge);
    const text = `+${extra.size}`;
    if (badge.textContent !== text) {
      badge.textContent = text;
      badge.style.animation = "none";
      void badge.offsetWidth; // 重启 pop 动画
      badge.style.animation = "";
    }
    const left = `${Math.round(m.x + 52)}px`;
    const bottom = `${ctx.badgeBottom(m.petId)}px`;
    if (badge.style.left !== left) badge.style.left = left;
    if (badge.style.bottom !== bottom) badge.style.bottom = bottom; // 矮的宠物在 pet 定义里调低徽标
  }

  function layout(maxSpan) {
    if (!ready()) return;
    const curSpan = maxSpan ?? ctx.span();
    for (const s of subs.values()) if (!s.moving && !s.dragging && !s.bumping) seatAt(s, s.home, curSpan);
    const m = ctx.main();
    // 舞台变宽或主宠落位后腾出座位时，把 +N 和待补播里的补入（主宠拖动/碰头途中不抢位）。
    if ((extra.size || replay.length) && !m.held && !m.bumping) promote(curSpan);
    else syncBadge();
  }

  function greet(s) {
    ctx.motion(s.p, "greet", () => settle(s));
    ctx.play(s.p, "waving", { once: true });
    ctx.glance(-toward(s.p));
  }

  // 告别途中又开始工作：取消告别，原地继续。
  function resume(s, status) {
    const i = farewells.findIndex((f) => f.s === s);
    if (i >= 0) farewells.splice(i, 1);
    clearTimeout(s.leaveTimer);
    s.leaveTimer = 0;
    s.bye = false;
    s.finishOk = undefined;
    s.status = status;
    s.p.rest = rest(status);
    if (!s.moving && !s.dragging && !s.bumping) settle(s);
    if (current === s) {
      current = null;
      pump();
    }
  }

  function arrive(id, petId, status, animate, finishOk, maxSpan) {
    const ri = replay.findIndex((r) => r.id === id);
    if (ri >= 0) replay.splice(ri, 1);
    const old = subs.get(id);
    if (old) return resume(old, status);
    const parked = extra.get(id);
    if (parked && finishOk === undefined) {
      parked.petId = petId;
      parked.status = status;
      return;
    }
    if (!ready()) {
      pending.set(id, { petId, status, animate, finishOk });
      return;
    }
    const curSpan = maxSpan ?? ctx.span();
    const x = freeSeat(curSpan);
    if (x === undefined) {
      if (finishOk !== undefined) {
        if (!document.hidden && !ctx.reduced()) enqueueReplay(id, petId, status, finishOk);
        return;
      }
      extra.set(id, { petId, status });
      syncBadge();
      return;
    }
    const p = ctx.create(petId);
    p.el.dataset.role = "sub";
    p.rest = rest(status);
    const s = { id, p, home: x, status, moving: false, dragging: false, bumping: false, bye: false, finishOk: undefined, leaveTimer: 0, runRaf: 0 };
    subs.set(id, s);
    ctx.stage().appendChild(p.el);
    seatAt(s, x, curSpan);
    if (!animate || ctx.reduced() || document.hidden) {
      if (finishOk !== undefined) {
        s.bye = true;
        if (ctx.reduced() || document.hidden) return leave(s, true);
        queueFarewell(s, finishOk);
        return;
      }
      ctx.motion(p, "sub-seat", () => settle(s));
      ctx.play(p, p.rest);
      return;
    }
    if (finishOk !== undefined) {
      s.bye = true;
      s.finishOk = finishOk;
    }
    // 从远离主宠物的那一侧边缘跑进来。
    const from = p.el.dataset.side === "left" ? 0 : curSpan;
    ctx.place(p, from, curSpan);
    s.moving = true;
    ctx.motion(p, "sub-run");
    ctx.play(p, from < x ? "running-right" : "running-left");
    const t0 = performance.now();
    const dur = Math.min(800, 300 + Math.abs(x - from) * 1.2);
    const step = (now) => {
      s.runRaf = 0;
      if (subs.get(id) !== s) return;
      const k = Math.min(1, (now - t0) / dur);
      ctx.place(p, from + (s.home - from) * (1 - (1 - k) ** 3), curSpan);
      if (k < 1) return void (s.runRaf = requestAnimationFrame(step));
      s.moving = false;
      seatAt(s, s.home);
      // 跑来途中就已经结束的短任务：到座后直接告别。
      if (s.finishOk !== undefined) return queueFarewell(s, s.finishOk);
      greet(s);
    };
    s.runRaf = requestAnimationFrame(step);
  }

  function promote(maxSpan) {
    if (!ready()) return void syncBadge();
    const curSpan = maxSpan ?? ctx.span();
    while (freeSeat(curSpan) !== undefined) {
      const first = extra.entries().next();
      if (!first.done) {
        const [id, e] = first.value;
        extra.delete(id);
        arrive(id, e.petId, e.status, true, undefined, curSpan);
        continue;
      }
      const next = replay.shift();
      if (!next) break;
      arrive(next.id, next.petId, next.status, true, next.finishOk, curSpan);
    }
    syncBadge();
  }

  function leave(s, blink) {
    if (subs.get(s.id) !== s) return;
    const { p } = s;
    // 先标记离场并终止拖动与碰头，避免松手或互动收尾撤销离场销毁回调。
    p.exiting = true;
    p.cancelDrag?.();
    p.cancelBump?.(p);
    stopSub(s);
    subs.delete(s.id);
    exiting.add(p);
    const gone = () => {
      exiting.delete(p);
      ctx.destroy(p);
      promote(); // 离场动画结束才放出名额
    };
    const dir = toward(p);
    if (blink || ctx.reduced() || Math.random() < 0.4) {
      ctx.motion(p, "exit-blink", gone);
    } else {
      p.el.style.setProperty("--t3x-run-dx", `${-dir * 120}px`);
      p.el.dataset.facing = dir > 0 ? "left" : "right";
      ctx.play(p, dir > 0 ? "running-left" : "running-right");
      ctx.motion(p, "exit-run", gone);
    }
  }

  function queueFarewell(s, ok) {
    farewells.push({ s, ok });
    pump();
  }

  // 好几只同时收工时排队：上一只真正开始离场，下一只才告别。
  function pump() {
    if (current) return;
    const f = farewells.shift();
    if (!f) return;
    const { s, ok } = f;
    current = s;
    const next = () => {
      if (current !== s) return;
      current = null;
      leave(s);
      pump();
    };
    if (ok && Math.abs(s.p.x - (ctx.main()?.x ?? s.p.x)) > GAP * 1.5) {
      // 远座够不着主宠物，挥手告别代替击掌。
      ctx.motion(s.p, "greet", next);
      ctx.play(s.p, "waving", { once: true });
      ctx.glance(-toward(s.p));
    } else if (ok) {
      ctx.motion(s.p, "highfive", next);
      ctx.play(s.p, "jumping", { once: true });
      ctx.glance(-toward(s.p));
      ctx.cheer();
    } else {
      s.p.rest = "failed";
      // 垂头保持一小会儿再走，让失败看得出来。
      ctx.motion(s.p, "sub-droop", () => {
        s.leaveTimer = setTimeout(next, 280);
      });
      ctx.play(s.p, "failed");
    }
  }

  function finish(id, ok, quiet) {
    const pend = pending.get(id);
    if (pend) {
      // 主宠物还没入场时就收到了 seat+finish（如换主宠切回会话），留到 flush 后补播告别，静默离开则直接清掉。
      if (quiet || document.hidden || ctx.reduced()) pending.delete(id);
      else pend.finishOk = ok;
      return;
    }
    const ext = extra.get(id);
    if (ext) {
      extra.delete(id);
      if (!quiet && !document.hidden && !ctx.reduced()) enqueueReplay(id, ext.petId, ext.status, ok);
      syncBadge();
      return;
    }
    const s = subs.get(id);
    if (!s || s.bye) return;
    s.bye = true;
    if (quiet || document.hidden || ctx.reduced()) return leave(s, true);
    // 跑来途中、正被拖着或正在互动：结束后再告别，不打断当前动作。
    if (s.moving || s.dragging || s.bumping) {
      s.finishOk = ok;
      return;
    }
    queueFarewell(s, ok);
  }

  function setStatus(id, status) {
    const parked = pending.get(id) ?? extra.get(id);
    if (parked) parked.status = status;
    const s = subs.get(id);
    if (!s || s.bye) return;
    s.status = status;
    s.p.rest = rest(status);
    if (!s.moving && !s.bumping && s.p.el.dataset.motion === "idle") ctx.play(s.p, s.p.rest);
  }

  function trimReplay() {
    if (!replay.length) return;
    if (ready()) promote();
    // 场上没有即将让座的宠物时，不在以后突兀补播很久前溢出收工的代理。
    if (replay.length && !hasLeaving()) replay.length = 0;
  }

  function reset() {
    for (const s of subs.values()) {
      stopSub(s);
      ctx.destroy(s.p);
    }
    for (const p of exiting) ctx.destroy(p);
    subs.clear();
    exiting.clear();
    extra.clear();
    replay.length = 0;
    pending.clear();
    farewells.length = 0;
    current = null;
    syncBadge();
  }

  return {
    apply(events, fresh) {
      if (fresh) reset();
      for (const ev of events) {
        if (ev.type === "seat") arrive(ev.id, ev.petId, ev.status, false);
        else if (ev.type === "arrive") arrive(ev.id, ev.petId, ev.status, true);
        else if (ev.type === "status") setStatus(ev.id, ev.status);
        else if (ev.type === "finish") finish(ev.id, ev.ok, ev.quiet);
      }
      trimReplay();
    },
    // 主宠物就绪（或换了 host）后，把之前记下的子代理按原本的入场方式安排上。
    flush() {
      if (!ready()) return;
      const curSpan = ctx.span();
      const waiting = [...pending];
      pending.clear();
      for (const [id, e] of waiting) arrive(id, e.petId, e.status, e.animate, e.finishOk, curSpan);
      layout(curSpan);
      trimReplay();
    },
    layout,
    promote,
    reset,
    // 拖动子宠物：落座后、告别前、不在互动中才能拖（返回 false 表示不接这次拖动）。
    grab(p) {
      const s = subOf(p);
      if (!s || s.moving || s.bye || s.bumping || s.dragging) return false;
      s.dragging = true;
      return true;
    },
    // 松手或取消拖动：返回 true 表示这只已收工并进入告别，不再触发互动；skipSeat=true 时把落座留给碰头判定。
    drop(p, { skipSeat = false, curSpan } = {}) {
      const s = subOf(p);
      if (!s?.dragging) return false;
      s.dragging = false;
      if (p.exiting || !p.el.isConnected) return false;
      const spanNow = curSpan ?? ctx.span();
      if (s.bye && s.finishOk !== undefined) {
        s.home = p.x;
        if (ready()) seatAt(s, p.x, spanNow);
        queueFarewell(s, s.finishOk);
        return true;
      }
      if (!skipSeat) {
        s.home = p.x;
        if (ready()) {
          seatAt(s, p.x, spanNow);
          promote(spanNow);
        }
      }
      return false;
    },
    // 未触发碰头时回写子宠物新座位，并顺手检查是否腾出空座。
    seat(p, curSpan) {
      const s = subOf(p);
      if (!s || p.exiting) return;
      s.home = p.x;
      if (!ready()) return;
      const spanNow = curSpan ?? ctx.span();
      seatAt(s, p.x, spanNow);
      promote(spanNow);
    },
    // 拖动松手后查询可以互动的静息子宠物：排除进场、告别、拖动或已有动作中的宠物。
    bumpCandidates(exclude) {
      return [...subs.values()]
        .filter((s) => s.p !== exclude && s.p.el.isConnected && !s.p.exiting && !s.p.held && !s.moving && !s.dragging && !s.bumping && !s.bye && s.p.el.dataset.motion === "idle")
        .map((s) => s.p);
    },
    // 场上除参与互动两只之外的其他子宠物横坐标，用于分开时尽量避让。
    otherXs(excludeA, excludeB) {
      return [...subs.values()].filter((s) => s.p !== excludeA && s.p !== excludeB && s.p.el.isConnected).map((s) => s.p.x);
    },
    // 切换子宠物的互动标记；结束时回写新座位，若互动期间收工则顺势补上告别（返回 true）。
    setBumping(p, on, curSpan) {
      const s = subOf(p);
      if (!s) return false;
      s.bumping = on;
      if (on) {
        s.dragging = false;
        return false;
      }
      if (p.exiting || !p.el.isConnected) return false;
      const spanNow = curSpan ?? ctx.span();
      s.home = p.x;
      if (ready()) {
        seatAt(s, p.x, spanNow);
        promote(spanNow);
      }
      if (s.bye && s.finishOk !== undefined) {
        queueFarewell(s, s.finishOk);
        return true;
      }
      return false;
    },
    count: () => subs.size + exiting.size + extra.size + replay.length,
    pets: () => [...[...subs.values()].map((s) => s.p), ...exiting],
  };
}
