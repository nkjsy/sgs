import { AiContext, Identity, PlayCardAction, TurnAction } from "./types";
import { getLegalActions } from "./engine";

/**
 * 为基础 AI 生成本回合动作。
 *
 * 策略优先级：
 * 1) 先保命（如果可用桃并受伤则优先使用）。
 * 2) 再尝试功能锦囊（顺手牵羊、过河拆桥、决斗、借刀杀人、乐不思蜀）。
 * 3) 再尝试增益锦囊（桃园结义、五谷丰登）。
 * 4) 再尝试群体锦囊（南蛮入侵、万箭齐发）。
 * 4) 再尝试进攻（使用杀攻击体力最低目标）。
 * 4) 无更优动作时结束出牌阶段。
 *
 * @param context AI 可见上下文。
 * @returns 选择后的动作。
 */
export function chooseAiAction(context: AiContext): TurnAction {
  const legal = getLegalActions(context.state).filter((action) => action.actorId === context.actor.id);

  const utilityTrickActions = legal.filter((action): action is PlayCardAction => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const card = context.actor.hand.find((item) => item.id === action.cardId);
    if (!card) {
      return false;
    }

    if (
      card.kind !== "snatch" &&
      card.kind !== "dismantle" &&
      card.kind !== "duel" &&
      card.kind !== "collateral" &&
      card.kind !== "indulgence"
    ) {
      return false;
    }

    const target = context.state.players.find((player) => player.id === action.targetId);
    if (!target) {
      return false;
    }

    return shouldAttackTarget(context.actor.identity, target.identity);
  });

  const slashActions = legal.filter((action): action is PlayCardAction => {
    if (!isPlayCardAction(action)) {
      return false;
    }
    const card = context.actor.hand.find((item) => item.id === action.cardId);
    if (card?.kind !== "slash") {
      return false;
    }

    const target = context.state.players.find((player) => player.id === action.targetId);
    if (!target) {
      return false;
    }

    return shouldAttackTarget(context.actor.identity, target.identity);
  });

  const heal = legal.find((action) => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const card = context.actor.hand.find((item) => item.id === action.cardId);
    if (card?.kind !== "peach") {
      return false;
    }

    return shouldUsePeachInPlayPhase(context, slashActions.length > 0);
  });

  if (heal) {
    return heal;
  }

  if (utilityTrickActions.length > 0) {
    const sorted = [...utilityTrickActions].sort((left, right) => {
      const leftTarget = context.state.players.find((player) => player.id === left.targetId);
      const rightTarget = context.state.players.find((player) => player.id === right.targetId);
      return (leftTarget?.hand.length ?? 0) - (rightTarget?.hand.length ?? 0);
    });
    return sorted[sorted.length - 1];
  }

  const supportTrickAction = legal.find((action) => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const card = context.actor.hand.find((item) => item.id === action.cardId);
    if (!card) {
      return false;
    }

    if (card.kind === "taoyuan") {
      return context.state.players.some(
        (player) => player.alive && isSameCamp(context.actor.identity, player.identity) && player.hp < player.maxHp
      );
    }

    if (card.kind === "harvest") {
      return true;
    }

    return false;
  });

  if (supportTrickAction) {
    return supportTrickAction;
  }

  const delayedAction = legal.find((action) => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const card = context.actor.hand.find((item) => item.id === action.cardId);
    if (!card) {
      return false;
    }

    if (card.kind === "lightning") {
      const hpSafe = context.actor.hp >= 3;
      const enemyCount = context.state.players.filter(
        (player) => player.alive && player.id !== context.actor.id && shouldAttackTarget(context.actor.identity, player.identity)
      ).length;
      return hpSafe && enemyCount >= 2;
    }

    return false;
  });

  if (delayedAction) {
    return delayedAction;
  }

  const equipmentAction = legal.find((action) => {
    if (!isPlayCardAction(action)) {
      return false;
    }
    const card = context.actor.hand.find((item) => item.id === action.cardId);
    if (!card) {
      return false;
    }

    if (card.kind === "weapon_blade") {
      return context.actor.equipment.weapon?.kind !== "weapon_blade";
    }
    if (card.kind === "horse_plus") {
      return !context.actor.equipment.horsePlus;
    }
    if (card.kind === "horse_minus") {
      return !context.actor.equipment.horseMinus;
    }
    return false;
  });

  if (equipmentAction) {
    return equipmentAction;
  }

  const aoeAction = legal.find((action) => {
    if (!isPlayCardAction(action)) {
      return false;
    }

    const card = context.actor.hand.find((item) => item.id === action.cardId);
    if (!card || (card.kind !== "barbarian" && card.kind !== "archery")) {
      return false;
    }

    const enemies = context.state.players.filter(
      (player) => player.alive && player.id !== context.actor.id && shouldAttackTarget(context.actor.identity, player.identity)
    );
    const allies = context.state.players.filter(
      (player) => player.alive && player.id !== context.actor.id && isSameCamp(context.actor.identity, player.identity)
    );

    return enemies.length >= allies.length;
  });

  if (aoeAction) {
    return aoeAction;
  }

  if (slashActions.length > 0) {
    const sorted = [...slashActions].sort((left, right) => {
      const leftTarget = context.state.players.find((player) => player.id === left.targetId);
      const rightTarget = context.state.players.find((player) => player.id === right.targetId);
      return (leftTarget?.hp ?? 99) - (rightTarget?.hp ?? 99);
    });
    return sorted[0];
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
function shouldUsePeachInPlayPhase(context: AiContext, hasAggressiveOption: boolean): boolean {
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

/**
 * 判断 AI 是否应将某身份视作优先攻击目标。
 *
 * @param actorIdentity 行动者身份。
 * @param targetIdentity 潜在目标身份。
 * @returns 若应攻击则返回 true。
 */
function shouldAttackTarget(actorIdentity: Identity, targetIdentity: Identity): boolean {
  if (actorIdentity === "lord" || actorIdentity === "loyalist") {
    return targetIdentity === "rebel" || targetIdentity === "renegade";
  }

  if (actorIdentity === "rebel") {
    return targetIdentity === "lord" || targetIdentity === "loyalist";
  }

  return targetIdentity !== "renegade";
}

/**
 * 判断两名身份是否同阵营。
 *
 * @param left 左侧身份。
 * @param right 右侧身份。
 * @returns 同阵营返回 true。
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
