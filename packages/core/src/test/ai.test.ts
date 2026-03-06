import assert from "node:assert/strict";
import test from "node:test";
import { chooseAiAction, createAiDecisionContext } from "../ai";
import { createInitialGame } from "../engine";
import { STANDARD_SKILL_IDS, assignSkillToPlayer } from "../skills";

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

test("renegade ai should avoid attacking low-hp lord before final duel", () => {
  const state = createInitialGame(42);
  const lord = state.players[0];
  const rebel = state.players[2];
  const actor = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  state.players[1].alive = false;
  state.players[3].alive = false;
  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-renegade-slash-hold-1", kind: "slash", suit: "spade", point: 7 }];
  lord.hp = 1;

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(lord.alive, true);
  assert.equal(rebel.alive, true);
  assert.equal(action.type, "end-play-phase");
});

test("renegade ai should attack lord in final duel", () => {
  const state = createInitialGame(42);
  const lord = state.players[0];
  const actor = state.players[4];

  for (const player of state.players) {
    player.hand = [];
  }

  state.players[1].alive = false;
  state.players[2].alive = false;
  state.players[3].alive = false;
  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-renegade-slash-finish-1", kind: "slash", suit: "club", point: 9 }];

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-renegade-slash-finish-1");
  assert.equal(action.targetId, lord.id);
});

test("renegade ai should prioritize inferred loyalist target before lord when lord-side is clearly stronger", () => {
  const state = createInitialGame(42);
  const lord = state.players[0];
  const actor = state.players[4];
  const likelyLoyalistA = state.players[1];
  const likelyLoyalistB = state.players[2];
  const likelyRebel = state.players[3];

  for (const player of state.players) {
    player.hand = [];
  }

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-renegade-slash-balance-1", kind: "slash", suit: "heart", point: 11 }];
  actor.equipment.weapon = { id: "ai-renegade-range-weapon-1", kind: "weapon_qinggang_sword" };

  lord.hp = 3;
  likelyRebel.hp = 4;
  state.events.push({ type: "rescue", message: `${likelyLoyalistA.name} 使用桃救回 ${lord.name}` });
  state.events.push({ type: "rescue", message: `${likelyLoyalistB.name} 使用桃救回 ${lord.name}` });
  state.events.push({ type: "damage", message: `${likelyRebel.name} 对 ${lord.name} 造成 1 点伤害` });

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-renegade-slash-balance-1");
  assert.notEqual(action.targetId, lord.id);
  assert.equal(
    action.targetId === likelyLoyalistA.id || action.targetId === likelyLoyalistB.id,
    true
  );
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

/**
 * 验证忠臣对“已推断为主忠方”的目标保持克制，不因轻微敌意误伤。
 */
test("loyalist ai should avoid attacking inferred lord-side target despite minor hostility", () => {
  const state = createInitialGame(42);
  const lord = state.players[0];
  const loyalist = state.players[1];
  const inferredAlly = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  loyalist.identity = "loyalist";
  lord.identity = "lord";
  state.players[3].alive = false;
  state.players[4].alive = false;

  state.currentPlayerId = loyalist.id;
  state.phase = "play";
  loyalist.hand = [{ id: "ai-loyalist-slash-safe-1", kind: "slash", suit: "spade", point: 8 }];

  state.events.push({ type: "damage", message: `${inferredAlly.name} 对 ${loyalist.name} 造成 1 点伤害` });
  state.events.push({ type: "rescue", message: `${inferredAlly.name} 使用桃救回 ${lord.name}` });

  const action = chooseAiAction(createAiDecisionContext(state, loyalist.id));

  assert.equal(action.type, "end-play-phase");
});

/**
 * 验证反贼对“已推断为反贼方”的目标保持克制，不因轻微敌意误伤。
 */
test("rebel ai should avoid attacking inferred rebel-side target despite minor hostility", () => {
  const state = createInitialGame(42);
  const rebel = state.players[2];
  const inferredAlly = state.players[3];
  const lord = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  rebel.identity = "rebel";
  inferredAlly.identity = "rebel";
  state.players[1].alive = false;
  state.players[4].alive = false;

  state.currentPlayerId = rebel.id;
  state.phase = "play";
  rebel.hand = [{ id: "ai-rebel-slash-safe-1", kind: "slash", suit: "spade", point: 8 }];

  state.events.push({ type: "damage", message: `${inferredAlly.name} 对 ${rebel.name} 造成 1 点伤害` });
  state.events.push({ type: "damage", message: `${inferredAlly.name} 对 ${lord.name} 造成 1 点伤害` });

  const action = chooseAiAction(createAiDecisionContext(state, rebel.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-rebel-slash-safe-1");
  assert.equal(action.targetId, lord.id);
});

/**
 * 验证甘宁 AI 使用【奇袭】时不会误拆同阵营目标。
 */
test("ai qixi should avoid dismantling inferred same-camp target", () => {
  const state = createInitialGame(42);
  const actor = state.players[2];
  const inferredAlly = state.players[3];
  const lord = state.players[0];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.ganningQixi);
  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.identity = "rebel";
  inferredAlly.identity = "rebel";
  state.players[1].alive = false;
  state.players[4].alive = false;
  actor.hand = [{ id: "ai-qixi-source-1", kind: "dodge", suit: "spade", point: 7 }];
  lord.hand = [{ id: "ai-qixi-lord-card-1", kind: "slash", suit: "heart", point: 8 }];
  inferredAlly.hand = [{ id: "ai-qixi-ally-card-1", kind: "dodge", suit: "club", point: 9 }];

  state.events.push({ type: "damage", message: `${inferredAlly.name} 对 ${lord.name} 造成 1 点伤害` });

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.ok(action.cardId.startsWith("__virtual_qixi__::"));
  assert.equal(action.targetId, lord.id);
});

/**
 * 验证刘备 AI 在仁德可选目标中会优先同阵营而非敌方。
 */
test("ai rende should not target inferred enemy", () => {
  const state = createInitialGame(42);
  const actor = state.players[0];
  const ally = state.players[1];
  const enemy = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.liubeiRende);
  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.identity = "lord";
  actor.hp = 3;
  ally.identity = "loyalist";
  enemy.identity = "rebel";
  actor.hand = [
    { id: "ai-rende-card-1", kind: "dodge", suit: "heart", point: 3 },
    { id: "ai-rende-card-2", kind: "dodge", suit: "spade", point: 7 },
    { id: "ai-rende-card-3", kind: "nullify", suit: "diamond", point: 10 },
    { id: "ai-rende-card-4", kind: "nullify", suit: "club", point: 11 },
    { id: "ai-rende-card-5", kind: "dodge", suit: "spade", point: 9 }
  ];

  state.events.push({ type: "rescue", message: `${ally.name} 使用桃救回 ${actor.name}` });
  state.events.push({ type: "damage", message: `${enemy.name} 对 ${actor.name} 造成 1 点伤害` });

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  if (action.type === "play-card" && action.cardId.startsWith("__virtual_rende__::")) {
    assert.equal(action.targetId, ally.id);
  } else {
    assert.equal(action.type, "end-play-phase");
  }
});

/**
 * 验证敌意较高时，AI 会优先进攻而非先发动发育型技能。
 */
test("ai should prefer slash over zhiheng under high hostility", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const hostileTarget = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  assignSkillToPlayer(state, actor.id, STANDARD_SKILL_IDS.sunquanZhiheng);
  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hp = 3;
  actor.maxHp = 4;
  actor.hand = [
    { id: "ai-aggr-slash-1", kind: "slash", suit: "spade", point: 8 },
    { id: "ai-aggr-extra-1", kind: "dodge", suit: "heart", point: 6 },
    { id: "ai-aggr-extra-2", kind: "dodge", suit: "diamond", point: 7 },
    { id: "ai-aggr-extra-3", kind: "nullify", suit: "club", point: 9 },
    { id: "ai-aggr-extra-4", kind: "lightning", suit: "spade", point: 1 },
    { id: "ai-aggr-extra-5", kind: "armor_renwang_shield", suit: "club", point: 2 }
  ];

  state.events.push({ type: "damage", message: `${hostileTarget.name} 对 ${actor.name} 造成 1 点伤害` });
  state.events.push({ type: "damage", message: `${hostileTarget.name} 对 ${actor.name} 造成 1 点伤害` });

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "play-card");
  assert.equal(action.cardId, "ai-aggr-slash-1");
  assert.equal(action.targetId, hostileTarget.id);
});

/**
 * 验证有人死亡并暴露身份后，AI 会据此修正对过往行为的阵营判断。
 */
test("ai should revise inference after revealed identity on death", () => {
  const state = createInitialGame(42);
  const actor = state.players[1];
  const revealedDeadAlly = state.players[0];
  const uncertainSource = state.players[2];

  for (const player of state.players) {
    player.hand = [];
  }

  actor.identity = "loyalist";
  revealedDeadAlly.identity = "lord";
  revealedDeadAlly.alive = false;
  uncertainSource.identity = "rebel";
  state.players[3].alive = false;
  state.players[4].alive = false;

  state.currentPlayerId = actor.id;
  state.phase = "play";
  actor.hand = [{ id: "ai-revise-slash-1", kind: "slash", suit: "spade", point: 7 }];

  // 先给出“疑似敌对”信号，再给出“救主”信号；由于主公已死亡并暴露身份，后者应触发修正。
  state.events.push({ type: "damage", message: `${uncertainSource.name} 对 ${actor.name} 造成 1 点伤害` });
  state.events.push({ type: "rescue", message: `${uncertainSource.name} 使用桃救回 ${revealedDeadAlly.name}` });

  const action = chooseAiAction(createAiDecisionContext(state, actor.id));

  assert.equal(action.type, "end-play-phase");
});
