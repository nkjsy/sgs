import { createDeck, shuffleWithSeed } from "./cards";
import { STANDARD_SKILL_IDS, createSkillSystemState, emitSkillEvent, hasSkill } from "./skills";
import {
  Card,
  CardKind,
  CardSuit,
  EndPlayPhaseAction,
  GameState,
  Identity,
  NullifyResponsePolicy,
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
const VIRTUAL_SPEAR_SLASH_CARD_ID = "__virtual_spear_slash__";
const VIRTUAL_WUSHENG_SLASH_CARD_ID_PREFIX = "__virtual_wusheng_slash__::";
const VIRTUAL_LONGDAN_SLASH_CARD_ID_PREFIX = "__virtual_longdan_slash__::";
const VIRTUAL_RENDE_CARD_ID_PREFIX = "__virtual_rende__::";
const VIRTUAL_FANJIAN_CARD_ID_PREFIX = "__virtual_fanjian__::";
const VIRTUAL_KUROU_CARD_ID = "__virtual_kurou__";
const VIRTUAL_ZHIHENG_CARD_ID_PREFIX = "__virtual_zhiheng__::";
const VIRTUAL_JIEYIN_CARD_ID = "__virtual_jieyin__";
const VIRTUAL_GUOSE_CARD_ID_PREFIX = "__virtual_guose__::";
const VIRTUAL_QIXI_CARD_ID_PREFIX = "__virtual_qixi__::";
const VIRTUAL_LIJIAN_CARD_ID_PREFIX = "__virtual_lijian__::";
const VIRTUAL_QINGNANG_CARD_ID_PREFIX = "__virtual_qingnang__::";
const DYING_RESOLUTION_DEPTH = new WeakMap<GameState, number>();

export interface CreateInitialGameOptions {
  nullifyResponsePolicy?: NullifyResponsePolicy;
}

/**
 * 创建一局 5 人身份局的初始状态。
 *
 * @param seed 固定随机种子，用于确保复盘一致。
 * @param options 可选初始化配置。
 * @returns 初始化后的游戏状态。
 */
export function createInitialGame(seed: number, options: CreateInitialGameOptions = {}): GameState {
  const identities: Identity[] = ["lord", "loyalist", "rebel", "rebel", "renegade"];
  const genders: Array<"male" | "female"> = ["male", "female", "male", "female", "male"];
  const players: PlayerState[] = identities.map((identity, index) => ({
    id: `P${index + 1}`,
    name: index === 0 ? "你" : `AI-${index}`,
    identity,
    gender: genders[index],
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
    luoyiActivePlayerId: null,
    rendeGivenInTurnByPlayer: {},
    rendeRecoveredInTurnByPlayer: {},
    fanjianUsedInTurnByPlayer: {},
    zhihengUsedInTurnByPlayer: {},
    jieyinUsedInTurnByPlayer: {},
    lijianUsedInTurnByPlayer: {},
    qingnangUsedInTurnByPlayer: {},
    winner: null,
    seed,
    nullifyResponsePolicy: options.nullifyResponsePolicy ?? "camp-first",
    skillSystem: createSkillSystemState()
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

  const current = getPlayerById(state, state.currentPlayerId);
  if (!current || !current.alive) {
    advanceTurn(state);
    return;
  }

  if (state.phase === "judge") {
    tryTriggerLuoshen(state, current);
    tryTriggerGuanxing(state, current);
    resolveJudgePhase(state, current.id);
    state.phase = "draw";
    pushEvent(state, "phase", `${current.name} 进入摸牌阶段`);
    return;
  }

  if (state.phase === "draw") {
    resolveDrawPhase(state, current);

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

  if (state.phase === "end") {
    tryTriggerBiyue(state, current);
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
    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.huatuoQingnang) && !state.qingnangUsedInTurnByPlayer[actor.id]) {
      for (const target of state.players.filter((candidate) => candidate.alive && candidate.hp < candidate.maxHp)) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: `${VIRTUAL_QINGNANG_CARD_ID_PREFIX}${card.id}`,
          targetId: target.id
        });
      }
    }

    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.diaochanLijian) && !state.lijianUsedInTurnByPlayer[actor.id]) {
      const maleTargets = getAliveOpponents(state, actor.id).filter((candidate) => candidate.gender === "male");
      for (const firstTarget of maleTargets) {
        for (const secondTarget of maleTargets) {
          if (secondTarget.id === firstTarget.id) {
            continue;
          }

          actions.push({
            type: "play-card",
            actorId: actor.id,
            cardId: `${VIRTUAL_LIJIAN_CARD_ID_PREFIX}${card.id}`,
            targetId: firstTarget.id,
            secondaryTargetId: secondTarget.id
          });
        }
      }
    }

    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.ganningQixi) && isBlack(card)) {
      for (const target of getAliveOpponents(state, actor.id).filter((candidate) => candidate.hand.length > 0)) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: `${VIRTUAL_QIXI_CARD_ID_PREFIX}${card.id}`,
          targetId: target.id
        });
      }
    }

    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.daqiaoGuose) && getCardSuit(card) === "diamond") {
      for (const target of getAliveOpponents(state, actor.id).filter(
        (candidate) => !hasDelayedTrick(candidate, "indulgence") && canBeTargetedBySnatchOrIndulgence(state, candidate)
      )) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: `${VIRTUAL_GUOSE_CARD_ID_PREFIX}${card.id}`,
          targetId: target.id
        });
      }
    }

    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.sunquanZhiheng) && !state.zhihengUsedInTurnByPlayer[actor.id]) {
      actions.push({
        type: "play-card",
        actorId: actor.id,
        cardId: `${VIRTUAL_ZHIHENG_CARD_ID_PREFIX}${card.id}`,
        targetId: actor.id
      });
    }

    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.liubeiRende)) {
      for (const target of getAliveOpponents(state, actor.id)) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: `${VIRTUAL_RENDE_CARD_ID_PREFIX}${card.id}`,
          targetId: target.id
        });
      }
    }

    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.zhouyuFanjian) && !state.fanjianUsedInTurnByPlayer[actor.id]) {
      for (const target of getAliveOpponents(state, actor.id)) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: `${VIRTUAL_FANJIAN_CARD_ID_PREFIX}${card.id}`,
          targetId: target.id
        });
      }
    }

    if (card.kind === "slash") {
      if (state.slashUsedInTurn >= 1 && !hasUnlimitedSlashUsage(state, actor)) {
        continue;
      }

      for (const target of getAliveOpponents(state, actor.id).filter(
        (candidate) => isInAttackRange(state, actor.id, candidate.id) && canBeTargetedBySlashOrDuel(state, candidate)
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

    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.guanyuWusheng) && isRed(card)) {
      if (state.slashUsedInTurn >= 1 && !hasUnlimitedSlashUsage(state, actor)) {
        continue;
      }

      for (const target of getAliveOpponents(state, actor.id).filter(
        (candidate) => isInAttackRange(state, actor.id, candidate.id) && canBeTargetedBySlashOrDuel(state, candidate)
      )) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: `${VIRTUAL_WUSHENG_SLASH_CARD_ID_PREFIX}${card.id}`,
          targetId: target.id
        });
      }
      continue;
    }

    if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.zhaoyunLongdan) && card.kind === "dodge") {
      if (state.slashUsedInTurn >= 1 && !hasUnlimitedSlashUsage(state, actor)) {
        continue;
      }

      for (const target of getAliveOpponents(state, actor.id).filter(
        (candidate) => isInAttackRange(state, actor.id, candidate.id) && canBeTargetedBySlashOrDuel(state, candidate)
      )) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: `${VIRTUAL_LONGDAN_SLASH_CARD_ID_PREFIX}${card.id}`,
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
        (candidate) =>
          candidate.hand.length > 0 &&
          (canIgnoreTrickDistance(state, actor) || getDistance(state, actor.id, candidate.id) <= 1) &&
          canBeTargetedBySnatchOrIndulgence(state, candidate)
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
      for (const target of getAliveOpponents(state, actor.id).filter((candidate) => canBeTargetedBySlashOrDuel(state, candidate))) {
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
        const secondTargets = getAliveOpponents(state, firstTarget.id).filter(
          (candidate) => isInAttackRange(state, firstTarget.id, candidate.id) && canBeTargetedBySlashOrDuel(state, candidate)
        );
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
      for (const target of getAliveOpponents(state, actor.id).filter(
        (candidate) => !hasDelayedTrick(candidate, "indulgence") && canBeTargetedBySnatchOrIndulgence(state, candidate)
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

  if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.huanggaiKurou)) {
    actions.push({
      type: "play-card",
      actorId: actor.id,
      cardId: VIRTUAL_KUROU_CARD_ID
    });
  }

  if (hasSkill(state, actor.id, STANDARD_SKILL_IDS.sunshangxiangJieyin) && !state.jieyinUsedInTurnByPlayer[actor.id]) {
    const woundedMaleTargets = getAliveOpponents(state, actor.id).filter(
      (candidate) => candidate.gender === "male" && candidate.hp < candidate.maxHp
    );
    if (actor.hand.length >= 2) {
      for (const target of woundedMaleTargets) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: VIRTUAL_JIEYIN_CARD_ID,
          targetId: target.id
        });
      }
    }
  }

  if (actor.equipment.weapon?.kind === "weapon_spear" && actor.hand.length >= 2) {
    if (state.slashUsedInTurn < 1 || hasUnlimitedSlashUsage(state, actor)) {
      for (const target of getAliveOpponents(state, actor.id).filter(
        (candidate) => isInAttackRange(state, actor.id, candidate.id) && canBeTargetedBySlashOrDuel(state, candidate)
      )) {
        actions.push({
          type: "play-card",
          actorId: actor.id,
          cardId: VIRTUAL_SPEAR_SLASH_CARD_ID,
          targetId: target.id
        });
      }
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

function resolveDrawPhase(state: GameState, player: PlayerState): void {
  let drawCount = 2;

  if (hasSkill(state, player.id, STANDARD_SKILL_IDS.zhouyuYingzi)) {
    drawCount += 1;
    pushEvent(state, "skill", `${player.name} 发动英姿，摸牌阶段额外摸 1 张`);
  }

  if (hasSkill(state, player.id, STANDARD_SKILL_IDS.zhangliaoTuxi)) {
    const targets = getAliveOpponents(state, player.id).filter((candidate) => candidate.hand.length > 0).slice(0, 2);
    for (const target of targets) {
      if (drawCount <= 0) {
        break;
      }

      const stolen = target.hand.shift() as Card;
      player.hand.push(stolen);
      drawCount -= 1;
      pushEvent(state, "skill", `${player.name} 发动突袭，获得了 ${target.name} 的 1 张手牌`);
    }
  }

  if (hasSkill(state, player.id, STANDARD_SKILL_IDS.xuchuLuoyi) && drawCount > 0) {
    drawCount -= 1;
    state.luoyiActivePlayerId = player.id;
    pushEvent(state, "skill", `${player.name} 发动裸衣，本回合杀与决斗伤害+1`);
  }

  drawCards(state, player.id, drawCount);
}

function tryTriggerGuanxing(state: GameState, player: PlayerState): void {
  if (!hasSkill(state, player.id, STANDARD_SKILL_IDS.zhugeliangGuanxing)) {
    return;
  }

  const aliveCount = state.players.filter((candidate) => candidate.alive).length;
  const peekCount = Math.min(5, aliveCount, state.deck.length);
  if (peekCount <= 1) {
    return;
  }

  const observed = state.deck.splice(0, peekCount);
  observed.sort((left, right) => evaluateHarvestCard(player, right) - evaluateHarvestCard(player, left));
  state.deck.unshift(...observed);
  pushEvent(state, "skill", `${player.name} 发动观星，调整了牌堆顶的 ${peekCount} 张牌顺序`);
}

function applyEndPlayPhase(state: GameState, action: EndPlayPhaseAction): void {
  if (action.actorId !== state.currentPlayerId) {
    return;
  }

  const actor = requireAlivePlayer(state, action.actorId);

  state.phase = "discard";
  pushEvent(state, "action", `${actor.name} 主动结束出牌阶段`);
}

function applyPlayCard(state: GameState, action: PlayCardAction): void {
  const actor = requireAlivePlayer(state, action.actorId);
  if (actor.id !== state.currentPlayerId) {
    return;
  }

  if (action.cardId.startsWith(VIRTUAL_RENDE_CARD_ID_PREFIX)) {
    applyRendeAction(state, actor, action);
    return;
  }

  if (action.cardId.startsWith(VIRTUAL_FANJIAN_CARD_ID_PREFIX)) {
    applyFanjianAction(state, actor, action);
    return;
  }

  if (action.cardId.startsWith(VIRTUAL_GUOSE_CARD_ID_PREFIX)) {
    applyGuoseAction(state, actor, action);
    return;
  }

  if (action.cardId.startsWith(VIRTUAL_QIXI_CARD_ID_PREFIX)) {
    applyQixiAction(state, actor, action);
    return;
  }

  if (action.cardId.startsWith(VIRTUAL_LIJIAN_CARD_ID_PREFIX)) {
    applyLijianAction(state, actor, action);
    return;
  }

  if (action.cardId.startsWith(VIRTUAL_ZHIHENG_CARD_ID_PREFIX)) {
    applyZhihengAction(state, actor, action);
    return;
  }

  if (action.cardId === VIRTUAL_KUROU_CARD_ID) {
    applyKurouAction(state, actor);
    return;
  }

  if (action.cardId === VIRTUAL_JIEYIN_CARD_ID) {
    applyJieyinAction(state, actor, action);
    return;
  }

  if (action.cardId.startsWith(VIRTUAL_QINGNANG_CARD_ID_PREFIX)) {
    applyQingnangAction(state, actor, action);
    return;
  }

  let card: Card | undefined;
  if (action.cardId.startsWith(VIRTUAL_WUSHENG_SLASH_CARD_ID_PREFIX)) {
    if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.guanyuWusheng)) {
      return;
    }

    const sourceCardId = action.cardId.slice(VIRTUAL_WUSHENG_SLASH_CARD_ID_PREFIX.length);
    const sourceCard = removeCardFromHand(actor, sourceCardId);
    if (!sourceCard || !isRed(sourceCard)) {
      if (sourceCard) {
        actor.hand.push(sourceCard);
      }
      return;
    }

    pushEvent(state, "skill", `${actor.name} 发动武圣，将红色手牌当杀使用`);
    card = {
      ...sourceCard,
      kind: "slash"
    };
  } else if (action.cardId.startsWith(VIRTUAL_LONGDAN_SLASH_CARD_ID_PREFIX)) {
    if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.zhaoyunLongdan)) {
      return;
    }

    const sourceCardId = action.cardId.slice(VIRTUAL_LONGDAN_SLASH_CARD_ID_PREFIX.length);
    const sourceCard = removeCardFromHand(actor, sourceCardId);
    if (!sourceCard || sourceCard.kind !== "dodge") {
      if (sourceCard) {
        actor.hand.push(sourceCard);
      }
      return;
    }

    pushEvent(state, "skill", `${actor.name} 发动龙胆，将闪当杀使用`);
    card = {
      ...sourceCard,
      kind: "slash"
    };
  } else if (action.cardId === VIRTUAL_SPEAR_SLASH_CARD_ID) {
    if (actor.equipment.weapon?.kind !== "weapon_spear" || actor.hand.length < 2) {
      return;
    }

    const subA = actor.hand.shift() as Card;
    const subB = actor.hand.shift() as Card;
    state.discard.push(subA, subB);
    pushEvent(state, "equip", `${actor.name} 发动丈八蛇矛，将两张手牌当杀使用`);

    card = {
      id: `${VIRTUAL_SPEAR_SLASH_CARD_ID}-${state.turnCount}-${state.events.length}`,
      kind: "slash",
      suit: "spade",
      point: 7
    };
  } else {
    card = removeCardFromHand(actor, action.cardId);
  }

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
    if (!target || !target.alive || target.id === actor.id || !canBeTargetedBySlashOrDuel(state, target)) {
      actor.hand.push(card);
      return;
    }

    if (state.slashUsedInTurn >= 1 && !hasUnlimitedSlashUsage(state, actor)) {
      actor.hand.push(card);
      return;
    }

    state.slashUsedInTurn += 1;

    pushEvent(state, "card", `${actor.name} 对 ${target.name} 使用杀`);
    const slashTargets = getSlashTargetsForResolution(state, actor, target);
    for (const slashTarget of slashTargets) {
      const canUseDodge = canTargetUseDodgeAgainstSlash(state, actor, slashTarget);
      resolveSlashOnTarget(state, actor, slashTarget, card, "杀", false, canUseDodge);
      if (state.winner) {
        break;
      }
    }
    state.discard.push(card);
    return;
  }

  if (card.kind === "dismantle" || card.kind === "snatch") {
    const target = action.targetId ? getPlayerById(state, action.targetId) : null;
    if (
      !target ||
      !target.alive ||
      target.id === actor.id ||
      target.hand.length === 0 ||
      (card.kind === "snatch" && !canBeTargetedBySnatchOrIndulgence(state, target))
    ) {
      actor.hand.push(card);
      return;
    }

    if (card.kind === "snatch" && !canIgnoreTrickDistance(state, actor) && getDistance(state, actor.id, target.id) > 1) {
      actor.hand.push(card);
      return;
    }

    const trickName = card.kind === "dismantle" ? "过河拆桥" : "顺手牵羊";
    triggerJizhiOnTrickUse(state, actor, card.kind);
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
    tryTriggerLianyingAfterHandLoss(state, target);
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
    if (!target || !target.alive || target.id === actor.id || !canBeTargetedBySlashOrDuel(state, target)) {
      actor.hand.push(card);
      return;
    }

    triggerJizhiOnTrickUse(state, actor, card.kind);
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

    triggerJizhiOnTrickUse(state, actor, card.kind);
    pushEvent(state, "card", `${actor.name} 对 ${weaponHolder.name} 使用借刀杀人，指定 ${slashTarget.name} 为目标`);
    const negated = resolveNullifyChain(state, actor.id, weaponHolder.id, card.kind);
    if (negated) {
      pushEvent(state, "nullify", "借刀杀人 被无懈可击抵消");
      state.discard.push(card);
      return;
    }

    const slash = consumeSlashLikeCard(state, weaponHolder, "借刀杀人");
    if (slash) {
      pushEvent(state, "response", `${weaponHolder.name} 被迫对 ${slashTarget.name} 使用杀`);
      resolveSlashOnTarget(state, weaponHolder, slashTarget, slash, "借刀杀人的杀", false);
      state.discard.push(slash);
    } else if (weaponHolder.equipment.weapon) {
      const takenWeapon = weaponHolder.equipment.weapon;
      weaponHolder.equipment.weapon = null;
      actor.hand.push(takenWeapon);
      tryTriggerXiaojiAfterEquipmentLoss(state, weaponHolder, 1);
      pushEvent(state, "trick", `${weaponHolder.name} 未打出杀，武器被 ${actor.name} 获得`);
    }

    state.discard.push(card);
    return;
  }

  if (card.kind === "taoyuan") {
    triggerJizhiOnTrickUse(state, actor, card.kind);
    pushEvent(state, "card", `${actor.name} 使用桃园结义`);
    resolveTaoyuan(state, actor.id);
    state.discard.push(card);
    return;
  }

  if (card.kind === "harvest") {
    triggerJizhiOnTrickUse(state, actor, card.kind);
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

    triggerJizhiOnTrickUse(state, actor, card.kind);
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
      if (
        !target ||
        !target.alive ||
        target.id === actor.id ||
        hasDelayedTrick(target, "indulgence") ||
        !canBeTargetedBySnatchOrIndulgence(state, target)
      ) {
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
    triggerJizhiOnTrickUse(state, actor, card.kind);
    pushEvent(state, "card", `${actor.name} 使用${trickName}`);

    const targets = getAliveOpponents(state, actor.id);
    for (const target of targets) {
      const negated = resolveNullifyChain(state, actor.id, target.id, card.kind);
      if (negated) {
        pushEvent(state, "nullify", `${target.name} 的${trickName}效果被无懈可击抵消`);
        continue;
      }

      if (card.kind === "barbarian") {
        const slash = consumeSlashLikeCard(state, target, "南蛮入侵");
        if (slash) {
          state.discard.push(slash);
          pushEvent(state, "response", `${target.name} 打出杀响应南蛮入侵`);
          continue;
        }
      }

      if (card.kind === "archery") {
        if (tryAutoDodgeWithEightDiagram(state, target)) {
          continue;
        }

        const dodge = consumeDodgeLikeCard(state, target, "万箭齐发");
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
    const requiredSlashCount = hasSkill(state, opponent.id, STANDARD_SKILL_IDS.lvbuWushuang) ? 2 : 1;
    const slashCards = consumeRequiredSlashLikeCards(state, current, requiredSlashCount, "决斗");
    if (slashCards.length < requiredSlashCount) {
      const duelDamage = getDamageAmountWithLuoyi(state, opponent.id, 1, "duel");
      dealDamage(state, opponent.id, current.id, duelDamage);
      return;
    }

    state.discard.push(...slashCards);
    pushEvent(
      state,
      "response",
      `${current.name} 在决斗中打出 ${requiredSlashCount} 张杀`
    );

    const nextCurrent = opponent;
    const nextOpponent = current;
    current = nextCurrent;
    opponent = nextOpponent;
  }
}

function resolveSlashOnTarget(
  state: GameState,
  source: PlayerState,
  target: PlayerState,
  slashCard: Card,
  slashLabel = "杀",
  shouldDiscardSlash = true,
  canUseDodge = true
): void {
  if (!source.alive || !target.alive) {
    if (shouldDiscardSlash) {
      state.discard.push(slashCard);
    }
    return;
  }

  const redirected = tryApplyLiuliRedirection(state, source, target, slashCard, slashLabel, shouldDiscardSlash, canUseDodge);
  if (redirected) {
    return;
  }

  if (source.equipment.weapon?.kind === "weapon_double_sword" && source.gender !== target.gender) {
    if (target.hand.length > 0) {
      const discarded = target.hand.shift() as Card;
      state.discard.push(discarded);
      tryTriggerLianyingAfterHandLoss(state, target);
      pushEvent(state, "equip", `${source.name} 发动雌雄双股剑，${target.name} 弃置了 1 张手牌`);
    } else {
      drawCards(state, source.id, 1);
      pushEvent(state, "equip", `${source.name} 发动雌雄双股剑，摸了 1 张牌`);
    }
  }

  const armorIgnored = source.equipment.weapon?.kind === "weapon_qinggang_sword";
  if (armorIgnored && target.equipment.armor) {
    pushEvent(state, "equip", `${source.name} 的青釭剑无视 ${target.name} 的防具`);
  }

  if (!armorIgnored && target.equipment.armor?.kind === "armor_renwang_shield" && isBlack(slashCard)) {
    pushEvent(state, "response", `${target.name} 的仁王盾使黑色${slashLabel}无效`);
    if (shouldDiscardSlash) {
      state.discard.push(slashCard);
    }
    return;
  }

  if (canUseDodge) {
    const requiredDodgeCount = hasSkill(state, source.id, STANDARD_SKILL_IDS.lvbuWushuang) ? 2 : 1;
    const dodged = consumeRequiredDodgeResponses(state, target, requiredDodgeCount, armorIgnored, slashLabel);
    if (dodged) {
      if (source.equipment.weapon?.kind === "weapon_axe" && source.hand.length >= 2) {
        const discardA = source.hand.shift() as Card;
        const discardB = source.hand.shift() as Card;
        state.discard.push(discardA, discardB);
        pushEvent(state, "equip", `${source.name} 发动贯石斧，弃置两张手牌令${slashLabel}仍然生效`);
        const slashDamageByAxe = getDamageAmountWithLuoyi(state, source.id, 1, "slash");
        dealDamage(state, source.id, target.id, slashDamageByAxe);
        if (shouldDiscardSlash) {
          state.discard.push(slashCard);
        }
        return;
      }

      if (source.equipment.weapon?.kind === "weapon_blade") {
        const followSlash = consumeSlashLikeCard(state, source, "青龙偃月刀");
        if (followSlash) {
          pushEvent(state, "equip", `${source.name} 发动青龙偃月刀，对 ${target.name} 追加使用一张杀`);
          resolveSlashOnTarget(state, source, target, followSlash, "青龙偃月刀追击的杀");
          if (shouldDiscardSlash) {
            state.discard.push(slashCard);
          }
          return;
        }
      }

      if (shouldDiscardSlash) {
        state.discard.push(slashCard);
      }
      return;
    }
  } else {
    pushEvent(state, "skill", `${target.name} 受到铁骑影响，不能使用闪响应${slashLabel}`);
  }

  if (source.equipment.weapon?.kind === "weapon_ice_sword" && hasCardForIceSword(target)) {
    const first = discardOneCardForIceSword(state, target);
    const second = discardOneCardForIceSword(state, target);
    if (first || second) {
      pushEvent(state, "equip", `${source.name} 发动寒冰剑，防止了本次伤害并弃置了 ${target.name} 的牌`);
      if (shouldDiscardSlash) {
        state.discard.push(slashCard);
      }
      return;
    }
  }

  const slashDamage = getDamageAmountWithLuoyi(state, source.id, 1, "slash");
  dealDamage(state, source.id, target.id, slashDamage);
  if (source.equipment.weapon?.kind === "weapon_kylin_bow") {
    tryDiscardHorseByKylinBow(state, source, target);
  }
  if (shouldDiscardSlash) {
    state.discard.push(slashCard);
  }
}

function tryApplyLiuliRedirection(
  state: GameState,
  source: PlayerState,
  target: PlayerState,
  slashCard: Card,
  slashLabel: string,
  shouldDiscardSlash: boolean,
  canUseDodge: boolean
): boolean {
  if (!hasSkill(state, target.id, STANDARD_SKILL_IDS.daqiaoLiuli)) {
    return false;
  }

  const candidates = getAliveOpponents(state, source.id).filter(
    (candidate) =>
      candidate.id !== target.id &&
      isInAttackRange(state, source.id, candidate.id) &&
      canBeTargetedBySlashOrDuel(state, candidate)
  );

  if (candidates.length === 0) {
    return false;
  }

  const discarded = discardOneCardForLiuli(state, target);
  if (!discarded) {
    return false;
  }

  const redirectedTarget = candidates.sort((left, right) => left.hp - right.hp)[0];
  pushEvent(state, "skill", `${target.name} 发动流离，弃置 ${discarded.id}，将${slashLabel}转移给 ${redirectedTarget.name}`);
  resolveSlashOnTarget(state, source, redirectedTarget, slashCard, slashLabel, shouldDiscardSlash, canUseDodge);
  return true;
}

function discardOneCardForLiuli(state: GameState, target: PlayerState): Card | undefined {
  if (target.hand.length > 0) {
    const card = target.hand.shift() as Card;
    state.discard.push(card);
    tryTriggerLianyingAfterHandLoss(state, target);
    return card;
  }

  if (target.equipment.weapon) {
    const card = target.equipment.weapon;
    target.equipment.weapon = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(card);
    return card;
  }

  if (target.equipment.armor) {
    const card = target.equipment.armor;
    target.equipment.armor = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(card);
    return card;
  }

  if (target.equipment.horsePlus) {
    const card = target.equipment.horsePlus;
    target.equipment.horsePlus = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(card);
    return card;
  }

  if (target.equipment.horseMinus) {
    const card = target.equipment.horseMinus;
    target.equipment.horseMinus = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(card);
    return card;
  }

  return undefined;
}

function canTargetUseDodgeAgainstSlash(state: GameState, source: PlayerState, target: PlayerState): boolean {
  if (!hasSkill(state, source.id, STANDARD_SKILL_IDS.machaoTieqi)) {
    return true;
  }

  const judgeCard = drawJudgmentCard(state, source);
  if (!judgeCard) {
    return true;
  }

  if (isRed(judgeCard)) {
    pushEvent(state, "skill", `${source.name} 发动铁骑，判定为红色，${target.name} 不能使用闪`);
    return false;
  }

  pushEvent(state, "skill", `${source.name} 发动铁骑，判定为黑色，${target.name} 可正常使用闪`);
  return true;
}

function triggerJizhiOnTrickUse(state: GameState, actor: PlayerState, trickKind: CardKind): void {
  if (!isNonDelayedTrickKind(trickKind)) {
    return;
  }

  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.huangyueyingJizhi)) {
    return;
  }

  drawCards(state, actor.id, 1);
  pushEvent(state, "skill", `${actor.name} 发动集智，摸了 1 张牌`);
}

function isNonDelayedTrickKind(kind: CardKind): boolean {
  return (
    kind === "dismantle" ||
    kind === "snatch" ||
    kind === "duel" ||
    kind === "barbarian" ||
    kind === "archery" ||
    kind === "taoyuan" ||
    kind === "harvest" ||
    kind === "ex_nihilo" ||
    kind === "collateral"
  );
}

function hasCardForIceSword(target: PlayerState): boolean {
  return (
    target.hand.length > 0 ||
    target.equipment.weapon !== null ||
    target.equipment.armor !== null ||
    target.equipment.horsePlus !== null ||
    target.equipment.horseMinus !== null
  );
}

function discardOneCardForIceSword(state: GameState, target: PlayerState): Card | undefined {
  if (target.hand.length > 0) {
    const card = target.hand.shift() as Card;
    state.discard.push(card);
    tryTriggerLianyingAfterHandLoss(state, target);
    return card;
  }

  if (target.equipment.weapon) {
    const card = target.equipment.weapon;
    target.equipment.weapon = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(card);
    return card;
  }

  if (target.equipment.armor) {
    const card = target.equipment.armor;
    target.equipment.armor = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(card);
    return card;
  }

  if (target.equipment.horsePlus) {
    const card = target.equipment.horsePlus;
    target.equipment.horsePlus = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(card);
    return card;
  }

  if (target.equipment.horseMinus) {
    const card = target.equipment.horseMinus;
    target.equipment.horseMinus = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(card);
    return card;
  }

  return undefined;
}

function getSlashTargetsForResolution(state: GameState, source: PlayerState, primaryTarget: PlayerState): PlayerState[] {
  const targets: PlayerState[] = [primaryTarget];

  if (source.equipment.weapon?.kind !== "weapon_halberd") {
    return targets;
  }

  if (source.hand.length !== 0) {
    return targets;
  }

  const extras = getAliveOpponents(state, source.id)
    .filter((candidate) => candidate.id !== primaryTarget.id && isInAttackRange(state, source.id, candidate.id))
    .sort((left, right) => left.hp - right.hp)
    .slice(0, 2);

  if (extras.length > 0) {
    pushEvent(state, "equip", `${source.name} 发动方天画戟，追加了 ${extras.length} 名目标`);
    targets.push(...extras);
  }

  return targets;
}

function tryDiscardHorseByKylinBow(state: GameState, source: PlayerState, target: PlayerState): void {
  if (target.equipment.horsePlus) {
    const removed = target.equipment.horsePlus;
    target.equipment.horsePlus = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(removed);
    pushEvent(state, "equip", `${source.name} 发动麒麟弓，弃置了 ${target.name} 的+1坐骑`);
    return;
  }

  if (target.equipment.horseMinus) {
    const removed = target.equipment.horseMinus;
    target.equipment.horseMinus = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, target, 1);
    state.discard.push(removed);
    pushEvent(state, "equip", `${source.name} 发动麒麟弓，弃置了 ${target.name} 的-1坐骑`);
  }
}

function tryAutoDodgeWithEightDiagram(state: GameState, target: PlayerState): boolean {
  if (target.equipment.armor?.kind !== "armor_eight_diagram") {
    return false;
  }

  const judgeCard = drawJudgmentCard(state, target);
  if (!judgeCard) {
    return false;
  }

  if (isHeart(judgeCard) || getCardSuit(judgeCard) === "diamond") {
    pushEvent(state, "response", `${target.name} 的八卦阵判定为红色，视为打出闪`);
    return true;
  }

  pushEvent(state, "response", `${target.name} 的八卦阵判定为黑色，未能生效`);
  return false;
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
      const shouldPlay = shouldPlayDelayedNullify(state, responder, target, negated);
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

function shouldPlayDelayedNullify(
  state: GameState,
  responder: PlayerState,
  target: PlayerState,
  currentlyNegated: boolean
): boolean {
  if (!responder.hand.some((card) => card.kind === "nullify")) {
    return false;
  }

  if (state.nullifyResponsePolicy === "seat-order") {
    return true;
  }

  return !currentlyNegated ? isSameCamp(responder.identity, target.identity) : !isSameCamp(responder.identity, target.identity);
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

  const drawnCard = state.deck.shift();
  if (!drawnCard) {
    return undefined;
  }

  let judgeCard = drawnCard;
  const guicaiOwner = findGuicaiResponder(state, player);
  if (guicaiOwner) {
    const replacement = guicaiOwner.hand.shift() as Card;
    state.discard.push(judgeCard);
    judgeCard = replacement;
    pushEvent(state, "skill", `${guicaiOwner.name} 发动鬼才，替换了 ${player.name} 的判定牌`);
  }

  if (!judgeCard) {
    return undefined;
  }

  pushEvent(state, "judge", `${player.name} 判定牌：${judgeCard.id}（${getCardSuit(judgeCard)}${getCardPoint(judgeCard)}）`);
  state.discard.push(judgeCard);
  tryTriggerTiandu(state, player, judgeCard.id);
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
      tryTriggerXiaojiAfterEquipmentLoss(state, actor, 1);
    }
    actor.equipment.weapon = card;
    pushEvent(state, "equip", `${actor.name} 装备了${getEquipmentDisplayName(card.kind)}`);
    return;
  }

  if (isArmorKind(card.kind)) {
    if (actor.equipment.armor) {
      state.discard.push(actor.equipment.armor);
      tryTriggerXiaojiAfterEquipmentLoss(state, actor, 1);
    }
    actor.equipment.armor = card;
    pushEvent(state, "equip", `${actor.name} 装备了${getEquipmentDisplayName(card.kind)}`);
    return;
  }

  if (isHorsePlusKind(card.kind)) {
    if (actor.equipment.horsePlus) {
      state.discard.push(actor.equipment.horsePlus);
      tryTriggerXiaojiAfterEquipmentLoss(state, actor, 1);
    }
    actor.equipment.horsePlus = card;
    pushEvent(state, "equip", `${actor.name} 装备了${getEquipmentDisplayName(card.kind)}`);
    return;
  }

  if (isHorseMinusKind(card.kind)) {
    if (actor.equipment.horseMinus) {
      state.discard.push(actor.equipment.horseMinus);
      tryTriggerXiaojiAfterEquipmentLoss(state, actor, 1);
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

  if (state.nullifyResponsePolicy === "seat-order") {
    return true;
  }

  const source = getPlayerById(state, sourceId);
  const target = getPlayerById(state, targetId);
  if (!source || !target || !source.alive || !target.alive) {
    return false;
  }

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
 * - 装备武器后按武器牌名映射到对应射程。
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
  if (hasSkill(state, from.id, STANDARD_SKILL_IDS.machaoMashu)) {
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
  const source = getPlayerById(state, sourceId);
  const target = getPlayerById(state, targetId);
  if (!source || !target || !target.alive) {
    return;
  }

  enterDyingResolution(state);
  try {
    target.hp -= amount;
    pushEvent(state, "damage", `${source.name} 对 ${target.name} 造成 ${amount} 点伤害`);
    tryTriggerYiji(state, target.id, amount);
    tryTriggerJianxiong(state, source, target);
    tryTriggerFankui(state, source.id, target.id, amount);
    tryTriggerGanglie(state, source.id, target.id, amount);

    resolveDyingAndDeath(state, target, source);
  } finally {
    leaveDyingResolution(state);
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
  const target = getPlayerById(state, targetId);
  if (!target || !target.alive) {
    return;
  }

  enterDyingResolution(state);
  try {
    target.hp -= amount;
    pushEvent(state, "damage", `${target.name} 受到 ${reason} 造成的 ${amount} 点无来源伤害`);
    tryTriggerYiji(state, target.id, amount);

    resolveDyingAndDeath(state, target);
  } finally {
    leaveDyingResolution(state);
  }
}

function tryTriggerYiji(state: GameState, targetId: string, damageAmount: number): void {
  const target = requireAlivePlayer(state, targetId);
  if (!hasSkill(state, target.id, STANDARD_SKILL_IDS.guojiaYiji)) {
    return;
  }

  for (let index = 0; index < damageAmount; index += 1) {
    const handCountBeforeDraw = target.hand.length;
    drawCards(state, target.id, 2);
    const drawnCards = target.hand.slice(handCountBeforeDraw);

    distributeYijiCards(state, target, drawnCards);
    pushEvent(state, "skill", `${target.name} 发动遗计，完成本次受伤后的分配`);
  }
}

function tryTriggerJianxiong(state: GameState, source: PlayerState, target: PlayerState): void {
  if (!hasSkill(state, target.id, STANDARD_SKILL_IDS.caocaoJianxiong)) {
    return;
  }

  const obtained = takeOneCardForFankui(state, source);
  if (!obtained) {
    return;
  }

  target.hand.push(obtained);
  pushEvent(state, "skill", `${target.name} 发动奸雄，获得了 ${source.name} 的 ${obtained.id}`);
}

function distributeYijiCards(state: GameState, owner: PlayerState, cards: Card[]): void {
  if (cards.length === 0) {
    return;
  }

  const recipients = getYijiRecipients(state, owner);
  if (recipients.length === 0) {
    return;
  }

  let cursor = 0;
  for (const card of cards) {
    const recipient = recipients[cursor % recipients.length];
    cursor += 1;

    if (recipient.id === owner.id) {
      pushEvent(state, "skill", `${owner.name} 发动遗计，保留了 ${card.id}`);
      continue;
    }

    const moved = removeCardFromHand(owner, card.id);
    if (!moved) {
      continue;
    }

    recipient.hand.push(moved);
    pushEvent(state, "skill", `${owner.name} 发动遗计，将 ${moved.id} 分配给 ${recipient.name}`);
  }
}

function getYijiRecipients(state: GameState, owner: PlayerState): PlayerState[] {
  if (!owner.isAi) {
    return [owner];
  }

  const ordered = getAlivePlayersFrom(state, owner.id);
  const allies = ordered.filter((candidate) => candidate.id !== owner.id && isSameCamp(candidate.identity, owner.identity));
  if (allies.length > 0) {
    return allies;
  }

  return [owner];
}

function tryTriggerFankui(state: GameState, sourceId: string, targetId: string, damageAmount: number): void {
  const target = requireAlivePlayer(state, targetId);
  if (!hasSkill(state, target.id, STANDARD_SKILL_IDS.simayiFankui)) {
    return;
  }

  const source = getPlayerById(state, sourceId);
  if (!source || !source.alive) {
    return;
  }

  for (let index = 0; index < damageAmount; index += 1) {
    const taken = takeOneCardForFankui(state, source);
    if (!taken) {
      break;
    }

    target.hand.push(taken);
    pushEvent(state, "skill", `${target.name} 发动反馈，获得了 ${source.name} 的 ${taken.id}`);
  }
}

function takeOneCardForFankui(state: GameState, source: PlayerState): Card | undefined {
  if (source.hand.length > 0) {
    const card = source.hand.shift() as Card;
    tryTriggerLianyingAfterHandLoss(state, source);
    return card;
  }

  if (source.equipment.weapon) {
    const card = source.equipment.weapon;
    source.equipment.weapon = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, source, 1);
    return card;
  }

  if (source.equipment.armor) {
    const card = source.equipment.armor;
    source.equipment.armor = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, source, 1);
    return card;
  }

  if (source.equipment.horsePlus) {
    const card = source.equipment.horsePlus;
    source.equipment.horsePlus = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, source, 1);
    return card;
  }

  if (source.equipment.horseMinus) {
    const card = source.equipment.horseMinus;
    source.equipment.horseMinus = null;
    tryTriggerXiaojiAfterEquipmentLoss(state, source, 1);
    return card;
  }

  return undefined;
}

function findGuicaiResponder(state: GameState, judgedPlayer: PlayerState): PlayerState | undefined {
  const responders = getAlivePlayersFrom(state, judgedPlayer.id);
  for (const responder of responders) {
    if (!hasSkill(state, responder.id, STANDARD_SKILL_IDS.simayiGuicai)) {
      continue;
    }

    if (responder.hand.length === 0) {
      continue;
    }

    if (!shouldUseGuicai(responder, judgedPlayer)) {
      continue;
    }

    return responder;
  }

  return undefined;
}

function shouldUseGuicai(responder: PlayerState, judgedPlayer: PlayerState): boolean {
  if (!responder.isAi) {
    return true;
  }

  return isSameCamp(responder.identity, judgedPlayer.identity);
}

function getDamageAmountWithLuoyi(
  state: GameState,
  sourceId: string,
  baseDamage: number,
  reason: "slash" | "duel"
): number {
  if (reason !== "slash" && reason !== "duel") {
    return baseDamage;
  }

  if (state.luoyiActivePlayerId !== sourceId) {
    return baseDamage;
  }

  return baseDamage + 1;
}

function applyRendeAction(state: GameState, actor: PlayerState, action: PlayCardAction): void {
  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.liubeiRende)) {
    return;
  }

  const target = action.targetId ? getPlayerById(state, action.targetId) : null;
  if (!target || !target.alive || target.id === actor.id) {
    return;
  }

  const sourceCardId = action.cardId.slice(VIRTUAL_RENDE_CARD_ID_PREFIX.length);
  const givenCard = removeCardFromHand(actor, sourceCardId);
  if (!givenCard) {
    return;
  }

  target.hand.push(givenCard);
  pushEvent(state, "skill", `${actor.name} 发动仁德，将 ${givenCard.id} 交给了 ${target.name}`);
  tryTriggerLianyingAfterHandLoss(state, actor);

  const givenCount = (state.rendeGivenInTurnByPlayer[actor.id] ?? 0) + 1;
  state.rendeGivenInTurnByPlayer[actor.id] = givenCount;

  if (!state.rendeRecoveredInTurnByPlayer[actor.id] && givenCount >= 2 && actor.hp < actor.maxHp) {
    actor.hp += 1;
    state.rendeRecoveredInTurnByPlayer[actor.id] = true;
    pushEvent(state, "skill", `${actor.name} 的仁德本阶段给牌达到两张，回复了 1 点体力`);
  }
}

function applyFanjianAction(state: GameState, actor: PlayerState, action: PlayCardAction): void {
  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.zhouyuFanjian)) {
    return;
  }

  if (state.fanjianUsedInTurnByPlayer[actor.id]) {
    return;
  }

  const target = action.targetId ? getPlayerById(state, action.targetId) : null;
  if (!target || !target.alive || target.id === actor.id) {
    return;
  }

  const sourceCardId = action.cardId.slice(VIRTUAL_FANJIAN_CARD_ID_PREFIX.length);
  const givenCard = removeCardFromHand(actor, sourceCardId);
  if (!givenCard) {
    return;
  }

  state.fanjianUsedInTurnByPlayer[actor.id] = true;

  const chosenSuit = chooseFanjianSuit(target);
  pushEvent(state, "skill", `${target.name} 被反间指定，选择了花色 ${getSuitDisplayName(chosenSuit)}`);
  target.hand.push(givenCard);
  pushEvent(state, "skill", `${actor.name} 发动反间，将 ${givenCard.id} 交给了 ${target.name}`);

  if (getCardSuit(givenCard) !== chosenSuit) {
    pushEvent(state, "skill", `${target.name} 猜错了花色，受到 1 点伤害`);
    dealDamage(state, actor.id, target.id, 1);
  } else {
    pushEvent(state, "skill", `${target.name} 猜中了花色，未受到伤害`);
  }
}

function applyKurouAction(state: GameState, actor: PlayerState): void {
  loseHp(state, actor.id, 1, "苦肉");
  if (!actor.alive) {
    return;
  }

  drawCards(state, actor.id, 2);
  pushEvent(state, "skill", `${actor.name} 发动苦肉，失去 1 点体力并摸 2 张牌`);
}

function applyZhihengAction(state: GameState, actor: PlayerState, action: PlayCardAction): void {
  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.sunquanZhiheng)) {
    return;
  }

  if (state.zhihengUsedInTurnByPlayer[actor.id]) {
    return;
  }

  const sourceCardId = action.cardId.slice(VIRTUAL_ZHIHENG_CARD_ID_PREFIX.length);
  const discarded = removeCardFromHand(actor, sourceCardId);
  if (!discarded) {
    return;
  }

  state.discard.push(discarded);
  state.zhihengUsedInTurnByPlayer[actor.id] = true;
  tryTriggerLianyingAfterHandLoss(state, actor);
  drawCards(state, actor.id, 1);
  pushEvent(state, "skill", `${actor.name} 发动制衡，弃置 1 张牌并摸 1 张牌`);
}

function applyJieyinAction(state: GameState, actor: PlayerState, action: PlayCardAction): void {
  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.sunshangxiangJieyin)) {
    return;
  }

  if (state.jieyinUsedInTurnByPlayer[actor.id]) {
    return;
  }

  const target = action.targetId ? getPlayerById(state, action.targetId) : null;
  if (!target || !target.alive || target.id === actor.id || target.gender !== "male" || target.hp >= target.maxHp) {
    return;
  }

  if (actor.hand.length < 2) {
    return;
  }

  const discardA = actor.hand.shift() as Card;
  const discardB = actor.hand.shift() as Card;
  state.discard.push(discardA, discardB);
  tryTriggerLianyingAfterHandLoss(state, actor);
  state.jieyinUsedInTurnByPlayer[actor.id] = true;

  if (actor.hp < actor.maxHp) {
    actor.hp += 1;
  }
  if (target.hp < target.maxHp) {
    target.hp += 1;
  }

  pushEvent(state, "skill", `${actor.name} 发动结姻，与 ${target.name} 各回复 1 点体力`);
}

function applyGuoseAction(state: GameState, actor: PlayerState, action: PlayCardAction): void {
  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.daqiaoGuose)) {
    return;
  }

  const target = action.targetId ? getPlayerById(state, action.targetId) : null;
  if (!target || !target.alive || target.id === actor.id || hasDelayedTrick(target, "indulgence")) {
    return;
  }

  const sourceCardId = action.cardId.slice(VIRTUAL_GUOSE_CARD_ID_PREFIX.length);
  const sourceCard = removeCardFromHand(actor, sourceCardId);
  if (!sourceCard || getCardSuit(sourceCard) !== "diamond") {
    if (sourceCard) {
      actor.hand.push(sourceCard);
    }
    return;
  }

  const indulgenceCard: Card = {
    ...sourceCard,
    kind: "indulgence"
  };

  target.judgmentZone.delayedTricks.push(indulgenceCard);
  pushEvent(state, "skill", `${actor.name} 发动国色，将方片牌当乐不思蜀置入 ${target.name} 的判定区`);
}

function applyQixiAction(state: GameState, actor: PlayerState, action: PlayCardAction): void {
  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.ganningQixi)) {
    return;
  }

  const target = action.targetId ? getPlayerById(state, action.targetId) : null;
  if (!target || !target.alive || target.id === actor.id || target.hand.length === 0) {
    return;
  }

  const sourceCardId = action.cardId.slice(VIRTUAL_QIXI_CARD_ID_PREFIX.length);
  const sourceCard = removeCardFromHand(actor, sourceCardId);
  if (!sourceCard || !isBlack(sourceCard)) {
    if (sourceCard) {
      actor.hand.push(sourceCard);
    }
    return;
  }

  pushEvent(state, "skill", `${actor.name} 发动奇袭，将黑色牌当过河拆桥使用`);

  const negated = resolveNullifyChain(state, actor.id, target.id, "dismantle");
  if (negated) {
    pushEvent(state, "nullify", "奇袭的过河拆桥效果被无懈可击抵消");
    state.discard.push(sourceCard);
    tryTriggerLianyingAfterHandLoss(state, actor);
    return;
  }

  if (target.hand.length > 0) {
    const removed = target.hand.shift() as Card;
    state.discard.push(removed);
    pushEvent(state, "trick", `${actor.name} 通过奇袭弃置了 ${target.name} 的 1 张手牌`);
  }

  state.discard.push(sourceCard);
  tryTriggerLianyingAfterHandLoss(state, actor);
}

function applyLijianAction(state: GameState, actor: PlayerState, action: PlayCardAction): void {
  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.diaochanLijian)) {
    return;
  }

  if (state.lijianUsedInTurnByPlayer[actor.id]) {
    return;
  }

  const firstTarget = action.targetId ? getPlayerById(state, action.targetId) : null;
  const secondTarget = action.secondaryTargetId ? getPlayerById(state, action.secondaryTargetId) : null;
  if (
    !firstTarget ||
    !secondTarget ||
    !firstTarget.alive ||
    !secondTarget.alive ||
    firstTarget.id === secondTarget.id ||
    firstTarget.id === actor.id ||
    secondTarget.id === actor.id ||
    firstTarget.gender !== "male" ||
    secondTarget.gender !== "male"
  ) {
    return;
  }

  const sourceCardId = action.cardId.slice(VIRTUAL_LIJIAN_CARD_ID_PREFIX.length);
  const costCard = removeCardFromHand(actor, sourceCardId);
  if (!costCard) {
    return;
  }

  state.discard.push(costCard);
  state.lijianUsedInTurnByPlayer[actor.id] = true;
  pushEvent(state, "skill", `${actor.name} 发动离间，弃置 1 张牌并令 ${firstTarget.name} 对 ${secondTarget.name} 使用决斗`);
  resolveDuel(state, firstTarget.id, secondTarget.id);
}

function applyQingnangAction(state: GameState, actor: PlayerState, action: PlayCardAction): void {
  if (!hasSkill(state, actor.id, STANDARD_SKILL_IDS.huatuoQingnang)) {
    return;
  }

  if (state.qingnangUsedInTurnByPlayer[actor.id]) {
    return;
  }

  const target = action.targetId ? getPlayerById(state, action.targetId) : null;
  if (!target || !target.alive || target.hp >= target.maxHp) {
    return;
  }

  const sourceCardId = action.cardId.slice(VIRTUAL_QINGNANG_CARD_ID_PREFIX.length);
  const costCard = removeCardFromHand(actor, sourceCardId);
  if (!costCard) {
    return;
  }

  state.discard.push(costCard);
  state.qingnangUsedInTurnByPlayer[actor.id] = true;
  target.hp += 1;
  pushEvent(state, "skill", `${actor.name} 发动青囊，弃置 1 张手牌并令 ${target.name} 回复 1 点体力`);
}

function tryTriggerLianyingAfterHandLoss(state: GameState, owner: PlayerState): void {
  if (!hasSkill(state, owner.id, STANDARD_SKILL_IDS.luxunLianying)) {
    return;
  }

  if (owner.hand.length !== 0) {
    return;
  }

  drawCards(state, owner.id, 1);
  pushEvent(state, "skill", `${owner.name} 发动连营，失去最后手牌后摸 1 张牌`);
}

function tryTriggerXiaojiAfterEquipmentLoss(state: GameState, owner: PlayerState, count: number): void {
  if (!owner.alive) {
    return;
  }

  if (!hasSkill(state, owner.id, STANDARD_SKILL_IDS.sunshangxiangXiaoji)) {
    return;
  }

  if (count <= 0) {
    return;
  }

  const drawCount = count * 2;
  drawCards(state, owner.id, drawCount);
  pushEvent(state, "skill", `${owner.name} 发动枭姬，失去装备后摸 ${drawCount} 张牌`);
}

function loseHp(state: GameState, targetId: string, amount: number, reason: string): void {
  const target = requireAlivePlayer(state, targetId);
  enterDyingResolution(state);
  try {
    target.hp -= amount;
    pushEvent(state, "damage", `${target.name} 因${reason}失去 ${amount} 点体力`);

    resolveDyingAndDeath(state, target);
  } finally {
    leaveDyingResolution(state);
  }
}

function chooseFanjianSuit(target: PlayerState): CardSuit {
  if (!target.isAi) {
    return "spade";
  }

  return "spade";
}

function getSuitDisplayName(suit: CardSuit): string {
  if (suit === "spade") {
    return "黑桃";
  }
  if (suit === "heart") {
    return "红桃";
  }
  if (suit === "club") {
    return "梅花";
  }

  return "方片";
}

function tryTriggerTiandu(state: GameState, judgedPlayer: PlayerState, judgeCardId: string): void {
  if (!hasSkill(state, judgedPlayer.id, STANDARD_SKILL_IDS.guojiaTiandu)) {
    return;
  }

  const cardIndex = state.discard.findIndex((card) => card.id === judgeCardId);
  if (cardIndex < 0) {
    return;
  }

  const [taken] = state.discard.splice(cardIndex, 1);
  judgedPlayer.hand.push(taken);
  pushEvent(state, "skill", `${judgedPlayer.name} 发动天妒，获得了判定牌 ${taken.id}`);
}

function tryTriggerGanglie(state: GameState, sourceId: string, targetId: string, damageAmount: number): void {
  const owner = requireAlivePlayer(state, targetId);
  if (!hasSkill(state, owner.id, STANDARD_SKILL_IDS.xiahoudunGanglie)) {
    return;
  }

  for (let index = 0; index < damageAmount; index += 1) {
    const source = getPlayerById(state, sourceId);
    if (!source || !source.alive || !owner.alive) {
      return;
    }

    const judgeCard = drawJudgmentCard(state, owner);
    if (!judgeCard) {
      continue;
    }

    if (isHeart(judgeCard)) {
      pushEvent(state, "skill", `${owner.name} 的刚烈判定为红桃，效果未生效`);
      continue;
    }

    if (source.hand.length >= 2) {
      const discardA = source.hand.shift() as Card;
      const discardB = source.hand.shift() as Card;
      state.discard.push(discardA, discardB);
      tryTriggerLianyingAfterHandLoss(state, source);
      pushEvent(state, "skill", `${owner.name} 发动刚烈，${source.name} 弃置了两张手牌`);
      continue;
    }

    pushEvent(state, "skill", `${owner.name} 发动刚烈，${source.name} 手牌不足两张，受到 1 点伤害`);
    dealDamage(state, owner.id, source.id, 1);
    if (state.winner) {
      return;
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

  let rescueRound = 1;
  while (target.hp <= 0) {
    let rescuedThisRound = false;
    const rescueOrder = getRescueCandidatesInOrder(state, target.id);
    pushEvent(state, "rescue", `${target.name} 发起第 ${rescueRound} 轮求桃（当前体力=${target.hp}）`);

    for (const candidate of rescueOrder) {

      if (!shouldUsePeachToRescue(candidate, target)) {
        continue;
      }

      const peach = consumePeachLikeForRescue(state, candidate);
      if (!peach) {
        continue;
      }

      state.discard.push(peach);
      target.hp = Math.min(target.maxHp, target.hp + 1);
      if (shouldTriggerJiuyuan(state, candidate, target)) {
        target.hp = Math.min(target.maxHp, target.hp + 1);
        pushEvent(state, "skill", `${target.name} 发动救援，额外回复 1 点体力`);
      }

      pushEvent(state, "rescue", `${candidate.name} 使用桃救回 ${target.name}`);
      rescuedThisRound = true;
      if (target.hp > 0) {
        pushEvent(state, "dying", `${target.name} 已脱离濒死（体力=${target.hp}）`);
        return true;
      }
    }

    if (!rescuedThisRound) {
      pushEvent(state, "dying", `${target.name} 求桃失败，未脱离濒死`);
      return false;
    }

    rescueRound += 1;
  }

  return true;
}

function resolveDyingAndDeath(state: GameState, target: PlayerState, source?: PlayerState): void {
  if (!target.alive || target.hp > 0) {
    return;
  }

  pushEvent(state, "dying", `${target.name} 进入濒死状态（体力=${target.hp}）`);
  const rescued = tryRescueWithPeach(state, target.id);
  if (rescued) {
    return;
  }

  target.alive = false;
  clearDeadPlayerCards(state, target);
  pushEvent(state, "death", `${target.name} 阵亡`);
  applyKillRewardAndPunishment(state, source, target);
}

function applyKillRewardAndPunishment(state: GameState, killer: PlayerState | undefined, dead: PlayerState): void {
  if (!killer || !killer.alive) {
    return;
  }

  if (dead.identity === "rebel") {
    drawCards(state, killer.id, 3);
    pushEvent(state, "trick", `${killer.name} 击杀反贼，摸 3 张牌`);
    return;
  }

  if (killer.identity === "lord" && dead.identity === "loyalist") {
    discardAllCardsForPunishment(state, killer);
    pushEvent(state, "trick", `${killer.name} 误杀忠臣，弃置所有牌`);
  }
}

function discardAllCardsForPunishment(state: GameState, player: PlayerState): void {
  for (const card of player.hand) {
    state.discard.push(card);
  }
  player.hand = [];

  if (player.equipment.weapon) {
    state.discard.push(player.equipment.weapon);
    player.equipment.weapon = null;
  }
  if (player.equipment.armor) {
    state.discard.push(player.equipment.armor);
    player.equipment.armor = null;
  }
  if (player.equipment.horsePlus) {
    state.discard.push(player.equipment.horsePlus);
    player.equipment.horsePlus = null;
  }
  if (player.equipment.horseMinus) {
    state.discard.push(player.equipment.horseMinus);
    player.equipment.horseMinus = null;
  }

  for (const trick of player.judgmentZone.delayedTricks) {
    state.discard.push(trick);
  }
  player.judgmentZone.delayedTricks = [];
}

function enterDyingResolution(state: GameState): void {
  const depth = DYING_RESOLUTION_DEPTH.get(state) ?? 0;
  DYING_RESOLUTION_DEPTH.set(state, depth + 1);
}

function leaveDyingResolution(state: GameState): void {
  const depth = DYING_RESOLUTION_DEPTH.get(state) ?? 0;
  if (depth <= 1) {
    DYING_RESOLUTION_DEPTH.delete(state);
    updateWinner(state);
    return;
  }

  DYING_RESOLUTION_DEPTH.set(state, depth - 1);
}

function getRescueCandidatesInOrder(state: GameState, targetId: string): PlayerState[] {
  const current = getPlayerById(state, state.currentPlayerId);
  if (current && current.alive) {
    return getAlivePlayersFrom(state, current.id);
  }

  return getAlivePlayersFrom(state, targetId);
}

function consumePeachLikeForRescue(state: GameState, player: PlayerState): Card | undefined {
  const peach = consumeFirstCardByKind(player, "peach");
  if (peach) {
    return peach;
  }

  if (!hasSkill(state, player.id, STANDARD_SKILL_IDS.huatuoJijiu)) {
    return undefined;
  }

  if (player.id === state.currentPlayerId) {
    return undefined;
  }

  const redIndex = player.hand.findIndex((card) => isRed(card));
  if (redIndex < 0) {
    return undefined;
  }

  const [converted] = player.hand.splice(redIndex, 1);
  pushEvent(state, "skill", `${player.name} 在回合外发动急救，将红色手牌当桃使用`);
  return {
    ...converted,
    kind: "peach"
  };
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

function shouldTriggerJiuyuan(state: GameState, rescuer: PlayerState, target: PlayerState): boolean {
  if (!hasSkill(state, target.id, STANDARD_SKILL_IDS.sunquanJiuyuan)) {
    return false;
  }

  if (target.identity !== "lord") {
    return false;
  }

  if (rescuer.id === target.id) {
    return false;
  }

  return isSameCamp(rescuer.identity, target.identity);
}

function canIgnoreTrickDistance(state: GameState, actor: PlayerState): boolean {
  return hasSkill(state, actor.id, STANDARD_SKILL_IDS.huangyueyingQicai);
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

  if (hasSkill(state, player.id, STANDARD_SKILL_IDS.lvmengKeji) && state.slashUsedInTurn === 0) {
    pushEvent(state, "skill", `${player.name} 发动克己，跳过弃牌阶段`);
    return;
  }

  while (player.hand.length > player.hp) {
    const card = player.hand.pop() as Card;
    state.discard.push(card);
    tryTriggerLianyingAfterHandLoss(state, player);
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
  state.luoyiActivePlayerId = null;
  state.rendeGivenInTurnByPlayer = {};
  state.rendeRecoveredInTurnByPlayer = {};
  state.fanjianUsedInTurnByPlayer = {};
  state.zhihengUsedInTurnByPlayer = {};
  state.jieyinUsedInTurnByPlayer = {};
  state.lijianUsedInTurnByPlayer = {};
  state.qingnangUsedInTurnByPlayer = {};
  state.turnCount += 1;
  pushEvent(state, "turn", `轮到 ${next.name} 的回合`);
  pushEvent(state, "phase", `${next.name} 进入判定阶段`);
}

function getAliveOpponents(state: GameState, actorId: string): PlayerState[] {
  const actor = getPlayerById(state, actorId);
  if (!actor) {
    return state.players.filter((candidate) => candidate.alive);
  }

  return state.players.filter((candidate) => candidate.alive && candidate.id !== actor.id);
}

function hasUnlimitedSlashUsage(state: GameState, player: PlayerState): boolean {
  return player.equipment.weapon?.kind === "weapon_crossbow" || hasSkill(state, player.id, STANDARD_SKILL_IDS.zhangfeiPaoxiao);
}

function canBeTargetedBySlashOrDuel(state: GameState, target: PlayerState): boolean {
  if (hasSkill(state, target.id, STANDARD_SKILL_IDS.zhugeliangKongcheng) && target.hand.length === 0) {
    return false;
  }

  return true;
}

function canBeTargetedBySnatchOrIndulgence(state: GameState, target: PlayerState): boolean {
  if (hasSkill(state, target.id, STANDARD_SKILL_IDS.luxunQianxun)) {
    return false;
  }

  return true;
}

function tryTriggerLuoshen(state: GameState, owner: PlayerState): void {
  if (!hasSkill(state, owner.id, STANDARD_SKILL_IDS.zhenjiLuoshen)) {
    return;
  }

  while (true) {
    const judgeCard = drawJudgmentCard(state, owner);
    if (!judgeCard) {
      return;
    }

    if (!isBlack(judgeCard)) {
      pushEvent(state, "skill", `${owner.name} 发动洛神，判定为红色，结束连判`);
      return;
    }

    const discardIndex = state.discard.findIndex((card) => card.id === judgeCard.id);
    if (discardIndex >= 0) {
      const [obtained] = state.discard.splice(discardIndex, 1);
      owner.hand.push(obtained);
    }
    pushEvent(state, "skill", `${owner.name} 发动洛神，判定为黑色，获得 ${judgeCard.id}`);
  }
}

function tryTriggerBiyue(state: GameState, owner: PlayerState): void {
  if (!hasSkill(state, owner.id, STANDARD_SKILL_IDS.diaochanBiyue)) {
    return;
  }

  pushEvent(state, "skill", `${owner.name} 发动闭月，结束阶段摸 1 张牌`);
  drawCards(state, owner.id, 1);
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

function consumeSlashLikeCard(state: GameState, player: PlayerState, contextName: string, allowJijiang = true): Card | undefined {
  const slash = consumeFirstCardByKind(player, "slash");
  if (slash) {
    return slash;
  }

  if (allowJijiang && hasSkill(state, player.id, STANDARD_SKILL_IDS.liubeiJijiang)) {
    const responders = getJijiangResponders(state, player);
    for (const responder of responders) {
      const provided = consumeSlashLikeCard(state, responder, "激将", false);
      if (!provided) {
        continue;
      }

      pushEvent(state, "skill", `${player.name} 发动激将，由 ${responder.name} 提供了一张杀`);
      return provided;
    }
  }

  if (hasSkill(state, player.id, STANDARD_SKILL_IDS.zhaoyunLongdan)) {
    const dodgeAsSlash = consumeFirstCardByKind(player, "dodge");
    if (dodgeAsSlash) {
      pushEvent(state, "skill", `${player.name} 在${contextName}中发动龙胆，将闪当杀打出`);
      return {
        ...dodgeAsSlash,
        kind: "slash"
      };
    }
  }

  if (hasSkill(state, player.id, STANDARD_SKILL_IDS.guanyuWusheng)) {
    const redIndex = player.hand.findIndex((card) => isRed(card));
    if (redIndex >= 0) {
      const [converted] = player.hand.splice(redIndex, 1);
      pushEvent(state, "skill", `${player.name} 在${contextName}中发动武圣，将红色手牌当杀打出`);
      return {
        ...converted,
        kind: "slash"
      };
    }
  }

  if (player.equipment.weapon?.kind === "weapon_spear" && player.hand.length >= 2) {
    const subA = player.hand.shift() as Card;
    const subB = player.hand.shift() as Card;
    state.discard.push(subA, subB);
    pushEvent(state, "equip", `${player.name} 在${contextName}中发动丈八蛇矛，将两张手牌当杀打出`);
    return {
      id: `${VIRTUAL_SPEAR_SLASH_CARD_ID}-rsp-${state.turnCount}-${state.events.length}`,
      kind: "slash",
      suit: "spade",
      point: 7
    };
  }

  return undefined;
}

function getJijiangResponders(state: GameState, owner: PlayerState): PlayerState[] {
  const ordered = getAlivePlayersFrom(state, owner.id);
  return ordered.filter((candidate) => candidate.id !== owner.id && isSameCamp(candidate.identity, owner.identity));
}

function consumeRequiredSlashLikeCards(state: GameState, player: PlayerState, count: number, contextName: string): Card[] {
  const consumed: Card[] = [];
  for (let index = 0; index < count; index += 1) {
    const slash = consumeSlashLikeCard(state, player, contextName);
    if (!slash) {
      break;
    }
    consumed.push(slash);
  }

  return consumed;
}

function consumeRequiredDodgeResponses(
  state: GameState,
  target: PlayerState,
  requiredCount: number,
  armorIgnored: boolean,
  slashLabel: string
): boolean {
  let respondedCount = 0;
  for (let index = 0; index < requiredCount; index += 1) {
    if (!armorIgnored && tryAutoDodgeWithEightDiagram(state, target)) {
      respondedCount += 1;
      continue;
    }

    const dodgeCard = consumeDodgeLikeCard(state, target, "响应杀");
    if (!dodgeCard) {
      break;
    }

    state.discard.push(dodgeCard);
    respondedCount += 1;
  }

  if (respondedCount < requiredCount) {
    if (requiredCount > 1) {
      pushEvent(state, "response", `${target.name} 未能连续打出 ${requiredCount} 张闪，无法抵消${slashLabel}`);
    }
    return false;
  }

  if (requiredCount > 1) {
    pushEvent(state, "response", `${target.name} 连续打出 ${requiredCount} 张闪，抵消${slashLabel}`);
  } else {
    pushEvent(state, "response", `${target.name} 打出闪，抵消${slashLabel}`);
  }

  return true;
}

function consumeDodgeLikeCard(state: GameState, player: PlayerState, contextName: string): Card | undefined {
  const dodge = consumeFirstCardByKind(player, "dodge");
  if (dodge) {
    return dodge;
  }

  if (hasSkill(state, player.id, STANDARD_SKILL_IDS.zhenjiQingguo)) {
    const blackIndex = player.hand.findIndex((card) => isBlack(card));
    if (blackIndex >= 0) {
      const [converted] = player.hand.splice(blackIndex, 1);
      pushEvent(state, "skill", `${player.name} 在${contextName}中发动倾国，将黑色手牌当闪打出`);
      return {
        ...converted,
        kind: "dodge"
      };
    }
  }

  if (hasSkill(state, player.id, STANDARD_SKILL_IDS.caocaoHujia) && player.identity === "lord") {
    const responders = getJijiangResponders(state, player);
    for (const responder of responders) {
      const provided = consumeDodgeLikeCard(state, responder, "护驾");
      if (!provided) {
        continue;
      }

      pushEvent(state, "skill", `${player.name} 发动护驾，由 ${responder.name} 提供了一张闪`);
      return provided;
    }
  }

  if (!hasSkill(state, player.id, STANDARD_SKILL_IDS.zhaoyunLongdan)) {
    return undefined;
  }

  const slashAsDodge = consumeFirstCardByKind(player, "slash");
  if (!slashAsDodge) {
    return undefined;
  }

  pushEvent(state, "skill", `${player.name} 在${contextName}中发动龙胆，将杀当闪打出`);
  return {
    ...slashAsDodge,
    kind: "dodge"
  };
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
  const event = { type, message };
  state.events.push(event);
  emitSkillEvent(state, event);
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

function isBlack(card: Card): boolean {
  const suit = getCardSuit(card);
  return suit === "spade" || suit === "club";
}

function isRed(card: Card): boolean {
  return !isBlack(card);
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
