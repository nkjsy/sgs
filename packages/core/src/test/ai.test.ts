import assert from "node:assert/strict";
import test from "node:test";
import { chooseAiAction, createAiDecisionContext } from "../ai";
import { createInitialGame } from "../engine";

/**
 * 验证 AI 使用【杀】时会优先压低血线敌方目标。
 */
test("ai should prioritize low-hp enemy when choosing slash target", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const enemyInRange = state.players[1];
  const allyInRange = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-slash-1", kind: "slash", suit: "spade", point: 7 }];

  enemyInRange.hp = 1;
  enemyInRange.maxHp = 4;
  allyInRange.hp = 1;
  allyInRange.maxHp = 4;
  state.events.push({ type: "rescue", message: `${enemyInRange.name} 使用桃救回 你` });
  state.events.push({ type: "damage", message: `${allyInRange.name} 对 你 造成 1 点伤害` });

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-slash-1");
  assert.equal(action.targetId, enemyInRange.id);
});

/**
 * 验证内奸 AI 会优先攻击场上更占优的一方。
 */
test("renegade ai should pressure stronger camp first", () => {
  const state = createInitialGame(42);
  const actor = state.players[4];
  const rebel = state.players[3];
  const lord = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-slash-2", kind: "slash", suit: "club", point: 9 }];

  // 让“反贼阵营人数 >= 主忠阵营人数”，内奸应优先压反贼。
  state.players[1].alive = false;
  state.events.push({ type: "damage", message: `${rebel.name} 对 ${lord.name} 造成 1 点伤害` });

  rebel.hp = 2;
  lord.hp = 2;

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-slash-2");
  assert.equal(action.targetId, rebel.id);
});

/**
 * 验证 AI 使用【决斗】时会优先选择手牌更少的敌方目标。
 */
test("ai should use duel on enemy with fewer hand cards", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const enemyA = state.players[2];
  const enemyB = state.players[3];
  const renegade = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-duel-1", kind: "duel", suit: "heart", point: 1 }];
  renegade.alive = false;
  state.events.push({ type: "damage", message: `${enemyA.name} 对 你 造成 1 点伤害` });
  state.events.push({ type: "damage", message: `${enemyB.name} 对 你 造成 1 点伤害` });

  enemyA.hand = [
    { id: "duel-a-1", kind: "slash", suit: "spade", point: 4 },
    { id: "duel-a-2", kind: "slash", suit: "club", point: 5 },
    { id: "duel-a-3", kind: "dodge", suit: "heart", point: 8 }
  ];
  enemyB.hand = [{ id: "duel-b-1", kind: "dodge", suit: "diamond", point: 11 }];

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-duel-1");
  assert.equal(action.targetId, enemyB.id);
});

/**
 * 验证 AI 不直接读取隐藏身份，而是依据行为推断阵营倾向。
 */
test("ai should prioritize behavior inference over hidden identity label", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const targetA = state.players[2];
  const targetB = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-slash-infer-1", kind: "slash", suit: "spade", point: 6 }];

  // 刻意制造“身份标签与行为冲突”：A 标签偏友方但行为敌对，B 标签偏敌方但行为友方。
  targetA.identity = "loyalist";
  targetB.identity = "rebel";
  state.events.push({ type: "damage", message: `${targetA.name} 对 你 造成 1 点伤害` });
  state.events.push({ type: "rescue", message: `${targetB.name} 使用桃救回 你` });

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-slash-infer-1");
  assert.equal(action.targetId, targetA.id);
});

/**
 * 验证 AI 会在收益更高时替换已有武器。
 */
test("ai should replace current weapon with higher-value weapon", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.equipment.weapon = { id: "ai-old-weapon", kind: "weapon_double_sword", suit: "spade", point: 2 };
  actor.hand = [
    { id: "ai-equip-crossbow", kind: "weapon_crossbow", suit: "club", point: 1 },
    { id: "ai-slash-equip-1", kind: "slash", suit: "spade", point: 7 },
    { id: "ai-slash-equip-2", kind: "slash", suit: "heart", point: 8 }
  ];

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-equip-crossbow");
});

/**
 * 验证行为推断会给予近期事件更高权重。
 */
test("ai should weight recent hostility higher than old hostility", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const oldHostile = state.players[1];
  const recentHostile = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-slash-recent-1", kind: "slash", suit: "spade", point: 6 }];

  state.events.push({ type: "damage", message: `${oldHostile.name} 对 ${actor.name} 造成 1 点伤害` });
  state.events.push({ type: "rescue", message: `${oldHostile.name} 使用桃救回 ${actor.name}` });
  state.events.push({ type: "damage", message: `${recentHostile.name} 对 ${actor.name} 造成 1 点伤害` });

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-slash-recent-1");
  assert.equal(action.targetId, recentHostile.id);
});

/**
 * 验证主忠方 AI 不会主动把主公当作攻击目标。
 */
test("loyalist ai should not attack the lord on opening action", () => {
  const state = createInitialGame(42);
  const lord = state.players[0];
  const loyalist = state.players[1];

  for (const player of state.players) {
    player.hand = [];
  }

  loyalist.identity = "loyalist";
  lord.identity = "lord";
  state.currentPlayerId = loyalist.id;
  state.phase = "play";
  loyalist.hand = [{ id: "ai-loyalist-slash-1", kind: "slash", suit: "spade", point: 7 }];

  const action = chooseAiAction(createAiDecisionContext(state, loyalist.id));

  assert.equal(action.type, "end-play-phase");
});

/**
 * 验证主公在无行为证据时可主动攻击未知身份目标（可能误伤忠臣）。
 */
test("lord ai may attack unknown target without evidence", () => {
  const state = createInitialGame(42);
  const lord = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  lord.identity = "lord";
  state.currentPlayerId = lord.id;
  state.phase = "play";
  lord.hand = [{ id: "ai-lord-slash-unknown-1", kind: "slash", suit: "spade", point: 8 }];

  const action = chooseAiAction(createAiDecisionContext(state, lord.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-lord-slash-unknown-1");
  assert.notEqual(action.targetId, lord.id);
});
