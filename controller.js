// 桌宠控制器：只操作 DOM，不依赖 React。宠物挂在主输入框上沿（side chat 里的输入框不挂）。
// catalog.get(id) 给出宠物定义（sheet、badgeBottom 等），position 读写宠物在输入框上沿的位置比例。
function createPetController({ catalog, position }) {
  // 精灵图 8 列 x 11 行：行号 + 每帧时长（毫秒）。第 9、10 行是 16 个方向的看向帧。
  const ROWS = {
    idle: [0, [280, 110, 110, 140, 140, 320]],
    "running-right": [1, [120, 120, 120, 120, 120, 120, 120, 220]],
    "running-left": [2, [120, 120, 120, 120, 120, 120, 120, 220]],
    waving: [3, [140, 140, 140, 280]],
    jumping: [4, [140, 140, 140, 140, 280]],
    failed: [5, [140, 140, 140, 140, 140, 140, 140, 240]],
    waiting: [6, [150, 150, 150, 150, 150, 260]],
    running: [7, [120, 120, 120, 120, 120, 220]],
    review: [8, [150, 150, 150, 150, 150, 280]],
  };
  const LOOPING = new Set(["idle", "running", "waiting", "running-left", "running-right"]);
  const HIDE_KEY = "t3x-pets-hidden"; // 右键让宠物先离开：本次启动内有效
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  let stage = null;
  let pet = null; // { el, sprite, petId }
  const exitingMains = new Set(); // 退场中的旧主宠：纳入 detach/dispose 统一清理
  let wanted = { petId: null, mood: "idle" };
  let hidden = false;
  let detachTimer = 0;
  let switchTimer = 0;
  let stageRaf = 0;
  let wanderTimer = 0;
  let wanderRaf = 0;
  let gen = 0; // detach 或新一轮 update 后，旧的找 host 重试作废
  let lookTimer = 0;
  let looking = false;
  // 窗口不在前台（切到别的应用、最小化）时，子代理进出场和后台完成的庆祝先攒着，回来再按顺序播。
  let missed = [];
  let missedCheer = false;
  const away = () => document.hidden || !document.hasFocus();

  const ratio = () => {
    const v = Number(position.get());
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.9;
  };
  const findHost = () => [...document.querySelectorAll('[data-slot="composer-host"]')].find((h) => !h.closest("[data-side-chat-pane]")) || null;
  const span = () => {
    const w = stage ? stage.clientWidth : 0;
    const petW = pet?.el.offsetWidth || 64; // 还没入场的宠物宽度是 0
    return Math.max(0, w - petW);
  };
  // maxSpan 由调用方复用以避免同一次布局里反复读取 offsetWidth / clientWidth。
  const place = (p, x, maxSpan = span()) => {
    const nx = Math.max(0, Math.min(maxSpan, x));
    const left = `${Math.round(nx)}px`;
    p.x = nx;
    if (p.el.style.left !== left) p.el.style.left = left;
    if (p === pet) subPets.layout(maxSpan);
  };

  function play(p, state, { once = false } = {}) {
    clearTimeout(p.frameTimer);
    p.resume = null;
    p.state = state;
    if (state === "running-left" || state === "running-right") p.el.dataset.facing = state.slice(8);
    const [row, durations] = ROWS[state];
    const frames = durations.length;
    const slow = state === "idle" ? 6 : 1;
    const cycles = once ? 1 : LOOPING.has(state) ? Infinity : 3;
    let i = 0;
    let done = 0;
    const show = () => {
      p.sprite.style.backgroundPosition = `${(i / 7) * 100}% ${(row / 10) * 100}%`;
    };
    show();
    if (reduced()) {
      // 减少动态效果时只显示静帧；一次性动作不停留，直接落到当前状态。
      const after = p.rest ?? wanted.mood;
      if ((once || !LOOPING.has(state)) && state !== after) play(p, after);
      return;
    }
    const tick = () => {
      p.frameTimer = setTimeout(() => {
        p.frameTimer = 0;
        if (reduced() || !p.el.isConnected) return;
        if (document.hidden) {
          p.resume = tick; // 窗口重新可见时由 visibilitychange 接着播
          return;
        }
        i += 1;
        if (i >= frames) {
          i = 0;
          done += 1;
          if (done >= cycles) return play(p, p.rest ?? wanted.mood);
        }
        show();
        tick();
      }, durations[i] * slow);
    };
    tick();
  }

  // 每只宠物同一时刻只有一个动作在等收尾；换动作时作废上一个的监听和兜底计时器。
  function motion(p, name, done) {
    p.cancelMotion?.();
    p.cancelMotion = null;
    p.el.dataset.motion = name;
    if (!done) return;
    const onEnd = (ev) => {
      const n = String(ev.animationName);
      if (ev.target === p.body && (n === `t3x-pet-${name}` || n.startsWith("t3x-pet-reduced-"))) finish();
    };
    const fallback = setTimeout(() => finish(), 1000);
    const cancel = () => {
      p.body.removeEventListener("animationend", onEnd);
      clearTimeout(fallback);
    };
    function finish() {
      if (p.cancelMotion !== cancel) return;
      p.cancelMotion = null;
      cancel();
      done();
    }
    p.body.addEventListener("animationend", onEnd);
    p.cancelMotion = cancel;
  }

  // 一次性位移动作结束：回到待机姿态，消费积攒的庆祝并补上动作期间错过的状态变化。子宠物的静息状态在 p.rest 里。
  function settle(p) {
    if (p.exiting || !p.el.isConnected) return;
    motion(p, "idle");
    if (p === pet && tryCheer()) return;
    const mood = p === pet ? wanted.mood : (p.rest ?? wanted.mood);
    if (LOOPING.has(p.state) && p.state !== mood && !(looking && p === pet)) play(p, mood);
  }

  function create(petId) {
    const el = document.createElement("div");
    el.className = "t3x-pet";
    el.dataset.pet = petId;
    const def = catalog.get(petId);
    if (def?.pixelFx) el.dataset.pixelFx = "";
    if (def?.smooth) el.dataset.smooth = "";
    el.dataset.motion = "idle";
    el.dataset.facing = "left";
    const shadow = document.createElement("div");
    shadow.className = "t3x-pet-shadow";
    const body = document.createElement("div");
    body.className = "t3x-pet-body";
    const sprite = document.createElement("div");
    sprite.className = "t3x-pet-sprite";
    sprite.style.backgroundImage = `url(${def?.sheet ?? ""})`;
    sprite.style.backgroundSize = "800% 1100%";
    const fx = document.createElement("div");
    fx.className = "t3x-pet-fx";
    body.appendChild(sprite);
    el.append(shadow, body, fx);
    const p = { el, body, sprite, petId, x: 0, state: "idle", frameTimer: 0, exiting: false, held: false, bumping: false };
    bindPointer(p);
    return p;
  }

  function destroy(p) {
    p.exiting = true;
    p.cancelDrag?.();
    p.cancelBump?.(p);
    p.cancelMotion?.();
    p.cancelMotion = null;
    clearTimeout(p.frameTimer);
    p.frameTimer = 0;
    p.resume = null;
    p.el.style.translate = "";
    exitingMains.delete(p);
    p.el.remove();
  }

  function enter(p, x, style) {
    stage.appendChild(p.el);
    place(p, x);
    subPets.flush();
    // 先进入入场动作再 catchUp：积攒的庆祝留在入场 settle 时播，不会被入场挥手覆盖。
    motion(p, style, () => settle(p));
    play(p, style === "enter-jump" ? "jumping" : "waving", { once: true });
    catchUp();
  }

  function runExit(p) {
    if (!p.el.isConnected) return destroy(p);
    exitingMains.add(p);
    const toRight = p.x < span() / 2 ? false : true;
    const blink = reduced() || Math.random() < 0.5;
    if (blink) {
      motion(p, "exit-blink", () => destroy(p));
      return;
    }
    p.el.dataset.facing = toRight ? "right" : "left";
    p.el.style.setProperty("--t3x-run-dx", `${toRight ? 120 : -120}px`);
    play(p, toRight ? "running-right" : "running-left");
    motion(p, "exit-run", () => destroy(p));
  }

  function exit(p) {
    if (!p || p.exiting) return;
    p.exiting = true;
    p.cancelDrag?.();
    p.cancelBump?.(p);
    runExit(p);
  }

  function switchTo(petId) {
    clearTimeout(switchTimer);
    switchTimer = 0;
    const old = pet;
    const next = create(petId);
    next.x = old ? old.x : ratio() * span(); // 还没入场就又被换掉时，下一只仍从这里出现
    pet = next;
    if (old) exit(old);
    const style = reduced() || Math.random() < 0.5 ? "enter-blink" : "enter-jump";
    switchTimer = setTimeout(() => {
      switchTimer = 0;
      if (pet === next) enter(next, next.x, style);
    }, old ? 120 : 0);
  }

  // 找松手位置附近可互动的另一只宠物；只匹配静息且未被按住的宠物，不打断进场、拖动或告别。
  function findBump(mover) {
    const candidates = subPets.bumpCandidates(mover);
    if (mover !== pet && pet?.el.isConnected && !pet.exiting && !pet.held && !pet.bumping && pet.el.dataset.motion === "idle") {
      candidates.push(pet);
    }
    return findBumpTarget(mover.x, candidates);
  }

  // 两只宠物面对面跳起碰头互动，结束后自然分开到不重叠的位置，各自回到原来的状态。
  function startBump(mover, target, moverFromX) {
    if (mover.exiting || target.exiting || !mover.el.isConnected || !target.el.isConnected) return;
    cancelAnimationFrame(wanderRaf);
    wanderRaf = 0;
    clearTimeout(lookTimer);
    lookTimer = 0;
    looking = false;
    const max = span();
    const otherXs = subPets.otherXs(mover, target);
    if (pet && pet !== mover && pet !== target && pet.el.isConnected) otherXs.push(pet.x);
    const pos = resolveBumpPositions({ moverX: mover.x, moverFromX, targetX: target.x, span: max, others: otherXs });
    const leftPet = pos.side < 0 ? mover : target;
    const rightPet = pos.side < 0 ? target : mover;
    const pair = [mover, target];
    let sepRaf = 0;
    let ended = false;

    const clearBumpState = (p) => {
      p.bumping = false;
      p.cancelBump = null;
      p.el.style.translate = "";
      delete p.el.dataset.bump;
      if (p.el.dataset.role !== "sub") delete p.el.dataset.side;
    };

    const finishPet = (p, saveMain, curSpan) => {
      clearBumpState(p);
      if (p.exiting || !p.el.isConnected) return;
      if (p === pet) {
        if (saveMain) position.set(curSpan ? p.x / curSpan : 0.9);
        subPets.promote(curSpan);
        settle(p);
        return;
      }
      if (p.el.dataset.role !== "sub") return;
      const tookFarewell = subPets.setBumping(p, false, curSpan);
      if (!tookFarewell && p.el.isConnected && !p.exiting) settle(p);
    };

    const cancel = (leaving) => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(sepRaf);
      sepRaf = 0;
      const curSpan = span();
      for (const p of pair) {
        if (p === leaving || p.exiting || !p.el.isConnected) {
          clearBumpState(p);
        } else {
          finishPet(p, false, curSpan);
        }
      }
    };

    for (const p of pair) {
      p.bumping = true;
      p.cancelBump = cancel;
      if (p.el.dataset.role === "sub") subPets.setBumping(p, true);
    }

    place(mover, pos.meetMoverX, max);
    place(target, pos.meetTargetX, max);
    leftPet.el.dataset.side = "left";
    leftPet.el.dataset.facing = "right";
    leftPet.el.dataset.bump = "exclaim";
    rightPet.el.dataset.side = "right";
    rightPet.el.dataset.facing = "left";
    rightPet.el.dataset.bump = "spark";

    let pending = 2;
    const onBumpDone = () => {
      if (ended || --pending > 0) return;
      for (const p of pair) delete p.el.dataset.bump;
      const doneSeparate = () => {
        if (ended) return;
        ended = true;
        sepRaf = 0;
        mover.el.style.translate = "";
        target.el.style.translate = "";
        const curSpan = span();
        place(mover, pos.afterMoverX, curSpan);
        place(target, pos.afterTargetX, curSpan);
        finishPet(mover, true, curSpan);
        finishPet(target, true, curSpan);
      };
      const distA = Math.abs(pos.afterMoverX - mover.x);
      const distB = Math.abs(pos.afterTargetX - target.x);
      if (reduced() || (distA < 1 && distB < 1)) return doneSeparate();

      const fromA = mover.x;
      const fromB = target.x;
      for (const [p, to, dist] of [
        [mover, pos.afterMoverX, distA],
        [target, pos.afterTargetX, distB],
      ]) {
        motion(p, "idle");
        if (dist >= 1) play(p, to > p.x ? "running-right" : "running-left");
        else play(p, p === pet ? wanted.mood : (p.rest ?? wanted.mood));
      }
      const t0 = performance.now();
      const dur = Math.min(260, Math.max(150, Math.max(distA, distB) * 4));
      // 用独立 translate 属性播放分开过渡，避免每帧写 left 与反复重排；完成后一次回写 x/home。
      const step = (now) => {
        if (ended) return;
        const k = Math.min(1, (now - t0) / dur);
        const ease = 1 - (1 - k) ** 3;
        if (distA >= 1) mover.el.style.translate = `${((pos.afterMoverX - fromA) * ease).toFixed(2)}px 0`;
        if (distB >= 1) target.el.style.translate = `${((pos.afterTargetX - fromB) * ease).toFixed(2)}px 0`;
        if (k < 1) return void (sepRaf = requestAnimationFrame(step));
        doneSeparate();
      };
      sepRaf = requestAnimationFrame(step);
    };

    for (const p of pair) {
      motion(p, "bump", onBumpDone);
      play(p, "jumping", { once: true });
    }
  }

  // 拖动沿输入框上沿移动；不移动就是点一下。主宠物和子宠物各拖各的。
  function bindPointer(p) {
    let drag = null; // { pointerId, x, px, moved, lastDx }

    // 统一幂等收尾：commit=true 仅用于归属指针正常松手；取消、丢失捕获、捕获失败、离场均走 commit=false。
    const endDrag = (commit) => {
      if (!drag) return;
      const { pointerId, moved, px } = drag;
      drag = null;
      p.held = false;
      try {
        if (p.el.hasPointerCapture?.(pointerId)) p.el.releasePointerCapture(pointerId);
      } catch {}
      const isSub = p.el.dataset.role === "sub";
      if (p.exiting || !p.el.isConnected) {
        if (isSub) subPets.drop(p, { skipSeat: true });
        return;
      }
      const curSpan = span();
      if (!commit) {
        if (isSub) {
          if (subPets.drop(p, { curSpan })) return;
        } else if (moved) {
          position.set(curSpan ? p.x / curSpan : 0.9);
          subPets.promote(curSpan);
        }
        if (moved) {
          motion(p, "drop", () => settle(p));
          play(p, p === pet ? wanted.mood : (p.rest ?? wanted.mood));
        } else if (p.el.dataset.motion === "drag") {
          settle(p);
        }
        return;
      }
      if (moved) {
        // 拖着的时候收工了，直接补播告别，不触发双宠互动。
        if (isSub && subPets.drop(p, { skipSeat: true, curSpan })) return;
        const target = findBump(p);
        if (target) return startBump(p, target, px);
        if (p === pet) {
          position.set(curSpan ? p.x / curSpan : 0.9);
          subPets.promote(curSpan);
        } else if (isSub) {
          subPets.seat(p, curSpan);
        }
        motion(p, "drop", () => settle(p));
        play(p, p === pet ? wanted.mood : (p.rest ?? wanted.mood));
      } else {
        if (isSub && subPets.drop(p, { curSpan })) return;
        motion(p, "poke", () => settle(p));
        play(p, "jumping", { once: true });
      }
    };
    p.cancelDrag = () => endDrag(false);

    p.el.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || drag || p.exiting || p.bumping) return;
      if (p === pet) {
        if (p.el.dataset.motion === "enter-jump" || p.el.dataset.motion === "enter-blink") return;
      } else if (!subPets.grab(p)) {
        return;
      }
      p.held = true;
      drag = { pointerId: ev.pointerId, x: ev.clientX, px: p.x, moved: false, lastDx: 0 };
      try {
        p.el.setPointerCapture(ev.pointerId);
      } catch {
        endDrag(false);
        return;
      }
      ev.preventDefault();
      cancelAnimationFrame(wanderRaf);
      wanderRaf = 0;
    });
    p.el.addEventListener("pointermove", (ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      if (p.exiting || p.bumping || !p.el.isConnected) return endDrag(false);
      if (drag.moved && p.el.dataset.motion !== "drag") return endDrag(false);
      const dx = ev.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        motion(p, "drag");
      }
      const dir = dx >= drag.lastDx ? "running-right" : "running-left";
      drag.lastDx = dx;
      if (p.state !== dir) play(p, dir);
      place(p, drag.px + dx);
    });
    p.el.addEventListener("pointerup", (ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      endDrag(true);
    });
    const onAbort = (ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      endDrag(false);
    };
    p.el.addEventListener("pointercancel", onAbort);
    p.el.addEventListener("lostpointercapture", onAbort);
    p.el.addEventListener("pointerenter", () => {
      if (p === pet && !drag && !p.exiting && !p.bumping && p.state === "idle" && wanted.mood === "idle") play(p, "waving", { once: true });
    });
    // 右键让宠物这次先离开，下次启动再出现。
    p.el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      hidden = true;
      sessionStorage.setItem(HIDE_KEY, "1");
      hideAll();
    });
  }

  // 空闲时眼睛跟着指针转，停下 1.5 秒后恢复待机动画。
  function onPointerMove(ev) {
    const p = pet;
    if (!p || p.exiting || p.held || p.bumping || p.el.dataset.motion !== "idle" || wanted.mood !== "idle" || p.state !== "idle" || reduced()) return;
    const r = p.el.getBoundingClientRect();
    const dx = ev.clientX - (r.left + r.width / 2);
    const dy = ev.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) > 320) return;
    lookAt(p, dx, dy, 1500);
  }

  function lookAt(p, dx, dy, ms) {
    const look = lookFrame(dx, dy);
    if (!look) return;
    clearTimeout(p.frameTimer);
    p.resume = null;
    looking = true;
    p.sprite.style.backgroundPosition = `${(look.col / 7) * 100}% ${(look.row / 10) * 100}%`;
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => {
      lookTimer = 0;
      looking = false;
      if (pet === p && !p.exiting && p.el.dataset.motion === "idle") play(p, wanted.mood);
    }, ms);
  }

  // 子宠物来打招呼或击掌时，主宠物转头看过去一下（dir: -1 左，1 右）。
  function glance(dir) {
    const p = pet;
    if (p && !p.exiting && !p.held && p.el.dataset.motion === "idle" && !reduced()) lookAt(p, dir * 100, 0, 900);
  }

  const enabled = () => !hidden && sessionStorage.getItem(HIDE_KEY) !== "1";

  function hideAll() {
    gen += 1; // 关掉前排队等 host 的 update 作废，免得 host 出现后又把宠物挂回去
    cancelAnimationFrame(stageRaf);
    stageRaf = 0;
    clearTimeout(switchTimer);
    switchTimer = 0;
    clearTimeout(lookTimer);
    lookTimer = 0;
    looking = false;
    cancelAnimationFrame(wanderRaf);
    wanderRaf = 0;
    missed = [];
    missedCheer = false;
    const old = pet;
    pet = null;
    // 先标记离场并终止拖动，再清子宠（取消碰头时跳过旧主宠的 settle），最后走退场动画。
    if (old) {
      old.exiting = true;
      old.cancelDrag?.();
    }
    subPets.reset();
    if (old) runExit(old);
    window.dispatchEvent(new Event("t3x-pets-change"));
  }

  const subPets = createSubPets({
    stage: () => stage,
    main: () => pet,
    span,
    create,
    destroy,
    place,
    play,
    motion,
    reduced,
    glance,
    cheer: () => pet && !pet.exiting && pet.el.dataset.motion === "idle" && play(pet, "jumping", { once: true }),
    badgeBottom: (id) => catalog.get(id)?.badgeBottom ?? 54,
  });

  // 闲着时偶尔沿上沿走几步。
  function scheduleWander() {
    clearTimeout(wanderTimer);
    wanderTimer = setTimeout(() => {
      const p = pet;
      if (p && !p.exiting && !p.held && !p.bumping && !document.hidden && !reduced() && !subPets.count() && wanted.mood === "idle" && p.state === "idle" && !looking && p.el.dataset.motion === "idle") {
        const max = span();
        const target = Math.max(0, Math.min(max, p.x + (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 100)));
        const dir = target > p.x ? 1 : -1;
        play(p, dir > 0 ? "running-right" : "running-left");
        const step = () => {
          wanderRaf = 0;
          if (pet !== p || p.exiting || p.held || p.el.dataset.motion !== "idle" || p.state.indexOf("running-") !== 0) return;
          const next = p.x + dir * 1.6;
          if ((dir > 0 && next >= target) || (dir < 0 && next <= target)) {
            place(p, target, max);
            position.set(max ? p.x / max : 0.9);
            return play(p, wanted.mood);
          }
          place(p, next, max);
          wanderRaf = requestAnimationFrame(step);
        };
        wanderRaf = requestAnimationFrame(step);
      }
      scheduleWander();
    }, 20000 + Math.random() * 25000);
  }

  const reducedQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let resizer = null;
  function onVisible() {
    if (document.hidden) return;
    for (const p of [pet, ...exitingMains, ...subPets.pets()]) {
      const resume = p?.resume;
      if (!resume) continue;
      p.resume = null;
      resume();
    }
    catchUp();
  }
  function tryCheer() {
    if (!missedCheer || away() || !pet || pet.exiting || !pet.el.isConnected || pet.el.dataset.motion !== "idle") return false;
    missedCheer = false;
    clearTimeout(lookTimer);
    lookTimer = 0;
    looking = false;
    play(pet, "jumping", { once: true });
    return true;
  }
  // 回到前台：补播离开期间攒下的。
  function catchUp() {
    if (away()) return;
    const events = missed;
    missed = [];
    if (events.length) subPets.apply(events, false);
    tryCheer();
  }
  function cheer() {
    missedCheer = true;
    tryCheer();
  }
  // 系统切换减少动态效果：按当前帧状态重启（或停住）帧循环；动作途中切换也要覆盖，动作结束的 settle 不会补播。
  function onReducedChange() {
    for (const p of [pet, ...exitingMains, ...subPets.pets()]) if (p?.state && p.el.isConnected) play(p, p.state, { once: !LOOPING.has(p.state) });
  }

  function ensureStage() {
    const host = findHost();
    if (!host) return false;
    if (!stage) {
      stage = document.createElement("div");
      stage.className = "t3x-pet-stage";
      stage.setAttribute("aria-hidden", "true");
      document.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", catchUp);
      reducedQuery?.addEventListener?.("change", onReducedChange);
      // stage 和输入框同宽；观察它才能跟上侧栏开合，窗口尺寸不变时也会触发。
      resizer = new ResizeObserver(() => {
        if (!pet) return;
        const max = span();
        place(pet, ratio() * max, max);
      });
      resizer.observe(stage);
    }
    if (stage.parentElement !== host) {
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.prepend(stage);
      if (pet) {
        const max = span();
        place(pet, ratio() * max, max);
      }
      scheduleWander();
    }
    return true;
  }

  function clearStage() {
    gen += 1;
    missed = [];
    missedCheer = false;
    cancelAnimationFrame(stageRaf);
    stageRaf = 0;
    clearTimeout(switchTimer);
    switchTimer = 0;
    clearTimeout(wanderTimer);
    wanderTimer = 0;
    clearTimeout(lookTimer);
    lookTimer = 0;
    looking = false;
    cancelAnimationFrame(wanderRaf);
    wanderRaf = 0;
    const old = pet;
    pet = null;
    if (old) old.exiting = true;
    subPets.reset();
    if (old) destroy(old);
    for (const p of [...exitingMains]) destroy(p);
    exitingMains.clear();
    stage?.remove();
  }

  return {
    update(next) {
      clearTimeout(detachTimer);
      detachTimer = 0;
      wanted = next;
      if (!enabled()) return;
      const my = ++gen;
      cancelAnimationFrame(stageRaf);
      stageRaf = 0;
      let tries = 0;
      const apply = () => {
        stageRaf = 0;
        if (my !== gen) return;
        if (!ensureStage()) {
          if (tries++ < 30) stageRaf = requestAnimationFrame(apply);
          return;
        }
        if (!pet || pet.petId !== wanted.petId) return switchTo(wanted.petId);
        subPets.flush();
        catchUp();
        if (pet.el.dataset.motion === "idle" && pet.state !== wanted.mood && !looking && pet.state.indexOf("running-") !== 0) play(pet, wanted.mood);
      };
      apply();
    },
    celebrate: cheer,
    subagents(events, fresh) {
      if (!enabled()) return;
      if (fresh) missed = [];
      // 落座不带动画，马上生效；其余的在不在前台期间按顺序攒着（前面攒了的话后面也得排队）。
      const later = away() || missed.length ? events.filter((e) => e.type !== "seat") : [];
      missed.push(...later);
      subPets.apply(later.length ? events.filter((e) => e.type === "seat") : events, fresh);
    },
    enabled,
    // 当前 agent 设成不显示桌宠：主宠物和子宠物都离开，但不算“隐藏”，换了 agent 还会出现。
    clear: hideAll,
    // 设置里“叫回桌宠”：解除右键的临时隐藏。
    unhide() {
      sessionStorage.removeItem(HIDE_KEY);
      hidden = false;
      window.dispatchEvent(new Event("t3x-pets-change"));
    },
    // 宠物定义改了（换图、缩放）：当前这只换成新样子重新入场。
    refresh() {
      if (pet) switchTo(pet.petId);
    },
    // 切换会话会先卸载再挂载聊天视图；稍等一下，同一 petId 就不重播入场。
    detach() {
      clearTimeout(detachTimer);
      detachTimer = setTimeout(() => {
        detachTimer = 0;
        clearStage();
      }, 400);
    },
    // 扩展停用：立即清掉所有宠物、计时器和全局监听。
    dispose() {
      clearTimeout(detachTimer);
      detachTimer = 0;
      clearStage();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", catchUp);
      reducedQuery?.removeEventListener?.("change", onReducedChange);
      resizer?.disconnect();
      resizer = null;
      stage = null;
    },
  };
}
