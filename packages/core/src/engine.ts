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
    isAi: index !== 0
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

  if (state.phase === "draw") {
    drawCards(state, current.id, 2);
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

  actor.hand.push(card);
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
function resolveNullifyChain(state: GameState, sourceId: string, targetId: string, trickKind: Extract<CardKind, "dismantle" | "snatch">): boolean {
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
  trickKind: Extract<CardKind, "dismantle" | "snatch">,
  currentlyNegated: boolean
): boolean {
  if (!responder.hand.some((card) => card.kind === "nullify")) {
    return false;
  }

  const source = requireAlivePlayer(state, sourceId);
  const target = requireAlivePlayer(state, targetId);

  if (!currentlyNegated) {
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
  return getDistance(state, fromId, toId) <= 1;
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
  return Math.min(clockwise, anticlockwise);
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
      target.hand = [];
      pushEvent(state, "death", `${target.name} 阵亡`);
      updateWinner(state);
    }
  }
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
  state.phase = "draw";
  state.slashUsedInTurn = 0;
  state.turnCount += 1;
  pushEvent(state, "turn", `轮到 ${next.name} 的回合`);
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
