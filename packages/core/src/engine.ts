import { createDeck, shuffleWithSeed } from "./cards";
import {
  Card,
  CardKind,
  EndPlayPhaseAction,
  GameState,
  Identity,
  PlayCardAction,
  PlayerState,
  TurnAction
} from "./types";

const EQUIPMENT_KINDS: CardKind[] = [
  "weapon_crossbow",
  "weapon_double_sword",
  "weapon_qinggang_sword",
  "weapon_blade",
  "weapon_spear",
  "weapon_axe",
  "weapon_halberd",
  "weapon_kylin_bow",
  "weapon_ice_sword",
  "armor_eight_diagram",
  "armor_renwang_shield",
  "horse_jueying",
  "horse_dilu",
  "horse_zhuahuangfeidian",
  "horse_chitu",
  "horse_dayuan",
  "horse_zixing",
  "horse_plus",
  "horse_minus"
];
const DELAYED_TRICK_KINDS: CardKind[] = ["indulgence", "lightning"];

/**
 * 创建一局 5 人身份局的初始状态。
 *
 * @param seed 固定随机种子，用于确保复盘一致。
 * @returns 初始化后的游戏状态。
 */
export function createInitialGame(seed: number): GameState {
  const identities: Identity[] = ["lord", "loyalist", "rebel", "rebel", "renegade"];
  const players: PlayerState[] = identities.map((identity, index) => ({
    id: `P${index + 1}`,
    name: index === 0 ? "你" : `AI-${index}`,
    identity,
    hp: identity === "lord" ? 5 : 4,
    maxHp: identity === "lord" ? 5 : 4,
    hand: [],
    alive: true,
    isAi: index !== 0,
    equipment: {
      weapon: null,
      armor: null,
      horsePlus: null,
      horseMinus: null
    },
    judgmentZone: {
      delayedTricks: []
    }
  }));

  const fullDeck = shuffleWithSeed(createDeck(), seed);
  const state: GameState = {
    currentPlayerId: players[0].id,
    phase: "draw",
    players,
    deck: fullDeck,
    discard: [],
    events: [],
    turnCount: 1,
    slashUsedInTurn: 0,
    skipPlayPhaseForCurrentTurn: false,
    winner: null,
    seed
  };

  for (const player of players) {
    drawCards(state, player.id, 4);
  }

  pushEvent(state, "game-start", `游戏开始，随机种子=${seed}`);
  return state;
}

/**
 * 推进当前回合到下一个阶段或玩家。
 *
 * @param state 当前游戏状态。
 */
export function stepPhase(state: GameState): void {
  if (state.winner) {
    return;
  }

  const current = requireAlivePlayer(state, state.currentPlayerId);

  if (state.phase === "judge") {
    resolveJudgePhase(state, current.id);
    state.phase = "draw";
    pushEvent(state, "phase", `${current.name} 进入摸牌阶段`);
    return;
  }

  if (state.phase === "draw") {
    drawCards(state, current.id, 2);

    if (state.skipPlayPhaseForCurrentTurn) {
      state.phase = "discard";
      pushEvent(state, "phase", `${current.name} 跳过出牌阶段，进入弃牌阶段`);
      return;
    }

    state.phase = "play";
    pushEvent(state, "phase", `${current.name} 进入出牌阶段`);
    return;
  }

  if (state.phase === "play") {
    state.phase = "discard";
    pushEvent(state, "phase", `${current.name} 进入弃牌阶段`);
    return;
  }

  if (state.phase === "discard") {
    resolveDiscardIfNeeded(state, current.id);
    state.phase = "end";
    pushEvent(state, "phase", `${current.name} 进入结束阶段`);
    return;
  }

  advanceTurn(state);
}

/**
 * 获取当前行动玩家可执行的合法动作。
 *
 * @param state 当前游戏状态。
 * @returns 合法动作列表。
 */
export function getLegalActions(state: GameState): TurnAction[] {
  if (state.winner) {
    return [];
  }

  if (state.phase !== "play") {
    return [];
  }

  const actor = requireAlivePlayer(state, state.currentPlayerId);
  const actions: TurnAction[] = [];

  for (const card of actor.hand) {
    if (card.kind === "slash") {
      if (state.slashUsedInTurn >= 1) {
        continue;
      }

      for (const target of getAliveOpponents(state, actor.id).filter((candidate) => isInAttackRange(state, actor.id, candidate.id))) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: card.id,
          targetId: target.id
        });
      }
      continue;
    }

    if (card.kind === "dismantle") {
      for (const target of getAliveOpponents(state, actor.id).filter((candidate) => candidate.hand.length > 0)) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: card.id,
          targetId: target.id
        });
      }
      continue;
    }

    if (card.kind === "snatch") {
      for (const target of getAliveOpponents(state, actor.id).filter(
        (candidate) => candidate.hand.length > 0 && getDistance(state, actor.id, candidate.id) <= 1
      )) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: card.id,
          targetId: target.id
        });
      }
      continue;
    }

    if (card.kind === "duel") {
      for (const target of getAliveOpponents(state, actor.id)) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: card.id,
          targetId: target.id
        });
      }
      continue;
    }

    if (card.kind === "collateral") {
      const firstTargets = getAliveOpponents(state, actor.id).filter((candidate) => candidate.equipment.weapon !== null);
      for (const firstTarget of firstTargets) {
        const secondTargets = getAliveOpponents(state, firstTarget.id).filter((candidate) => isInAttackRange(state, firstTarget.id, candidate.id));
        for (const secondTarget of secondTargets) {
          actions.push({
            type: "play-card",
            actorId: actor.id,
            cardId: card.id,
            targetId: firstTarget.id,
            secondaryTargetId: secondTarget.id
          });
        }
      }
      continue;
    }

    if (isEquipmentKind(card.kind)) {
      actions.push({
        type: "play-card",
        actorId: actor.id,
        cardId: card.id,
        targetId: actor.id
      });
      continue;
    }

    if (card.kind === "indulgence") {
      for (const target of getAliveOpponents(state, actor.id).filter((candidate) => !hasDelayedTrick(candidate, "indulgence"))) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: card.id,
          targetId: target.id
        });
      }
      continue;
    }

    if (card.kind === "lightning") {
      if (!hasDelayedTrick(actor, "lightning")) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: card.id,
          targetId: actor.id
        });
      }
      continue;
    }

    if (card.kind === "barbarian" || card.kind === "archery") {
      if (getAliveOpponents(state, actor.id).length > 0) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: card.id
        });
      }
      continue;
    }

    if (card.kind === "taoyuan" || card.kind === "harvest") {
      actions.push({
        type: "play-card",
        actorId: actor.id,
        cardId: card.id
      });
      continue;
    }

    if (card.kind === "ex_nihilo") {
      for (const target of getAlivePlayersFrom(state, actor.id)) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: card.id,
          targetId: target.id
        });
      }
      continue;
    }

    if (card.kind === "peach" && actor.hp < actor.maxHp) {
      actions.push({
        type: "play-card",
        actorId: actor.id,
        cardId: card.id,
        targetId: actor.id
      });
    }
  }

  actions.push({ type: "end-play-phase", actorId: actor.id });
  return actions;
}

/**
 * 执行一个回合动作并应用到状态。
 *
 * @param state 当前游戏状态。
 * @param action 要执行的动作。
 */
export function applyAction(state: GameState, action: TurnAction): void {
  if (state.winner || state.phase !== "play") {
    return;
  }

  if (action.type === "end-play-phase") {
    applyEndPlayPhase(state, action);
    return;
  }

  applyPlayCard(state, action);
}

/**
 * 判断并写入胜利结果。
 *
 * @param state 当前游戏状态。
 */
export function updateWinner(state: GameState): void {
  if (state.winner) {
    return;
  }

  const alive = state.players.filter((player) => player.alive);
  const lordAlive = alive.some((player) => player.identity === "lord");
  const rebelAlive = alive.some((player) => player.identity === "rebel");
  const loyalAlive = alive.some((player) => player.identity === "loyalist");
  const renegadeAlive = alive.some((player) => player.identity === "renegade");

  if (!lordAlive) {
    if (renegadeAlive && alive.length === 1) {
      state.winner = "renegade";
      pushEvent(state, "game-over", "内奸获胜");
      return;
    }

    state.winner = "rebel-side";
    pushEvent(state, "game-over", "反贼阵营获胜");
    return;
  }

  if (!rebelAlive && !renegadeAlive) {
    state.winner = "lord-side";
    pushEvent(state, "game-over", loyalAlive ? "主忠阵营获胜" : "主公单独获胜");
  }
}

/**
 * 让指定玩家摸指定数量的牌。
 *
 * @param state 当前游戏状态。
 * @param playerId 玩家编号。
 * @param count 摸牌数量。
 */
export function drawCards(state: GameState, playerId: string, count: number): void {
  const player = requireAlivePlayer(state, playerId);
  let drawn = 0;

  for (let index = 0; index < count; index += 1) {
    if (state.deck.length === 0) {
      refillDeckFromDiscard(state);
    }
    const card = state.deck.shift();
    if (!card) {
      break;
    }
    player.hand.push(card);
    drawn += 1;
  }

  pushEvent(state, "draw", `${player.name} 摸了 ${drawn} 张牌`);
}

/**
 * 获取当前状态下所有事件日志。
 *
 * @param state 当前游戏状态。
 * @returns 事件消息字符串数组。
 */
export function getEventMessages(state: GameState): string[] {
  return state.events.map((event) => event.message);
}

function applyEndPlayPhase(state: GameState, action: EndPlayPhaseAction): void {
  if (action.actorId !== state.currentPlayerId) {
    return;
  }

  state.phase = "discard";
  pushEvent(state, "action", `${action.actorId} 主动结束出牌阶段`);
}

function applyPlayCard(state: GameState, action: PlayCardAction): void {
  const actor = requireAlivePlayer(state, action.actorId);
  if (actor.id !== state.currentPlayerId) {
    return;
  }

  const card = removeCardFromHand(actor, action.cardId);
  if (!card) {
    return;
  }

  if (card.kind === "peach") {
    if (actor.hp < actor.maxHp) {
      actor.hp += 1;
      pushEvent(state, "card", `${actor.name} 使用桃，恢复 1 点体力`);
    }
    state.discard.push(card);
    return;
  }

  if (card.kind === "slash") {
    const target = action.targetId ? getPlayerById(state, action.targetId) : null;
    if (!target || !target.alive || target.id === actor.id) {
      actor.hand.push(card);
      return;
    }

    if (state.slashUsedInTurn >= 1) {
      actor.hand.push(card);
      return;
    }

    state.slashUsedInTurn += 1;

    pushEvent(state, "card", `${actor.name} 对 ${target.name} 使用杀`);
    const dodgeCard = consumeFirstCardByKind(target, "dodge");
    if (dodgeCard) {
      state.discard.push(dodgeCard);
      pushEvent(state, "response", `${target.name} 打出闪，抵消杀`);
      state.discard.push(card);
      return;
    }

    dealDamage(state, actor.id, target.id, 1);
    state.discard.push(card);
    return;
  }

  if (card.kind === "dismantle" || card.kind === "snatch") {
    const target = action.targetId ? getPlayerById(state, action.targetId) : null;
    if (!target || !target.alive || target.id === actor.id || target.hand.length === 0) {
      actor.hand.push(card);
      return;
    }

    if (card.kind === "snatch" && getDistance(state, actor.id, target.id) > 1) {
      actor.hand.push(card);
      return;
    }

    const trickName = card.kind === "dismantle" ? "过河拆桥" : "顺手牵羊";
    pushEvent(state, "card", `${actor.name} 对 ${target.name} 使用${trickName}`);

    const negated = resolveNullifyChain(state, actor.id, target.id, card.kind);
    if (negated) {
      pushEvent(state, "nullify", `${trickName} 被无懈可击抵消`);
      state.discard.push(card);
      return;
    }

    if (target.hand.length === 0) {
      state.discard.push(card);
      return;
    }

    const movedCard = target.hand.shift() as Card;
    if (card.kind === "dismantle") {
      state.discard.push(movedCard);
      pushEvent(state, "trick", `${actor.name} 弃置了 ${target.name} 的 1 张手牌`);
    } else {
      actor.hand.push(movedCard);
      pushEvent(state, "trick", `${actor.name} 获得了 ${target.name} 的 1 张手牌`);
    }

    state.discard.push(card);
    return;
  }

  if (card.kind === "duel") {
    const target = action.targetId ? getPlayerById(state, action.targetId) : null;
    if (!target || !target.alive || target.id === actor.id) {
      actor.hand.push(card);
      return;
    }

    pushEvent(state, "card", `${actor.name} 对 ${target.name} 使用决斗`);
    const negated = resolveNullifyChain(state, actor.id, target.id, card.kind);
    if (negated) {
      pushEvent(state, "nullify", "决斗 被无懈可击抵消");
      state.discard.push(card);
      return;
    }

    resolveDuel(state, actor.id, target.id);
    state.discard.push(card);
    return;
  }

  if (card.kind === "collateral") {
    const weaponHolder = action.targetId ? getPlayerById(state, action.targetId) : null;
    const slashTarget = action.secondaryTargetId ? getPlayerById(state, action.secondaryTargetId) : null;
    if (
      !weaponHolder ||
      !weaponHolder.alive ||
      weaponHolder.id === actor.id ||
      !weaponHolder.equipment.weapon ||
      !slashTarget ||
      !slashTarget.alive ||
      slashTarget.id === weaponHolder.id ||
      !isInAttackRange(state, weaponHolder.id, slashTarget.id)
    ) {
      actor.hand.push(card);
      return;
    }

    pushEvent(state, "card", `${actor.name} 对 ${weaponHolder.name} 使用借刀杀人，指定 ${slashTarget.name} 为目标`);
    const negated = resolveNullifyChain(state, actor.id, weaponHolder.id, card.kind);
    if (negated) {
      pushEvent(state, "nullify", "借刀杀人 被无懈可击抵消");
      state.discard.push(card);
      return;
    }

    const slash = consumeFirstCardByKind(weaponHolder, "slash");
    if (slash) {
      state.discard.push(slash);
      pushEvent(state, "response", `${weaponHolder.name} 被迫对 ${slashTarget.name} 使用杀`);

      const dodge = consumeFirstCardByKind(slashTarget, "dodge");
      if (dodge) {
        state.discard.push(dodge);
        pushEvent(state, "response", `${slashTarget.name} 打出闪，抵消借刀杀人的杀`);
      } else {
        dealDamage(state, weaponHolder.id, slashTarget.id, 1);
      }
    } else if (weaponHolder.equipment.weapon) {
      const takenWeapon = weaponHolder.equipment.weapon;
      weaponHolder.equipment.weapon = null;
      actor.hand.push(takenWeapon);
      pushEvent(state, "trick", `${weaponHolder.name} 未打出杀，武器被 ${actor.name} 获得`);
    }

    state.discard.push(card);
    return;
  }

  if (card.kind === "taoyuan") {
    pushEvent(state, "card", `${actor.name} 使用桃园结义`);
    resolveTaoyuan(state, actor.id);
    state.discard.push(card);
    return;
  }

  if (card.kind === "harvest") {
    pushEvent(state, "card", `${actor.name} 使用五谷丰登`);
    resolveHarvest(state, actor.id);
    state.discard.push(card);
    return;
  }

  if (card.kind === "ex_nihilo") {
    const target = action.targetId ? getPlayerById(state, action.targetId) : null;
    if (!target || !target.alive) {
      actor.hand.push(card);
      return;
    }

    pushEvent(state, "card", `${actor.name} 对 ${target.name} 使用无中生有`);
    const negated = resolveNullifyChain(state, actor.id, target.id, card.kind);
    if (negated) {
      pushEvent(state, "nullify", `${target.name} 的无中生有效果被无懈可击抵消`);
      state.discard.push(card);
      return;
    }

    drawCards(state, target.id, 2);
    state.discard.push(card);
    return;
  }

  if (isEquipmentKind(card.kind)) {
    equipCard(state, actor, card);
    return;
  }

  if (isDelayedTrickKind(card.kind)) {
    if (card.kind === "indulgence") {
      const target = action.targetId ? getPlayerById(state, action.targetId) : null;
      if (!target || !target.alive || target.id === actor.id || hasDelayedTrick(target, "indulgence")) {
        actor.hand.push(card);
        return;
      }

      target.judgmentZone.delayedTricks.push(card);
      pushEvent(state, "card", `${actor.name} 对 ${target.name} 使用乐不思蜀`);
      pushEvent(state, "trick", `乐不思蜀 进入 ${target.name} 的判定区`);
      return;
    }

    if (card.kind === "lightning") {
      if (hasDelayedTrick(actor, "lightning")) {
        actor.hand.push(card);
        return;
      }

      actor.judgmentZone.delayedTricks.push(card);
      pushEvent(state, "card", `${actor.name} 使用闪电`);
      pushEvent(state, "trick", `闪电 进入 ${actor.name} 的判定区`);
      return;
    }
  }

  if (card.kind === "barbarian" || card.kind === "archery") {
    const trickName = card.kind === "barbarian" ? "南蛮入侵" : "万箭齐发";
    pushEvent(state, "card", `${actor.name} 使用${trickName}`);

    const targets = getAliveOpponents(state, actor.id);
    for (const target of targets) {
      const negated = resolveNullifyChain(state, actor.id, target.id, card.kind);
      if (negated) {
        pushEvent(state, "nullify", `${target.name} 的${trickName}效果被无懈可击抵消`);
        continue;
      }

      if (card.kind === "barbarian") {
        const slash = consumeFirstCardByKind(target, "slash");
        if (slash) {
          state.discard.push(slash);
          pushEvent(state, "response", `${target.name} 打出杀响应南蛮入侵`);
          continue;
        }
      }

      if (card.kind === "archery") {
        const dodge = consumeFirstCardByKind(target, "dodge");
        if (dodge) {
          state.discard.push(dodge);
          pushEvent(state, "response", `${target.name} 打出闪响应万箭齐发`);
          continue;
        }
      }

      dealDamage(state, actor.id, target.id, 1);
      if (state.winner) {
        break;
      }
    }

    state.discard.push(card);
    return;
  }

  actor.hand.push(card);
}

/**
 * 结算【决斗】效果。
 *
 * 由目标开始与使用者轮流打出【杀】，首次无法打出者受到对方造成的 1 点伤害。
 *
 * @param state 当前游戏状态。
 * @param sourceId 决斗使用者。
 * @param targetId 决斗目标。
 */
function resolveDuel(state: GameState, sourceId: string, targetId: string): void {
  let current = requireAlivePlayer(state, targetId);
  let opponent = requireAlivePlayer(state, sourceId);

  while (current.alive && opponent.alive && !state.winner) {
    const slash = consumeFirstCardByKind(current, "slash");
    if (!slash) {
      dealDamage(state, opponent.id, current.id, 1);
      return;
    }

    state.discard.push(slash);
    pushEvent(state, "response", `${current.name} 在决斗中打出杀`);

    const nextCurrent = opponent;
    const nextOpponent = current;
    current = nextCurrent;
    opponent = nextOpponent;
  }
}

/**
 * 结算【桃园结义】效果。
 *
 * 所有存活角色各回复 1 点体力（不超过上限）。
 *
 * @param state 当前游戏状态。
 * @param sourceId 使用者编号。
 */
function resolveTaoyuan(state: GameState, sourceId: string): void {
  const participants = getAlivePlayersFrom(state, sourceId);
  for (const participant of participants) {
    const negated = resolveNullifyChain(state, sourceId, participant.id, "taoyuan");
    if (negated) {
      pushEvent(state, "nullify", `${participant.name} 的桃园结义效果被无懈可击抵消`);
      continue;
    }

    if (participant.hp >= participant.maxHp) {
      continue;
    }

    participant.hp += 1;
    pushEvent(state, "trick", `${participant.name} 因桃园结义回复 1 点体力`);
  }
}

/**
 * 结算【五谷丰登】效果。
 *
 * 亮出等同于存活角色数量的牌，并由角色按座次依次各获得其中 1 张。
 *
 * @param state 当前游戏状态。
 * @param sourceId 使用者编号。
 */
function resolveHarvest(state: GameState, sourceId: string): void {
  const participants = getAlivePlayersFrom(state, sourceId);
  const revealed: Card[] = [];

  for (let index = 0; index < participants.length; index += 1) {
    if (state.deck.length === 0) {
      refillDeckFromDiscard(state);
    }

    const card = state.deck.shift();
    if (!card) {
      break;
    }

    revealed.push(card);
  }

  if (revealed.length === 0) {
    pushEvent(state, "trick", "五谷丰登未能亮出有效牌");
    return;
  }

  pushEvent(state, "trick", `五谷丰登亮出：${revealed.map((card) => card.id).join("、")}`);

  for (const participant of participants) {
    if (revealed.length === 0) {
      break;
    }

    const negated = resolveNullifyChain(state, sourceId, participant.id, "harvest");
    if (negated) {
      pushEvent(state, "nullify", `${participant.name} 的五谷丰登效果被无懈可击抵消`);
      continue;
    }

    const selectedIndex = chooseHarvestCardIndex(participant, revealed);
    const [selected] = revealed.splice(selectedIndex, 1);
    participant.hand.push(selected);
    pushEvent(state, "trick", `${participant.name} 从五谷丰登中获得 ${selected.id}`);
  }

  if (revealed.length > 0) {
    state.discard.push(...revealed);
    pushEvent(state, "trick", `五谷丰登剩余牌进入弃牌堆：${revealed.map((card) => card.id).join("、")}`);
  }
}

/**
 * 为五谷丰登选择最优牌索引。
 *
 * @param player 选牌角色。
 * @param options 当前可选牌。
 * @returns 最优牌在 options 中的索引。
 */
function chooseHarvestCardIndex(player: PlayerState, options: Card[]): number {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < options.length; index += 1) {
    const score = evaluateHarvestCard(player, options[index]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

/**
 * 评估单张五谷候选牌价值。
 *
 * @param player 选牌角色。
 * @param card 候选牌。
 * @returns 分值，越高越优先。
 */
function evaluateHarvestCard(player: PlayerState, card: Card): number {
  if (card.kind === "peach") {
    return player.hp < player.maxHp ? 100 : 55;
  }

  if (card.kind === "nullify") {
    return 90;
  }

  if (card.kind === "slash") {
    return 75;
  }

  if (card.kind === "dodge") {
    return 70;
  }

  if (card.kind === "duel" || card.kind === "dismantle" || card.kind === "snatch") {
    return 65;
  }

  if (card.kind === "barbarian" || card.kind === "archery" || card.kind === "taoyuan" || card.kind === "harvest") {
    return 60;
  }

  if (card.kind === "weapon_blade" || card.kind === "horse_plus" || card.kind === "horse_minus") {
    return 58;
  }

  if (card.kind === "indulgence" || card.kind === "lightning") {
    return 56;
  }

  return 50;
}

/**
 * 结算当前角色判定阶段中的延时类锦囊。
 *
 * @param state 当前游戏状态。
 * @param playerId 当前回合角色编号。
 */
function resolveJudgePhase(state: GameState, playerId: string): void {
  const player = requireAlivePlayer(state, playerId);
  if (player.judgmentZone.delayedTricks.length === 0) {
    return;
  }

  const queue = [...player.judgmentZone.delayedTricks];
  player.judgmentZone.delayedTricks = [];

  for (const trick of queue) {
    if (!player.alive || state.winner) {
      state.discard.push(trick);
      continue;
    }

    if (!isDelayedTrickKind(trick.kind)) {
      state.discard.push(trick);
      continue;
    }

    const delayedNegated = resolveDelayedTrickNullifyChain(state, player, trick.kind);
    if (delayedNegated) {
      pushEvent(state, "nullify", `${player.name} 的延时锦囊效果被无懈可击抵消`);
      state.discard.push(trick);
      continue;
    }

    const judgeCard = drawJudgmentCard(state, player);
    if (!judgeCard) {
      state.discard.push(trick);
      continue;
    }

    if (trick.kind === "indulgence") {
      if (!isHeart(judgeCard)) {
        state.skipPlayPhaseForCurrentTurn = true;
        pushEvent(state, "judge", `${player.name} 的乐不思蜀判定失败（非红桃）`);
      } else {
        pushEvent(state, "judge", `${player.name} 的乐不思蜀判定成功（红桃）`);
      }
      state.discard.push(trick);
      continue;
    }

    if (trick.kind === "lightning") {
      if (isSpade(judgeCard) && isPointBetween(judgeCard, 2, 9)) {
        pushEvent(state, "judge", `${player.name} 的闪电判定命中（黑桃2~9）`);
        state.discard.push(trick);
        dealDamageWithoutSource(state, player.id, 3, "闪电");
        continue;
      }

      pushEvent(state, "judge", `${player.name} 的闪电判定未命中，闪电传递`);
      transferLightning(state, player.id, trick);
      continue;
    }

    state.discard.push(trick);
  }
}

/**
 * 结算延时类锦囊在判定生效前的【无懈可击】响应链。
 *
 * 规则简化说明：
 * - 先由目标同阵营角色优先响应（抵消效果）。
 * - 然后可被目标敌对阵营角色继续反制。
 * - 最终 `negated=true` 表示该延时锦囊本次判定效果被抵消。
 *
 * @param state 当前游戏状态。
 * @param target 延时类锦囊当前生效目标。
 * @param trickKind 延时类锦囊类型。
 * @returns 是否被无懈抵消。
 */
function resolveDelayedTrickNullifyChain(
  state: GameState,
  target: PlayerState,
  trickKind: Extract<CardKind, "indulgence" | "lightning">
): boolean {
  let negated = false;

  while (true) {
    let played = false;
    const responders = getAlivePlayersFrom(state, target.id);
    for (const responder of responders) {
      const hasNullify = responder.hand.some((card) => card.kind === "nullify");
      if (!hasNullify) {
        continue;
      }

      const shouldPlay = !negated
        ? isSameCamp(responder.identity, target.identity)
        : !isSameCamp(responder.identity, target.identity);
      if (!shouldPlay) {
        continue;
      }

      const nullify = consumeFirstCardByKind(responder, "nullify");
      if (!nullify) {
        continue;
      }

      state.discard.push(nullify);
      negated = !negated;
      played = true;
      pushEvent(state, "nullify", `${responder.name} 对${getDelayedTrickName(trickKind)}打出无懈可击`);
      break;
    }

    if (!played) {
      break;
    }
  }

  return negated;
}

/**
 * 抽取一张判定牌并写入日志。
 *
 * @param state 当前游戏状态。
 * @param player 判定角色。
 * @returns 判定牌。
 */
function drawJudgmentCard(state: GameState, player: PlayerState): Card | undefined {
  if (state.deck.length === 0) {
    refillDeckFromDiscard(state);
  }

  const judgeCard = state.deck.shift();
  if (!judgeCard) {
    return undefined;
  }

  pushEvent(state, "judge", `${player.name} 判定牌：${judgeCard.id}（${getCardSuit(judgeCard)}${getCardPoint(judgeCard)}）`);
  state.discard.push(judgeCard);
  return judgeCard;
}

/**
 * 闪电未命中时传递到下一个合法角色判定区。
 *
 * @param state 当前游戏状态。
 * @param currentPlayerId 当前判定角色编号。
 * @param lightning 闪电牌。
 */
function transferLightning(state: GameState, currentPlayerId: string, lightning: Card): void {
  const aliveOrder = getAlivePlayersFrom(state, currentPlayerId);
  for (let index = 1; index < aliveOrder.length; index += 1) {
    const candidate = aliveOrder[index];
    if (!hasDelayedTrick(candidate, "lightning")) {
      candidate.judgmentZone.delayedTricks.push(lightning);
      pushEvent(state, "trick", `闪电 传递到 ${candidate.name} 的判定区`);
      return;
    }
  }

  const current = requireAlivePlayer(state, currentPlayerId);
  current.judgmentZone.delayedTricks.push(lightning);
  pushEvent(state, "trick", `闪电 留在 ${current.name} 的判定区`);
}

/**
 * 装备一张装备牌到对应装备槽位。
 *
 * 若槽位已有牌，则先将原装备置入弃牌堆。
 *
 * @param state 当前游戏状态。
 * @param actor 装备者。
 * @param card 待装备的卡牌。
 */
function equipCard(state: GameState, actor: PlayerState, card: Card): void {
  if (isWeaponKind(card.kind)) {
    if (actor.equipment.weapon) {
      state.discard.push(actor.equipment.weapon);
    }
    actor.equipment.weapon = card;
    pushEvent(state, "equip", `${actor.name} 装备了${getEquipmentDisplayName(card.kind)}`);
    return;
  }

  if (isArmorKind(card.kind)) {
    if (actor.equipment.armor) {
      state.discard.push(actor.equipment.armor);
    }
    actor.equipment.armor = card;
    pushEvent(state, "equip", `${actor.name} 装备了${getEquipmentDisplayName(card.kind)}`);
    return;
  }

  if (isHorsePlusKind(card.kind)) {
    if (actor.equipment.horsePlus) {
      state.discard.push(actor.equipment.horsePlus);
    }
    actor.equipment.horsePlus = card;
    pushEvent(state, "equip", `${actor.name} 装备了${getEquipmentDisplayName(card.kind)}`);
    return;
  }

  if (isHorseMinusKind(card.kind)) {
    if (actor.equipment.horseMinus) {
      state.discard.push(actor.equipment.horseMinus);
    }
    actor.equipment.horseMinus = card;
    pushEvent(state, "equip", `${actor.name} 装备了${getEquipmentDisplayName(card.kind)}`);
  }
}

/**
 * 结算非延时锦囊的【无懈可击】响应链。
 *
 * 规则简化说明：
 * - 仅处理当前 MVP 已实现的单目标锦囊（顺手牵羊、过河拆桥）。
 * - 结算顺序按“使用者开始，按座次循环”依次询问。
 * - 一旦有人打出无懈，改为新一轮询问，直到无人继续打出。
 *
 * @param state 当前游戏状态。
 * @param sourceId 锦囊使用者。
 * @param targetId 锦囊目标。
 * @param trickKind 锦囊类型。
 * @returns 返回 true 表示锦囊最终被抵消。
 */
function resolveNullifyChain(
  state: GameState,
  sourceId: string,
  targetId: string,
  trickKind: Extract<
    CardKind,
    "dismantle" | "snatch" | "duel" | "barbarian" | "archery" | "taoyuan" | "harvest" | "ex_nihilo" | "collateral"
  >
): boolean {
  let negated = false;

  while (true) {
    let played = false;
    const responders = getAlivePlayersFrom(state, sourceId);
    for (const responder of responders) {
      const shouldPlay = shouldPlayNullify(state, responder, sourceId, targetId, trickKind, negated);
      if (!shouldPlay) {
        continue;
      }

      const nullify = consumeFirstCardByKind(responder, "nullify");
      if (!nullify) {
        continue;
      }

      state.discard.push(nullify);
      negated = !negated;
      played = true;
      pushEvent(state, "nullify", `${responder.name} 打出无懈可击`);
      break;
    }

    if (!played) {
      break;
    }
  }

  return negated;
}

/**
 * 判断某名角色是否应在当前无懈阶段打出【无懈可击】。
 *
 * @param state 当前游戏状态。
 * @param responder 响应者。
 * @param sourceId 锦囊来源。
 * @param targetId 锦囊目标。
 * @param trickKind 锦囊类型。
 * @param currentlyNegated 当前是否已被无懈抵消。
 * @returns 是否打出无懈。
 */
function shouldPlayNullify(
  state: GameState,
  responder: PlayerState,
  sourceId: string,
  targetId: string,
  trickKind: Extract<
    CardKind,
    "dismantle" | "snatch" | "duel" | "barbarian" | "archery" | "taoyuan" | "harvest" | "ex_nihilo" | "collateral"
  >,
  currentlyNegated: boolean
): boolean {
  if (!responder.hand.some((card) => card.kind === "nullify")) {
    return false;
  }

  const source = requireAlivePlayer(state, sourceId);
  const target = requireAlivePlayer(state, targetId);

  if (!currentlyNegated) {
    if (trickKind === "barbarian" || trickKind === "archery") {
      return isSameCamp(responder.identity, target.identity) && !isSameCamp(source.identity, target.identity);
    }

    return isSameCamp(responder.identity, target.identity) && !isSameCamp(source.identity, target.identity);
  }

  return isSameCamp(responder.identity, source.identity) && !isSameCamp(source.identity, target.identity);
}

/**
 * 获取角色对另一名角色是否在攻击范围内。
 *
 * 当前 MVP 攻击范围固定为 1。
 *
 * @param state 当前游戏状态。
 * @param fromId 使用者编号。
 * @param toId 目标编号。
 * @returns 若目标在攻击范围内返回 true。
 */
function isInAttackRange(state: GameState, fromId: string, toId: string): boolean {
  return getDistance(state, fromId, toId) <= getAttackRange(state, fromId);
}

/**
 * 获取角色当前攻击范围。
 *
 * 规则：
 * - 基础攻击范围为 1。
 * - 装备武器后攻击范围 +1（当前仅实现一种武器示例）。
 *
 * @param state 当前游戏状态。
 * @param playerId 角色编号。
 * @returns 当前攻击范围。
 */
function getAttackRange(state: GameState, playerId: string): number {
  const player = requireAlivePlayer(state, playerId);
  if (!player.equipment.weapon) {
    return 1;
  }

  return getWeaponRange(player.equipment.weapon.kind);
}

/**
 * 计算两名存活角色之间的最短座次距离。
 *
 * @param state 当前游戏状态。
 * @param fromId 起点角色编号。
 * @param toId 终点角色编号。
 * @returns 最短座次距离。
 */
function getDistance(state: GameState, fromId: string, toId: string): number {
  if (fromId === toId) {
    return 0;
  }

  const aliveOrder = state.players.filter((player) => player.alive);
  const fromIndex = aliveOrder.findIndex((player) => player.id === fromId);
  const toIndex = aliveOrder.findIndex((player) => player.id === toId);
  if (fromIndex < 0 || toIndex < 0) {
    return Number.POSITIVE_INFINITY;
  }

  const clockwise = (toIndex - fromIndex + aliveOrder.length) % aliveOrder.length;
  const anticlockwise = (fromIndex - toIndex + aliveOrder.length) % aliveOrder.length;
  let distance = Math.min(clockwise, anticlockwise);

  const from = aliveOrder[fromIndex];
  const to = aliveOrder[toIndex];

  if (from.equipment.horseMinus) {
    distance -= 1;
  }
  if (to.equipment.horsePlus) {
    distance += 1;
  }

  return Math.max(1, distance);
}

/**
 * 以指定角色为起点，按座次获取存活角色序列。
 *
 * @param state 当前游戏状态。
 * @param startId 起点角色编号。
 * @returns 有序角色列表。
 */
function getAlivePlayersFrom(state: GameState, startId: string): PlayerState[] {
  const aliveOrder = state.players.filter((player) => player.alive);
  const startIndex = aliveOrder.findIndex((player) => player.id === startId);
  if (startIndex < 0) {
    return aliveOrder;
  }

  return [...aliveOrder.slice(startIndex), ...aliveOrder.slice(0, startIndex)];
}

function dealDamage(state: GameState, sourceId: string, targetId: string, amount: number): void {
  const source = requireAlivePlayer(state, sourceId);
  const target = requireAlivePlayer(state, targetId);

  target.hp -= amount;
  pushEvent(state, "damage", `${source.name} 对 ${target.name} 造成 ${amount} 点伤害`);

  if (target.hp <= 0) {
    const rescued = tryRescueWithPeach(state, target.id);
    if (!rescued) {
      target.alive = false;
      clearDeadPlayerCards(state, target);
      pushEvent(state, "death", `${target.name} 阵亡`);
      updateWinner(state);
    }
  }
}

/**
 * 造成无来源伤害。
 *
 * @param state 当前游戏状态。
 * @param targetId 受伤角色编号。
 * @param amount 伤害值。
 * @param reason 伤害原因。
 */
function dealDamageWithoutSource(state: GameState, targetId: string, amount: number, reason: string): void {
  const target = requireAlivePlayer(state, targetId);
  target.hp -= amount;
  pushEvent(state, "damage", `${target.name} 受到 ${reason} 造成的 ${amount} 点无来源伤害`);

  if (target.hp <= 0) {
    const rescued = tryRescueWithPeach(state, target.id);
    if (!rescued) {
      target.alive = false;
      clearDeadPlayerCards(state, target);
      pushEvent(state, "death", `${target.name} 阵亡`);
      updateWinner(state);
    }
  }
}

/**
 * 阵亡角色的所有区域牌进入弃牌堆。
 *
 * @param state 当前游戏状态。
 * @param target 阵亡角色。
 */
function clearDeadPlayerCards(state: GameState, target: PlayerState): void {
  for (const card of target.hand) {
    state.discard.push(card);
  }
  target.hand = [];

  if (target.equipment.weapon) {
    state.discard.push(target.equipment.weapon);
    target.equipment.weapon = null;
  }
  if (target.equipment.armor) {
    state.discard.push(target.equipment.armor);
    target.equipment.armor = null;
  }
  if (target.equipment.horsePlus) {
    state.discard.push(target.equipment.horsePlus);
    target.equipment.horsePlus = null;
  }
  if (target.equipment.horseMinus) {
    state.discard.push(target.equipment.horseMinus);
    target.equipment.horseMinus = null;
  }

  for (const trick of target.judgmentZone.delayedTricks) {
    state.discard.push(trick);
  }
  target.judgmentZone.delayedTricks = [];
}

function tryRescueWithPeach(state: GameState, targetId: string): boolean {
  const target = getPlayerById(state, targetId);
  if (!target || !target.alive) {
    return false;
  }

  if (target.hp > 0) {
    return true;
  }

  for (const candidate of state.players) {
    if (!candidate.alive) {
      continue;
    }

    if (!shouldUsePeachToRescue(candidate, target)) {
      continue;
    }

    const peach = consumeFirstCardByKind(candidate, "peach");
    if (peach) {
      state.discard.push(peach);
      target.hp = 1;
      pushEvent(state, "rescue", `${candidate.name} 使用桃救回 ${target.name}`);
      return true;
    }
  }

  return false;
}

/**
 * 当摸牌堆为空时，将弃牌堆回洗为新的摸牌堆。
 *
 * @param state 当前游戏状态。
 */
function refillDeckFromDiscard(state: GameState): void {
  if (state.discard.length === 0) {
    return;
  }

  const nextSeed = (state.seed + state.turnCount + state.events.length) >>> 0;
  state.deck = shuffleWithSeed(state.discard, nextSeed);
  state.discard = [];
  pushEvent(state, "deck", "摸牌堆已耗尽，弃牌堆洗回牌堆");
}

/**
 * 判断某个角色是否应该使用桃救援濒死角色。
 *
 * 当前基础策略：
 * - 玩家自己永远自救。
 * - AI 仅救援同阵营角色。
 *
 * @param rescuer 可能出桃的角色。
 * @param target 濒死目标。
 * @returns 是否执行救援。
 */
function shouldUsePeachToRescue(rescuer: PlayerState, target: PlayerState): boolean {
  if (rescuer.id === target.id) {
    return true;
  }

  if (!rescuer.isAi) {
    return true;
  }

  return isSameCamp(rescuer.identity, target.identity);
}

/**
 * 判断两个身份是否属于同一阵营。
 *
 * @param left 左侧身份。
 * @param right 右侧身份。
 * @returns 若同阵营则返回 true。
 */
function isSameCamp(left: Identity, right: Identity): boolean {
  if (left === "lord" || left === "loyalist") {
    return right === "lord" || right === "loyalist";
  }

  if (left === "rebel") {
    return right === "rebel";
  }

  return right === "renegade";
}

function resolveDiscardIfNeeded(state: GameState, playerId: string): void {
  const player = requireAlivePlayer(state, playerId);
  while (player.hand.length > player.hp) {
    const card = player.hand.pop() as Card;
    state.discard.push(card);
    pushEvent(state, "discard", `${player.name} 弃置了 1 张手牌`);
  }
}

function advanceTurn(state: GameState): void {
  const alivePlayers = state.players.filter((player) => player.alive);
  if (alivePlayers.length <= 1) {
    updateWinner(state);
    return;
  }

  const currentIndex = alivePlayers.findIndex((player) => player.id === state.currentPlayerId);
  const next = alivePlayers[(currentIndex + 1) % alivePlayers.length];
  state.currentPlayerId = next.id;
  state.phase = "judge";
  state.slashUsedInTurn = 0;
  state.skipPlayPhaseForCurrentTurn = false;
  state.turnCount += 1;
  pushEvent(state, "turn", `轮到 ${next.name} 的回合`);
  pushEvent(state, "phase", `${next.name} 进入判定阶段`);
}

function getAliveOpponents(state: GameState, actorId: string): PlayerState[] {
  const actor = requireAlivePlayer(state, actorId);
  return state.players.filter((candidate) => candidate.alive && candidate.id !== actor.id);
}

function removeCardFromHand(player: PlayerState, cardId: string): Card | undefined {
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) {
    return undefined;
  }
  const [card] = player.hand.splice(index, 1);
  return card;
}

function consumeFirstCardByKind(player: PlayerState, kind: Card["kind"]): Card | undefined {
  const index = player.hand.findIndex((card) => card.kind === kind);
  if (index < 0) {
    return undefined;
  }
  const [card] = player.hand.splice(index, 1);
  return card;
}

function getPlayerById(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

function requireAlivePlayer(state: GameState, playerId: string): PlayerState {
  const player = getPlayerById(state, playerId);
  if (!player || !player.alive) {
    throw new Error(`玩家不存在或已死亡: ${playerId}`);
  }
  return player;
}

function pushEvent(state: GameState, type: string, message: string): void {
  state.events.push({ type, message });
}

/**
 * 判断卡牌是否属于当前已支持的装备牌。
 *
 * @param kind 卡牌类型。
 * @returns 若为装备牌返回 true。
 */
function isEquipmentKind(kind: CardKind): boolean {
  return EQUIPMENT_KINDS.includes(kind);
}

function isWeaponKind(kind: CardKind): boolean {
  return (
    kind === "weapon_crossbow" ||
    kind === "weapon_double_sword" ||
    kind === "weapon_qinggang_sword" ||
    kind === "weapon_blade" ||
    kind === "weapon_spear" ||
    kind === "weapon_axe" ||
    kind === "weapon_halberd" ||
    kind === "weapon_kylin_bow" ||
    kind === "weapon_ice_sword"
  );
}

function isArmorKind(kind: CardKind): boolean {
  return kind === "armor_eight_diagram" || kind === "armor_renwang_shield";
}

function isHorsePlusKind(kind: CardKind): boolean {
  return kind === "horse_plus" || kind === "horse_jueying" || kind === "horse_dilu" || kind === "horse_zhuahuangfeidian";
}

function isHorseMinusKind(kind: CardKind): boolean {
  return kind === "horse_minus" || kind === "horse_chitu" || kind === "horse_dayuan" || kind === "horse_zixing";
}

function getWeaponRange(kind: CardKind): number {
  if (kind === "weapon_crossbow") {
    return 1;
  }
  if (kind === "weapon_double_sword" || kind === "weapon_qinggang_sword" || kind === "weapon_ice_sword") {
    return 2;
  }
  if (kind === "weapon_blade" || kind === "weapon_spear" || kind === "weapon_axe") {
    return 3;
  }
  if (kind === "weapon_halberd") {
    return 4;
  }
  if (kind === "weapon_kylin_bow") {
    return 5;
  }

  return 1;
}

function getEquipmentDisplayName(kind: CardKind): string {
  if (kind === "weapon_crossbow") return "诸葛连弩";
  if (kind === "weapon_double_sword") return "雌雄双股剑";
  if (kind === "weapon_qinggang_sword") return "青釭剑";
  if (kind === "weapon_blade") return "青龙偃月刀（简化）";
  if (kind === "weapon_spear") return "丈八蛇矛";
  if (kind === "weapon_axe") return "贯石斧";
  if (kind === "weapon_halberd") return "方天画戟";
  if (kind === "weapon_kylin_bow") return "麒麟弓";
  if (kind === "weapon_ice_sword") return "寒冰剑";
  if (kind === "armor_eight_diagram") return "八卦阵";
  if (kind === "armor_renwang_shield") return "仁王盾";
  if (kind === "horse_jueying") return "+1坐骑（绝影）";
  if (kind === "horse_dilu") return "+1坐骑（的卢）";
  if (kind === "horse_zhuahuangfeidian") return "+1坐骑（爪黄飞电）";
  if (kind === "horse_chitu") return "-1坐骑（赤兔）";
  if (kind === "horse_dayuan") return "-1坐骑（大宛）";
  if (kind === "horse_zixing") return "-1坐骑（紫骍）";
  if (kind === "horse_plus") return "+1坐骑";
  if (kind === "horse_minus") return "-1坐骑";
  return "装备牌";
}

/**
 * 判断卡牌是否属于延时类锦囊。
 *
 * @param kind 卡牌类型。
 * @returns 若为延时类锦囊返回 true。
 */
function isDelayedTrickKind(kind: CardKind): kind is Extract<CardKind, "indulgence" | "lightning"> {
  return DELAYED_TRICK_KINDS.includes(kind);
}

/**
 * 获取延时类锦囊中文名称。
 *
 * @param kind 延时类锦囊类型。
 * @returns 中文名称。
 */
function getDelayedTrickName(kind: Extract<CardKind, "indulgence" | "lightning">): string {
  return kind === "indulgence" ? "乐不思蜀" : "闪电";
}

/**
 * 判断角色判定区是否已有同名延时类锦囊。
 *
 * @param player 角色。
 * @param kind 延时类锦囊类型。
 * @returns 若已存在返回 true。
 */
function hasDelayedTrick(player: PlayerState, kind: Extract<CardKind, "indulgence" | "lightning">): boolean {
  return player.judgmentZone.delayedTricks.some((card) => card.kind === kind);
}

/**
 * 获取卡牌花色（基于卡牌编号序号做可复现映射）。
 *
 * @param card 卡牌。
 * @returns 花色。
 */
function getCardSuit(card: Card): "spade" | "heart" | "club" | "diamond" {
  if (card.suit) {
    return card.suit;
  }

  const seq = getCardSequence(card);
  const mod = seq % 4;
  if (mod === 0) {
    return "spade";
  }
  if (mod === 1) {
    return "heart";
  }
  if (mod === 2) {
    return "club";
  }
  return "diamond";
}

/**
 * 获取卡牌点数（1~13）。
 *
 * @param card 卡牌。
 * @returns 点数。
 */
function getCardPoint(card: Card): number {
  if (card.point && card.point >= 1 && card.point <= 13) {
    return card.point;
  }

  return (getCardSequence(card) % 13) + 1;
}

function isHeart(card: Card): boolean {
  return getCardSuit(card) === "heart";
}

function isSpade(card: Card): boolean {
  return getCardSuit(card) === "spade";
}

function isPointBetween(card: Card, start: number, end: number): boolean {
  const point = getCardPoint(card);
  return point >= start && point <= end;
}

/**
 * 从卡牌编号中提取序号。
 *
 * @param card 卡牌。
 * @returns 序号。
 */
function getCardSequence(card: Card): number {
  const parts = card.id.split("-");
  const raw = Number(parts[parts.length - 1]);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return 1;
}
