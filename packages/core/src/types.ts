/**
 * 定义游戏内可用的身份类型。
 */
export type Identity = "lord" | "loyalist" | "rebel" | "renegade";

/**
 * 定义当前玩家回合所处阶段。
 */
export type Phase = "judge" | "draw" | "play" | "discard" | "end";

/**
 * 定义当前可用的基础卡牌类型。
 */
export type CardKind =
  | "slash"
  | "dodge"
  | "peach"
  | "dismantle"
  | "snatch"
  | "nullify"
  | "duel"
  | "barbarian"
  | "archery"
  | "weapon_blade"
  | "horse_plus"
  | "horse_minus"
  | "indulgence"
  | "lightning";

/**
 * 表示角色装备区状态。
 */
export interface EquipmentState {
  /** 武器槽。 */
  weapon: Card | null;
  /** +1 坐骑槽。 */
  horsePlus: Card | null;
  /** -1 坐骑槽。 */
  horseMinus: Card | null;
}

/**
 * 表示角色判定区状态。
 */
export interface JudgmentZoneState {
  /** 判定区内的延时类锦囊。 */
  delayedTricks: Card[];
}

/**
 * 表示一张卡牌的数据结构。
 */
export interface Card {
  /** 卡牌唯一编号。 */
  id: string;
  /** 卡牌规则类型。 */
  kind: CardKind;
}

/**
 * 表示一名玩家的完整状态。
 */
export interface PlayerState {
  /** 玩家唯一编号。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 身份类型。 */
  identity: Identity;
  /** 当前体力值。 */
  hp: number;
  /** 最大体力值。 */
  maxHp: number;
  /** 手牌列表。 */
  hand: Card[];
  /** 玩家是否存活。 */
  alive: boolean;
  /** 是否由 AI 托管。 */
  isAi: boolean;
  /** 玩家当前装备区。 */
  equipment: EquipmentState;
  /** 玩家当前判定区。 */
  judgmentZone: JudgmentZoneState;
}

/**
 * 表示一次出牌动作。
 */
export interface PlayCardAction {
  /** 动作类型。 */
  type: "play-card";
  /** 出牌者编号。 */
  actorId: string;
  /** 使用的手牌编号。 */
  cardId: string;
  /** 目标玩家编号，部分牌可为空。 */
  targetId?: string;
}

/**
 * 表示主动结束出牌阶段动作。
 */
export interface EndPlayPhaseAction {
  /** 动作类型。 */
  type: "end-play-phase";
  /** 执行动作的玩家编号。 */
  actorId: string;
}

/**
 * 玩家在回合中可执行动作的联合类型。
 */
export type TurnAction = PlayCardAction | EndPlayPhaseAction;

/**
 * 用于记录结算过程的事件。
 */
export interface GameEvent {
  /** 事件名称。 */
  type: string;
  /** 事件描述。 */
  message: string;
}

/**
 * 表示整局对局状态。
 */
export interface GameState {
  /** 当前轮到行动的玩家编号。 */
  currentPlayerId: string;
  /** 当前回合阶段。 */
  phase: Phase;
  /** 玩家状态列表。 */
  players: PlayerState[];
  /** 抽牌堆。 */
  deck: Card[];
  /** 弃牌堆。 */
  discard: Card[];
  /** 事件日志。 */
  events: GameEvent[];
  /** 当前轮次计数。 */
  turnCount: number;
  /** 当前行动角色在本回合已使用【杀】的次数。 */
  slashUsedInTurn: number;
  /** 当前回合是否应跳过出牌阶段。 */
  skipPlayPhaseForCurrentTurn: boolean;
  /** 获胜阵营，未结束时为空。 */
  winner: "lord-side" | "rebel-side" | "renegade" | null;
  /** 随机种子。 */
  seed: number;
}

/**
 * 定义 AI 在其行动时可见的输入信息。
 */
export interface AiContext {
  /** 当前整局状态快照。 */
  state: GameState;
  /** 正在行动的玩家。 */
  actor: PlayerState;
}
