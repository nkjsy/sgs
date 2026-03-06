/**
 * 定义游戏内可用的身份类型。
 */
export type Identity = "lord" | "loyalist" | "rebel" | "renegade";
export type Gender = "male" | "female";

/**
 * 定义当前玩家回合所处阶段。
 */
export type Phase = "judge" | "draw" | "play" | "discard" | "end";

export type CardSuit = "spade" | "heart" | "club" | "diamond";
export type NullifyResponsePolicy = "camp-first" | "seat-order";

export interface SkillEventContext {
  state: GameState;
  event: GameEvent;
  owner: PlayerState;
}

export type SkillEventHandler = (context: SkillEventContext) => void;

export interface SkillDefinition {
  id: string;
  onEvent?: SkillEventHandler;
}

export interface SkillSystemState {
  definitions: Record<string, SkillDefinition>;
  playerSkills: Record<string, string[]>;
}

export type ResponseKind =
  | "dodge"
  | "slash"
  | "collateral"
  | "nullify"
  | "fankui"
  | "ice-sword"
  | "axe-strike"
  | "blade-follow-up"
  | "peach"
  | "hujia"
  | "jijiang"
  | "double-sword";

export interface ResponsePreference {
  dodge?: boolean;
  slash?: boolean;
  collateral?: boolean;
  nullify?: boolean;
  fankui?: boolean;
  "ice-sword"?: boolean;
  "axe-strike"?: boolean;
  "blade-follow-up"?: boolean;
  "double-sword"?: boolean;
  peach?: boolean;
  hujia?: boolean;
  jijiang?: boolean;
}

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
  | "taoyuan"
  | "harvest"
  | "ex_nihilo"
  | "collateral"
  | "weapon_crossbow"
  | "weapon_double_sword"
  | "weapon_qinggang_sword"
  | "weapon_blade"
  | "weapon_spear"
  | "weapon_axe"
  | "weapon_halberd"
  | "weapon_kylin_bow"
  | "weapon_ice_sword"
  | "armor_eight_diagram"
  | "armor_renwang_shield"
  | "horse_jueying"
  | "horse_dilu"
  | "horse_zhuahuangfeidian"
  | "horse_chitu"
  | "horse_dayuan"
  | "horse_zixing"
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
  /** 防具槽。 */
  armor: Card | null;
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
  /** 卡牌花色（可选，未提供时由兼容逻辑推导）。 */
  suit?: CardSuit;
  /** 卡牌点数（可选，未提供时由兼容逻辑推导）。 */
  point?: number;
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
  /** 性别（用于部分装备/技能判定）。 */
  gender: Gender;
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
  /** 第二目标玩家编号，仅部分双目标牌使用。 */
  secondaryTargetId?: string;
  /** 第三目标玩家编号，仅方天画戟多目标【杀】使用。 */
  tertiaryTargetId?: string;
  /** 目标区域选择（用于顺手牵羊/过河拆桥）。 */
  targetZone?: "hand" | "equipment" | "judgment";
  /** 目标卡牌编号（用于在装备区/判定区中精确选择）。 */
  targetCardId?: string;
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

export interface PendingHarvestState {
  /** 发动五谷丰登的角色编号。 */
  sourceId: string;
  /** 按座次结算的目标序列。 */
  participantIds: string[];
  /** 当前轮到选择牌的序号。 */
  cursor: number;
  /** 仍可被选择的亮出牌。 */
  revealed: Card[];
  /** 五谷丰登实体牌，结算完成后进入弃牌堆。 */
  trickCard: Card;
}

export interface PendingMassTrickState {
  /** 发动群体锦囊的角色编号。 */
  sourceId: string;
  /** 群体锦囊类型。 */
  trickKind: Extract<CardKind, "barbarian" | "archery">;
  /** 按座次结算的目标序列。 */
  targetIds: string[];
  /** 当前结算到的目标序号。 */
  cursor: number;
  /** 群体锦囊实体牌，结算完成后进入弃牌堆。 */
  trickCard: Card;
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
  /** 最新一次打出的牌（用于界面展示）。 */
  latestPlayedCard: Card | null;
  /** 当前轮次计数。 */
  turnCount: number;
  /** 当前行动角色在本回合已使用【杀】的次数。 */
  slashUsedInTurn: number;
  /** 当前回合是否应跳过出牌阶段。 */
  skipPlayPhaseForCurrentTurn: boolean;
  /** 当前回合【裸衣】增伤生效角色编号。 */
  luoyiActivePlayerId: string | null;
  /** 当前回合各角色是否选择发动【裸衣】。 */
  luoyiChosenInTurnByPlayer: Record<string, boolean>;
  /** 当前回合各角色为【突袭】预选的目标列表（0~2名）。 */
  tuxiChosenTargetsByPlayer: Record<string, string[]>;
  /** 当前回合各角色通过【仁德】给出的手牌数量。 */
  rendeGivenInTurnByPlayer: Record<string, number>;
  /** 当前回合各角色是否已通过【仁德】触发回复。 */
  rendeRecoveredInTurnByPlayer: Record<string, boolean>;
  /** 当前回合各角色是否已发动过【反间】。 */
  fanjianUsedInTurnByPlayer: Record<string, boolean>;
  /** 当前回合各角色是否已发动过【制衡】。 */
  zhihengUsedInTurnByPlayer: Record<string, boolean>;
  /** 当前回合各角色是否已发动过【结姻】。 */
  jieyinUsedInTurnByPlayer: Record<string, boolean>;
  /** 当前回合各角色是否已发动过【离间】。 */
  lijianUsedInTurnByPlayer: Record<string, boolean>;
  /** 当前回合各角色是否已发动过【青囊】。 */
  qingnangUsedInTurnByPlayer: Record<string, boolean>;
  /** 单次结算内的人类响应偏好（用于 Web 响应窗口）。 */
  responsePreferenceByPlayer: Record<string, ResponsePreference>;
  /** 当前回合各角色的响应决策队列。 */
  responseDecisionQueueByPlayer: Record<string, Partial<Record<ResponseKind, boolean[]>>>;
  /** 当前回合各角色的响应选牌队列（用于指定本次响应消耗的具体手牌）。 */
  responseCardChoiceQueueByPlayer: Record<string, Partial<Record<ResponseKind, string[]>>>;
  /** 各角色是否启用决斗逐次手动响应模式。 */
  duelPromptModeByPlayer: Record<string, boolean>;
  /** 各角色是否启用反馈手动确认模式。 */
  fankuiPromptModeByPlayer: Record<string, boolean>;
  /** 各角色是否启用借刀杀人“是否出杀”手动确认模式。 */
  collateralPromptModeByPlayer: Record<string, boolean>;
  /** 各角色是否启用桃救援手动确认模式。 */
  peachRescuePromptModeByPlayer: Record<string, boolean>;
  /** 各角色预结算的八卦阵判定结果队列（按响应次序消费）。 */
  preparedEightDiagramResultByPlayer: Record<string, boolean[]>;
  /** 各角色是否启用手动弃牌模式。 */
  manualDiscardByPlayer: Record<string, boolean>;
  /** 是否启用五谷丰登手动选牌模式。 */
  manualHarvestSelectionMode: boolean;
  /** 五谷丰登待选牌状态。 */
  pendingHarvest: PendingHarvestState | null;
  /** 是否启用南蛮/万箭逐目标暂停结算模式。 */
  manualMassTrickStepMode: boolean;
  /** 群体锦囊（南蛮/万箭）逐目标结算状态。 */
  pendingMassTrick: PendingMassTrickState | null;
  /** 各角色是否启用方天画戟手动多目标模式。 */
  halberdManualTargetModeByPlayer: Record<string, boolean>;
  /** 各角色是否启用贯石斧“闪后确认”模式。 */
  axeStrikePromptModeByPlayer: Record<string, boolean>;
  /** 各角色是否启用寒冰剑“命中前确认”模式。 */
  iceSwordPromptModeByPlayer: Record<string, boolean>;
  /** 寒冰剑防伤待确认状态。 */
  pendingIceSword: {
    sourceId: string;
    targetId: string;
    slashCard: Card;
    shouldDiscardSlash: boolean;
  } | null;
  /** 贯石斧追伤待确认状态。 */
  pendingAxeStrike: {
    sourceId: string;
    targetId: string;
    slashCard: Card;
    slashLabel: string;
    shouldDiscardSlash: boolean;
  } | null;
  /** 各角色是否启用青龙偃月刀“闪后确认”模式。 */
  bladeFollowUpPromptModeByPlayer: Record<string, boolean>;
  /** 青龙偃月刀追击待确认状态。 */
  pendingBladeFollowUp: { sourceId: string; targetId: string } | null;
  /** 反馈待确认状态。 */
  pendingFankui: {
    sourceId: string;
    targetId: string;
    remainingCount: number;
  } | null;
  /** 借刀杀人“是否出杀”待确认状态。 */
  pendingCollateral: {
    sourceId: string;
    holderId: string;
    targetId: string;
    trickCard: Card;
  } | null;
  /** 决斗响应待确认状态（用于逐次询问人类是否打出杀）。 */
  pendingDuel: {
    sourceId: string;
    targetId: string;
    currentId: string;
    opponentId: string;
    duelCard?: Card;
  } | null;
  /** 获胜阵营，未结束时为空。 */
  winner: "lord-side" | "rebel-side" | "renegade" | null;
  /** 随机种子。 */
  seed: number;
  /** 无懈响应优先级策略。 */
  nullifyResponsePolicy: NullifyResponsePolicy;
  /** 武将技能系统运行态。 */
  skillSystem: SkillSystemState;
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
