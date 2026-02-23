import assert from "node:assert/strict";
import test from "node:test";
import { createDeck } from "../cards";
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
 * 验证【无中生有】生效时目标摸 2 张牌。
 */
test("ex nihilo should let target draw 2 cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const target = state.players[1];

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

  applyAction(state, {
    type: "play-card",
    actorId: actor.id,
    cardId: "ex-nihilo-1",
    targetId: target.id
  });

  assert.equal(target.hand.length, 2);
  assert.ok(state.discard.some((card) => card.id === "ex-nihilo-1"));
});

/**
 * 验证【无中生有】可被【无懈可击】抵消。
 */
test("ex nihilo should be canceled by nullify", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const target = state.players[0];
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
    targetId: target.id
  });

  assert.equal(target.hand.length, 0);
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
