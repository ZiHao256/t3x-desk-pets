"use strict";
// 桌宠状态机回归：主宠物的用量、切会话、换宠与定时清理；离场、碰头、指针、补播、布局读取与 rAF 清理。
const assert = require("node:assert/strict");
const { createPetsHarness } = require("./harness.cjs");

module.exports = (test) => {
  test("桌宠：主宠物的用量、切会话、换宠与定时清理", () => {
    let calm = false;
    const h = createPetsHarness({ quiet: () => calm });
    const fill = "--t3x-pet-fill";
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.ctrl.updateSwell("a", 0.799, false);
    h.advance(0);
    const main = h.mainEls()[0];
    assert.equal(main.children.at(-2).className, "t3x-pet-fx");
    assert.equal(main.children.at(-1).className, "t3x-pet-puff");
    assert.equal(main.children.at(-1).attributes["aria-hidden"], "true");
    assert.equal(main.style[fill], "0.799");
    assert.equal(main.dataset.swellSnap, "");
    h.stepRaf();
    assert.equal(main.dataset.swellSnap, "");
    h.stepRaf();
    assert.equal(main.dataset.swellSnap, undefined);
    h.ctrl.updateSwell("a", 0.8, false);
    assert.equal(main.style[fill], "0.799");
    assert.equal(main.dataset.fill, "high");
    h.ctrl.updateSwell("a", 0.806, true);
    assert.equal(main.style[fill], "0.806");
    assert.equal(main.dataset.compact, "squeeze");
    h.ctrl.updateSwell("b", 0.809, false);
    assert.equal(main.style[fill], "0.809");
    assert.equal(main.dataset.swellSnap, "");
    assert.equal(main.dataset.compact, undefined);
    h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
    calm = true;
    h.ctrl.syncCalm();
    assert.equal(main.dataset.calm, "");
    const sub = h.subEls()[0];
    assert.equal(sub.style[fill], undefined);
    for (const key of ["fill", "swellSnap", "compact", "calm"]) assert.equal(sub.dataset[key], undefined);
    assert.equal(sub.children.some((child) => child.className === "t3x-pet-puff"), false);

    h.ctrl.updateSwell("b", 0.97, true);
    h.ctrl.update({ petId: "claude", mood: "idle" });
    h.advance(120);
    const replacement = h.mainEls().at(-1);
    assert.equal(replacement.dataset.compact, "squeeze");
    assert.equal(replacement.dataset.calm, "");
    assert.equal(replacement.dataset.fill, "full");
    assert.equal(replacement.style[fill], "0.97");
    h.ctrl.updateSwell("b", 0.21, false);
    assert.equal(replacement.dataset.compact, "pop");
    assert.equal(replacement.dataset.fill, undefined);
    h.advance(600);
    h.ctrl.refresh();
    h.advance(120);
    const rebuilt = h.mainEls().at(-1);
    assert.equal(rebuilt.style[fill], "0.21");
    assert.equal(rebuilt.dataset.compact, "pop");
    calm = false;
    h.ctrl.syncCalm();
    assert.equal(rebuilt.dataset.calm, undefined);
    h.advance(379);
    assert.equal(rebuilt.dataset.compact, "pop");
    h.advance(1);
    assert.equal(rebuilt.dataset.compact, undefined);

    // 换输入框时宠物短暂脱离文档：这期间切到的新会话状态也要写上，重挂后不能还是旧会话的样子
    rebuilt._connected = false;
    h.ctrl.updateSwell("d", 0.12, false);
    assert.equal(rebuilt.style[fill], "0.12");
    assert.equal(rebuilt.dataset.compact, undefined);
    rebuilt._connected = true;

    h.ctrl.updateSwell("c", 1, true);
    h.ctrl.updateSwell("c", 0.2, false);
    h.ctrl.dispose();
    assert.equal(h.timers.size, 0);
    assert.equal(h.rafs.size, 0);
  });

  test("桌宠：子代理宠物上限可设置，调大补进 +N 里的，调小不赶走在场的", () => {
    let max = 5;
    const h = createPetsHarness({ stageWidth: 1200, maxSubs: () => max });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    const seat = (id) => ({ type: "seat", id, petId: "codex", status: "running" });
    h.ctrl.subagents(["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map(seat), true);
    assert.equal(h.subEls().length, 5);
    assert.equal(h.badgeEl().textContent, "+2");
    max = 6;
    h.ctrl.layoutSubs();
    assert.equal(h.subEls().length, 6);
    assert.equal(h.badgeEl().textContent, "+1");
    max = 2;
    h.ctrl.layoutSubs();
    h.ctrl.subagents([seat("s8")], false);
    assert.equal(h.subEls().length, 6, "调小后已在场的不赶走");
    assert.equal(h.badgeEl().textContent, "+2");
    // 补进来的那只是跑进场的：跑完、打完招呼再看落点
    for (let i = 0; i < 120; i++) h.stepRaf();
    for (const el of h.subEls()) if (el.dataset.motion !== "idle") h.finishAnim(el);
    assert(h.subEls().every((el) => el.dataset.motion === "idle"));
    const xs = [h.mainEls()[0], ...h.subEls()].map((el) => Number.parseFloat(el.style.left)).sort((a, b) => a - b);
    assert(xs.every((x, i) => i === 0 || x - xs[i - 1] >= 25), `7 只各站各的：${xs}`);
  });

  test("桌宠：两只子宠物碰头期间调大上限，补进来的不和它们抢同一个座位", () => {
    let max = 2;
    const h = createPetsHarness({ stageWidth: 600, maxSubs: () => max });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.ctrl.subagents(["s1", "s2", "s3"].map((id) => ({ type: "seat", id, petId: "codex", status: "running" })), true);
    const [a, b] = h.subEls();
    h.finishAnim(a);
    h.finishAnim(b);
    assert.equal(h.badgeEl().textContent, "+1");
    const bx = Number.parseFloat(b.style.left);
    a.dispatch("pointerdown", { pointerId: 5, clientX: Number.parseFloat(a.style.left) });
    a.dispatch("pointermove", { pointerId: 5, clientX: bx });
    a.dispatch("pointerup", { pointerId: 5, clientX: bx });
    assert.equal(b.dataset.motion, "bump");
    max = 3;
    h.ctrl.layoutSubs();
    assert.equal(h.subEls().length, 2, "碰头途中不补位");
    for (let i = 0; i < 20 && (a.dataset.motion === "bump" || b.dataset.motion === "bump"); i++) {
      for (const el of [a, b]) if (el.dataset.motion === "bump") h.finishAnim(el);
      for (let j = 0; j < 60; j++) h.stepRaf();
    }
    assert.equal(h.subEls().length, 3, "碰完补进来");
    assert.equal(h.badgeEl(), null);
    for (let i = 0; i < 120; i++) h.stepRaf();
    for (const el of h.subEls()) if (el.dataset.motion !== "idle") h.finishAnim(el);
    const xs = [h.mainEls()[0], ...h.subEls()].map((el) => Number.parseFloat(el.style.left)).sort((x, y) => x - y);
    assert(xs.every((x, i) => i === 0 || x - xs[i - 1] >= 25), `4 只各站各的：${xs}`);
  });

  test("桌宠：在等你的子代理举牌子，点了跳转；收工放下；挤在 +N 里时徽标代它举", () => {
    const h = createPetsHarness({ stageWidth: 1200 });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    const seat = (id) => ({ type: "seat", id, petId: "codex", status: "running" });
    h.ctrl.subagents(["s1", "s2", "s3", "s4"].map(seat), true);
    assert.equal(h.subEls().length, 3);
    assert.equal(h.badgeEl().textContent, "+1");
    const opened = [];
    const sign = (id, needs = "approval") => ({ needs, label: needs === "input" ? "等你回复" : "等你批准", hint: "打开会话", open: () => opened.push(id) });
    h.ctrl.signs(new Map([["s2", sign("s2")]]));
    const signOf = (el) => el.children.find((c) => c.className === "t3x-pet-sign");
    const [a, b] = h.subEls();
    assert.equal(signOf(a), undefined);
    const placard = signOf(b);
    assert.equal(placard.textContent, "等你批准");
    assert.equal(placard.dataset.needs, "approval");
    let stopped = 0;
    const ev = { stopPropagation: () => (stopped += 1) };
    let prevented = 0;
    placard.dispatch("pointerdown", ev);
    placard.dispatch("click", ev);
    placard.dispatch("contextmenu", { ...ev, preventDefault: () => (prevented += 1) });
    assert.equal(stopped, 3, "按牌子不当成拖宠物，右键也不冒泡到宠物菜单");
    assert.equal(prevented, 1);
    assert.deepEqual(opened, ["s2"]);
    assert.equal(h.badgeEl().dataset.alert, undefined, "+N 里没人在等");
    assert.equal(h.badgeEl().disabled, true, "没人在等时徽标只是计数，不能聚焦");

    h.ctrl.signs(new Map([["s2", sign("s2", "input")], ["s4", sign("s4", "input")]]));
    assert.equal(placard.dataset.needs, "input", "等回复换青色灯");
    assert.equal(h.badgeEl().dataset.alert, "", "挤在 +N 里的 s4 在等：徽标变成牌子");
    assert.equal(h.badgeEl().dataset.needs, "input", "徽标灯色跟 s4 一样");
    assert.equal(h.badgeEl().disabled, false);
    h.badgeEl().dispatch("click", ev);
    assert.deepEqual(opened, ["s2", "s4"]);

    h.ctrl.subagents([{ type: "finish", id: "s2", ok: true }], false);
    assert.equal(signOf(b), undefined, "收工就放下牌子");
    h.ctrl.signs(new Map());
    assert.equal(h.badgeEl()?.dataset.alert, undefined);
    h.ctrl.dispose();
  });

  test("桌宠：挤在 +N 里收工的子代理补播进场时不举牌子", () => {
    const h = createPetsHarness({ stageWidth: 1200 });
    h.ctrl.update({ petId: "codex", mood: "idle" });
    h.advance(50);
    h.finishAnim(h.mainEls()[0]);
    h.ctrl.subagents(["s1", "s2", "s3", "s4"].map((id) => ({ type: "seat", id, petId: "codex", status: "running" })), true);
    const seated = h.subEls();
    for (const el of seated) h.finishAnim(el);
    // s4 在 +1 里等你；会话的 needs 还没清掉时它和 s1 先后收工
    h.ctrl.signs(new Map([["s4", { label: "等你批准", hint: "打开会话", open() {} }]]));
    h.ctrl.subagents([{ type: "finish", id: "s4", ok: true }, { type: "finish", id: "s1", ok: true }], false);
    for (let i = 0; i < 20 && h.subEls().length <= 3; i++) {
      for (const el of h.subEls()) h.finishAnim(el);
      h.advance(400);
    }
    const replayed = h.subEls().filter((el) => !seated.includes(el));
    assert.equal(replayed.length, 1, "s1 离场后 s4 补播进场");
    assert.equal(replayed[0].children.some((c) => c.className === "t3x-pet-sign"), false, "补播的已经收工，不举牌子");
    h.ctrl.dispose();
  });

  test("桌宠：离场、碰头、指针、补播、布局与 rAF 回归", () => {
    // 1. 拖动中切换主宠，松手不会复活旧主宠，dispose 后计时器清零
    {
      const h = createPetsHarness();
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      const oldMain = h.mainEls()[0];
      h.finishAnim(oldMain);
      oldMain.dispatch("pointerdown", { pointerId: 1, clientX: 500 });
      oldMain.dispatch("pointermove", { pointerId: 1, clientX: 460 });
      h.ctrl.update({ petId: "claude", mood: "idle" }); // 旧主宠开始离场
      oldMain.dispatch("pointerup", { pointerId: 1, clientX: 460 });
      assert.match(oldMain.dataset.motion, /^exit-/);
      h.ctrl.dispose();
      assert.equal(h.timers.size, 0, "dispose 后不应残留计时器");
      assert.equal(h.rafs.size, 0, "dispose 后不应残留 rAF");
    }

    // 1b. 拖动子宠物期间代理消失（quiet），松手不会复活或泄漏 exiting 名额
    {
      const h = createPetsHarness();
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      h.finishAnim(h.mainEls()[0]);
      h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
      const sub = h.subEls()[0];
      h.finishAnim(sub);
      sub.dispatch("pointerdown", { pointerId: 2, clientX: 400 });
      sub.dispatch("pointermove", { pointerId: 2, clientX: 360 });
      h.ctrl.subagents([{ type: "finish", id: "s1", ok: true, quiet: true }], false);
      assert.equal(sub.dataset.motion, "exit-blink");
      sub.dispatch("pointerup", { pointerId: 2, clientX: 360 });
      assert.equal(sub.dataset.motion, "exit-blink");
      h.finishAnim(sub);
      assert.equal(h.subEls().length, 0);
      h.ctrl.dispose();
    }

    // 2. 碰头期间右键隐藏，主宠正常离场销毁，不留屏幕也不留计时器
    {
      const h = createPetsHarness();
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      const main = h.mainEls()[0];
      h.finishAnim(main);
      h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
      const sub = h.subEls()[0];
      h.finishAnim(sub);
      const subX = Number.parseFloat(sub.style.left);
      const mainX = Number.parseFloat(main.style.left);
      sub.dispatch("pointerdown", { pointerId: 3, clientX: subX });
      sub.dispatch("pointermove", { pointerId: 3, clientX: mainX });
      sub.dispatch("pointerup", { pointerId: 3, clientX: mainX });
      assert.equal(main.dataset.motion, "bump");
      assert.equal(sub.dataset.motion, "bump");
      main.dispatch("contextmenu", {});
      assert.match(main.dataset.motion, /^exit-/);
      h.advance(1600);
      assert.equal(h.petEls().length, 0);
      h.ctrl.dispose();
      assert.equal(h.timers.size, 0);
    }

    // 3. lostpointercapture 恢复待播告别；pointercancel 不触发碰头；捕获失败回滚
    {
      const h = createPetsHarness();
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      const main = h.mainEls()[0];
      h.finishAnim(main);
      h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
      const sub = h.subEls()[0];
      h.finishAnim(sub);

      // 捕获抛错时回滚，不残留 dragging
      h.setCaptureThrow(true);
      sub.dispatch("pointerdown", { pointerId: 10, clientX: 400 });
      h.setCaptureThrow(false);
      sub.dispatch("pointermove", { pointerId: 10, clientX: 350 });
      assert.equal(sub.dataset.motion, "idle");

      // 拖到主宠上方触发 pointercancel：绝不进入 bump
      const subX = Number.parseFloat(sub.style.left);
      const mainX = Number.parseFloat(main.style.left);
      sub.dispatch("pointerdown", { pointerId: 11, clientX: subX });
      sub.dispatch("pointermove", { pointerId: 11, clientX: mainX });
      sub.dispatch("pointercancel", { pointerId: 11, clientX: mainX });
      assert.notEqual(sub.dataset.motion, "bump");
      assert.notEqual(main.dataset.motion, "bump");
      h.finishAnim(sub);

      // 拖动中收工后丢失捕获：接续告别离场
      sub.dispatch("pointerdown", { pointerId: 12, clientX: subX });
      sub.dispatch("pointermove", { pointerId: 12, clientX: subX - 20 });
      h.ctrl.subagents([{ type: "finish", id: "s1", ok: true }], false);
      assert.equal(sub.dataset.motion, "drag");
      sub.dispatch("lostpointercapture", { pointerId: 12 });
      assert(["highfive", "greet"].includes(sub.dataset.motion), `丢失捕获后应接续告别，实际 ${sub.dataset.motion}`);
      h.ctrl.dispose();
    }

    // 4. 已经按住的主宠不能被另一只当成碰头目标
    {
      const h = createPetsHarness();
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      const main = h.mainEls()[0];
      h.finishAnim(main);
      h.ctrl.subagents([{ type: "seat", id: "s1", petId: "codex", status: "running" }], true);
      const sub = h.subEls()[0];
      h.finishAnim(sub);
      const subX = Number.parseFloat(sub.style.left);
      const mainX = Number.parseFloat(main.style.left);
      main.dispatch("pointerdown", { pointerId: 1, clientX: mainX }); // 只按住未移动
      sub.dispatch("pointerdown", { pointerId: 2, clientX: subX });
      sub.dispatch("pointermove", { pointerId: 2, clientX: mainX });
      sub.dispatch("pointerup", { pointerId: 2, clientX: mainX });
      assert.notEqual(main.dataset.motion, "bump");
      assert.notEqual(sub.dataset.motion, "bump");
      main.dispatch("pointerup", { pointerId: 1, clientX: mainX });
      h.ctrl.dispose();
    }

    // 5. 后台依次完成四只子代理，回前台后四只全部依次出现并完成告别
    {
      const h = createPetsHarness();
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      h.finishAnim(h.mainEls()[0]);
      h.setFocus(false);
      let spawned = 0;
      const stageEl = h.stage();
      const origAppend = stageEl.appendChild.bind(stageEl);
      stageEl.appendChild = (c) => {
        if (c.className === "t3x-pet" && c.dataset.role === "sub") spawned += 1;
        return origAppend(c);
      };
      for (const id of ["a", "b", "c", "d"]) {
        h.ctrl.subagents([{ type: "arrive", id, petId: "codex", status: "running" }], false);
        h.ctrl.subagents([{ type: "finish", id, ok: true }], false);
      }
      assert.equal(spawned, 0);
      h.setFocus(true);
      assert.equal(spawned, 3);
      for (let i = 0; i < 120; i++) {
        h.stepRaf(20);
        h.advance(100);
      }
      assert.equal(spawned, 4, "第四只子代理应在腾出座位后补播");
      assert.equal(h.subEls().length, 0);
      h.ctrl.dispose();
    }

    // 6. 后台完成任务，回到前台时主宠仍在入场动画中：庆祝不能丢失，入场结束后播放跳跃
    {
      const h = createPetsHarness();
      h.setFocus(false);
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      const main = h.mainEls()[0];
      assert.match(main.dataset.motion, /^enter-/);
      h.ctrl.celebrate();
      h.setFocus(true); // 主宠还在入场中
      const sprite = main.children.find((c) => c.className === "t3x-pet-body").children[0];
      h.finishAnim(main); // 入场结束 -> settle 应立刻消费 missedCheer 播放 jumping（第 4 行）
      assert.equal(sprite.style.backgroundPosition, "0% 40%", "入场结束后应播放积攒的庆祝跳跃");
      h.ctrl.dispose();
    }

    // 9. 输入框从 204px 加宽到 600px 后，+1 中的子宠物自动补入座位
    {
      const h = createPetsHarness({ stageWidth: 204 });
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      h.finishAnim(h.mainEls()[0]);
      h.ctrl.subagents(
        [
          { type: "seat", id: "a", petId: "codex", status: "running" },
          { type: "seat", id: "b", petId: "codex", status: "running" },
          { type: "seat", id: "c", petId: "codex", status: "running" },
        ],
        true,
      );
      assert.equal(h.subEls().length, 2);
      assert.equal(h.badgeEl()?.textContent, "+1");
      h.setStageWidth(600);
      assert.equal(h.subEls().length, 3);
      assert.equal(h.badgeEl(), null);
      h.ctrl.dispose();
    }

    // 10. 三只子宠落座时，一次主宠 pointermove 只读一次主宠 offsetWidth；碰头分开动画期间不读布局
    {
      const h = createPetsHarness({ stageWidth: 600 });
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      const main = h.mainEls()[0];
      h.finishAnim(main);
      h.ctrl.subagents(
        [
          { type: "seat", id: "a", petId: "codex", status: "running" },
          { type: "seat", id: "b", petId: "codex", status: "running" },
          { type: "seat", id: "c", petId: "codex", status: "running" },
        ],
        true,
      );
      for (const s of h.subEls()) h.finishAnim(s);
      const mx = Number.parseFloat(main.style.left);
      main.dispatch("pointerdown", { pointerId: 1, clientX: mx });
      h.resetOffsetReads();
      main.dispatch("pointermove", { pointerId: 1, clientX: mx - 20 });
      assert.equal(h.getOffsetReads(), 1, "单次主宠移动只应读取一次 offsetWidth");
      main.dispatch("pointerup", { pointerId: 1, clientX: mx - 20 });
      h.finishAnim(main);

      // 碰头分开 rAF 期间不读 offsetWidth
      const sub = h.subEls()[0];
      const sx = Number.parseFloat(sub.style.left);
      const curMx = Number.parseFloat(main.style.left);
      sub.dispatch("pointerdown", { pointerId: 2, clientX: sx });
      sub.dispatch("pointermove", { pointerId: 2, clientX: curMx });
      sub.dispatch("pointerup", { pointerId: 2, clientX: curMx });
      h.finishAnim(main);
      h.finishAnim(sub);
      h.resetOffsetReads();
      h.stepRaf(50);
      h.stepRaf(50);
      assert.equal(h.getOffsetReads(), 0, "碰头分开过渡帧不应读取 offsetWidth");
      h.ctrl.dispose();
    }

    // 11. 子宠入场 rAF 在 dispose 时被主动取消
    {
      const h = createPetsHarness({ stageWidth: 600 });
      h.ctrl.update({ petId: "codex", mood: "idle" });
      h.advance(50);
      h.stepRaf();
      h.stepRaf();
      h.finishAnim(h.mainEls()[0]);
      h.ctrl.subagents(
        [
          { type: "arrive", id: "a", petId: "codex", status: "running" },
          { type: "arrive", id: "b", petId: "codex", status: "running" },
        ],
        false,
      );
      assert.equal(h.rafs.size, 2);
      h.ctrl.dispose();
      assert.equal(h.rafs.size, 0, "dispose 后子宠入场 rAF 应全部取消");
    }
  });
};
