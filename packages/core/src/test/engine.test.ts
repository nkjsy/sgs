import assert from "node:assert/strict";
import test from "node:test";
import { createDeck } from "../cards";
import {
  applyAction,
  createInitialGame,
  getLegalActions,
  queueResponseDecision,
  setLuoyiChoice,
  setResponsePreference,
  stepPhase
} from "../engine";
import { STANDARD_SKILL_IDS, assignSkillToPlayer } from "../skills";
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
 * 验证默认牌堆采用标准身份场 108 张口径，并包含显式花色点数。
 */
test("createDeck should return standard identity 108-card blueprint with suit and point", () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.ok(deck.every((card) => card.suit && card.point && card.point >= 1 && card.point <= 13));
});

/**
 * 验证当前标准身份场牌堆口径不混入军争扩展关键装备。
 */
test("createDeck should exclude military-struggle expansion equipments", () => {
  const deck = createDeck();
  const kinds = new Set(deck.map((card) => String(card.kind)));

  assert.equal(kinds.has("weapon_guding_blade"), false);
  assert.equal(kinds.has("weapon_vermilion_fan"), false);
  assert.equal(kinds.has("armor_silver_lion"), false);
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
 * 验证结算层兜底：强行提交越距离【杀】动作会被拒绝并退回手牌。
 */
test("slash resolution should reject forced out-of-range target", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const outOfRangeTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-out-range-1", kind: "slash", suit: "spade", point: 7 }];
  outOfRangeTarget.hp = 4;

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-out-range-1",
    targetId: outOfRangeTarget.id
  });

  assert.equal(outOfRangeTarget.hp, 4);
  assert.ok(actor.hand.some((card) => card.id === "slash-out-range-1"));
});

/**
 * 验证马超【马术】可令你计算与其他角色距离-1，从而无武器也可指定原距离2的杀目标。
 */
test("mashu skill should reduce distance by 1 for slash targeting", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.machaoMashu);
  actor.hand = [{ id: "slash-mashu-1", kind: "slash", suit: "spade", point: 7 }];

  stepPhase(state);
  const slashTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "slash-mashu-1")
    .map((action) => action.targetId)
    .sort();

  assert.deepEqual(slashTargets, ["P2", "P3", "P4", "P5"]);
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
 * 验证【顺手牵羊】会为同一目标生成“手牌/装备区/判定区”的区域选择动作。
 */
test("snatch should expose selectable target zones", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  actor.hand = [{ id: "snatch-zone-1", kind: "snatch", suit: "spade", point: 6 }];
  target.hand = [{ id: "snatch-zone-hand", kind: "dodge", suit: "heart", point: 2 }];
  target.equipment.weapon = { id: "snatch-zone-weapon", kind: "weapon_blade", suit: "club", point: 5 };
  target.judgmentZone.delayedTricks = [{ id: "snatch-zone-judge", kind: "indulgence", suit: "diamond", point: 9 }];

  stepPhase(state);
  const zones = getLegalActions(state)
    .filter(
      (action): action is PlayCardAction =>
        action.type === "play-card" && action.cardId === "snatch-zone-1" && action.targetId === target.id
    )
    .map((action) => action.targetZone)
    .filter((zone): zone is Exclude<PlayCardAction["targetZone"], undefined> => Boolean(zone))
    .sort();

  assert.deepEqual(zones, ["equipment", "hand", "judgment"]);
});

test("snatch should allow choosing specific equipment card when multiple exist", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
    player.equipment.weapon = null;
    player.equipment.armor = null;
    player.equipment.horsePlus = null;
    player.equipment.horseMinus = null;
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "snatch-equip-choice-1", kind: "snatch", suit: "spade", point: 6 }];
  target.equipment.weapon = { id: "snatch-target-weapon", kind: "weapon_blade", suit: "club", point: 5 };
  target.equipment.armor = { id: "snatch-target-armor", kind: "armor_eight_diagram", suit: "spade", point: 2 };

  const legal = getLegalActions(state).filter(
    (action): action is PlayCardAction =>
      action.type === "play-card" &&
      action.cardId === "snatch-equip-choice-1" &&
      action.targetId === target.id &&
      action.targetZone === "equipment"
  );
  const armorAction = legal.find((action) => action.targetCardId === "snatch-target-armor");
  assert.ok(armorAction);

  applyAction(state, armorAction);

  assert.equal(target.equipment.armor, null);
  assert.equal(target.equipment.weapon?.id, "snatch-target-weapon");
  assert.ok(actor.hand.some((card) => card.id === "snatch-target-armor"));
});

/**
 * 验证【过河拆桥】按所选区域结算（装备区/判定区均可被指定）。
 */
test("dismantle should resolve with selected target zone", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
    player.equipment.weapon = null;
    player.equipment.armor = null;
    player.equipment.horsePlus = null;
    player.equipment.horseMinus = null;
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "dismantle-zone-1", kind: "dismantle", suit: "club", point: 8 }];
  target.hand = [{ id: "dismantle-zone-hand", kind: "slash", suit: "spade", point: 7 }];
  target.equipment.weapon = { id: "dismantle-zone-weapon", kind: "weapon_crossbow", suit: "diamond", point: 1 };
  target.judgmentZone.delayedTricks = [{ id: "dismantle-zone-judge", kind: "indulgence", suit: "heart", point: 12 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "dismantle-zone-1",
    targetId: target.id,
    targetZone: "equipment"
  });

  assert.equal(target.equipment.weapon, null);
  assert.equal(target.hand.some((card) => card.id === "dismantle-zone-hand"), true);
  assert.equal(target.judgmentZone.delayedTricks.some((card) => card.id === "dismantle-zone-judge"), true);
  assert.equal(state.discard.some((card) => card.id === "dismantle-zone-weapon"), true);
});

test("indulgence should target all opponents except qianxun owner", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const qianxunOwner = state.players[1];
  const normalTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
    player.judgmentZone.delayedTricks = [];
  }

  assignSkillToPlayer(state, qianxunOwner.id, STANDARD_SKILL_IDS.luxunQianxun);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "indulgence-target-check-1", kind: "indulgence", suit: "heart", point: 7 }];

  const actions = getLegalActions(state).filter(
    (action): action is PlayCardAction => action.type === "play-card" && action.cardId === "indulgence-target-check-1"
  );

  assert.equal(actions.some((action) => action.targetId === qianxunOwner.id), false);
  assert.equal(actions.some((action) => action.targetId === normalTarget.id), true);
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
 * 验证击杀反贼后，击杀者摸3张牌奖励。
 */
test("killer should draw three cards after killing a rebel", () => {
  const state = createInitialGame(42);
  const lord = state.players[0];
  const rebel = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = lord.id;
  state.phase = "play";
  lord.equipment.weapon = { id: "kill-reward-weapon-1", kind: "weapon_qinggang_sword", suit: "spade", point: 2 };
  lord.hand = [{ id: "kill-reward-slash-1", kind: "slash", suit: "spade", point: 9 }];
  rebel.hp = 1;
  rebel.hand = [];
  state.deck = [
    { id: "kill-reward-draw-1", kind: "dodge", suit: "heart", point: 6 },
    { id: "kill-reward-draw-2", kind: "slash", suit: "club", point: 3 },
    { id: "kill-reward-draw-3", kind: "peach", suit: "diamond", point: 12 },
    ...state.deck
  ];

  applyAction(state, {
    type: "play-card",
    actorId: lord.id,
    cardId: "kill-reward-slash-1",
    targetId: rebel.id
  });

  assert.equal(rebel.alive, false);
  assert.equal(lord.hand.length, 3);
  assert.ok(state.events.some((event) => event.message.includes("击杀反贼，摸 3 张牌")));
});

/**
 * 验证无懈策略切换为 seat-order 时，非延时锦囊可按座次由来源方优先打出无懈。
 */
test("seat-order nullify policy should allow source-first nullify on trick", () => {
  const state = createInitialGame(42, { nullifyResponsePolicy: "seat-order" });
  const actor = state.players[0];
  const target = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";

  actor.hand = [
    { id: "dismantle-seat-order-1", kind: "dismantle" },
    { id: "nullify-seat-order-src-1", kind: "nullify" }
  ];
  target.hand = [{ id: "target-seat-order-card-1", kind: "dodge" }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "dismantle-seat-order-1",
    targetId: target.id
  });

  assert.equal(target.hand.length, 1);
  assert.ok(state.discard.some((card) => card.id === "nullify-seat-order-src-1"));
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
 * 验证关羽【武圣】可将红色手牌当【杀】打出（决斗响应链）。
 */
test("wusheng skill should allow red card as slash in duel response", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.guanyuWusheng);

  state.currentPlayerId = actor.id;
  state.phase = "play";

  actor.hand = [{ id: "duel-ws-1", kind: "duel", suit: "spade", point: 1 }];
  target.hand = [{ id: "target-red-ws-1", kind: "dodge", suit: "heart", point: 6 }];

  const targetHpBefore = target.hp;
  const actorHpBefore = actor.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "duel-ws-1",
    targetId: target.id
  });

  assert.equal(target.hp, targetHpBefore);
  assert.equal(actor.hp, actorHpBefore - 1);
  assert.ok(state.discard.some((card) => card.id === "target-red-ws-1"));
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
 * 验证【万箭齐发】可被目标身份同阵营角色用【无懈可击】抵消。
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

test("queued nullify decisions should be consumed in order", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const target = state.players[1];
  const human = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = source.id;
  state.phase = "play";

  source.hand = [
    { id: "queue-nullify-dismantle", kind: "dismantle" },
    { id: "queue-nullify-source-1", kind: "nullify" }
  ];
  target.hand = [{ id: "queue-nullify-target-1", kind: "slash" }];
  human.hand = [
    { id: "queue-nullify-human-1", kind: "nullify" },
    { id: "queue-nullify-human-2", kind: "nullify" }
  ];

  queueResponseDecision(state, human.id, "nullify", true);
  queueResponseDecision(state, human.id, "nullify", false);

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "queue-nullify-dismantle",
    targetId: target.id
  });

  assert.ok(state.discard.some((card) => card.id === "queue-nullify-human-1"));
  assert.ok(state.discard.some((card) => card.id === "queue-nullify-source-1"));
  assert.equal(human.hand.some((card) => card.id === "queue-nullify-human-2"), true);
  assert.ok(state.discard.some((card) => card.id === "queue-nullify-target-1"));
});

test("queued nullify decisions should be cleared after action", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const target = state.players[1];
  const human = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = source.id;
  state.phase = "play";

  source.hand = [
    { id: "clear-queue-dismantle-1", kind: "dismantle" },
    { id: "clear-queue-dismantle-2", kind: "dismantle" },
    { id: "clear-queue-source-nullify-1", kind: "nullify" }
  ];
  target.hand = [
    { id: "clear-queue-target-card-1", kind: "slash" },
    { id: "clear-queue-target-card-2", kind: "dodge" }
  ];
  human.hand = [{ id: "clear-queue-human-nullify-1", kind: "nullify" }];

  queueResponseDecision(state, human.id, "nullify", true);

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "clear-queue-dismantle-1",
    targetId: target.id
  });

  assert.ok(state.discard.some((card) => card.id === "clear-queue-human-nullify-1"));
  assert.ok(state.discard.some((card) => card.id === "clear-queue-source-nullify-1"));
  assert.equal(state.responseDecisionQueueByPlayer[human.id]?.nullify?.length ?? 0, 0);

  source.hand.push({ id: "clear-queue-source-nullify-2", kind: "nullify" });
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "clear-queue-dismantle-2",
    targetId: target.id
  });

  assert.equal(
    state.discard.some((card) => card.id === "clear-queue-source-nullify-2"),
    false,
    "第二次行动不应受上次队列残留影响，来源方无懈应保留在手牌"
  );
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
 * 验证诸葛连弩不提高攻击范围（仅提供多次出杀能力）。
 */
test("crossbow should not extend slash attack range", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  actor.hand = [
    { id: "crossbow-range-1", kind: "weapon_crossbow" },
    { id: "slash-crossbow-range-1", kind: "slash" }
  ];

  stepPhase(state);
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "crossbow-range-1",
    targetId: actor.id
  });

  const slashTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "slash-crossbow-range-1")
    .map((action) => action.targetId)
    .sort();

  assert.deepEqual(slashTargets, ["P2", "P5"]);
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

  for (const player of state.players) {
    player.hand = [];
  }

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
 * 验证同一目标判定区已有【乐不思蜀】时，不能再次放置同名延时锦囊。
 */
test("indulgence should not be placeable when target already has indulgence", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "indulgence-dup-1", kind: "indulgence" }];
  target.judgmentZone.delayedTricks = [{ id: "indulgence-existing-1", kind: "indulgence" }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "indulgence-dup-1",
    targetId: target.id
  });

  assert.ok(actor.hand.some((card) => card.id === "indulgence-dup-1"));
  assert.equal(target.judgmentZone.delayedTricks.filter((card) => card.kind === "indulgence").length, 1);
});

/**
 * 验证自己判定区已有【闪电】时，不能再次放置同名延时锦囊。
 */
test("lightning should not be placeable when self already has lightning", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "lightning-dup-1", kind: "lightning" }];
  actor.judgmentZone.delayedTricks = [{ id: "lightning-existing-1", kind: "lightning" }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "lightning-dup-1",
    targetId: actor.id
  });

  assert.ok(actor.hand.some((card) => card.id === "lightning-dup-1"));
  assert.equal(actor.judgmentZone.delayedTricks.filter((card) => card.kind === "lightning").length, 1);
});

/**
 * 验证【乐不思蜀】与【闪电】可在同一角色判定区共存（不同名允许）。
 */
test("indulgence and lightning should coexist in judgment zone", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "indulgence-coexist-1", kind: "indulgence" },
    { id: "lightning-coexist-1", kind: "lightning" }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "indulgence-coexist-1",
    targetId: target.id
  });
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "lightning-coexist-1",
    targetId: actor.id
  });

  assert.equal(target.judgmentZone.delayedTricks.some((card) => card.kind === "indulgence"), true);
  assert.equal(actor.judgmentZone.delayedTricks.some((card) => card.kind === "lightning"), true);
});

/**
 * 验证【闪电】判定命中时造成 3 点无来源伤害。
 */
test("lightning should deal 3 damage on spade 2-9 judgment", () => {
  const state = createInitialGame(42);
  const target = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

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

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-2", kind: "lightning" }];
  state.deck = [{ id: "judge-heart-1", kind: "slash" }];

  stepPhase(state);

  assert.equal(target.judgmentZone.delayedTricks.length, 0);
  assert.equal(next.judgmentZone.delayedTricks.some((card) => card.kind === "lightning"), true);
});

/**
 * 验证闪电未命中传递时，会跳过判定区已有【闪电】的角色并传给下一个合法目标。
 */
test("lightning transfer should skip players who already have lightning", () => {
  const state = createInitialGame(42);
  const target = state.players[0];
  const p2 = state.players[1];
  const p3 = state.players[2];
  const p4 = state.players[3];

  for (const player of state.players) {
    player.hand = [];
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-skip-1", kind: "lightning" }];
  p2.judgmentZone.delayedTricks = [{ id: "lightning-existing-p2", kind: "lightning" }];
  p3.judgmentZone.delayedTricks = [{ id: "lightning-existing-p3", kind: "lightning" }];
  state.deck = [{ id: "judge-heart-skip-1", kind: "slash", suit: "heart", point: 1 }];

  stepPhase(state);

  assert.equal(target.judgmentZone.delayedTricks.length, 0);
  assert.equal(p2.judgmentZone.delayedTricks.length, 1);
  assert.equal(p3.judgmentZone.delayedTricks.length, 1);
  assert.equal(p4.judgmentZone.delayedTricks.some((card) => card.id === "lightning-skip-1"), true);
});

/**
 * 验证闪电未命中且其余存活角色判定区均已有闪电时，闪电留在当前角色判定区。
 */
test("lightning transfer should stay when all other players already have lightning", () => {
  const state = createInitialGame(42);
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-stay-1", kind: "lightning" }];
  state.players[1].judgmentZone.delayedTricks = [{ id: "lightning-existing-a", kind: "lightning" }];
  state.players[2].judgmentZone.delayedTricks = [{ id: "lightning-existing-b", kind: "lightning" }];
  state.players[3].judgmentZone.delayedTricks = [{ id: "lightning-existing-c", kind: "lightning" }];
  state.players[4].judgmentZone.delayedTricks = [{ id: "lightning-existing-d", kind: "lightning" }];
  state.deck = [{ id: "judge-heart-stay-1", kind: "slash", suit: "heart", point: 2 }];

  stepPhase(state);

  assert.equal(target.judgmentZone.delayedTricks.some((card) => card.id === "lightning-stay-1"), true);
});

/**
 * 验证同回合存在【乐不思蜀】与【闪电】时：先乐后电按顺序结算，且乐失败仍跳过出牌阶段。
 */
test("indulgence then lightning should both resolve and still skip play phase", () => {
  const state = createInitialGame(42);
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [
    { id: "indulgence-both-1", kind: "indulgence" },
    { id: "lightning-both-1", kind: "lightning" }
  ];
  state.deck = [
    { id: "judge-spade-both-ind-1", kind: "slash", suit: "spade", point: 7 },
    { id: "judge-spade-both-light-1", kind: "slash", suit: "spade", point: 4 },
    { id: "draw-buffer-both-1", kind: "dodge" },
    { id: "draw-buffer-both-2", kind: "peach" }
  ];

  const hpBefore = target.hp;
  stepPhase(state);
  assert.equal(target.hp, hpBefore - 3);

  stepPhase(state);
  assert.equal(state.phase, "discard");
  assert.ok(state.discard.some((card) => card.id === "indulgence-both-1"));
  assert.ok(state.discard.some((card) => card.id === "lightning-both-1"));
});

/**
 * 验证同回合存在【闪电】与【乐不思蜀】时：先电后乐也应独立结算，乐失败仍跳过出牌阶段。
 */
test("lightning then indulgence should both resolve and still skip play phase", () => {
  const state = createInitialGame(42);
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
    player.judgmentZone.delayedTricks = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [
    { id: "lightning-both-2", kind: "lightning" },
    { id: "indulgence-both-2", kind: "indulgence" }
  ];
  state.deck = [
    { id: "judge-spade-both-light-2", kind: "slash", suit: "spade", point: 4 },
    { id: "judge-spade-both-ind-2", kind: "slash", suit: "spade", point: 8 },
    { id: "draw-buffer-both-3", kind: "dodge" },
    { id: "draw-buffer-both-4", kind: "peach" }
  ];

  const hpBefore = target.hp;
  stepPhase(state);
  assert.equal(target.hp, hpBefore - 3);

  stepPhase(state);
  assert.equal(state.phase, "discard");
  assert.ok(state.discard.some((card) => card.id === "lightning-both-2"));
  assert.ok(state.discard.some((card) => card.id === "indulgence-both-2"));
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

/**
 * 验证无懈策略切换为 seat-order 时，延时锦囊可被座次靠前的敌方先手无懈抵消。
 */
test("seat-order nullify policy should allow enemy-first nullify on delayed trick", () => {
  const state = createInitialGame(42, { nullifyResponsePolicy: "seat-order" });
  const target = state.players[1];
  const enemy = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "indulgence-seat-order-1", kind: "indulgence" }];
  enemy.hand = [{ id: "nullify-seat-order-enemy-1", kind: "nullify" }];
  state.deck = [
    { id: "judge-spade-seat-order-1", kind: "slash", suit: "spade", point: 6 },
    { id: "draw-buffer-seat-order-1", kind: "dodge" },
    { id: "draw-buffer-seat-order-2", kind: "peach" }
  ];

  stepPhase(state);
  stepPhase(state);

  assert.equal(state.phase, "play");
  assert.ok(state.discard.some((card) => card.id === "nullify-seat-order-enemy-1"));
});

/**
 * 验证延时锦囊无懈链可被反制：乐不思蜀被“无懈→反无懈”后恢复生效。
 */
test("indulgence should apply when delayed nullify is countered", () => {
  const state = createInitialGame(42);
  const target = state.players[0];
  const ally = state.players[1];
  const enemy = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "indulgence-chain-1", kind: "indulgence" }];
  ally.hand = [{ id: "nullify-ind-chain-ally", kind: "nullify" }];
  enemy.hand = [{ id: "nullify-ind-chain-enemy", kind: "nullify" }];
  state.deck = [
    { id: "judge-spade-chain-ind-1", kind: "slash", suit: "spade", point: 4 },
    { id: "draw-buffer-chain-ind-1", kind: "dodge" },
    { id: "draw-buffer-chain-ind-2", kind: "peach" }
  ];

  stepPhase(state);
  stepPhase(state);

  assert.equal(state.phase, "discard");
  assert.ok(state.discard.some((card) => card.id === "nullify-ind-chain-ally"));
  assert.ok(state.discard.some((card) => card.id === "nullify-ind-chain-enemy"));
  assert.ok(state.discard.some((card) => card.id === "judge-spade-chain-ind-1"));
});

/**
 * 验证延时锦囊无懈链可被反制：闪电被“无懈→反无懈”后恢复判定并正常命中伤害。
 */
test("lightning should still hit when delayed nullify is countered", () => {
  const state = createInitialGame(42);
  const target = state.players[2];
  const ally = state.players[3];
  const enemy = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-chain-1", kind: "lightning" }];
  ally.hand = [{ id: "nullify-light-chain-ally", kind: "nullify" }];
  enemy.hand = [{ id: "nullify-light-chain-enemy", kind: "nullify" }];
  state.deck = [{ id: "judge-spade-chain-light-1", kind: "slash", suit: "spade", point: 4 }];

  const hpBefore = target.hp;
  stepPhase(state);

  assert.equal(target.hp, hpBefore - 3);
  assert.ok(state.discard.some((card) => card.id === "nullify-light-chain-ally"));
  assert.ok(state.discard.some((card) => card.id === "nullify-light-chain-enemy"));
  assert.ok(state.discard.some((card) => card.id === "judge-spade-chain-light-1"));
});

/**
 * 验证同回合多张延时锦囊按顺序独立结算：前者被无懈不影响后者判定生效。
 */
test("multiple delayed tricks should resolve in order with independent nullify state", () => {
  const state = createInitialGame(42);
  const target = state.players[0];
  const ally = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [
    { id: "indulgence-seq-1", kind: "indulgence" },
    { id: "lightning-seq-1", kind: "lightning" }
  ];
  ally.hand = [{ id: "nullify-seq-ind-1", kind: "nullify" }];
  state.deck = [
    { id: "judge-spade-seq-light-1", kind: "slash", suit: "spade", point: 5 },
    { id: "draw-buffer-seq-1", kind: "dodge" },
    { id: "draw-buffer-seq-2", kind: "peach" }
  ];

  const hpBefore = target.hp;
  stepPhase(state);
  assert.equal(target.hp, hpBefore - 3);

  stepPhase(state);
  assert.equal(state.phase, "play");
  assert.ok(state.discard.some((card) => card.id === "nullify-seq-ind-1"));
  assert.ok(state.discard.some((card) => card.id === "judge-spade-seq-light-1"));
});

/**
 * 验证同回合多张延时锦囊各自拥有独立无懈链：前一张可被反无懈，后一张仍可重新发起无懈抵消。
 */
test("multiple delayed tricks should each start a fresh nullify chain", () => {
  const state = createInitialGame(42);
  const target = state.players[0];
  const ally = state.players[1];
  const enemy = state.players[2];
  const next = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [
    { id: "indulgence-chain-seq-1", kind: "indulgence" },
    { id: "lightning-chain-seq-1", kind: "lightning" }
  ];
  ally.hand = [{ id: "nullify-chain-seq-ally-1", kind: "nullify" }];
  enemy.hand = [{ id: "nullify-chain-seq-enemy-1", kind: "nullify" }];
  state.deck = [
    { id: "judge-spade-chain-seq-ind-1", kind: "slash", suit: "spade", point: 4 },
    { id: "judge-heart-chain-seq-light-1", kind: "slash", suit: "heart", point: 5 },
    { id: "draw-buffer-chain-seq-1", kind: "dodge" },
    { id: "draw-buffer-chain-seq-2", kind: "peach" }
  ];

  const hpBefore = target.hp;
  stepPhase(state);

  assert.equal(target.hp, hpBefore);
  assert.ok(state.discard.some((card) => card.id === "nullify-chain-seq-ally-1"));
  assert.ok(state.discard.some((card) => card.id === "nullify-chain-seq-enemy-1"));
  assert.ok(state.discard.some((card) => card.id === "judge-spade-chain-seq-ind-1"));
  assert.ok(state.discard.some((card) => card.id === "judge-heart-chain-seq-light-1"));
  assert.equal(next.judgmentZone.delayedTricks.some((card) => card.kind === "lightning"), true);

  stepPhase(state);
  assert.equal(state.phase, "discard");
});

/**
 * 验证【桃园结义】会令所有存活角色各回复 1 点体力（不超过上限）。
 */
test("taoyuan should heal all alive players by 1 up to max hp", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  state.currentPlayerId = actor.id;
  state.phase = "play";

  actor.hand = [{ id: "taoyuan-1", kind: "taoyuan" }];
  state.players[0].hp = 3;
  state.players[1].hp = 2;
  state.players[2].hp = 4;
  state.players[3].hp = 1;
  state.players[4].hp = 2;

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "taoyuan-1"
  });

  assert.equal(state.players[0].hp, 4);
  assert.equal(state.players[1].hp, 3);
  assert.equal(state.players[2].hp, 4);
  assert.equal(state.players[3].hp, 2);
  assert.equal(state.players[4].hp, 3);
  assert.ok(state.discard.some((card) => card.id === "taoyuan-1"));
});

/**
 * 验证【五谷丰登】会亮出并按座次分配卡牌到所有存活角色手中。
 */
test("harvest should distribute one revealed card to each alive player", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "harvest-1", kind: "harvest" }];
  state.deck = [
    { id: "h-card-1", kind: "slash" },
    { id: "h-card-2", kind: "peach" },
    { id: "h-card-3", kind: "dodge" },
    { id: "h-card-4", kind: "duel" },
    { id: "h-card-5", kind: "nullify" }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "harvest-1"
  });

  const handCounts = state.players.map((player) => player.hand.length);
  assert.deepEqual(handCounts, [1, 1, 1, 1, 1]);
  assert.equal(state.deck.length, 0);
  assert.ok(state.discard.some((card) => card.id === "harvest-1"));
});

/**
 * 验证【借刀杀人】可强制持武器目标对指定角色打出【杀】。
 */
test("collateral should force weapon holder to slash designated target", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "wh-weapon", kind: "weapon_blade" };
  weaponHolder.hand = [{ id: "forced-slash", kind: "slash" }];
  slashTarget.hand = [];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore - 1);
  assert.equal(weaponHolder.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "forced-slash"));
  assert.ok(state.discard.some((card) => card.id === "collateral-1"));
});

/**
 * 验证【借刀杀人】在持刀者无法打出【杀】时，使用者获得其武器。
 */
test("collateral should transfer weapon when holder cannot slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-2", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "wh-weapon-2", kind: "weapon_blade" };
  weaponHolder.hand = [{ id: "not-slash", kind: "dodge" }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-2",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(weaponHolder.equipment.weapon, null);
  assert.ok(actor.hand.some((card) => card.id === "wh-weapon-2"));
  assert.ok(state.discard.some((card) => card.id === "collateral-2"));
});

/**
 * 验证借刀指定越界次目标时动作无效，手牌不应被消耗。
 */
test("collateral should remain in hand when secondary target is out of holder range", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[2];
  const slashTarget = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-invalid-range-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-crossbow-invalid-1", kind: "weapon_crossbow", suit: "club", point: 1 };

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-invalid-range-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.ok(actor.hand.some((card) => card.id === "collateral-invalid-range-1"));
  assert.equal(state.discard.some((card) => card.id === "collateral-invalid-range-1"), false);
});

/**
 * 验证借刀强制杀在方天画戟下仅结算指定次目标，不会自动追加额外目标。
 */
test("collateral forced slash with halberd should only affect designated target", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];
  const otherA = state.players[3];
  const otherB = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-halberd-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-halberd-weapon-1", kind: "weapon_halberd", suit: "diamond", point: 12 };
  weaponHolder.hand = [{ id: "holder-halberd-slash-1", kind: "slash", suit: "spade", point: 8 }];

  const hpTargetBefore = slashTarget.hp;
  const hpOtherABefore = otherA.hp;
  const hpOtherBBefore = otherB.hp;

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-halberd-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpTargetBefore - 1);
  assert.equal(otherA.hp, hpOtherABefore);
  assert.equal(otherB.hp, hpOtherBBefore);
});

/**
 * 验证【五谷丰登】可按目标被【无懈可击】抵消。
 */
test("harvest should be nullifiable per target", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[0];
  const protector = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "harvest-nullify-1", kind: "harvest" }];
  protector.hand = [{ id: "harvest-nullify-rsp", kind: "nullify" }];
  state.deck = [
    { id: "hv-1", kind: "slash" },
    { id: "hv-2", kind: "dodge" },
    { id: "hv-3", kind: "peach" },
    { id: "hv-4", kind: "duel" },
    { id: "hv-5", kind: "snatch" }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "harvest-nullify-1"
  });

  assert.equal(target.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "harvest-nullify-rsp"));
});

/**
 * 验证【借刀杀人】可被【无懈可击】抵消。
 */
test("collateral should be canceled by nullify", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const weaponHolder = state.players[0];
  const protector = state.players[1];
  const slashTarget = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-nullify-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-weapon-1", kind: "weapon_blade" };
  weaponHolder.hand = [{ id: "holder-slash-1", kind: "slash" }];
  protector.hand = [{ id: "holder-nullify-1", kind: "nullify" }];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-nullify-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore);
  assert.equal(weaponHolder.hand.length, 1);
  assert.ok(state.discard.some((card) => card.id === "holder-nullify-1"));
  assert.ok(state.discard.some((card) => card.id === "collateral-nullify-1"));
});

/**
 * 验证【借刀杀人】强制出的【杀】可被目标用【闪】响应。
 */
test("forced slash from collateral should be dodgeable", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-dodge-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-weapon-2", kind: "weapon_blade" };
  weaponHolder.hand = [{ id: "holder-slash-2", kind: "slash" }];
  slashTarget.hand = [{ id: "target-dodge-2", kind: "dodge" }];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-dodge-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore);
  assert.ok(state.discard.some((card) => card.id === "holder-slash-2"));
  assert.ok(state.discard.some((card) => card.id === "target-dodge-2"));
});

/**
 * 验证借刀强制出的【杀】在青釭剑下会无视八卦阵，不触发判定闪避。
 */
test("collateral forced slash with qinggang should bypass eight diagram", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-qinggang-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = {
    id: "holder-qinggang-weapon-1",
    kind: "weapon_qinggang_sword",
    suit: "spade",
    point: 6
  };
  weaponHolder.hand = [{ id: "holder-qinggang-slash-1", kind: "slash", suit: "spade", point: 9 }];
  slashTarget.equipment.armor = { id: "target-eight-qinggang-1", kind: "armor_eight_diagram", suit: "spade", point: 2 };
  state.deck = [{ id: "judge-red-collateral-qg-1", kind: "peach", suit: "heart", point: 7 }];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-qinggang-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore - 1);
  assert.equal(state.discard.some((card) => card.id === "judge-red-collateral-qg-1"), false);
});

/**
 * 验证借刀强制出的【杀】在非青釭武器下，八卦阵会正常判定并可闪避。
 */
test("collateral forced slash without qinggang should allow eight diagram judgment", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-normal-8d-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-blade-8d-1", kind: "weapon_blade", suit: "spade", point: 5 };
  weaponHolder.hand = [{ id: "holder-blade-slash-8d-1", kind: "slash", suit: "spade", point: 9 }];
  slashTarget.equipment.armor = { id: "target-eight-normal-1", kind: "armor_eight_diagram", suit: "club", point: 2 };
  state.deck = [{ id: "judge-red-collateral-normal-1", kind: "peach", suit: "heart", point: 7 }];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-normal-8d-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore);
  assert.ok(state.discard.some((card) => card.id === "judge-red-collateral-normal-1"));
});

/**
 * 验证借刀强制出的黑色【杀】会被仁王盾无效化。
 */
test("collateral forced black slash should be nullified by renwang shield", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-rw-black-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-rw-black-weapon-1", kind: "weapon_blade", suit: "spade", point: 5 };
  weaponHolder.hand = [{ id: "holder-rw-black-slash-1", kind: "slash", suit: "spade", point: 9 }];
  slashTarget.equipment.armor = { id: "target-rw-black-armor-1", kind: "armor_renwang_shield", suit: "club", point: 2 };

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-rw-black-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore);
  assert.ok(state.discard.some((card) => card.id === "holder-rw-black-slash-1"));
});

/**
 * 验证借刀强制出的红色【杀】不会被仁王盾抵消。
 */
test("collateral forced red slash should bypass renwang shield restriction", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-rw-red-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-rw-red-weapon-1", kind: "weapon_blade", suit: "spade", point: 5 };
  weaponHolder.hand = [{ id: "holder-rw-red-slash-1", kind: "slash", suit: "heart", point: 10 }];
  slashTarget.equipment.armor = { id: "target-rw-red-armor-1", kind: "armor_renwang_shield", suit: "club", point: 2 };

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-rw-red-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore - 1);
  assert.ok(state.discard.some((card) => card.id === "holder-rw-red-slash-1"));
});

/**
 * 验证借刀强制出杀时，持刀者可用丈八蛇矛将两张手牌转化为【杀】。
 */
test("collateral should allow spear virtual slash with two hand cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-spear-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-spear-weapon-1", kind: "weapon_spear", suit: "spade", point: 12 };
  weaponHolder.hand = [
    { id: "holder-spear-sub-a", kind: "dodge", suit: "diamond", point: 4 },
    { id: "holder-spear-sub-b", kind: "peach", suit: "heart", point: 5 }
  ];
  slashTarget.hand = [];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-spear-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore - 1);
  assert.equal(weaponHolder.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "holder-spear-sub-a"));
  assert.ok(state.discard.some((card) => card.id === "holder-spear-sub-b"));
});

/**
 * 验证借刀强制出杀时，丈八蛇矛优先使用实体【杀】而非两牌转化。
 */
test("collateral should prefer real slash over spear conversion", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-spear-priority-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-spear-priority-weapon", kind: "weapon_spear", suit: "spade", point: 12 };
  weaponHolder.hand = [
    { id: "holder-spear-priority-slash", kind: "slash", suit: "spade", point: 9 },
    { id: "holder-spear-priority-a", kind: "dodge", suit: "diamond", point: 4 },
    { id: "holder-spear-priority-b", kind: "peach", suit: "heart", point: 5 }
  ];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-spear-priority-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore - 1);
  assert.equal(weaponHolder.hand.length, 2);
  assert.ok(weaponHolder.hand.some((card) => card.id === "holder-spear-priority-a"));
  assert.ok(weaponHolder.hand.some((card) => card.id === "holder-spear-priority-b"));
});

/**
 * 验证借刀强制出杀时，丈八蛇矛手牌不足两张则不能转化，武器被获得。
 */
test("collateral should transfer spear when holder has less than two cards and no slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-spear-2", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-spear-weapon-2", kind: "weapon_spear", suit: "spade", point: 12 };
  weaponHolder.hand = [{ id: "holder-only-one-card", kind: "dodge", suit: "diamond", point: 7 }];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-spear-2",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore);
  assert.equal(weaponHolder.equipment.weapon, null);
  assert.ok(actor.hand.some((card) => card.id === "holder-spear-weapon-2"));
  assert.equal(weaponHolder.hand.length, 1);
});

/**
 * 验证借刀强制出的【杀】在青龙偃月刀下可被【闪】后继续追击。
 */
test("collateral forced slash should trigger blade follow-up on dodge", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-blade-chain-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-blade-chain-weapon", kind: "weapon_blade", suit: "spade", point: 5 };
  weaponHolder.hand = [
    { id: "holder-blade-chain-slash-1", kind: "slash", suit: "club", point: 9 },
    { id: "holder-blade-chain-slash-2", kind: "slash", suit: "spade", point: 10 }
  ];
  slashTarget.hand = [{ id: "target-blade-chain-dodge-1", kind: "dodge", suit: "diamond", point: 6 }];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-blade-chain-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore - 1);
  assert.equal(weaponHolder.hand.length, 0);
  assert.equal(state.discard.filter((card) => card.id.startsWith("holder-blade-chain-slash-")).length, 2);
  assert.ok(state.discard.some((card) => card.id === "target-blade-chain-dodge-1"));
});

/**
 * 验证借刀强制出的【杀】在被【闪】后，若无后续【杀】则青龙追击链终止。
 */
test("collateral blade follow-up should stop when holder has no extra slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-blade-stop-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-blade-stop-weapon", kind: "weapon_blade", suit: "spade", point: 5 };
  weaponHolder.hand = [{ id: "holder-blade-stop-slash-1", kind: "slash", suit: "club", point: 9 }];
  slashTarget.hand = [{ id: "target-blade-stop-dodge-1", kind: "dodge", suit: "diamond", point: 6 }];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-blade-stop-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore);
  assert.equal(weaponHolder.hand.length, 0);
  assert.equal(state.discard.filter((card) => card.id.startsWith("holder-blade-stop-slash-")).length, 1);
  assert.ok(state.discard.some((card) => card.id === "target-blade-stop-dodge-1"));
});

/**
 * 验证借刀强制出的【杀】在贯石斧下可弃两牌强制命中。
 */
test("collateral forced slash should trigger axe forced hit after dodge", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-axe-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-axe-weapon-1", kind: "weapon_axe", suit: "diamond", point: 5 };
  weaponHolder.hand = [
    { id: "holder-axe-slash-1", kind: "slash", suit: "spade", point: 9 },
    { id: "holder-axe-discard-a", kind: "dodge", suit: "diamond", point: 2 },
    { id: "holder-axe-discard-b", kind: "peach", suit: "heart", point: 3 }
  ];
  slashTarget.hand = [{ id: "target-axe-dodge-1", kind: "dodge", suit: "diamond", point: 6 }];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-axe-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore - 1);
  assert.equal(weaponHolder.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "holder-axe-discard-a"));
  assert.ok(state.discard.some((card) => card.id === "holder-axe-discard-b"));
});

/**
 * 验证借刀强制出的【杀】在寒冰剑下可防止伤害并弃置目标两张牌。
 */
test("collateral forced slash should trigger ice sword prevent-damage effect", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-ice-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-ice-weapon-1", kind: "weapon_ice_sword", suit: "spade", point: 2 };
  weaponHolder.hand = [{ id: "holder-ice-slash-1", kind: "slash", suit: "spade", point: 9 }];
  slashTarget.hand = [
    { id: "target-ice-card-a", kind: "peach", suit: "heart", point: 7 },
    { id: "target-ice-card-b", kind: "snatch", suit: "heart", point: 8 }
  ];

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-ice-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore);
  assert.equal(slashTarget.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "target-ice-card-a"));
  assert.ok(state.discard.some((card) => card.id === "target-ice-card-b"));
});

/**
 * 验证借刀强制出的【杀】造成伤害后可触发麒麟弓弃马。
 */
test("collateral forced slash should trigger kylin bow horse discard", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const weaponHolder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "collateral-kylin-1", kind: "collateral" }];
  weaponHolder.equipment.weapon = { id: "holder-kylin-weapon-1", kind: "weapon_kylin_bow", suit: "heart", point: 5 };
  weaponHolder.hand = [{ id: "holder-kylin-slash-1", kind: "slash", suit: "spade", point: 9 }];
  slashTarget.equipment.horsePlus = { id: "target-kylin-horse-1", kind: "horse_jueying", suit: "spade", point: 5 };

  const hpBefore = slashTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "collateral-kylin-1",
    targetId: weaponHolder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(slashTarget.hp, hpBefore - 1);
  assert.equal(slashTarget.equipment.horsePlus, null);
  assert.ok(state.discard.some((card) => card.id === "target-kylin-horse-1"));
});

/**
 * 验证【无中生有】只能对自己生效并摸 2 张牌。
 */
test("ex nihilo should only target self and draw 2 cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ex-nihilo-1", kind: "ex_nihilo" }];
  state.deck = [
    { id: "draw-a", kind: "slash" },
    { id: "draw-b", kind: "dodge" }
  ];

  const legalActions = getLegalActions(state).filter(
    (
      action
    ): action is {
      type: "play-card";
      actorId: string;
      cardId: string;
      targetId?: string;
      secondaryTargetId?: string;
    } =>
      action.type === "play-card" && action.cardId === "ex-nihilo-1"
  );
  assert.equal(legalActions.length, 1);
  assert.equal(legalActions[0]?.targetId, actor.id);

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "ex-nihilo-1",
    targetId: actor.id
  });

  assert.equal(actor.hand.length, 2);
  assert.ok(state.discard.some((card) => card.id === "ex-nihilo-1"));
});

/**
 * 验证【无中生有】可被【无懈可击】抵消。
 */
test("ex nihilo should be canceled by nullify", () => {
  const state = createInitialGame(42, { nullifyResponsePolicy: "seat-order" });
  const actor = state.players[2];
  const protector = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ex-nihilo-2", kind: "ex_nihilo" }];
  protector.hand = [{ id: "nullify-ex-1", kind: "nullify" }];
  state.deck = [
    { id: "draw-c", kind: "slash" },
    { id: "draw-d", kind: "dodge" }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "ex-nihilo-2",
    targetId: actor.id
  });

  assert.equal(actor.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "nullify-ex-1"));
});

/**
 * 验证诸葛连弩可令【杀】在出牌阶段不受次数上限限制。
 */
test("crossbow should allow multiple slashes in one play phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  actor.hand = [
    { id: "slash-cb-1", kind: "slash", suit: "spade", point: 7 },
    { id: "slash-cb-2", kind: "slash", suit: "club", point: 8 }
  ];
  target.hand = [];
  actor.equipment.weapon = { id: "crossbow-eq", kind: "weapon_crossbow", suit: "club", point: 1 };

  stepPhase(state);
  const firstSlash = getLegalActions(state).find(
    (action) => action.type === "play-card" && action.cardId === "slash-cb-1" && action.targetId === target.id
  );
  assert.ok(firstSlash);
  applyAction(state, firstSlash);

  const secondSlashStillLegal = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.cardId === "slash-cb-2" && action.targetId === target.id
  );
  assert.equal(secondSlashStillLegal, true);
});

/**
 * 验证张飞【咆哮】（锁定技）可令【杀】在出牌阶段不受次数上限限制。
 */
test("paoxiao skill should allow multiple slashes in one play phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.zhangfeiPaoxiao);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "slash-px-1", kind: "slash", suit: "spade", point: 7 },
    { id: "slash-px-2", kind: "slash", suit: "club", point: 8 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-px-1",
    targetId: target.id
  });

  const secondSlashStillLegal = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.cardId === "slash-px-2" && action.targetId === target.id
  );
  assert.equal(secondSlashStillLegal, true);
});

/**
 * 验证关羽【武圣】可在出牌阶段将红色手牌当【杀】使用。
 */
test("wusheng skill should allow red card as slash in play phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.guanyuWusheng);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "wusheng-red-play-1", kind: "dodge", suit: "heart", point: 9 }];

  const virtualSlashAction = getLegalActions(state).find(
    (action) => action.type === "play-card" && action.cardId === "__virtual_wusheng_slash__::wusheng-red-play-1"
  );
  assert.ok(virtualSlashAction);

  const target = state.players.find((player) => player.id === (virtualSlashAction.type === "play-card" ? virtualSlashAction.targetId : ""));
  assert.ok(target);
  const hpBefore = target.hp;
  applyAction(state, virtualSlashAction);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(actor.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "wusheng-red-play-1"));
});

/**
 * 验证郭嘉【遗计】在受到伤害后摸 2 张牌。
 */
test("yiji skill should draw 2 cards after taking damage", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.guojiaYiji);
  target.isAi = false;

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-yiji-1", kind: "slash", suit: "spade", point: 8 }];
  state.deck = [
    { id: "yiji-draw-1", kind: "dodge", suit: "heart", point: 2 },
    { id: "yiji-draw-2", kind: "peach", suit: "diamond", point: 7 }
  ];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-yiji-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
  assert.ok(target.hand.some((card) => card.id === "yiji-draw-1"));
  assert.ok(target.hand.some((card) => card.id === "yiji-draw-2"));
});

/**
 * 验证 AI 郭嘉【遗计】会将本次摸到的牌分配给身份同阵营角色。
 */
test("yiji skill should distribute drawn cards to identity-camp ally for ai owner", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[1];
  const ally = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.guojiaYiji);
  target.isAi = true;

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-yiji-ai-1", kind: "slash", suit: "spade", point: 8 }];
  state.deck = [
    { id: "yiji-ai-draw-1", kind: "dodge", suit: "heart", point: 2 },
    { id: "yiji-ai-draw-2", kind: "peach", suit: "diamond", point: 7 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-yiji-ai-1",
    targetId: target.id
  });

  assert.equal(target.hand.length, 0);
  assert.ok(ally.hand.some((card) => card.id === "yiji-ai-draw-1"));
  assert.ok(ally.hand.some((card) => card.id === "yiji-ai-draw-2"));
});

/**
 * 验证诸葛亮【空城】在空手时不能成为【杀】或【决斗】目标。
 */
test("kongcheng skill should prevent empty-hand target from slash and duel targeting", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const kongchengTarget = state.players[1];

  assignSkillToPlayer(state, kongchengTarget.id, STANDARD_SKILL_IDS.zhugeliangKongcheng);

  actor.hand = [
    { id: "slash-kc-1", kind: "slash", suit: "spade", point: 7 },
    { id: "duel-kc-1", kind: "duel", suit: "club", point: 9 }
  ];
  kongchengTarget.hand = [];

  stepPhase(state);

  const slashTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "slash-kc-1")
    .map((action) => action.targetId);
  const duelTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "duel-kc-1")
    .map((action) => action.targetId);

  assert.equal(slashTargets.includes(kongchengTarget.id), false);
  assert.equal(duelTargets.includes(kongchengTarget.id), false);
});

/**
 * 验证【空城】在空手时，强行提交的【决斗】动作会被规则兜底拒绝且手牌退回。
 */
test("kongcheng skill should reject forced duel action against empty-hand target", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const kongchengTarget = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, kongchengTarget.id, STANDARD_SKILL_IDS.zhugeliangKongcheng);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "duel-kc-forced-1", kind: "duel", suit: "spade", point: 1 }];
  kongchengTarget.hand = [];

  const hpBefore = kongchengTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "duel-kc-forced-1",
    targetId: kongchengTarget.id
  });

  assert.equal(kongchengTarget.hp, hpBefore);
  assert.ok(actor.hand.some((card) => card.id === "duel-kc-forced-1"));
  assert.equal(state.discard.some((card) => card.id === "duel-kc-forced-1"), false);
});

/**
 * 验证吕布【无双】：其【杀】需要目标连续打出两张【闪】才能抵消。
 */
test("wushuang skill should require two dodges against slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.lvbuWushuang);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-ws-1", kind: "slash", suit: "spade", point: 9 }];
  target.hand = [{ id: "dodge-ws-only-1", kind: "dodge", suit: "heart", point: 2 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-ws-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
  assert.equal(target.hand.length, 0);
});

/**
 * 验证吕布【无双】：当吕布发起【决斗】时，对方每轮需连续打出两张【杀】。
 */
test("wushuang skill should require two slashes from opponent in duel", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.lvbuWushuang);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "duel-ws-1", kind: "duel", suit: "club", point: 1 }];
  target.hand = [{ id: "target-slash-ws-only-1", kind: "slash", suit: "spade", point: 7 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "duel-ws-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
});

/**
 * 验证赵云【龙胆】可在出牌阶段将【闪】当【杀】使用。
 */
test("longdan skill should allow dodge as slash in play phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.zhaoyunLongdan);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "longdan-dodge-play-1", kind: "dodge", suit: "heart", point: 9 }];

  const virtualSlashAction = getLegalActions(state).find(
    (action) => action.type === "play-card" && action.cardId === "__virtual_longdan_slash__::longdan-dodge-play-1"
  );
  assert.ok(virtualSlashAction);

  const target = state.players.find((player) => player.id === (virtualSlashAction.type === "play-card" ? virtualSlashAction.targetId : ""));
  assert.ok(target);
  const hpBefore = target.hp;
  applyAction(state, virtualSlashAction);

  assert.equal(target.hp, hpBefore - 1);
  assert.equal(actor.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "longdan-dodge-play-1"));
});

/**
 * 验证赵云【龙胆】可在响应【杀】时将【杀】当【闪】打出。
 */
test("longdan skill should allow slash as dodge response to slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.zhaoyunLongdan);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-longdan-attack-1", kind: "slash", suit: "spade", point: 10 }];
  target.hand = [{ id: "slash-longdan-dodge-1", kind: "slash", suit: "club", point: 8 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-longdan-attack-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore);
  assert.equal(target.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "slash-longdan-dodge-1"));
});

/**
 * 验证马超【铁骑】判定为红色时，目标不能使用【闪】响应【杀】。
 */
test("tieqi skill should prevent dodge when judgment is red", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.machaoTieqi);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-tieqi-1", kind: "slash", suit: "spade", point: 9 }];
  target.hand = [{ id: "dodge-tieqi-1", kind: "dodge", suit: "heart", point: 2 }];
  state.deck = [{ id: "tieqi-judge-red-1", kind: "peach", suit: "heart", point: 7 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-tieqi-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
  assert.equal(target.hand.length, 1);
});

/**
 * 验证马超【铁骑】判定为黑色时，目标仍可正常使用【闪】响应【杀】。
 */
test("tieqi skill should still allow dodge when judgment is black", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.machaoTieqi);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-tieqi-2", kind: "slash", suit: "spade", point: 10 }];
  target.hand = [{ id: "dodge-tieqi-2", kind: "dodge", suit: "heart", point: 3 }];
  state.deck = [{ id: "tieqi-judge-black-1", kind: "slash", suit: "club", point: 6 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-tieqi-2",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore);
  assert.equal(target.hand.length, 0);
});

/**
 * 验证黄月英【集智】在使用非延时锦囊后可摸 1 张牌。
 */
test("jizhi skill should draw 1 card after using non-delayed trick", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.huangyueyingJizhi);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ex-nihilo-jizhi-1", kind: "ex_nihilo", suit: "heart", point: 4 }];
  state.deck = [
    { id: "jizhi-draw-1", kind: "dodge", suit: "diamond", point: 8 },
    { id: "ex-nihilo-draw-1", kind: "slash", suit: "spade", point: 11 },
    { id: "ex-nihilo-draw-2", kind: "peach", suit: "heart", point: 12 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "ex-nihilo-jizhi-1",
    targetId: actor.id
  });

  assert.equal(actor.hand.length, 3);
  assert.ok(actor.hand.some((card) => card.id === "jizhi-draw-1"));
  assert.ok(actor.hand.some((card) => card.id === "ex-nihilo-draw-1"));
  assert.ok(actor.hand.some((card) => card.id === "ex-nihilo-draw-2"));
});

/**
 * 验证黄月英【集智】不会在使用延时锦囊时触发。
 */
test("jizhi skill should not trigger on delayed trick", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.huangyueyingJizhi);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "indulgence-jizhi-1", kind: "indulgence", suit: "club", point: 5 }];
  state.deck = [{ id: "jizhi-should-not-draw-1", kind: "slash", suit: "spade", point: 13 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "indulgence-jizhi-1",
    targetId: target.id
  });

  assert.equal(actor.hand.length, 0);
  assert.equal(state.deck.some((card) => card.id === "jizhi-should-not-draw-1"), true);
});

/**
 * 验证司马懿【反馈】在受到有来源伤害后可获得伤害来源的一张牌。
 */
test("fankui skill should gain one card from damage source", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.simayiFankui);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [
    { id: "slash-fankui-src-1", kind: "slash", suit: "spade", point: 10 },
    { id: "fankui-src-card-1", kind: "dodge", suit: "heart", point: 4 }
  ];
  target.hand = [];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "slash-fankui-src-1",
    targetId: target.id
  });

  assert.ok(target.hand.some((card) => card.id === "fankui-src-card-1"));
  assert.equal(source.hand.some((card) => card.id === "fankui-src-card-1"), false);
});

/**
 * 验证司马懿【反馈】不会对无来源伤害（如闪电）触发。
 */
test("fankui skill should not trigger on source-less damage", () => {
  const state = createInitialGame(42);
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.simayiFankui);

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-fankui-1", kind: "lightning", suit: "spade", point: 1 }];
  state.deck = [{ id: "lightning-hit-fankui-1", kind: "slash", suit: "spade", point: 5 }];

  stepPhase(state);

  assert.equal(target.hand.length, 0);
});

/**
 * 验证司马懿【鬼才】可替换判定牌，使【乐不思蜀】判定由失败变成功。
 */
test("guicai skill should replace judgment card for indulgence", () => {
  const state = createInitialGame(42);
  const judged = state.players[1];
  const guicaiOwner = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, guicaiOwner.id, STANDARD_SKILL_IDS.simayiGuicai);

  state.currentPlayerId = judged.id;
  state.phase = "judge";
  judged.judgmentZone.delayedTricks = [{ id: "indulgence-guicai-1", kind: "indulgence", suit: "spade", point: 3 }];
  guicaiOwner.hand = [{ id: "guicai-heart-1", kind: "peach", suit: "heart", point: 9 }];
  state.deck = [{ id: "judge-black-before-guicai-1", kind: "slash", suit: "club", point: 6 }];

  stepPhase(state);

  assert.equal(state.skipPlayPhaseForCurrentTurn, false);
  assert.equal(guicaiOwner.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "guicai-heart-1"));
});

/**
 * 验证司马懿【鬼才】无手牌时无法替换判定。
 */
test("guicai skill should not replace judgment without hand cards", () => {
  const state = createInitialGame(42);
  const judged = state.players[1];
  const guicaiOwner = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, guicaiOwner.id, STANDARD_SKILL_IDS.simayiGuicai);

  state.currentPlayerId = judged.id;
  state.phase = "judge";
  judged.judgmentZone.delayedTricks = [{ id: "indulgence-guicai-2", kind: "indulgence", suit: "spade", point: 7 }];
  state.deck = [{ id: "judge-black-no-guicai-1", kind: "slash", suit: "club", point: 2 }];

  stepPhase(state);

  assert.equal(state.skipPlayPhaseForCurrentTurn, true);
});

/**
 * 验证郭嘉【天妒】可在判定后获得生效判定牌。
 */
test("tiandu skill should gain judgment card", () => {
  const state = createInitialGame(42);
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.guojiaTiandu);

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-tiandu-1", kind: "lightning", suit: "spade", point: 1 }];
  state.deck = [{ id: "judge-tiandu-1", kind: "slash", suit: "club", point: 10 }];

  stepPhase(state);

  assert.ok(target.hand.some((card) => card.id === "judge-tiandu-1"));
  assert.equal(state.discard.some((card) => card.id === "judge-tiandu-1"), false);
});

/**
 * 验证无【天妒】时判定牌仍进入弃牌堆。
 */
test("judgment card should go to discard without tiandu", () => {
  const state = createInitialGame(42);
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = target.id;
  state.phase = "judge";
  target.judgmentZone.delayedTricks = [{ id: "lightning-no-tiandu-1", kind: "lightning", suit: "spade", point: 1 }];
  state.deck = [{ id: "judge-no-tiandu-1", kind: "slash", suit: "club", point: 11 }];

  stepPhase(state);

  assert.equal(target.hand.some((card) => card.id === "judge-no-tiandu-1"), false);
  assert.ok(state.discard.some((card) => card.id === "judge-no-tiandu-1"));
});

/**
 * 验证夏侯惇【刚烈】非红桃判定时可令伤害来源弃两张手牌。
 */
test("ganglie skill should force source to discard two cards on non-heart judgment", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const owner = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, owner.id, STANDARD_SKILL_IDS.xiahoudunGanglie);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [
    { id: "slash-ganglie-1", kind: "slash", suit: "spade", point: 8 },
    { id: "src-discard-ganglie-1", kind: "dodge", suit: "club", point: 6 },
    { id: "src-discard-ganglie-2", kind: "peach", suit: "diamond", point: 12 }
  ];
  state.deck = [{ id: "ganglie-judge-black-1", kind: "slash", suit: "club", point: 4 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "slash-ganglie-1",
    targetId: owner.id
  });

  assert.equal(source.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "src-discard-ganglie-1"));
  assert.ok(state.discard.some((card) => card.id === "src-discard-ganglie-2"));
});

/**
 * 验证夏侯惇【刚烈】非红桃判定且来源手牌不足两张时，对来源造成1点伤害。
 */
test("ganglie skill should deal damage when source has less than two cards", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const owner = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, owner.id, STANDARD_SKILL_IDS.xiahoudunGanglie);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [
    { id: "slash-ganglie-2", kind: "slash", suit: "spade", point: 9 },
    { id: "src-only-one-card-1", kind: "dodge", suit: "heart", point: 2 }
  ];
  state.deck = [{ id: "ganglie-judge-black-2", kind: "slash", suit: "club", point: 7 }];

  const hpBefore = source.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "slash-ganglie-2",
    targetId: owner.id
  });

  assert.equal(source.hp, hpBefore - 1);
});

/**
 * 验证八卦阵判定为红色时可视为打出【闪】抵消【杀】。
 */
test("eight diagram should auto-dodge slash on red judgment", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-ed-1", kind: "slash", suit: "spade", point: 9 }];
  target.equipment.armor = { id: "eight-diagram-1", kind: "armor_eight_diagram", suit: "spade", point: 2 };
  state.deck = [{ id: "judge-red-1", kind: "peach", suit: "heart", point: 6 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-ed-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore);
});

/**
 * 验证仁王盾会令黑色【杀】无效。
 */
test("renwang shield should nullify black slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-rw-1", kind: "slash", suit: "club", point: 9 }];
  target.equipment.armor = { id: "renwang-1", kind: "armor_renwang_shield", suit: "club", point: 2 };

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-rw-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore);
});

/**
 * 验证青釭剑可无视防具，使黑色【杀】仍可对仁王盾目标造成伤害。
 */
test("qinggang sword should ignore renwang shield", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-qg-1", kind: "slash", suit: "club", point: 10 }];
  actor.equipment.weapon = { id: "qinggang-1", kind: "weapon_qinggang_sword", suit: "spade", point: 6 };
  target.equipment.armor = { id: "renwang-2", kind: "armor_renwang_shield", suit: "club", point: 2 };

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-qg-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
});

/**
 * 验证贯石斧可在【杀】被【闪】抵消后弃置两张手牌令其仍生效。
 */
test("axe should force slash to hit after dodge by discarding two cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "axe-1", kind: "weapon_axe", suit: "diamond", point: 5 };
  actor.hand = [
    { id: "slash-axe-1", kind: "slash", suit: "spade", point: 9 },
    { id: "axe-cost-a", kind: "dodge", suit: "heart", point: 2 },
    { id: "axe-cost-b", kind: "peach", suit: "heart", point: 3 }
  ];
  target.hand = [{ id: "target-dodge-axe", kind: "dodge", suit: "diamond", point: 7 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-axe-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
  assert.equal(actor.hand.length, 0);
});

/**
 * 验证麒麟弓在【杀】造成伤害后可弃置目标坐骑。
 */
test("kylin bow should discard target horse after slash damage", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "kylin-1", kind: "weapon_kylin_bow", suit: "heart", point: 5 };
  actor.hand = [{ id: "slash-kylin-1", kind: "slash", suit: "spade", point: 8 }];
  target.equipment.horsePlus = { id: "target-horse-plus", kind: "horse_jueying", suit: "spade", point: 5 };

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-kylin-1",
    targetId: target.id
  });

  assert.equal(target.equipment.horsePlus, null);
  assert.ok(state.discard.some((card) => card.id === "target-horse-plus"));
});

/**
 * 验证丈八蛇矛可将两张手牌当【杀】在出牌阶段使用。
 */
test("spear should allow virtual slash from two hand cards in play phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "spear-1", kind: "weapon_spear", suit: "spade", point: 12 };
  actor.hand = [
    { id: "spear-sub-a", kind: "dodge", suit: "diamond", point: 2 },
    { id: "spear-sub-b", kind: "peach", suit: "heart", point: 3 }
  ];

  const virtualSlashAction = getLegalActions(state).find(
    (action) => action.type === "play-card" && action.cardId === "__virtual_spear_slash__" && action.targetId === target.id
  );
  assert.ok(virtualSlashAction);

  const hpBefore = target.hp;
  applyAction(state, virtualSlashAction);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(actor.hand.length, 0);
});

/**
 * 验证丈八蛇矛可在南蛮响应中将两张手牌当【杀】打出。
 */
test("spear should allow virtual slash response for barbarian", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "barbarian-spear-1", kind: "barbarian", suit: "spade", point: 7 }];
  target.equipment.weapon = { id: "spear-2", kind: "weapon_spear", suit: "spade", point: 12 };
  target.hand = [
    { id: "rsp-a", kind: "dodge", suit: "diamond", point: 4 },
    { id: "rsp-b", kind: "peach", suit: "heart", point: 5 }
  ];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "barbarian-spear-1"
  });

  assert.equal(target.hp, hpBefore);
  assert.equal(target.hand.length, 0);
});

/**
 * 验证方天画戟在“最后手牌为杀”时可追加最多两名额外目标（MVP 自动择优）。
 */
test("halberd should add up to two extra slash targets when slash is last hand card", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const primary = state.players[1];
  const extraA = state.players[2];
  const extraB = state.players[3];
  const untouched = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "halberd-1", kind: "weapon_halberd", suit: "diamond", point: 12 };
  actor.hand = [{ id: "slash-halberd-1", kind: "slash", suit: "spade", point: 8 }];

  extraA.hp = 2;
  extraB.hp = 2;
  untouched.hp = 4;

  const hpPrimaryBefore = primary.hp;
  const hpExtraABefore = extraA.hp;
  const hpExtraBBefore = extraB.hp;
  const hpUntouchedBefore = untouched.hp;

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-halberd-1",
    targetId: primary.id
  });

  assert.equal(primary.hp, hpPrimaryBefore - 1);
  assert.equal(extraA.hp, hpExtraABefore - 1);
  assert.equal(extraB.hp, hpExtraBBefore - 1);
  assert.equal(untouched.hp, hpUntouchedBefore);
});

/**
 * 验证方天画戟多目标结算时，实体【杀】仅进入一次弃牌堆。
 */
test("halberd multi-target should discard physical slash only once", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const primary = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "halberd-discard-1", kind: "weapon_halberd", suit: "diamond", point: 12 };
  actor.hand = [{ id: "slash-halberd-discard-1", kind: "slash", suit: "spade", point: 8 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-halberd-discard-1",
    targetId: primary.id
  });

  const slashDiscardCount = state.discard.filter((card) => card.id === "slash-halberd-discard-1").length;
  assert.equal(slashDiscardCount, 1);
});

/**
 * 验证雌雄双股剑对异性目标可触发弃牌分支。
 */
test("double sword should force opposite-gender target to discard when possible", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "double-sword-1", kind: "weapon_double_sword", suit: "spade", point: 2 };
  actor.hand = [{ id: "slash-ds-1", kind: "slash", suit: "spade", point: 9 }];
  target.hand = [{ id: "target-card-ds-1", kind: "peach", suit: "heart", point: 3 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-ds-1",
    targetId: target.id
  });

  assert.equal(target.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "target-card-ds-1"));
});

/**
 * 验证雌雄双股剑在异性目标无手牌时触发摸牌分支。
 */
test("double sword should let source draw when opposite-gender target has no cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "double-sword-2", kind: "weapon_double_sword", suit: "spade", point: 2 };
  actor.hand = [{ id: "slash-ds-2", kind: "slash", suit: "club", point: 9 }];
  state.deck = [{ id: "draw-double-sword", kind: "dodge", suit: "diamond", point: 2 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-ds-2",
    targetId: target.id
  });

  assert.ok(actor.hand.some((card) => card.id === "draw-double-sword"));
});

/**
 * 验证青龙偃月刀在【杀】被【闪】抵消后可追加一张【杀】。
 */
test("blade should follow up with another slash after dodge", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "blade-1", kind: "weapon_blade", suit: "spade", point: 5 };
  actor.hand = [
    { id: "slash-follow-1", kind: "slash", suit: "club", point: 9 },
    { id: "slash-follow-2", kind: "slash", suit: "spade", point: 10 }
  ];
  target.hand = [{ id: "target-dodge-follow", kind: "dodge", suit: "diamond", point: 6 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-follow-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
});

/**
 * 验证青龙偃月刀在无后续可用【杀】时应终止追击链。
 */
test("blade follow-up should stop when no slash remains", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "blade-stop-1", kind: "weapon_blade", suit: "spade", point: 5 };
  actor.hand = [{ id: "slash-stop-1", kind: "slash", suit: "club", point: 9 }];
  target.hand = [{ id: "target-dodge-stop-1", kind: "dodge", suit: "diamond", point: 6 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-stop-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore);
});

/**
 * 验证可通过响应偏好关闭青龙偃月刀追击。
 */
test("blade follow-up should respect disabled response preference", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "blade-pref-off-weapon-1", kind: "weapon_blade", suit: "spade", point: 5 };
  actor.hand = [
    { id: "slash-pref-off-1", kind: "slash", suit: "club", point: 9 },
    { id: "slash-pref-off-2", kind: "slash", suit: "spade", point: 10 }
  ];
  target.hand = [{ id: "target-dodge-pref-off-1", kind: "dodge", suit: "diamond", point: 6 }];

  const hpBefore = target.hp;
  setResponsePreference(state, actor.id, "blade-follow-up", false);
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-pref-off-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore);
  assert.ok(actor.hand.some((card) => card.id === "slash-pref-off-2"));
});

/**
 * 验证青龙偃月刀可在连续闪避下持续追击，直到目标无闪或攻击方无可用【杀】。
 */
test("blade follow-up should chain across multiple dodges within slash limit", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "blade-chain-1", kind: "weapon_blade", suit: "spade", point: 5 };
  actor.hand = [
    { id: "slash-chain-1", kind: "slash", suit: "club", point: 9 },
    { id: "slash-chain-2", kind: "slash", suit: "spade", point: 10 },
    { id: "slash-chain-3", kind: "slash", suit: "diamond", point: 11 }
  ];
  target.hand = [
    { id: "target-dodge-chain-1", kind: "dodge", suit: "diamond", point: 6 },
    { id: "target-dodge-chain-2", kind: "dodge", suit: "heart", point: 2 }
  ];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-chain-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
  assert.equal(actor.hand.length, 0);
  assert.equal(target.hand.length, 0);
  assert.equal(state.discard.filter((card) => card.id.startsWith("slash-chain-")).length, 3);
  assert.equal(state.discard.filter((card) => card.id.startsWith("target-dodge-chain-")).length, 2);
});

/**
 * 验证寒冰剑可防止【杀】伤害并弃置目标两张牌。
 */
test("ice sword should prevent slash damage and discard two target cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "ice-sword-1", kind: "weapon_ice_sword", suit: "spade", point: 2 };
  actor.hand = [{ id: "slash-ice-1", kind: "slash", suit: "spade", point: 10 }];
  target.hand = [
    { id: "target-card-ice-a", kind: "peach", suit: "heart", point: 7 },
    { id: "target-card-ice-b", kind: "snatch", suit: "heart", point: 8 }
  ];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-ice-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore);
  assert.equal(target.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "target-card-ice-a"));
  assert.ok(state.discard.some((card) => card.id === "target-card-ice-b"));
});

/**
 * 验证仁王盾仅对黑色【杀】无效化，红色【杀】仍会正常结算。
 */
test("renwang shield should not block red slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "slash-red-rw-1", kind: "slash", suit: "heart", point: 10 }];
  target.equipment.armor = { id: "renwang-red-1", kind: "armor_renwang_shield", suit: "club", point: 2 };

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-red-rw-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
});

/**
 * 验证青釭剑会无视八卦阵，目标不会触发八卦判定闪避。
 */
test("qinggang sword should bypass eight diagram auto-dodge", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "qinggang-bypass-1", kind: "weapon_qinggang_sword", suit: "spade", point: 6 };
  actor.hand = [{ id: "slash-qg-ed-1", kind: "slash", suit: "spade", point: 9 }];
  target.equipment.armor = { id: "eight-diagram-bypass-1", kind: "armor_eight_diagram", suit: "spade", point: 2 };
  state.deck = [{ id: "judge-red-bypass-1", kind: "peach", suit: "heart", point: 7 }];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-qg-ed-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
  assert.equal(state.discard.some((card) => card.id === "judge-red-bypass-1"), false);
});

/**
 * 验证方天画戟多目标结算时，仁王盾会按目标分别生效。
 */
test("renwang shield should apply per target in halberd multi-target slash", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const primary = state.players[1];
  const extraA = state.players[2];
  const extraB = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "halberd-rw-1", kind: "weapon_halberd", suit: "diamond", point: 12 };
  actor.hand = [{ id: "slash-halberd-rw-1", kind: "slash", suit: "club", point: 9 }];

  primary.equipment.armor = { id: "renwang-primary", kind: "armor_renwang_shield", suit: "club", point: 2 };
  extraA.equipment.armor = { id: "renwang-extra-a", kind: "armor_renwang_shield", suit: "club", point: 2 };

  const hpPrimaryBefore = primary.hp;
  const hpExtraABefore = extraA.hp;
  const hpExtraBBefore = extraB.hp;

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "slash-halberd-rw-1",
    targetId: primary.id
  });

  assert.equal(primary.hp, hpPrimaryBefore);
  assert.equal(extraA.hp, hpExtraABefore);
  assert.equal(extraB.hp, hpExtraBBefore - 1);
});

/**
 * 验证许褚【裸衣】会少摸一张牌，且本回合【杀】伤害+1。
 */
test("luoyi skill should reduce draw and increase slash damage", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.xuchuLuoyi);

  state.currentPlayerId = actor.id;
  state.phase = "draw";
  state.deck = [
    { id: "luoyi-draw-1", kind: "dodge", suit: "heart", point: 2 },
    { id: "luoyi-draw-2", kind: "slash", suit: "spade", point: 9 }
  ];

  setLuoyiChoice(state, actor.id, true);
  stepPhase(state);
  assert.equal(actor.hand.length, 1);

  actor.hand = [{ id: "luoyi-slash-1", kind: "slash", suit: "club", point: 7 }];
  target.hand = [];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "luoyi-slash-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 2);
});

/**
 * 验证许褚【裸衣】在本回合会使【决斗】造成伤害+1。
 */
test("luoyi skill should increase duel damage", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.xuchuLuoyi);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  state.luoyiActivePlayerId = actor.id;
  actor.hand = [{ id: "duel-luoyi-1", kind: "duel", suit: "spade", point: 1 }];
  target.hand = [];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "duel-luoyi-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 2);
});

/**
 * 验证张辽【突袭】可在摸牌阶段获得至多两名角色各一张手牌并少摸对应张数。
 */
test("tuxi skill should steal up to two cards and reduce draw", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const targetA = state.players[0];
  const targetB = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.zhangliaoTuxi);

  state.currentPlayerId = actor.id;
  state.phase = "draw";
  targetA.hand = [{ id: "tuxi-target-a-1", kind: "dodge", suit: "heart", point: 4 }];
  targetB.hand = [{ id: "tuxi-target-b-1", kind: "slash", suit: "spade", point: 8 }];
  state.deck = [
    { id: "tuxi-deck-1", kind: "peach", suit: "diamond", point: 6 },
    { id: "tuxi-deck-2", kind: "nullify", suit: "club", point: 10 }
  ];

  stepPhase(state);

  assert.ok(actor.hand.some((card) => card.id === "tuxi-target-a-1"));
  assert.ok(actor.hand.some((card) => card.id === "tuxi-target-b-1"));
  assert.equal(actor.hand.some((card) => card.id === "tuxi-deck-1"), false);
  assert.equal(actor.hand.some((card) => card.id === "tuxi-deck-2"), false);
});

/**
 * 验证张辽【突袭】在无可突袭目标时保持正常摸两张。
 */
test("tuxi skill should draw normally when no valid target", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.zhangliaoTuxi);

  state.currentPlayerId = actor.id;
  state.phase = "draw";
  state.deck = [
    { id: "tuxi-normal-draw-1", kind: "slash", suit: "spade", point: 6 },
    { id: "tuxi-normal-draw-2", kind: "dodge", suit: "heart", point: 9 }
  ];

  stepPhase(state);

  assert.ok(actor.hand.some((card) => card.id === "tuxi-normal-draw-1"));
  assert.ok(actor.hand.some((card) => card.id === "tuxi-normal-draw-2"));
});

/**
 * 验证刘备【仁德】可将手牌交给其他角色，阶段内累计给出2张时回复1点体力。
 */
test("rende skill should transfer cards and recover at two given cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.liubeiRende);

  actor.hp = 3;
  actor.maxHp = 4;
  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "rende-give-1", kind: "dodge", suit: "heart", point: 5 },
    { id: "rende-give-2", kind: "slash", suit: "spade", point: 9 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_rende__::rende-give-1",
    targetId: target.id
  });
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_rende__::rende-give-2",
    targetId: target.id
  });

  assert.equal(actor.hp, 4);
  assert.equal(actor.hand.length, 0);
  assert.ok(target.hand.some((card) => card.id === "rende-give-1"));
  assert.ok(target.hand.some((card) => card.id === "rende-give-2"));
});

/**
 * 验证刘备【仁德】阶段内回复仅触发一次。
 */
test("rende skill should recover only once per turn", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.liubeiRende);

  actor.hp = 2;
  actor.maxHp = 4;
  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "rende-once-1", kind: "dodge", suit: "heart", point: 1 },
    { id: "rende-once-2", kind: "slash", suit: "club", point: 2 },
    { id: "rende-once-3", kind: "peach", suit: "diamond", point: 3 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_rende__::rende-once-1",
    targetId: target.id
  });
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_rende__::rende-once-2",
    targetId: target.id
  });
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_rende__::rende-once-3",
    targetId: target.id
  });

  assert.equal(actor.hp, 3);
});

/**
 * 验证刘备【激将】可在【决斗】响应链中由蜀势力角色提供【杀】。
 */
test("jijiang skill should request slash from shu ally in duel", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const target = state.players[0];
  const ally = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.liubeiJijiang);
  assignSkillToPlayer(state, ally.id, STANDARD_SKILL_IDS.zhangfeiPaoxiao);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [{ id: "duel-jijiang-1", kind: "duel", suit: "spade", point: 1 }];
  ally.hand = [{ id: "ally-slash-jijiang-1", kind: "slash", suit: "club", point: 8 }];

  const sourceHpBefore = source.hp;
  const targetHpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "duel-jijiang-1",
    targetId: target.id
  });

  assert.equal(target.hp, targetHpBefore);
  assert.equal(source.hp, sourceHpBefore - 1);
  assert.equal(ally.hand.length, 0);
});

/**
 * 验证刘备【激将】无蜀势力可供【杀】时无法替代响应。
 */
test("jijiang skill should fail when no shu slash available", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.liubeiJijiang);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [{ id: "duel-jijiang-2", kind: "duel", suit: "spade", point: 2 }];

  const targetHpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "duel-jijiang-2",
    targetId: target.id
  });

  assert.equal(target.hp, targetHpBefore - 1);
});

/**
 * 验证青龙偃月刀追击会优先消耗来源角色自己的【杀】，而非先走【激将】。
 */
test("blade follow-up should consume owner's slash before jijiang", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const target = state.players[2];
  const shuAlly = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, source.id, STANDARD_SKILL_IDS.liubeiJijiang);
  assignSkillToPlayer(state, shuAlly.id, STANDARD_SKILL_IDS.guanyuWusheng);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.equipment.weapon = { id: "blade-owner-weapon-1", kind: "weapon_blade", suit: "spade", point: 5 };
  source.hand = [
    { id: "blade-owner-slash-open-1", kind: "slash", suit: "heart", point: 9 },
    { id: "blade-owner-slash-follow-1", kind: "slash", suit: "club", point: 7 }
  ];
  target.hand = [{ id: "blade-owner-target-dodge-1", kind: "dodge", suit: "diamond", point: 6 }];
  shuAlly.hand = [{ id: "blade-owner-ally-slash-1", kind: "slash", suit: "spade", point: 8 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "blade-owner-slash-open-1",
    targetId: target.id
  });

  assert.equal(source.hand.some((card) => card.id === "blade-owner-slash-follow-1"), false);
  assert.equal(shuAlly.hand.some((card) => card.id === "blade-owner-ally-slash-1"), true);
});

/**
 * 验证刘备【激将】可在出牌阶段主动当【杀】使用（由蜀势力角色提供）。
 */
test("jijiang should be manually usable as slash in play phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const ally = state.players[1];
  const target = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.liubeiJijiang);
  assignSkillToPlayer(state, ally.id, STANDARD_SKILL_IDS.zhangfeiPaoxiao);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  ally.hand = [{ id: "ally-slash-jijiang-manual-1", kind: "slash", suit: "heart", point: 9 }];

  const jijiangActions = getLegalActions(state).filter(
    (
      action
    ): action is {
      type: "play-card";
      actorId: string;
      cardId: string;
      targetId?: string;
      secondaryTargetId?: string;
    } => action.type === "play-card" && action.cardId.startsWith("__virtual_jijiang__::")
  );
  assert.ok(jijiangActions.some((action) => action.targetId === target.id));

  const targetHpBefore = target.hp;
  const chosen = jijiangActions.find((action) => action.targetId === target.id) as PlayCardAction;
  applyAction(state, chosen);

  assert.equal(target.hp, targetHpBefore - 1);
  assert.equal(ally.hand.length, 0);
});

/**
 * 验证刘备【激将】不会向非蜀势力角色征调【杀】。
 */
test("jijiang should not request slash from non-shu responders", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const target = state.players[0];
  const nonShuAlly = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.liubeiJijiang);
  assignSkillToPlayer(state, nonShuAlly.id, STANDARD_SKILL_IDS.lvmengKeji);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [{ id: "duel-jijiang-nonshu-1", kind: "duel", suit: "spade", point: 12 }];
  nonShuAlly.hand = [{ id: "nonshu-slash-jijiang-1", kind: "slash", suit: "club", point: 6 }];

  const targetHpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "duel-jijiang-nonshu-1",
    targetId: target.id
  });

  assert.equal(target.hp, targetHpBefore - 1);
  assert.equal(nonShuAlly.hand.length, 1);
});

/**
 * 验证诸葛亮【观星】可调整牌堆顶顺序，使后续摸牌更优。
 */
test("guanxing skill should reorder top deck before draw", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.zhugeliangGuanxing);

  state.currentPlayerId = actor.id;
  state.phase = "judge";
  state.deck = [
    { id: "gx-low-1", kind: "horse_plus", suit: "club", point: 2 },
    { id: "gx-mid-1", kind: "dodge", suit: "heart", point: 6 },
    { id: "gx-high-1", kind: "nullify", suit: "spade", point: 11 }
  ];

  stepPhase(state);
  stepPhase(state);

  assert.ok(actor.hand.some((card) => card.id === "gx-high-1"));
  assert.ok(actor.hand.some((card) => card.id === "gx-mid-1"));
  assert.equal(actor.hand.some((card) => card.id === "gx-low-1"), false);
});

/**
 * 验证【观星】不会破坏【空城】空手状态（判定阶段后仍可保持空手）。
 */
test("guanxing should keep kongcheng empty-hand edge before draw", () => {
  const state = createInitialGame(42);
  const kongchengOwner = state.players[0];
  const attacker = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, kongchengOwner.id, STANDARD_SKILL_IDS.zhugeliangGuanxing);
  assignSkillToPlayer(state, kongchengOwner.id, STANDARD_SKILL_IDS.zhugeliangKongcheng);

  state.currentPlayerId = kongchengOwner.id;
  state.phase = "judge";
  state.deck = [{ id: "gx-edge-1", kind: "slash", suit: "spade", point: 7 }];

  stepPhase(state);
  assert.equal(kongchengOwner.hand.length, 0);

  state.currentPlayerId = attacker.id;
  state.phase = "play";
  attacker.hand = [{ id: "slash-gx-kc-1", kind: "slash", suit: "spade", point: 8 }];

  const slashTargets = getLegalActions(state)
    .filter((action): action is PlayCardAction => action.type === "play-card" && action.cardId === "slash-gx-kc-1")
    .map((action) => action.targetId);
  assert.equal(slashTargets.includes(kongchengOwner.id), false);
});

/**
 * 验证周瑜【英姿】可在摸牌阶段额外摸 1 张牌。
 */
test("yingzi skill should draw one extra card in draw phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.zhouyuYingzi);

  state.currentPlayerId = actor.id;
  state.phase = "draw";
  state.deck = [
    { id: "yingzi-draw-1", kind: "slash", suit: "spade", point: 5 },
    { id: "yingzi-draw-2", kind: "dodge", suit: "heart", point: 9 },
    { id: "yingzi-draw-3", kind: "peach", suit: "diamond", point: 12 }
  ];

  stepPhase(state);

  assert.equal(actor.hand.length, 3);
  assert.ok(actor.hand.some((card) => card.id === "yingzi-draw-3"));
});

/**
 * 验证周瑜【反间】可交牌并在猜错花色时造成 1 点伤害，且每回合限一次。
 */
test("fanjian skill should deal damage on suit mismatch and be once per turn", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.zhouyuFanjian);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "fanjian-card-1", kind: "dodge", suit: "heart", point: 4 },
    { id: "fanjian-card-2", kind: "slash", suit: "spade", point: 11 }
  ];

  const hpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_fanjian__::fanjian-card-1",
    targetId: target.id
  });

  assert.equal(target.hp, hpBefore - 1);
  assert.ok(target.hand.some((card) => card.id === "fanjian-card-1"));

  const secondFanjianStillLegal = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.cardId === "__virtual_fanjian__::fanjian-card-2"
  );
  assert.equal(secondFanjianStillLegal, false);
});

/**
 * 验证黄盖【苦肉】可失去 1 点体力并摸 2 张牌。
 */
test("kurou skill should lose 1 hp and draw 2 cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.huanggaiKurou);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  state.deck = [
    { id: "kurou-draw-1", kind: "slash", suit: "spade", point: 8 },
    { id: "kurou-draw-2", kind: "dodge", suit: "heart", point: 6 }
  ];

  const hpBefore = actor.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_kurou__"
  });

  assert.equal(actor.hp, hpBefore - 1);
  assert.ok(actor.hand.some((card) => card.id === "kurou-draw-1"));
  assert.ok(actor.hand.some((card) => card.id === "kurou-draw-2"));
});

/**
 * 验证黄盖【苦肉】可在同一出牌阶段多次发动。
 */
test("kurou skill should be reusable in the same play phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.huanggaiKurou);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  state.deck = [
    { id: "kurou-repeat-1", kind: "slash", suit: "spade", point: 3 },
    { id: "kurou-repeat-2", kind: "dodge", suit: "heart", point: 5 },
    { id: "kurou-repeat-3", kind: "peach", suit: "diamond", point: 7 },
    { id: "kurou-repeat-4", kind: "duel", suit: "club", point: 9 }
  ];

  const hpBefore = actor.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_kurou__"
  });
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_kurou__"
  });

  assert.equal(actor.hp, hpBefore - 2);
  assert.equal(actor.hand.length, 4);
});

/**
 * 验证吕蒙【克己】在本回合未使用【杀】时可跳过弃牌阶段。
 */
test("keji skill should skip discard when no slash used", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.lvmengKeji);

  state.currentPlayerId = actor.id;
  state.phase = "discard";
  state.slashUsedInTurn = 0;
  actor.hp = 2;
  actor.hand = [
    { id: "keji-keep-1", kind: "slash", suit: "spade", point: 2 },
    { id: "keji-keep-2", kind: "dodge", suit: "heart", point: 4 },
    { id: "keji-keep-3", kind: "peach", suit: "diamond", point: 6 }
  ];

  stepPhase(state);

  assert.equal(actor.hand.length, 3);
});

/**
 * 验证吕蒙【克己】在本回合使用过【杀】时不会跳过弃牌阶段。
 */
test("keji skill should not skip discard after slash used", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.lvmengKeji);

  state.currentPlayerId = actor.id;
  state.phase = "discard";
  state.slashUsedInTurn = 1;
  actor.hp = 2;
  actor.hand = [
    { id: "keji-drop-1", kind: "slash", suit: "spade", point: 2 },
    { id: "keji-drop-2", kind: "dodge", suit: "heart", point: 4 },
    { id: "keji-drop-3", kind: "peach", suit: "diamond", point: 6 }
  ];

  stepPhase(state);

  assert.equal(actor.hand.length, 2);
});

/**
 * 验证孙权【制衡】可弃置1张并摸1张，且每回合限一次。
 */
test("zhiheng skill should discard one and draw one once per turn", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.sunquanZhiheng);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "zhiheng-src-1", kind: "dodge", suit: "heart", point: 6 },
    { id: "zhiheng-src-2", kind: "slash", suit: "spade", point: 9 }
  ];
  state.deck = [{ id: "zhiheng-draw-1", kind: "peach", suit: "diamond", point: 3 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_zhiheng__::zhiheng-src-1",
    targetId: actor.id
  });

  assert.equal(actor.hand.some((card) => card.id === "zhiheng-src-1"), false);
  assert.ok(actor.hand.some((card) => card.id === "zhiheng-draw-1"));

  const secondZhihengStillLegal = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.cardId.startsWith("__virtual_zhiheng__::")
  );
  assert.equal(secondZhihengStillLegal, false);
});

/**
 * 验证孙权【制衡】在下个回合可再次发动。
 */
test("zhiheng skill should reset usage on next turn", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.sunquanZhiheng);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "zhiheng-reset-1", kind: "dodge", suit: "heart", point: 6 }];
  state.deck = [{ id: "zhiheng-reset-draw-1", kind: "slash", suit: "spade", point: 7 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_zhiheng__::zhiheng-reset-1",
    targetId: actor.id
  });

  stepPhase(state);
  stepPhase(state);
  stepPhase(state);
  stepPhase(state);
  stepPhase(state);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "zhiheng-reset-2", kind: "dodge", suit: "club", point: 10 }];

  const zhihengLegalAgain = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.cardId === "__virtual_zhiheng__::zhiheng-reset-2"
  );
  assert.equal(zhihengLegalAgain, true);
});

/**
 * 验证孙尚香【结姻】可弃置两张手牌并与受伤男性目标各回复1点体力。
 */
test("jieyin skill should discard two and heal both parties", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.sunshangxiangJieyin);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hp = 3;
  actor.maxHp = 4;
  target.hp = 3;
  target.maxHp = 5;
  actor.hand = [
    { id: "jieyin-cost-1", kind: "dodge", suit: "heart", point: 2 },
    { id: "jieyin-cost-2", kind: "slash", suit: "spade", point: 11 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_jieyin__",
    targetId: target.id
  });

  assert.equal(actor.hand.length, 0);
  assert.equal(actor.hp, 4);
  assert.equal(target.hp, 4);
});

/**
 * 验证孙尚香【结姻】每回合限一次。
 */
test("jieyin skill should be once per turn", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.sunshangxiangJieyin);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hp = 3;
  actor.maxHp = 4;
  target.hp = 3;
  target.maxHp = 5;
  actor.hand = [
    { id: "jieyin-once-1", kind: "dodge", suit: "heart", point: 2 },
    { id: "jieyin-once-2", kind: "slash", suit: "spade", point: 11 },
    { id: "jieyin-once-3", kind: "peach", suit: "diamond", point: 8 },
    { id: "jieyin-once-4", kind: "duel", suit: "club", point: 4 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_jieyin__",
    targetId: target.id
  });

  const secondJieyinStillLegal = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.cardId === "__virtual_jieyin__"
  );
  assert.equal(secondJieyinStillLegal, false);
});

/**
 * 验证大乔【国色】可将方片牌当【乐不思蜀】置入目标判定区。
 */
test("guose skill should convert diamond card to indulgence", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.daqiaoGuose);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "guose-diamond-1", kind: "dodge", suit: "diamond", point: 9 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_guose__::guose-diamond-1",
    targetId: target.id
  });

  assert.equal(actor.hand.length, 0);
  assert.equal(target.judgmentZone.delayedTricks.length, 1);
  assert.equal(target.judgmentZone.delayedTricks[0].kind, "indulgence");
});

/**
 * 验证大乔【国色】不能对已有【乐不思蜀】的目标重复放置。
 */
test("guose skill should not target player with existing indulgence", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.daqiaoGuose);
  target.judgmentZone.delayedTricks = [{ id: "existing-indulgence-1", kind: "indulgence", suit: "spade", point: 6 }];

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "guose-diamond-2", kind: "dodge", suit: "diamond", point: 3 }];

  const guoseActions = getLegalActions(state).filter(
    (action) => action.type === "play-card" && action.cardId === "__virtual_guose__::guose-diamond-2"
  );
  assert.equal(guoseActions.some((action) => action.type === "play-card" && action.targetId === target.id), false);
});

/**
 * 验证大乔【流离】可弃牌并将【杀】转移给攻击范围内其他角色。
 */
test("liuli skill should redirect slash to another target in range", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const liuliOwner = state.players[1];
  const redirectedTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, liuliOwner.id, STANDARD_SKILL_IDS.daqiaoLiuli);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.equipment.weapon = { id: "liuli-source-weapon-1", kind: "weapon_blade", suit: "spade", point: 5 };
  source.hand = [{ id: "liuli-source-slash-1", kind: "slash", suit: "spade", point: 8 }];
  liuliOwner.hand = [{ id: "liuli-discard-1", kind: "dodge", suit: "heart", point: 2 }];

  const liuliHpBefore = liuliOwner.hp;
  const redirectedHpBefore = redirectedTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "liuli-source-slash-1",
    targetId: liuliOwner.id
  });

  assert.equal(liuliOwner.hp, liuliHpBefore);
  assert.equal(redirectedTarget.hp, redirectedHpBefore - 1);
  assert.equal(liuliOwner.hand.length, 0);
});

/**
 * 验证大乔【流离】无可转移目标时不生效，仍由自己结算【杀】。
 */
test("liuli skill should not redirect when no valid target", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const liuliOwner = state.players[1];

  for (const player of state.players) {
    player.hand = [];
    player.alive = false;
  }

  source.alive = true;
  liuliOwner.alive = true;

  assignSkillToPlayer(state, liuliOwner.id, STANDARD_SKILL_IDS.daqiaoLiuli);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [{ id: "liuli-source-slash-2", kind: "slash", suit: "club", point: 7 }];
  liuliOwner.hand = [{ id: "liuli-discard-2", kind: "dodge", suit: "heart", point: 4 }];

  const hpBefore = liuliOwner.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "liuli-source-slash-2",
    targetId: liuliOwner.id
  });

  assert.equal(liuliOwner.hp, hpBefore);
  assert.equal(liuliOwner.hand.length, 0);
});

test("liuli skill should not redirect to target outside liuli owner's attack range", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const liuliOwner = state.players[1];
  const nearTarget = state.players[2];
  const farTarget = state.players[3];

  for (const player of state.players) {
    player.hand = [];
    player.alive = false;
  }

  source.alive = true;
  liuliOwner.alive = true;
  nearTarget.alive = true;
  farTarget.alive = true;

  assignSkillToPlayer(state, liuliOwner.id, STANDARD_SKILL_IDS.daqiaoLiuli);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.equipment.weapon = { id: "liuli-source-weapon-range-1", kind: "weapon_blade", suit: "spade", point: 5 };
  source.hand = [{ id: "liuli-source-slash-range-1", kind: "slash", suit: "club", point: 7 }];
  liuliOwner.hand = [{ id: "liuli-discard-range-1", kind: "dodge", suit: "heart", point: 4 }];
  nearTarget.hand = [{ id: "liuli-near-dodge-1", kind: "dodge", suit: "heart", point: 8 }];
  farTarget.hand = [{ id: "liuli-far-dodge-1", kind: "dodge", suit: "diamond", point: 9 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "liuli-source-slash-range-1",
    targetId: liuliOwner.id
  });

  assert.equal(farTarget.hp, farTarget.maxHp);
  assert.equal(liuliOwner.hp, liuliOwner.maxHp);
  assert.ok(state.events.some((event) => event.message.includes(`将杀转移给 ${nearTarget.name}`)));
  assert.ok(state.events.every((event) => !event.message.includes(`将杀转移给 ${farTarget.name}`)));
});

/**
 * 验证甘宁【奇袭】可将黑色手牌当【过河拆桥】使用。
 */
test("qixi skill should convert black card to dismantle", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.ganningQixi);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "qixi-black-1", kind: "dodge", suit: "spade", point: 8 }];
  target.hand = [{ id: "qixi-target-card-1", kind: "slash", suit: "heart", point: 7 }];

  const qixiAction = getLegalActions(state).find(
    (action) =>
      action.type === "play-card" &&
      action.actorId === actor.id &&
      action.cardId === "__virtual_qixi__::qixi-black-1" &&
      action.targetId === target.id
  );
  assert.ok(qixiAction);

  applyAction(state, qixiAction);

  assert.equal(actor.hand.length, 0);
  assert.equal(target.hand.length, 0);
  assert.ok(state.discard.some((card) => card.id === "qixi-black-1"));
  assert.ok(state.discard.some((card) => card.id === "qixi-target-card-1"));
});

/**
 * 验证甘宁【奇袭】可被【无懈可击】抵消。
 */
test("qixi skill should be canceled by nullify", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[0];
  const protector = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.ganningQixi);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "qixi-black-2", kind: "dodge", suit: "club", point: 3 }];
  target.hand = [{ id: "qixi-target-card-2", kind: "slash", suit: "heart", point: 11 }];
  protector.hand = [{ id: "qixi-nullify-1", kind: "nullify", suit: "spade", point: 1 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_qixi__::qixi-black-2",
    targetId: target.id
  });

  assert.equal(target.hand.length, 1);
  assert.ok(state.discard.some((card) => card.id === "qixi-nullify-1"));
});

/**
 * 验证陆逊【连营】在失去最后手牌后触发摸1。
 */
test("lianying skill should draw one after losing last hand card", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.ganningQixi);
  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.luxunLianying);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "lianying-qixi-cost-1", kind: "dodge", suit: "club", point: 6 }];
  target.hand = [{ id: "lianying-target-card-1", kind: "slash", suit: "diamond", point: 9 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_qixi__::lianying-qixi-cost-1",
    targetId: target.id
  });

  assert.equal(actor.hand.length, 1);
});

/**
 * 验证陆逊【连营】仅在失去最后手牌时触发。
 */
test("lianying skill should not trigger when hand is not emptied", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.ganningQixi);
  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.luxunLianying);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "lianying-qixi-cost-2", kind: "dodge", suit: "spade", point: 10 },
    { id: "lianying-keep-1", kind: "peach", suit: "heart", point: 2 }
  ];
  target.hand = [{ id: "lianying-target-card-2", kind: "slash", suit: "diamond", point: 12 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_qixi__::lianying-qixi-cost-2",
    targetId: target.id
  });

  assert.equal(actor.hand.length, 1);
  assert.equal(actor.hand[0]?.id, "lianying-keep-1");
});

/**
 * 验证陆逊在被【过河拆桥】弃掉最后手牌时也会触发【连营】。
 */
test("lianying should trigger when dismantle removes the last hand card", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const luxun = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, luxun.id, STANDARD_SKILL_IDS.luxunLianying);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "lianying-dismantle-1", kind: "dismantle", suit: "spade", point: 4 }];
  luxun.hand = [{ id: "lianying-last-hand-1", kind: "dodge", suit: "club", point: 10 }];
  state.deck = [{ id: "lianying-draw-after-dismantle", kind: "slash", suit: "heart", point: 8 }, ...state.deck];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "lianying-dismantle-1",
    targetId: luxun.id
  });

  assert.equal(luxun.hand.length, 1);
  assert.equal(luxun.hand[0]?.id, "lianying-draw-after-dismantle");
});

/**
 * 验证陆逊【谦逊】使其不能成为【顺手牵羊】目标。
 */
test("qianxun skill should prevent snatch targeting", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const qianxunOwner = state.players[1];
  const normalTarget = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, qianxunOwner.id, STANDARD_SKILL_IDS.luxunQianxun);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "qianxun-snatch-1", kind: "snatch", suit: "spade", point: 6 }];
  qianxunOwner.hand = [{ id: "qianxun-owner-hand-1", kind: "dodge", suit: "heart", point: 7 }];
  normalTarget.hand = [{ id: "qianxun-normal-hand-1", kind: "slash", suit: "club", point: 9 }];

  const snatchActions = getLegalActions(state).filter(
    (action) => action.type === "play-card" && action.cardId === "qianxun-snatch-1"
  );

  assert.equal(snatchActions.some((action) => action.type === "play-card" && action.targetId === qianxunOwner.id), false);
  assert.equal(snatchActions.some((action) => action.type === "play-card" && action.targetId === normalTarget.id), true);
});

/**
 * 验证陆逊【谦逊】使其不能成为【乐不思蜀】目标（含普通与国色转化目标判定）。
 */
test("qianxun skill should prevent indulgence targeting", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const qianxunOwner = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, qianxunOwner.id, STANDARD_SKILL_IDS.luxunQianxun);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "qianxun-indulgence-1", kind: "indulgence", suit: "spade", point: 8 },
    { id: "qianxun-guose-src-1", kind: "dodge", suit: "diamond", point: 2 }
  ];
  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.daqiaoGuose);

  const indulgenceActions = getLegalActions(state).filter(
    (action) => action.type === "play-card" && action.cardId === "qianxun-indulgence-1"
  );
  const guoseActions = getLegalActions(state).filter(
    (action) => action.type === "play-card" && action.cardId === "__virtual_guose__::qianxun-guose-src-1"
  );

  assert.equal(indulgenceActions.some((action) => action.type === "play-card" && action.targetId === qianxunOwner.id), false);
  assert.equal(guoseActions.some((action) => action.type === "play-card" && action.targetId === qianxunOwner.id), false);
});

/**
 * 验证对【谦逊】目标强行提交【顺手牵羊】动作会被结算层拒绝并退回手牌。
 */
test("qianxun skill should reject forced snatch action on resolution", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const qianxunOwner = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, qianxunOwner.id, STANDARD_SKILL_IDS.luxunQianxun);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "qianxun-snatch-2", kind: "snatch", suit: "spade", point: 4 }];
  qianxunOwner.hand = [{ id: "qianxun-owner-hand-2", kind: "slash", suit: "heart", point: 10 }];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "qianxun-snatch-2",
    targetId: qianxunOwner.id
  });

  assert.equal(actor.hand.some((card) => card.id === "qianxun-snatch-2"), true);
  assert.equal(qianxunOwner.hand.some((card) => card.id === "qianxun-owner-hand-2"), true);
});

/**
 * 验证貂蝉【闭月】在结束阶段触发摸 1 张牌。
 */
test("biyue skill should draw one card at end phase", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.diaochanBiyue);

  state.currentPlayerId = actor.id;
  state.phase = "end";
  state.deck = [
    { id: "biyue-draw-1", kind: "dodge", suit: "heart", point: 6 },
    { id: "biyue-draw-2", kind: "slash", suit: "spade", point: 7 }
  ];

  stepPhase(state);

  assert.equal(actor.hand.length, 1);
  assert.equal(actor.hand[0]?.id, "biyue-draw-1");
  assert.equal(state.currentPlayerId, state.players[1].id);
  assert.equal(state.phase, "judge");
});

/**
 * 验证貂蝉【离间】可弃置一张牌并令两名男性角色按指定方向决斗。
 */
test("lijian skill should force duel between two male targets", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const firstTarget = state.players[2];
  const secondTarget = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.diaochanLijian);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "lijian-cost-1", kind: "dodge", suit: "heart", point: 8 }];
  firstTarget.hand = [];
  secondTarget.hand = [];

  const secondHpBefore = secondTarget.hp;
  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_lijian__::lijian-cost-1",
    targetId: firstTarget.id,
    secondaryTargetId: secondTarget.id
  });

  assert.equal(actor.hand.length, 0);
  assert.equal(secondTarget.hp, secondHpBefore - 1);
});

/**
 * 验证貂蝉【离间】每回合限一次。
 */
test("lijian skill should be once per turn", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const firstTarget = state.players[2];
  const secondTarget = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.diaochanLijian);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [
    { id: "lijian-cost-2", kind: "dodge", suit: "heart", point: 8 },
    { id: "lijian-cost-3", kind: "slash", suit: "spade", point: 5 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_lijian__::lijian-cost-2",
    targetId: firstTarget.id,
    secondaryTargetId: secondTarget.id
  });

  const secondLijianStillLegal = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.cardId === "__virtual_lijian__::lijian-cost-3"
  );
  assert.equal(secondLijianStillLegal, false);
});

/**
 * 验证孙尚香【枭姬】在失去装备（替换武器）后摸两张牌。
 */
test("xiaoji skill should draw two after losing an equipment card", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.sunshangxiangXiaoji);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "xiaoji-old-weapon", kind: "weapon_blade", suit: "spade", point: 7 };
  actor.hand = [{ id: "xiaoji-new-weapon", kind: "weapon_crossbow", suit: "diamond", point: 1 }];
  state.deck = [
    { id: "xiaoji-draw-1", kind: "dodge", suit: "heart", point: 3 },
    { id: "xiaoji-draw-2", kind: "slash", suit: "club", point: 9 },
    ...state.deck
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "xiaoji-new-weapon",
    targetId: actor.id
  });

  assert.equal(actor.equipment.weapon?.id, "xiaoji-new-weapon");
  assert.equal(actor.hand.some((card) => card.id === "xiaoji-draw-1"), true);
  assert.equal(actor.hand.some((card) => card.id === "xiaoji-draw-2"), true);
  assert.ok(state.discard.some((card) => card.id === "xiaoji-old-weapon"));
});

/**
 * 验证孙尚香【枭姬】在装备被借刀转移后也会触发摸两张牌。
 */
test("xiaoji skill should trigger when weapon is transferred by collateral", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const holder = state.players[1];
  const slashTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, holder.id, STANDARD_SKILL_IDS.sunshangxiangXiaoji);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "xiaoji-collateral-1", kind: "collateral", suit: "spade", point: 12 }];
  holder.equipment.weapon = { id: "xiaoji-holder-weapon", kind: "weapon_blade", suit: "club", point: 4 };
  holder.hand = [];
  slashTarget.hand = [];
  state.deck = [
    { id: "xiaoji-collateral-draw-1", kind: "dodge", suit: "diamond", point: 6 },
    { id: "xiaoji-collateral-draw-2", kind: "slash", suit: "spade", point: 8 },
    ...state.deck
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "xiaoji-collateral-1",
    targetId: holder.id,
    secondaryTargetId: slashTarget.id
  });

  assert.equal(holder.equipment.weapon, null);
  assert.equal(holder.hand.some((card) => card.id === "xiaoji-collateral-draw-1"), true);
  assert.equal(holder.hand.some((card) => card.id === "xiaoji-collateral-draw-2"), true);
  assert.equal(actor.hand.some((card) => card.id === "xiaoji-holder-weapon"), true);
});

/**
 * 验证曹操【奸雄】在受到有来源伤害后可获得造成伤害的牌。
 */
test("jianxiong skill should gain the card that caused damage", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.caocaoJianxiong);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [
    { id: "jianxiong-source-slash-1", kind: "slash", suit: "spade", point: 7 },
    { id: "jianxiong-source-extra-1", kind: "dodge", suit: "club", point: 5 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "jianxiong-source-slash-1",
    targetId: target.id
  });

  assert.equal(target.hand.length, 1);
  assert.equal(target.hand[0]?.id, "jianxiong-source-slash-1");
  assert.equal(source.hand.some((card) => card.id === "jianxiong-source-extra-1"), true);
});

/**
 * 验证曹操【护驾】可由魏势力角色提供【闪】响应【杀】。
 */
test("hujia skill should request dodge from wei ally", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const lord = state.players[0];
  const ally = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, lord.id, STANDARD_SKILL_IDS.caocaoHujia);
  assignSkillToPlayer(state, ally.id, STANDARD_SKILL_IDS.zhangliaoTuxi);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.equipment.weapon = { id: "hujia-weapon-1", kind: "weapon_qinggang_sword", suit: "spade", point: 2 };
  source.hand = [{ id: "hujia-slash-1", kind: "slash", suit: "spade", point: 9 }];
  ally.hand = [{ id: "hujia-dodge-ally-1", kind: "dodge", suit: "heart", point: 3 }];

  const lordHpBefore = lord.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "hujia-slash-1",
    targetId: lord.id
  });

  assert.equal(lord.hp, lordHpBefore);
  assert.ok(state.discard.some((card) => card.id === "hujia-dodge-ally-1"));
});

/**
 * 验证曹操【护驾】不会出现“首回合可用、后续回合失效”。
 */
test("hujia should remain usable on later turns", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const lord = state.players[0];
  const ally = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, lord.id, STANDARD_SKILL_IDS.caocaoHujia);
  assignSkillToPlayer(state, ally.id, STANDARD_SKILL_IDS.zhangliaoTuxi);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.equipment.weapon = { id: "hujia-weapon-2", kind: "weapon_qinggang_sword", suit: "club", point: 2 };
  source.hand = [{ id: "hujia-slash-turn1", kind: "slash", suit: "spade", point: 9 }];
  ally.hand = [{ id: "hujia-dodge-turn1", kind: "dodge", suit: "heart", point: 3 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "hujia-slash-turn1",
    targetId: lord.id
  });

  const hpAfterFirst = lord.hp;

  state.currentPlayerId = source.id;
  state.phase = "play";
  state.slashUsedInTurn = 0;
  source.hand = [{ id: "hujia-slash-turn2", kind: "slash", suit: "club", point: 11 }];
  ally.hand = [{ id: "hujia-dodge-turn2", kind: "dodge", suit: "diamond", point: 2 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "hujia-slash-turn2",
    targetId: lord.id
  });

  assert.equal(lord.hp, hpAfterFirst);
  assert.ok(state.discard.some((card) => card.id === "hujia-dodge-turn1"));
  assert.ok(state.discard.some((card) => card.id === "hujia-dodge-turn2"));
});

/**
 * 验证曹操【护驾】不会向非魏势力角色征调【闪】。
 */
test("hujia should not request dodge from non-wei responders", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const lord = state.players[0];
  const nonWei = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, lord.id, STANDARD_SKILL_IDS.caocaoHujia);
  assignSkillToPlayer(state, nonWei.id, STANDARD_SKILL_IDS.zhangfeiPaoxiao);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.equipment.weapon = { id: "hujia-weapon-3", kind: "weapon_qinggang_sword", suit: "diamond", point: 2 };
  source.hand = [{ id: "hujia-slash-nonwei", kind: "slash", suit: "spade", point: 8 }];
  nonWei.hand = [{ id: "hujia-dodge-nonwei", kind: "dodge", suit: "heart", point: 2 }];

  const lordHpBefore = lord.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "hujia-slash-nonwei",
    targetId: lord.id
  });

  assert.equal(lord.hp, lordHpBefore - 1);
  assert.equal(nonWei.hand.length, 1);
});

/**
 * 验证甄姬【倾国】可将黑色手牌当【闪】打出。
 */
test("qingguo skill should convert black card to dodge", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const target = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, target.id, STANDARD_SKILL_IDS.zhenjiQingguo);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.hand = [{ id: "qingguo-slash-1", kind: "slash", suit: "heart", point: 10 }];
  target.hand = [{ id: "qingguo-black-1", kind: "duel", suit: "club", point: 6 }];

  const targetHpBefore = target.hp;
  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "qingguo-slash-1",
    targetId: target.id
  });

  assert.equal(target.hp, targetHpBefore);
  assert.ok(state.events.some((event) => event.type === "skill" && event.message.includes("倾国")));
});

/**
 * 验证甄姬【洛神】在判定阶段可黑判得牌并在红判时停止。
 */
test("luoshen skill should repeatedly judge and gain black cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.zhenjiLuoshen);

  state.currentPlayerId = actor.id;
  state.phase = "judge";
  state.deck = [
    { id: "luoshen-black-1", kind: "slash", suit: "spade", point: 8 },
    { id: "luoshen-red-stop-1", kind: "dodge", suit: "heart", point: 4 },
    ...state.deck
  ];

  stepPhase(state);

  assert.equal(actor.hand.some((card) => card.id === "luoshen-black-1"), true);
  assert.equal(actor.hand.some((card) => card.id === "luoshen-red-stop-1"), false);
});

/**
 * 验证黄月英【奇才】可无距离限制使用【顺手牵羊】。
 */
test("qicai skill should ignore distance limit for snatch", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const farTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.huangyueyingQicai);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "qicai-snatch-1", kind: "snatch", suit: "spade", point: 5 }];
  farTarget.hand = [{ id: "qicai-target-card-1", kind: "dodge", suit: "heart", point: 11 }];

  const snatchTargets = getLegalActions(state).filter(
    (action) => action.type === "play-card" && action.cardId === "qicai-snatch-1"
  );

  assert.equal(snatchTargets.some((action) => action.type === "play-card" && action.targetId === farTarget.id), true);
});

/**
 * 验证孙权主公技【救援】在吴势力角色用桃救主公时额外回复1点。
 */
test("jiuyuan skill should grant extra heal when ally rescues lord", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const lord = state.players[0];
  const ally = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, lord.id, STANDARD_SKILL_IDS.sunquanJiuyuan);
  assignSkillToPlayer(state, ally.id, STANDARD_SKILL_IDS.lvmengKeji);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.equipment.weapon = { id: "jiuyuan-weapon-1", kind: "weapon_qinggang_sword", suit: "club", point: 2 };
  lord.hp = 1;
  source.hand = [{ id: "jiuyuan-slash-1", kind: "slash", suit: "spade", point: 9 }];
  ally.hand = [{ id: "jiuyuan-peach-1", kind: "peach", suit: "heart", point: 7 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "jiuyuan-slash-1",
    targetId: lord.id
  });

  assert.equal(lord.hp, 2);
});

/**
 * 验证濒死角色体力低于0时，需要按每张【桃】逐次回复直至体力大于0。
 */
test("dying rescue should require multiple peaches when hp is below zero", () => {
  const state = createInitialGame(42);
  const source = state.players[0];
  const target = state.players[2];
  const rescuer = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = source.id;
  state.phase = "play";
  state.luoyiActivePlayerId = source.id;
  target.hp = 1;
  source.hand = [{ id: "deep-dying-duel-1", kind: "duel", suit: "spade", point: 9 }];
  target.hand = [{ id: "deep-dying-peach-self", kind: "peach", suit: "heart", point: 6 }];
  rescuer.hand = [{ id: "deep-dying-peach-ally", kind: "peach", suit: "diamond", point: 7 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "deep-dying-duel-1",
    targetId: target.id
  });

  assert.equal(target.alive, true);
  assert.equal(target.hp, 1);
  assert.ok(state.discard.some((card) => card.id === "deep-dying-peach-self"));
  assert.ok(state.discard.some((card) => card.id === "deep-dying-peach-ally"));
});

/**
 * 验证主公技【救援】在深度濒死时按每张桃生效，单桃可额外回复1点。
 */
test("jiuyuan should rescue deep dying lord with one ally peach", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const lord = state.players[0];
  const ally = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, lord.id, STANDARD_SKILL_IDS.sunquanJiuyuan);
  assignSkillToPlayer(state, ally.id, STANDARD_SKILL_IDS.lvmengKeji);

  state.currentPlayerId = source.id;
  state.phase = "play";
  state.luoyiActivePlayerId = source.id;
  lord.hp = 1;
  source.hand = [{ id: "deep-jiuyuan-duel-1", kind: "duel", suit: "spade", point: 8 }];
  ally.hand = [{ id: "deep-jiuyuan-peach-1", kind: "peach", suit: "heart", point: 9 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "deep-jiuyuan-duel-1",
    targetId: lord.id
  });

  assert.equal(lord.alive, true);
  assert.equal(lord.hp, 1);
  assert.ok(state.discard.some((card) => card.id === "deep-jiuyuan-peach-1"));
});

/**
 * 验证主公技【救援】不会由非吴势力角色触发额外回复。
 */
test("jiuyuan should not grant extra heal from non-wu rescuer", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const lord = state.players[0];
  const ally = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, lord.id, STANDARD_SKILL_IDS.sunquanJiuyuan);
  assignSkillToPlayer(state, ally.id, STANDARD_SKILL_IDS.zhangfeiPaoxiao);

  state.currentPlayerId = source.id;
  state.phase = "play";
  lord.hp = 1;
  source.hand = [{ id: "jiuyuan-nonwu-slash-1", kind: "slash", suit: "spade", point: 7 }];
  ally.hand = [{ id: "jiuyuan-nonwu-peach-1", kind: "peach", suit: "heart", point: 10 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "jiuyuan-nonwu-slash-1",
    targetId: lord.id
  });

  assert.equal(lord.hp, 1);
});

/**
 * 验证濒死求桃询问顺序按“当前回合角色起始座次”，而非固定玩家数组顺序。
 */
test("dying rescue should ask peaches from current-player seat order", () => {
  const state = createInitialGame(42);
  const source = state.players[3];
  const target = state.players[4];
  const player = state.players[0];

  for (const participant of state.players) {
    participant.hand = [];
  }

  state.currentPlayerId = source.id;
  state.phase = "play";
  target.hp = 1;
  source.hand = [{ id: "rescue-order-slash-1", kind: "slash", suit: "spade", point: 8 }];
  target.hand = [{ id: "rescue-order-self-peach", kind: "peach", suit: "heart", point: 6 }];
  player.hand = [{ id: "rescue-order-player-peach", kind: "peach", suit: "diamond", point: 7 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "rescue-order-slash-1",
    targetId: target.id
  });

  assert.equal(target.alive, true);
  assert.equal(target.hp, 1);
  assert.ok(state.discard.some((card) => card.id === "rescue-order-self-peach"));
  assert.equal(state.discard.some((card) => card.id === "rescue-order-player-peach"), false);
});

/**
 * 验证濒死日志语义：进入濒死、按轮次求桃、成功脱离濒死。
 */
test("dying flow should emit enter-round-exit events", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const target = state.players[0];

  for (const participant of state.players) {
    participant.hand = [];
  }

  state.currentPlayerId = source.id;
  state.phase = "play";
  state.luoyiActivePlayerId = source.id;
  target.hp = 1;
  source.hand = [{ id: "dying-log-duel-1", kind: "duel", suit: "spade", point: 8 }];
  target.hand = [
    { id: "dying-log-peach-a", kind: "peach", suit: "heart", point: 6 },
    { id: "dying-log-peach-b", kind: "peach", suit: "diamond", point: 7 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "dying-log-duel-1",
    targetId: target.id
  });

  const enterDying = state.events.some((event) => event.type === "dying" && event.message.includes("进入濒死状态"));
  const rescueRounds = state.events.filter((event) => event.type === "rescue" && event.message.includes("发起第")).length;
  const leaveDying = state.events.some((event) => event.type === "dying" && event.message.includes("已脱离濒死"));

  assert.equal(enterDying, true);
  assert.equal(rescueRounds, 2);
  assert.equal(leaveDying, true);
  assert.equal(target.alive, true);
  assert.equal(target.hp, 1);
});

/**
 * 验证连锁双死场景下，胜负结算事件应在死亡事件之后写入日志。
 */
test("game-over should be emitted after chained deaths resolve", () => {
  const state = createInitialGame(42);
  const lord = state.players[0];
  const ganglieOwner = state.players[2];

  for (const participant of state.players) {
    participant.hand = [];
  }

  assignSkillToPlayer(state, ganglieOwner.id, STANDARD_SKILL_IDS.xiahoudunGanglie);

  state.currentPlayerId = lord.id;
  state.phase = "play";
  lord.hp = 1;
  ganglieOwner.hp = 1;
  lord.hand = [{ id: "chain-death-duel-1", kind: "duel", suit: "spade", point: 12 }];
  state.deck = [{ id: "chain-death-ganglie-judge-1", kind: "slash", suit: "spade", point: 9 }, ...state.deck];

  applyAction(state, {
    type: "play-card",
    actorId: lord.id,
    cardId: "chain-death-duel-1",
    targetId: ganglieOwner.id
  });

  const deathIndexes = state.events
    .map((event, index) => ({ event, index }))
    .filter((item) => item.event.type === "death")
    .map((item) => item.index);
  const gameOverIndex = state.events.findIndex((event) => event.type === "game-over");

  assert.equal(deathIndexes.length, 2);
  assert.ok(gameOverIndex > Math.max(...deathIndexes));
  assert.equal(state.winner, "rebel-side");
});

/**
 * 验证华佗【青囊】可弃一张手牌令目标回复1点且每回合限一次。
 */
test("qingnang skill should heal once per turn by discarding one card", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const target = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.huatuoQingnang);

  state.currentPlayerId = actor.id;
  state.phase = "play";
  target.hp = target.maxHp - 1;
  actor.hand = [
    { id: "qingnang-cost-1", kind: "slash", suit: "spade", point: 3 },
    { id: "qingnang-cost-2", kind: "dodge", suit: "club", point: 12 }
  ];

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "__virtual_qingnang__::qingnang-cost-1",
    targetId: target.id
  });

  assert.equal(target.hp, target.maxHp);
  const qingnangAgainLegal = getLegalActions(state).some(
    (action) => action.type === "play-card" && action.cardId === "__virtual_qingnang__::qingnang-cost-2"
  );
  assert.equal(qingnangAgainLegal, false);
});

/**
 * 验证华佗【急救】可在回合外将红色手牌当【桃】救援。
 */
test("jijiu skill should allow red card as peach outside own turn", () => {
  const state = createInitialGame(42);
  const source = state.players[2];
  const target = state.players[0];
  const rescuer = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, rescuer.id, STANDARD_SKILL_IDS.huatuoJijiu);

  state.currentPlayerId = source.id;
  state.phase = "play";
  source.equipment.weapon = { id: "jijiu-weapon-1", kind: "weapon_qinggang_sword", suit: "heart", point: 2 };
  target.hp = 1;
  source.hand = [{ id: "jijiu-slash-1", kind: "slash", suit: "spade", point: 10 }];
  rescuer.hand = [{ id: "jijiu-red-1", kind: "dodge", suit: "heart", point: 5 }];

  applyAction(state, {
    type: "play-card",
    actorId: source.id,
    cardId: "jijiu-slash-1",
    targetId: target.id
  });

  assert.equal(target.hp, 1);
  assert.ok(state.discard.some((card) => card.id === "jijiu-red-1"));
});
