import assert from "node:assert/strict";
import test from "node:test";
import { applyAction, createInitialGame, getLegalActions, stepPhase } from "../engine";
import { PlayCardAction } from "../types";

/**
 * 验证初始局面玩家数量和基础手牌发放正确。
 */
test("createInitialGame should initialize 5 players and 4 cards each", () => {
  const state = createInitialGame(42);
  assert.equal(state.players.length, 5);
  for (const player of state.players) {
    assert.equal(player.hand.length, 4);
  }
});

/**
 * 验证回合从摸牌阶段进入出牌阶段后，存在结束出牌阶段动作。
 */
test("legal actions should include end play phase in play phase", () => {
  const state = createInitialGame(42);
  stepPhase(state);
  const legal = getLegalActions(state);
  assert.ok(legal.some((action) => action.type === "end-play-phase"));
});

/**
 * 验证出牌阶段内【杀】的额定次数上限为 1。
 */
test("slash should be limited to once per play phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  actor.hand = [
    { id: "slash-a", kind: "slash" },
    { id: "slash-b", kind: "slash" },
    { id: "dodge-a", kind: "dodge" }
  ];
  target.hand = [];

  stepPhase(state);
  const firstSlash = getLegalActions(state).find(
    (action) =>
      action.type === "play-card" && action.actorId === actor.id && action.cardId === "slash-a" && action.targetId === target.id
  );

  assert.ok(firstSlash, "首张杀应是合法动作");
  applyAction(state, firstSlash);

  const secondSlashStillLegal = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.actorId === actor.id && action.cardId === "slash-b"
  );
  assert.equal(secondSlashStillLegal, false);
});

/**
 * 验证距离规则：攻击范围为 1 时，P1 不能直接指定 P3 为【杀】目标。
 */
test("slash target should respect attack range", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  actor.hand = [{ id: "slash-only", kind: "slash" }];

  stepPhase(state);
  const slashTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "slash-only")
    .map((action) => action.targetId);

  assert.deepEqual(slashTargets.sort(), ["P2", "P5"]);
});

/**
 * 验证【顺手牵羊】仅可指定距离为 1 且有手牌的角色。
 */
test("snatch should only target distance-1 player with cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  actor.hand = [{ id: "snatch-only", kind: "snatch" }];

  state.players[1].hand = [{ id: "x-1", kind: "dodge" }];
  state.players[2].hand = [{ id: "x-2", kind: "dodge" }];
  state.players[4].hand = [{ id: "x-5", kind: "dodge" }];

  stepPhase(state);
  const targets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "snatch-only")
    .map((action) => action.targetId)
    .sort();

  assert.deepEqual(targets, ["P2", "P5"]);
});

/**
 * 验证【无懈可击】可抵消【过河拆桥】。
 */
test("dismantle should be canceled by nullify", () => {
  const state = createInitialGame(42);

  for (const player of state.players) {
    player.hand = [];
  }

  const actor = state.players[2];
  const target = state.players[0];
  const protector = state.players[1];

  state.currentPlayerId = actor.id;
  state.phase = "play";

  actor.hand = [{ id: "dismantle-1", kind: "dismantle" }];
  target.hand = [{ id: "target-card", kind: "dodge" }];
  protector.hand = [{ id: "nullify-1", kind: "nullify" }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "dismantle-1",
    targetId: target.id
  });

  assert.equal(target.hand.length, 1);
  assert.ok(state.discard.some((card) => card.id === "nullify-1"));
});

/**
 * 验证【决斗】的轮流打杀逻辑：目标无法继续打出【杀】时受到伤害。
 */
test("duel should deal damage to first player who fails to play slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  state.currentPlayerId = actor.id;
  state.phase = "play";

  actor.hand = [
    { id: "duel-1", kind: "duel" },
    { id: "actor-slash-1", kind: "slash" }
  ];
  target.hand = [{ id: "target-slash-1", kind: "slash" }];

  const targetHpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "duel-1",
    targetId: target.id
  });

  assert.equal(target.hp, targetHpBefore - 1);
});

/**
 * 验证【南蛮入侵】要求目标打出【杀】，否则受到 1 点伤害。
 */
test("barbarian should require slash response for each target", () => {
  const state = createInitialGame(42);

  for (const player of state.players) {
    player.hand = [];
  }

  const actor = state.players[0];
  const targetWithSlash = state.players[1];
  const targetWithoutSlash = state.players[2];

  state.currentPlayerId = actor.id;
  state.phase = "play";

  actor.hand = [{ id: "barbarian-1", kind: "barbarian" }];
  targetWithSlash.hand = [{ id: "slash-rsp", kind: "slash" }];
  targetWithoutSlash.hand = [{ id: "dodge-rsp", kind: "dodge" }];

  const hpBefore = targetWithoutSlash.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "barbarian-1"
  });

  assert.equal(targetWithoutSlash.hp, hpBefore - 1);
});

/**
 * 验证【万箭齐发】可被目标同阵营角色用【无懈可击】抵消。
 */
test("archery should be cancelable per target by nullify", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[0];
  const protector = state.players[1];

  state.currentPlayerId = actor.id;
  state.phase = "play";

  actor.hand = [{ id: "archery-1", kind: "archery" }];
  target.hand = [{ id: "target-dodge-1", kind: "dodge" }];
  protector.hand = [{ id: "protector-nullify", kind: "nullify" }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "archery-1"
  });

  assert.equal(target.hp, hpBefore);
  assert.ok(state.discard.some((card) => card.id === "protector-nullify"));
});

/**
 * 验证武器能提升攻击范围，使 P1 可对距离为 2 的 P3 使用【杀】。
 */
test("weapon should increase attack range for slash target selection", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  actor.hand = [
    { id: "weapon-1", kind: "weapon_blade" },
    { id: "slash-1", kind: "slash" }
  ];

  stepPhase(state);
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "weapon-1",
    targetId: actor.id
  });

  const slashTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "slash-1")
    .map((action) => action.targetId)
    .sort();

  assert.deepEqual(slashTargets, ["P2", "P3", "P4", "P5"]);
});

/**
 * 验证坐骑会影响距离，从而影响【顺手牵羊】合法目标。
 */
test("horses should affect snatch target legality", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  actor.hand = [
    { id: "horse-minus-1", kind: "horse_minus" },
    { id: "snatch-1", kind: "snatch" }
  ];

  state.players[2].hand = [{ id: "p3-hand", kind: "dodge" }];

  stepPhase(state);

  const beforeEquipTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "snatch-1")
    .map((action) => action.targetId);

  assert.equal(beforeEquipTargets.includes("P3"), false);

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "horse-minus-1",
    targetId: actor.id
  });

  const afterEquipTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "snatch-1")
    .map((action) => action.targetId);

  assert.equal(afterEquipTargets.includes("P3"), true);
});

/**
 * 验证【乐不思蜀】判定失败时会跳过出牌阶段。
 */
test("indulgence should skip play phase on non-heart judgment", () => {
  const state = createInitialGame(42);
  const target = state.players[1];

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "indulgence-1", kind: "indulgence" }];
  state.deck = [{ id: "judge-spade-4", kind: "slash" }];

  stepPhase(state);
  assert.equal(state.phase, "draw");

  stepPhase(state);
  assert.equal(state.phase, "discard");
});

/**
 * 验证【闪电】判定命中时造成 3 点无来源伤害。
 */
test("lightning should deal 3 damage on spade 2-9 judgment", () => {
  const state = createInitialGame(42);
  const target = state.players[2];

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-1", kind: "lightning" }];
  state.deck = [{ id: "judge-spade-4", kind: "slash" }];

  const hpBefore = target.hp;
  stepPhase(state);
  assert.equal(target.hp, hpBefore - 3);
});

/**
 * 验证【闪电】判定未命中时会传递给下家判定区。
 */
test("lightning should transfer on non-trigger judgment", () => {
  const state = createInitialGame(42);
  const target = state.players[0];
  const next = state.players[1];

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-2", kind: "lightning" }];
  state.deck = [{ id: "judge-heart-1", kind: "slash" }];

  stepPhase(state);

  assert.equal(target.judgmentZone.delayedTricks.length, 0);
  assert.equal(next.judgmentZone.delayedTricks.some((card) => card.kind === "lightning"), true);
});

/**
 * 验证【乐不思蜀】在判定生效前可被【无懈可击】抵消。
 */
test("indulgence should be nullifiable before judgment effect", () => {
  const state = createInitialGame(42);
  const target = state.players[0];
  const ally = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "indulgence-2", kind: "indulgence" }];
  ally.hand = [{ id: "nullify-i-1", kind: "nullify" }];
  state.deck = [
    { id: "judge-spade-4", kind: "slash" },
    { id: "draw-buffer-1", kind: "dodge" },
    { id: "draw-buffer-2", kind: "peach" }
  ];

  stepPhase(state);
  stepPhase(state);

  assert.equal(state.phase, "play");
  assert.ok(state.discard.some((card) => card.id === "nullify-i-1"));
});

/**
 * 验证【闪电】在判定生效前可被【无懈可击】抵消，从而不造成伤害。
 */
test("lightning should be nullifiable before damage judgment", () => {
  const state = createInitialGame(42);
  const target = state.players[2];
  const ally = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-3", kind: "lightning" }];
  ally.hand = [{ id: "nullify-l-1", kind: "nullify" }];
  state.deck = [{ id: "judge-spade-4", kind: "slash" }];

  const hpBefore = target.hp;
  stepPhase(state);

  assert.equal(target.hp, hpBefore);
  assert.ok(state.discard.some((card) => card.id === "lightning-3"));
  assert.ok(state.discard.some((card) => card.id === "nullify-l-1"));
});
