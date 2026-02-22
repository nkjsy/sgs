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
