import { Card, CardKind, GameEvent, GameState, Identity, PlayerState, PlayCardAction, TurnAction } from "./types";
import { getLegalActions } from "./engine";

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

const WEAPON_BASE_SCORE: Partial<Record<CardKind, number>> = {
  weapon_crossbow: 11,
  weapon_qinggang_sword: 9,
  weapon_blade: 8,
  weapon_ice_sword: 8,
  weapon_spear: 7,
  weapon_axe: 7,
  weapon_halberd: 7,
  weapon_kylin_bow: 6,
  weapon_double_sword: 6
};

const ARMOR_BASE_SCORE: Partial<Record<CardKind, number>> = {
  armor_eight_diagram: 8,
  armor_renwang_shield: 7
};

type AiPerception = {
  relationByPlayerId: Record<string, number>;
  inferredCampByPlayerId: Record<string, "lord-side" | "rebel-side" | "unknown">;
};

type AiObservedState = {
  players: PlayerState[];
  events: GameEvent[];
};

export interface AiDecisionContext {
  state: AiObservedState;
  actor: PlayerState;
  legalActions: TurnAction[];
}

export function createAiDecisionContext(state: GameState, actorId: string): AiDecisionContext {
  const actor = state.players.find((player) => player.id === actorId && player.alive);
  if (!actor) {
    throw new Error(`AI actor not found or dead: ${actorId}`);
  }

  const observedPlayers = state.players.map((player) => createObservedPlayer(player, actorId));
  const observedActor = observedPlayers.find((player) => player.id === actorId);
  if (!observedActor) {
    throw new Error(`Observed AI actor not found: ${actorId}`);
  }

  const legalActions = getLegalActions(state).filter((action) => action.actorId === actorId);
  const observedEvents = state.events.slice(-200).map((event) => ({ ...event }));

  return {
    state: {
      players: observedPlayers,
      events: observedEvents
    },
    actor: observedActor,
    legalActions
  };
}

/**
 * 为基础 AI 生成本回合动作。
 *
 * 策略优先级：
 * 1) 先保命（如果可用桃并受伤则优先使用）。
 * 2) 再尝试功能锦囊（顺手牵羊、过河拆桥、决斗、借刀杀人、乐不思蜀）。
 * 3) 再尝试增益锦囊（桃园结义、五谷丰登、无中生有）。
 * 4) 再尝试群体锦囊（南蛮入侵、万箭齐发）。
 * 4) 再尝试进攻（使用杀攻击体力最低目标）。
 * 4) 无更优动作时结束出牌阶段。
 *
 * @param context AI 可见上下文。
 * @returns 选择后的动作。
 */
export function chooseAiAction(context: AiDecisionContext): TurnAction {
  const legal = context.legalActions;
  const perception = buildAiPerception(context);
  const slashLikeActionCount = legal.filter(
    (action) => isPlayCardAction(action) && getActionCardKind(context, action) === "slash"
  ).length;

  const utilityTrickActions = legal.filter((action): action is PlayCardAction => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const cardKind = getActionCardKind(context, action);

    if (
      cardKind !== "snatch" &&
      cardKind !== "dismantle" &&
      cardKind !== "duel" &&
      cardKind !== "collateral" &&
      cardKind !== "indulgence" &&
      cardKind !== "fanjian" &&
      cardKind !== "lijian"
    ) {
      return false;
    }

    if (cardKind === "lijian") {
      const sourceTarget = context.state.players.find((player) => player.id === action.targetId);
      const secondaryTarget = context.state.players.find((player) => player.id === action.secondaryTargetId);
      if (!sourceTarget || !secondaryTarget) {
        return false;
      }

      return shouldAttackPlayer(context, perception, sourceTarget) && shouldAttackPlayer(context, perception, secondaryTarget);
    }

    const target = context.state.players.find((player) => player.id === action.targetId);
    if (!target) {
      return false;
    }

    return shouldAttackPlayer(context, perception, target);
  });

  const slashActions = legal.filter((action): action is PlayCardAction => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const cardKind = getActionCardKind(context, action);
    if (cardKind !== "slash") {
      return false;
    }

    const target = context.state.players.find((player) => player.id === action.targetId);
    if (!target) {
      return false;
    }

    return shouldAttackPlayer(context, perception, target);
  });

  const heal = legal.find((action) => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    if (getActionCardKind(context, action) !== "peach") {
      return false;
    }

    return shouldUsePeachInPlayPhase(context, slashLikeActionCount > 0);
  });

  if (heal) {
    return heal;
  }

  if (utilityTrickActions.length > 0) {
    const bestUtilityAction = pickHighestScoreAction(utilityTrickActions, (action) =>
      scoreUtilityTrickAction(context, perception, action)
    );
    if (bestUtilityAction) {
      return bestUtilityAction;
    }
  }

  const supportTrickActions = legal.filter((action): action is PlayCardAction => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const cardKind = getActionCardKind(context, action);
    return (
      cardKind === "taoyuan" ||
      cardKind === "harvest" ||
      cardKind === "ex_nihilo" ||
      cardKind === "rende" ||
      cardKind === "zhiheng" ||
      cardKind === "jieyin" ||
      cardKind === "qingnang" ||
      cardKind === "kurou"
    );
  });

  if (supportTrickActions.length > 0) {
    const bestSupportAction = pickHighestScoreAction(supportTrickActions, (action) =>
      scoreSupportAction(context, perception, action, slashActions.length > 0)
    );
    if (bestSupportAction) {
      return bestSupportAction;
    }
  }

  const delayedAction = legal.find((action) => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const cardKind = getActionCardKind(context, action);

    if (cardKind === "lightning") {
      const hpSafe = context.actor.hp >= 3;
      const enemyCount = context.state.players.filter(
        (player) => player.alive && player.id !== context.actor.id && shouldAttackPlayer(context, perception, player)
      ).length;
      return hpSafe && enemyCount >= 2;
    }

    return false;
  });

  if (delayedAction) {
    return delayedAction;
  }

  const equipmentActions = legal.filter((action): action is PlayCardAction => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const cardKind = getActionCardKind(context, action);
    return (
      cardKind === "weapon_crossbow" ||
      cardKind === "weapon_double_sword" ||
      cardKind === "weapon_qinggang_sword" ||
      cardKind === "weapon_blade" ||
      cardKind === "weapon_spear" ||
      cardKind === "weapon_axe" ||
      cardKind === "weapon_halberd" ||
      cardKind === "weapon_kylin_bow" ||
      cardKind === "weapon_ice_sword" ||
      cardKind === "armor_eight_diagram" ||
      cardKind === "armor_renwang_shield" ||
      cardKind === "horse_plus" ||
      cardKind === "horse_jueying" ||
      cardKind === "horse_dilu" ||
      cardKind === "horse_zhuahuangfeidian" ||
      cardKind === "horse_minus" ||
      cardKind === "horse_chitu" ||
      cardKind === "horse_dayuan" ||
      cardKind === "horse_zixing"
    );
  });

  if (equipmentActions.length > 0) {
    const bestEquipmentAction = pickHighestScoreAction(equipmentActions, (action) => scoreEquipmentAction(context, action));
    if (bestEquipmentAction && scoreEquipmentAction(context, bestEquipmentAction) > 0) {
      return bestEquipmentAction;
    }
  }

  const aoeAction = legal.find((action) => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const cardKind = getActionCardKind(context, action);
    if (cardKind !== "barbarian" && cardKind !== "archery") {
      return false;
    }

    const enemies = context.state.players.filter(
      (player) => player.alive && player.id !== context.actor.id && shouldAttackPlayer(context, perception, player)
    );
    const allies = context.state.players.filter(
      (player) => player.alive && player.id !== context.actor.id && isLikelyAlly(context, perception, player)
    );

    const enemyImpact = enemies.reduce((sum, player) => {
      const hpPressure = player.hp <= 1 ? 3 : player.hp <= 2 ? 2 : 1;
      const responseWeakness = player.hand.length <= 1 ? 2 : player.hand.length <= 2 ? 1 : 0;
      return sum + hpPressure + responseWeakness;
    }, 0);

    const allyImpact = allies.reduce((sum, player) => {
      const hpRisk = player.hp <= 1 ? 4 : player.hp <= 2 ? 2 : 1;
      const responseRisk = player.hand.length <= 1 ? 2 : player.hand.length <= 2 ? 1 : 0;
      return sum + hpRisk + responseRisk;
    }, 0);

    const score = enemyImpact - allyImpact;
    return score > 0;
  });

  if (aoeAction) {
    return aoeAction;
  }

  if (slashActions.length > 0) {
    const bestSlashAction = pickHighestScoreAction(slashActions, (action) => scoreSlashAction(context, perception, action));
    if (bestSlashAction) {
      return bestSlashAction;
    }
  }

  return legal.find((action) => action.type === "end-play-phase") ?? legal[0];
}

/**
 * 判断动作是否为出牌动作，并在 TypeScript 中完成类型收窄。
 *
 * @param action 待判断动作。
 * @returns 若为出牌动作则返回 true。
 */
function isPlayCardAction(action: TurnAction): action is PlayCardAction {
  return action.type === "play-card";
}

function getActionCardKind(
  context: AiDecisionContext,
  action: PlayCardAction
): CardKind | "rende" | "fanjian" | "zhiheng" | "jieyin" | "kurou" | "lijian" | "qingnang" | null {
  const { cardId } = action;

  if (cardId === VIRTUAL_SPEAR_SLASH_CARD_ID) {
    return "slash";
  }

  if (cardId.startsWith(VIRTUAL_WUSHENG_SLASH_CARD_ID_PREFIX) || cardId.startsWith(VIRTUAL_LONGDAN_SLASH_CARD_ID_PREFIX)) {
    return "slash";
  }

  if (cardId.startsWith(VIRTUAL_QIXI_CARD_ID_PREFIX)) {
    return "dismantle";
  }

  if (cardId.startsWith(VIRTUAL_GUOSE_CARD_ID_PREFIX)) {
    return "indulgence";
  }

  if (cardId.startsWith(VIRTUAL_RENDE_CARD_ID_PREFIX)) {
    return "rende";
  }

  if (cardId.startsWith(VIRTUAL_FANJIAN_CARD_ID_PREFIX)) {
    return "fanjian";
  }

  if (cardId.startsWith(VIRTUAL_LIJIAN_CARD_ID_PREFIX)) {
    return "lijian";
  }

  if (cardId.startsWith(VIRTUAL_ZHIHENG_CARD_ID_PREFIX)) {
    return "zhiheng";
  }

  if (cardId === VIRTUAL_JIEYIN_CARD_ID) {
    return "jieyin";
  }

  if (cardId === VIRTUAL_KUROU_CARD_ID) {
    return "kurou";
  }

  if (cardId.startsWith(VIRTUAL_QINGNANG_CARD_ID_PREFIX)) {
    return "qingnang";
  }

  return context.actor.hand.find((item) => item.id === cardId)?.kind ?? null;
}

/**
 * 判断在出牌阶段是否主动使用【桃】。
 *
 * 设计目标：
 * - 避免 AI 在轻伤时过度吃桃导致终局拉锯。
 * - 仍保持低血线时优先自保。
 *
 * @param context AI 可见上下文。
 * @param hasAggressiveOption 当前是否存在可执行的进攻动作。
 * @returns 是否在本次决策中优先吃桃。
 */
function shouldUsePeachInPlayPhase(context: AiDecisionContext, hasAggressiveOption: boolean): boolean {
  const hpGap = context.actor.maxHp - context.actor.hp;
  if (hpGap <= 0) {
    return false;
  }

  if (context.actor.hp <= 2) {
    return true;
  }

  if (!hasAggressiveOption && context.actor.hand.length > context.actor.hp + 1) {
    return true;
  }

  return false;
}

function pickHighestScoreAction(actions: PlayCardAction[], scorer: (action: PlayCardAction) => number): PlayCardAction | null {
  if (actions.length === 0) {
    return null;
  }

  let bestAction: PlayCardAction | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const action of actions) {
    const score = scorer(action);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  return bestAction;
}

function scoreSlashAction(context: AiDecisionContext, perception: AiPerception, action: PlayCardAction): number {
  const target = context.state.players.find((player) => player.id === action.targetId);
  if (!target) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 40;
  score += Math.max(0, 4 - target.hp) * 8;
  score += target.hand.length === 0 ? 8 : 0;
  score += target.hp <= 1 ? 50 : 0;
  score += Math.max(0, getRelationScore(perception, target.id)) * 6;
  score += target.identity === "lord" && context.actor.identity === "rebel" ? 10 : 0;
  return score;
}

function scoreUtilityTrickAction(context: AiDecisionContext, perception: AiPerception, action: PlayCardAction): number {
  const kind = getActionCardKind(context, action);
  const target = context.state.players.find((player) => player.id === action.targetId);
  const targetCardPressure = target ? target.hand.length + countEquipmentCards(target) + target.judgmentZone.delayedTricks.length : 0;
  const hostility = target ? Math.max(0, getRelationScore(perception, target.id)) : 0;

  if (kind === "dismantle" || kind === "snatch") {
    return 48 + targetCardPressure * 5 + hostility * 4;
  }

  if (kind === "duel") {
    const actorAdvantage = context.actor.hand.length - (target?.hand.length ?? 0);
    const lowHpBonus = target && target.hp <= 2 ? 12 : 0;
    return 45 + actorAdvantage * 4 + lowHpBonus + hostility * 4;
  }

  if (kind === "collateral") {
    return 50 + targetCardPressure * 4 + hostility * 3;
  }

  if (kind === "indulgence") {
    return 42 + targetCardPressure * 3 + hostility * 2;
  }

  if (kind === "fanjian") {
    return 44 + (target ? Math.max(0, 4 - target.hp) * 4 : 0) + hostility * 3;
  }

  if (kind === "lijian") {
    const first = context.state.players.find((player) => player.id === action.targetId);
    const second = context.state.players.find((player) => player.id === action.secondaryTargetId);
    const firstScore = first ? Math.max(0, 4 - first.hp) * 3 + first.hand.length : 0;
    const secondScore = second ? Math.max(0, 4 - second.hp) * 3 + second.hand.length : 0;
    return 46 + firstScore + secondScore;
  }

  return Number.NEGATIVE_INFINITY;
}

function scoreSupportAction(
  context: AiDecisionContext,
  perception: AiPerception,
  action: PlayCardAction,
  hasSlashAction: boolean
): number {
  const kind = getActionCardKind(context, action);

  if (kind === "ex_nihilo") {
    return action.targetId === context.actor.id ? 95 : -1;
  }

  if (kind === "taoyuan") {
    const alliesWounded = context.state.players.filter(
      (player) => player.alive && isLikelyAlly(context, perception, player) && player.hp < player.maxHp
    ).length;
    const enemiesWounded = context.state.players.filter(
      (player) => player.alive && !isLikelyAlly(context, perception, player) && player.hp < player.maxHp
    ).length;
    return alliesWounded > 0 ? 40 + alliesWounded * 10 - enemiesWounded * 6 : -1;
  }

  if (kind === "harvest") {
    const allies = context.state.players.filter(
      (player) => player.alive && player.id !== context.actor.id && isLikelyAlly(context, perception, player)
    ).length;
    const enemies = context.state.players.filter(
      (player) => player.alive && player.id !== context.actor.id && !isLikelyAlly(context, perception, player)
    ).length;
    const resourceNeed = context.actor.hand.length <= 2 ? 12 : 0;
    return 34 + resourceNeed + (allies - enemies) * 4;
  }

  if (kind === "rende") {
    return context.actor.hand.length > context.actor.hp + 1 ? 32 + (context.actor.hand.length - context.actor.hp) * 3 : -1;
  }

  if (kind === "zhiheng") {
    const overflow = context.actor.hand.length - context.actor.hp;
    return overflow >= 2 ? 30 + overflow * 4 : -1;
  }

  if (kind === "jieyin") {
    const target = context.state.players.find((player) => player.id === action.targetId);
    if (!target) {
      return -1;
    }

    const sameCamp = isLikelyAlly(context, perception, target);
    const actorNeedHeal = context.actor.hp < context.actor.maxHp;
    const targetNeedHeal = target.hp < target.maxHp;
    return sameCamp && actorNeedHeal && targetNeedHeal ? 52 : 8;
  }

  if (kind === "qingnang") {
    const target = context.state.players.find((player) => player.id === action.targetId);
    if (!target) {
      return -1;
    }

    if (!isLikelyAlly(context, perception, target) || target.hp >= target.maxHp) {
      return -1;
    }

    return 54 + Math.max(0, 4 - target.hp) * 4;
  }

  if (kind === "kurou") {
    if (context.actor.hp <= 1) {
      return -1;
    }

    if (context.actor.hp === 2 && hasSlashAction) {
      return -1;
    }

    return context.actor.hp >= 3 ? 36 : 10;
  }

  return Number.NEGATIVE_INFINITY;
}

function scoreEquipmentAction(context: AiDecisionContext, action: PlayCardAction): number {
  const kind = getActionCardKind(context, action);
  if (!kind) {
    return Number.NEGATIVE_INFINITY;
  }

  const actor = context.actor;
  const slashCount = actor.hand.reduce((count, card) => (card.kind === "slash" ? count + 1 : count), 0);

  if (kind in WEAPON_BASE_SCORE) {
    const base = WEAPON_BASE_SCORE[kind as CardKind] ?? 0;
    const currentKind = actor.equipment.weapon?.kind;
    const current = currentKind ? WEAPON_BASE_SCORE[currentKind] ?? 0 : 0;
    const crossbowBonus = kind === "weapon_crossbow" && slashCount >= 2 ? 2 : 0;
    const replacePenalty = currentKind ? 1 : 0;
    return base + crossbowBonus - current - replacePenalty;
  }

  if (kind in ARMOR_BASE_SCORE) {
    const base = ARMOR_BASE_SCORE[kind as CardKind] ?? 0;
    const currentKind = actor.equipment.armor?.kind;
    const current = currentKind ? ARMOR_BASE_SCORE[currentKind] ?? 0 : 0;
    const replacePenalty = currentKind ? 1 : 0;
    return base - current - replacePenalty;
  }

  if (
    kind === "horse_plus" ||
    kind === "horse_jueying" ||
    kind === "horse_dilu" ||
    kind === "horse_zhuahuangfeidian"
  ) {
    return actor.equipment.horsePlus ? -1 : 3;
  }

  if (kind === "horse_minus" || kind === "horse_chitu" || kind === "horse_dayuan" || kind === "horse_zixing") {
    return actor.equipment.horseMinus ? -1 : 3;
  }

  return Number.NEGATIVE_INFINITY;
}

function countEquipmentCards(player: AiDecisionContext["actor"]): number {
  return [player.equipment.weapon, player.equipment.armor, player.equipment.horsePlus, player.equipment.horseMinus].filter(
    (item) => item !== null
  ).length;
}

function shouldAttackPlayer(context: AiDecisionContext, perception: AiPerception, target: AiDecisionContext["actor"]): boolean {
  if (target.id === context.actor.id || !target.alive) {
    return false;
  }

  if (target.identity === "lord" && (context.actor.identity === "lord" || context.actor.identity === "loyalist")) {
    return false;
  }

  const relation = getRelationScore(perception, target.id);

  if (context.actor.identity === "lord" && target.identity !== "lord") {
    return relation >= 0;
  }

  if (context.actor.identity !== "renegade") {
    return relation > 0;
  }

  const aliveRebels = context.state.players.filter(
    (player) => player.alive && perception.inferredCampByPlayerId[player.id] === "rebel-side"
  ).length;
  const aliveLordSide = context.state.players.filter(
    (player) => player.alive && perception.inferredCampByPlayerId[player.id] === "lord-side"
  ).length;

  if (aliveRebels >= aliveLordSide) {
    return perception.inferredCampByPlayerId[target.id] === "rebel-side" || relation >= 2;
  }

  return perception.inferredCampByPlayerId[target.id] === "lord-side" || relation >= 2;
}

function isLikelyAlly(context: AiDecisionContext, perception: AiPerception, target: AiDecisionContext["actor"]): boolean {
  if (!target.alive) {
    return false;
  }

  if (target.id === context.actor.id) {
    return true;
  }

  return getRelationScore(perception, target.id) <= -1;
}

function getRelationScore(perception: AiPerception, playerId: string): number {
  return perception.relationByPlayerId[playerId] ?? 0;
}

function buildAiPerception(context: AiDecisionContext): AiPerception {
  const relationByPlayerId: Record<string, number> = {};
  const inferredCampByPlayerId: Record<string, "lord-side" | "rebel-side" | "unknown"> = {};
  const lord = context.state.players.find((player) => player.identity === "lord");

  for (const player of context.state.players) {
    relationByPlayerId[player.id] = 0;
    inferredCampByPlayerId[player.id] = "unknown";
  }

  if (lord) {
    inferredCampByPlayerId[lord.id] = "lord-side";
    if (context.actor.identity === "lord" || context.actor.identity === "loyalist") {
      relationByPlayerId[lord.id] = -8;
    } else if (context.actor.identity === "rebel") {
      relationByPlayerId[lord.id] = 8;
    }
  }

  const actorCamp = getActorCamp(context.actor.identity);
  const namePattern = context.state.players
    .map((player) => escapeRegExp(player.name))
    .sort((left, right) => right.length - left.length)
    .join("|");
  if (!namePattern) {
    return { relationByPlayerId, inferredCampByPlayerId };
  }

  const hostilePattern = new RegExp(
    `(${namePattern}) 对 (${namePattern}) 使用(?:杀|决斗|过河拆桥|顺手牵羊|乐不思蜀|借刀杀人|南蛮入侵|万箭齐发)`
  );
  const damagePattern = new RegExp(`(${namePattern}) 对 (${namePattern}) 造成 \\d+ 点伤害`);
  const rescuePattern = new RegExp(`(${namePattern}) 使用桃救回 (${namePattern})`);
  const healPattern = new RegExp(`(${namePattern}) 发动(?:青囊|结姻).*?(?:令|与) (${namePattern}) .*回复`);

  for (let index = 0; index < context.state.events.length; index += 1) {
    const event = context.state.events[index];
    const recencyWeight = computeEventRecencyWeight(context.state.events.length, index);

    const hostileMatch = event.message.match(hostilePattern);
    if (hostileMatch) {
      const source = findPlayerByName(context, hostileMatch[1]);
      const target = findPlayerByName(context, hostileMatch[2]);
      if (source && target) {
        applyHostileEvidence(
          context,
          relationByPlayerId,
          inferredCampByPlayerId,
          actorCamp,
          source.id,
          target.id,
          1.5 * recencyWeight
        );
      }
    }

    const damageMatch = event.message.match(damagePattern);
    if (damageMatch) {
      const source = findPlayerByName(context, damageMatch[1]);
      const target = findPlayerByName(context, damageMatch[2]);
      if (source && target) {
        applyHostileEvidence(
          context,
          relationByPlayerId,
          inferredCampByPlayerId,
          actorCamp,
          source.id,
          target.id,
          2.5 * recencyWeight
        );
      }
    }

    const rescueMatch = event.message.match(rescuePattern);
    if (rescueMatch) {
      const source = findPlayerByName(context, rescueMatch[1]);
      const target = findPlayerByName(context, rescueMatch[2]);
      if (source && target) {
        applySupportEvidence(
          context,
          relationByPlayerId,
          inferredCampByPlayerId,
          actorCamp,
          source.id,
          target.id,
          2.5 * recencyWeight
        );
      }
    }

    const healMatch = event.message.match(healPattern);
    if (healMatch) {
      const source = findPlayerByName(context, healMatch[1]);
      const target = findPlayerByName(context, healMatch[2]);
      if (source && target) {
        applySupportEvidence(
          context,
          relationByPlayerId,
          inferredCampByPlayerId,
          actorCamp,
          source.id,
          target.id,
          1.5 * recencyWeight
        );
      }
    }
  }

  return { relationByPlayerId, inferredCampByPlayerId };
}

function applyHostileEvidence(
  context: AiDecisionContext,
  relationByPlayerId: Record<string, number>,
  inferredCampByPlayerId: Record<string, "lord-side" | "rebel-side" | "unknown">,
  actorCamp: "lord-side" | "rebel-side" | "renegade",
  sourceId: string,
  targetId: string,
  weight: number
): void {
  if (targetId === context.actor.id) {
    relationByPlayerId[sourceId] += 3 * weight;
  }

  const target = context.state.players.find((player) => player.id === targetId);
  if (!target) {
    return;
  }

  if (target.identity === "lord") {
    inferredCampByPlayerId[sourceId] = "rebel-side";
    if (actorCamp === "lord-side") {
      relationByPlayerId[sourceId] += 4 * weight;
    } else if (actorCamp === "rebel-side") {
      relationByPlayerId[sourceId] -= 2 * weight;
    }
  }
}

function applySupportEvidence(
  context: AiDecisionContext,
  relationByPlayerId: Record<string, number>,
  inferredCampByPlayerId: Record<string, "lord-side" | "rebel-side" | "unknown">,
  actorCamp: "lord-side" | "rebel-side" | "renegade",
  sourceId: string,
  targetId: string,
  weight: number
): void {
  if (targetId === context.actor.id) {
    relationByPlayerId[sourceId] -= 2 * weight;
  }

  const target = context.state.players.find((player) => player.id === targetId);
  if (!target) {
    return;
  }

  if (target.identity === "lord") {
    inferredCampByPlayerId[sourceId] = "lord-side";
    if (actorCamp === "lord-side") {
      relationByPlayerId[sourceId] -= 2 * weight;
    } else if (actorCamp === "rebel-side") {
      relationByPlayerId[sourceId] += 2 * weight;
    }
  }
}

function findPlayerByName(context: AiDecisionContext, name: string): AiDecisionContext["actor"] | undefined {
  return context.state.players.find((player) => player.name === name);
}

function createObservedPlayer(player: PlayerState, actorId: string): PlayerState {
  const isActor = player.id === actorId;
  const identity = isActor || player.identity === "lord" ? player.identity : "renegade";

  return {
    id: player.id,
    name: player.name,
    identity,
    gender: player.gender,
    hp: player.hp,
    maxHp: player.maxHp,
    hand: isActor ? player.hand.map((card) => ({ ...card })) : buildMaskedHand(player.hand.length, player.id),
    alive: player.alive,
    isAi: player.isAi,
    equipment: {
      weapon: player.equipment.weapon ? { ...player.equipment.weapon } : null,
      armor: player.equipment.armor ? { ...player.equipment.armor } : null,
      horsePlus: player.equipment.horsePlus ? { ...player.equipment.horsePlus } : null,
      horseMinus: player.equipment.horseMinus ? { ...player.equipment.horseMinus } : null
    },
    judgmentZone: {
      delayedTricks: player.judgmentZone.delayedTricks.map((card) => ({ ...card }))
    }
  };
}

function buildMaskedHand(size: number, playerId: string): Card[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `__masked_${playerId}_${index + 1}`,
    kind: "slash"
  }));
}

function getActorCamp(identity: Identity): "lord-side" | "rebel-side" | "renegade" {
  if (identity === "lord" || identity === "loyalist") {
    return "lord-side";
  }

  if (identity === "rebel") {
    return "rebel-side";
  }

  return "renegade";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeEventRecencyWeight(total: number, index: number): number {
  if (total <= 1) {
    return 1;
  }

  const ratio = index / (total - 1);
  return 0.6 + ratio * 0.8;
}
