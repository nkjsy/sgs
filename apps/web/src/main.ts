import {
  STANDARD_GENERAL_CHECKLIST,
  STANDARD_SKILL_IDS,
  applyAction,
  assignSkillToPlayer,
  canRespondWithDodge,
  canRespondWithNullify,
  canRespondWithPeach,
  canRespondWithSlash,
  chooseHarvestCard,
  chooseAiAction,
  createInitialGame,
  discardSelectedCards,
  getPendingMassTrickAction,
  getPendingHarvestChoice,
  getPlayerKingdomById,
  getLegalActions,
  prepareEightDiagramJudge,
  queueResponseDecision,
  resolvePendingBladeFollowUp,
  setBladeFollowUpPromptMode,
  setHalberdManualTargetMode,
  setManualDiscardMode,
  setManualHarvestSelectionMode,
  setManualMassTrickStepMode,
  setResponsePreference,
  setLuoyiChoice,
  setTuxiTargets,
  stepPhase,
  type Card,
  type GameState,
  type PlayCardAction,
  type PlayerState,
  type ResponseKind,
  type TurnAction
} from "@sgs/core";
import "./styles.css";

type Game = ReturnType<typeof createInitialGame>;

type EventStyle = {
  tag: string;
};

type SkillUiConfig = {
  name: string;
  description: string;
  trigger: "manual" | "auto" | "response";
  modeId: string | null;
};

type RosterMode = "fixed-demo" | "pick-human" | "random-all";
type IdentitySetupMode = "fixed-standard" | "random-all" | "pick-human";
type PendingHumanResponse = {
  kind: ResponseKind;
  message: string;
  action: TurnAction;
  previewCardEventMessage?: string;
  allowRespond?: boolean;
  nullifyTrickKind?: "dismantle" | "snatch" | "duel" | "barbarian" | "archery" | "taoyuan" | "harvest" | "collateral";
  nullifySourceId?: string;
  nullifyTargetId?: string;
  nullifyChosenDecisions?: boolean[];
  nullifyGroupTargetIds?: string[];
  nullifyGroupCursor?: number;
  nullifyQueuedTrueCount?: number;
  pendingHarvestCardId?: string;
};

const ASSET_BASE = `${import.meta.env.BASE_URL}assets`;

const EQUIPMENT_KINDS = new Set([
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
]);

const EVENT_STYLE: Record<string, EventStyle> = {
  "game-start": { tag: "开始" },
  "game-over": { tag: "结束" },
  phase: { tag: "阶段" },
  draw: { tag: "摸牌" },
  action: { tag: "行动" },
  card: { tag: "卡牌" },
  trick: { tag: "锦囊" },
  equip: { tag: "装备" },
  response: { tag: "响应" },
  nullify: { tag: "无懈" },
  judge: { tag: "判定" },
  damage: { tag: "伤害" },
  rescue: { tag: "救援" },
  dying: { tag: "濒死" },
  death: { tag: "死亡" },
  turn: { tag: "回合" },
  discard: { tag: "弃牌" },
  deck: { tag: "牌堆" },
  skill: { tag: "技能" }
};

const GENERAL_BASE_MAX_HP: Record<string, number> = {
  caocao: 4,
  zhangfei: 4,
  machao: 4,
  simayi: 3,
  xiahoudun: 4,
  guojia: 3,
  zhangliao: 4,
  xuchu: 4,
  liubei: 4,
  zhugeliang: 3,
  zhouyu: 3,
  huanggai: 4,
  lvmeng: 4,
  sunquan: 4,
  sunshangxiang: 3,
  daqiao: 3,
  ganning: 4,
  luxun: 3,
  diaochan: 3,
  guanyu: 4,
  lvbu: 4,
  zhaoyun: 4,
  huangyueying: 3,
  zhenji: 3,
  huatuo: 3
};

const GENERAL_GENDER: Record<string, PlayerState["gender"]> = {
  sunshangxiang: "female",
  daqiao: "female",
  diaochan: "female",
  huangyueying: "female",
  zhenji: "female"
};

const PHASE_LABEL: Record<GameState["phase"], string> = {
  judge: "判定",
  draw: "摸牌",
  play: "出牌",
  discard: "弃牌",
  end: "结束"
};

const SKILL_UI_CONFIG: Record<string, SkillUiConfig> = {
  [STANDARD_SKILL_IDS.caocaoJianxiong]: {
    name: "奸雄",
    description: "每当你受到伤害后，可摸一张牌或获得造成此伤害的牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.caocaoHujia]: {
    name: "护驾",
    description: "主公技：当你需要使用/打出【闪】时，可令其他魏势力角色代为打出。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhangfeiPaoxiao]: {
    name: "咆哮",
    description: "你使用【杀】无次数限制。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.machaoMashu]: {
    name: "马术",
    description: "锁定技：你与其他角色的距离 -1。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.machaoTieqi]: {
    name: "铁骑",
    description: "当你使用【杀】指定目标后可判定；若结果为红色，其不能使用【闪】响应此【杀】。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.simayiFankui]: {
    name: "反馈",
    description: "每当你受到1点伤害后，可获得伤害来源的一张牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.simayiGuicai]: {
    name: "鬼才",
    description: "当任意角色判定牌生效前，你可打出手牌替换该判定牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.xiahoudunGanglie]: {
    name: "刚烈",
    description: "每当你受到伤害后可判定；若不为红桃，来源选择弃两张手牌或受到你造成的1点伤害。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.guojiaTiandu]: {
    name: "天妒",
    description: "每当你的判定牌生效后，你可以获得之。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.guojiaYiji]: {
    name: "遗计",
    description: "每当你受到1点伤害后，观看牌堆顶两张牌并分配给任意角色。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhangliaoTuxi]: {
    name: "突袭",
    description: "摸牌阶段可放弃摸牌，改为获得至多两名其他角色各一张手牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.liubeiRende]: {
    name: "仁德",
    description: "出牌阶段可将手牌交给一名其他角色；本回合累计给出第二张牌时回复 1 点体力（已由规则层处理）。",
    trigger: "manual",
    modeId: "rende"
  },
  [STANDARD_SKILL_IDS.liubeiJijiang]: {
    name: "激将",
    description: "主公技：出牌阶段可主动发动激将当【杀】使用；或在需要【杀】响应时自动向蜀势力角色征调。",
    trigger: "manual",
    modeId: "jijiang"
  },
  [STANDARD_SKILL_IDS.xuchuLuoyi]: {
    name: "裸衣",
    description: "摸牌阶段可选择发动：少摸 1 张牌，本回合【杀】与【决斗】伤害 +1。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhugeliangGuanxing]: {
    name: "观星",
    description: "准备阶段开始时观看牌堆顶 X 张牌（至多5），可调整顺序并将部分置于牌堆底。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhugeliangKongcheng]: {
    name: "空城",
    description: "锁定技：若你没有手牌，你不是【杀】和【决斗】的合法目标。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhouyuYingzi]: {
    name: "英姿",
    description: "摸牌阶段你可以多摸一张牌。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhouyuFanjian]: {
    name: "反间",
    description: "出牌阶段限一次：令一名角色猜花色，其获得你的一张手牌，若猜错则受到1点伤害。",
    trigger: "manual",
    modeId: "fanjian"
  },
  [STANDARD_SKILL_IDS.huanggaiKurou]: {
    name: "苦肉",
    description: "出牌阶段可失去1点体力并摸两张牌。",
    trigger: "manual",
    modeId: "kurou"
  },
  [STANDARD_SKILL_IDS.lvmengKeji]: {
    name: "克己",
    description: "若你本回合出牌阶段未使用或打出过【杀】，可跳过弃牌阶段。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.sunquanZhiheng]: {
    name: "制衡",
    description: "出牌阶段限一次：弃置任意张牌并摸等量的牌。",
    trigger: "manual",
    modeId: "zhiheng"
  },
  [STANDARD_SKILL_IDS.sunquanJiuyuan]: {
    name: "救援",
    description: "主公技，锁定技：其他吴势力角色对濒死的你使用【桃】时，回复值 +1。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.sunshangxiangJieyin]: {
    name: "结姻",
    description: "出牌阶段限一次：弃置两张手牌并选择一名受伤男性角色，你与其各回复1点体力。",
    trigger: "manual",
    modeId: "jieyin"
  },
  [STANDARD_SKILL_IDS.sunshangxiangXiaoji]: {
    name: "枭姬",
    description: "每当你失去装备区里的一张牌后，可以摸两张牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.daqiaoGuose]: {
    name: "国色",
    description: "你可以将一张方块牌当【乐不思蜀】使用。",
    trigger: "manual",
    modeId: "guose"
  },
  [STANDARD_SKILL_IDS.daqiaoLiuli]: {
    name: "流离",
    description: "当你成为【杀】的目标时，可弃一张牌将此【杀】转移给你攻击范围内另一名合法目标。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.ganningQixi]: {
    name: "奇袭",
    description: "你可以将一张黑色牌当【过河拆桥】使用。",
    trigger: "manual",
    modeId: "qixi"
  },
  [STANDARD_SKILL_IDS.luxunLianying]: {
    name: "连营",
    description: "每当你失去最后一张手牌后，可以摸一张牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.luxunQianxun]: {
    name: "谦逊",
    description: "锁定技：你不是【顺手牵羊】和【乐不思蜀】的合法目标。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.diaochanBiyue]: {
    name: "闭月",
    description: "结束阶段开始时，你可以摸一张牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.diaochanLijian]: {
    name: "离间",
    description: "出牌阶段限一次：弃一张牌并令两名男性角色中一名视为对另一名使用【决斗】。",
    trigger: "manual",
    modeId: "lijian"
  },
  [STANDARD_SKILL_IDS.guanyuWusheng]: {
    name: "武圣",
    description: "你可以将一张红色牌当【杀】使用或打出。",
    trigger: "manual",
    modeId: "wusheng_slash"
  },
  [STANDARD_SKILL_IDS.lvbuWushuang]: {
    name: "无双",
    description: "锁定技：你使用【杀】时目标需依次打出两张【闪】；【决斗】中对手需依次打出两张【杀】。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhaoyunLongdan]: {
    name: "龙胆",
    description: "你可以将【杀】当【闪】、将【闪】当【杀】使用或打出。",
    trigger: "manual",
    modeId: "longdan_slash"
  },
  [STANDARD_SKILL_IDS.huangyueyingJizhi]: {
    name: "集智",
    description: "每当你使用非延时类锦囊牌时，可以摸一张牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.huangyueyingQicai]: {
    name: "奇才",
    description: "锁定技：你使用锦囊牌无距离限制。",
    trigger: "auto",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhenjiQingguo]: {
    name: "倾国",
    description: "你可以将一张黑色手牌当【闪】使用或打出。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.zhenjiLuoshen]: {
    name: "洛神",
    description: "准备阶段可判定：若为黑色可重复，最终获得黑色判定牌。",
    trigger: "response",
    modeId: null
  },
  [STANDARD_SKILL_IDS.huatuoQingnang]: {
    name: "青囊",
    description: "出牌阶段限一次：弃置一张手牌并令一名已受伤角色回复1点体力。",
    trigger: "manual",
    modeId: "qingnang"
  },
  [STANDARD_SKILL_IDS.huatuoJijiu]: {
    name: "急救",
    description: "回合外你可以将一张红色牌当【桃】使用。",
    trigger: "response",
    modeId: null
  }
};

const IDENTITY_LABEL_ZH: Record<PlayerState["identity"], string> = {
  lord: "主公",
  loyalist: "忠臣",
  rebel: "反贼",
  renegade: "内奸"
};

const SKILL_NAME_ZH: Record<string, string> = {
  [STANDARD_SKILL_IDS.caocaoJianxiong]: "奸雄",
  [STANDARD_SKILL_IDS.caocaoHujia]: "护驾",
  [STANDARD_SKILL_IDS.zhangfeiPaoxiao]: "咆哮",
  [STANDARD_SKILL_IDS.machaoMashu]: "马术",
  [STANDARD_SKILL_IDS.machaoTieqi]: "铁骑",
  [STANDARD_SKILL_IDS.simayiFankui]: "反馈",
  [STANDARD_SKILL_IDS.simayiGuicai]: "鬼才",
  [STANDARD_SKILL_IDS.xiahoudunGanglie]: "刚烈",
  [STANDARD_SKILL_IDS.guojiaTiandu]: "天妒",
  [STANDARD_SKILL_IDS.zhangliaoTuxi]: "突袭",
  [STANDARD_SKILL_IDS.xuchuLuoyi]: "裸衣",
  [STANDARD_SKILL_IDS.liubeiRende]: "仁德",
  [STANDARD_SKILL_IDS.liubeiJijiang]: "激将",
  [STANDARD_SKILL_IDS.zhugeliangGuanxing]: "观星",
  [STANDARD_SKILL_IDS.zhouyuYingzi]: "英姿",
  [STANDARD_SKILL_IDS.zhouyuFanjian]: "反间",
  [STANDARD_SKILL_IDS.huanggaiKurou]: "苦肉",
  [STANDARD_SKILL_IDS.lvmengKeji]: "克己",
  [STANDARD_SKILL_IDS.sunquanZhiheng]: "制衡",
  [STANDARD_SKILL_IDS.sunshangxiangJieyin]: "结姻",
  [STANDARD_SKILL_IDS.daqiaoGuose]: "国色",
  [STANDARD_SKILL_IDS.daqiaoLiuli]: "流离",
  [STANDARD_SKILL_IDS.ganningQixi]: "奇袭",
  [STANDARD_SKILL_IDS.luxunLianying]: "连营",
  [STANDARD_SKILL_IDS.luxunQianxun]: "谦逊",
  [STANDARD_SKILL_IDS.diaochanBiyue]: "闭月",
  [STANDARD_SKILL_IDS.diaochanLijian]: "离间",
  [STANDARD_SKILL_IDS.sunshangxiangXiaoji]: "枭姬",
  [STANDARD_SKILL_IDS.guanyuWusheng]: "武圣",
  [STANDARD_SKILL_IDS.guojiaYiji]: "遗计",
  [STANDARD_SKILL_IDS.zhugeliangKongcheng]: "空城",
  [STANDARD_SKILL_IDS.lvbuWushuang]: "无双",
  [STANDARD_SKILL_IDS.zhaoyunLongdan]: "龙胆",
  [STANDARD_SKILL_IDS.huangyueyingJizhi]: "集智",
  [STANDARD_SKILL_IDS.huangyueyingQicai]: "奇才",
  [STANDARD_SKILL_IDS.zhenjiQingguo]: "倾国",
  [STANDARD_SKILL_IDS.zhenjiLuoshen]: "洛神",
  [STANDARD_SKILL_IDS.sunquanJiuyuan]: "救援",
  [STANDARD_SKILL_IDS.huatuoQingnang]: "青囊",
  [STANDARD_SKILL_IDS.huatuoJijiu]: "急救"
};

const GENERAL_SKILL_IDS_BY_GENERAL_ID: Record<string, string[]> = Object.fromEntries(
  STANDARD_GENERAL_CHECKLIST.map((item) => [item.generalId, [...item.skills]])
);

const CARD_KIND_LABEL_ZH: Record<string, string> = {
  slash: "杀",
  dodge: "闪",
  peach: "桃",
  dismantle: "过河拆桥",
  snatch: "顺手牵羊",
  nullify: "无懈可击",
  duel: "决斗",
  barbarian: "南蛮入侵",
  archery: "万箭齐发",
  taoyuan: "桃园结义",
  harvest: "五谷丰登",
  ex_nihilo: "无中生有",
  collateral: "借刀杀人",
  weapon_crossbow: "诸葛连弩",
  weapon_double_sword: "雌雄双股剑",
  weapon_qinggang_sword: "青釭剑",
  weapon_blade: "青龙偃月刀",
  weapon_spear: "丈八蛇矛",
  weapon_axe: "贯石斧",
  weapon_halberd: "方天画戟",
  weapon_kylin_bow: "麒麟弓",
  weapon_ice_sword: "寒冰剑",
  armor_eight_diagram: "八卦阵",
  armor_renwang_shield: "仁王盾",
  horse_jueying: "绝影",
  horse_dilu: "的卢",
  horse_zhuahuangfeidian: "爪黄飞电",
  horse_chitu: "赤兔",
  horse_dayuan: "大宛",
  horse_zixing: "紫骍",
  horse_plus: "+1坐骑",
  horse_minus: "-1坐骑",
  indulgence: "乐不思蜀",
  lightning: "闪电"
};

const foundApp = document.querySelector<HTMLDivElement>("#app");

function createRuntimeSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

let rosterMode: RosterMode = "pick-human";
let preferredHumanGeneralId = "liubei";
let identitySetupMode: IdentitySetupMode = "fixed-standard";
let preferredHumanIdentity: PlayerState["identity"] = "lord";
let manualInitialHandMode = false;
let manualInitialHandKinds: Card["kind"][] = ["slash", "dodge", "peach", "nullify"];
let playerGeneralIdByPlayerId: Record<string, string> = {};
let game = createGame(createRuntimeSeed());
let gameStarted = false;
let autoMode = true;
let autoplayTimer: number | null = null;
let previewTargetIds: string[] = [];
let selectedCardId: string | null = null;
let pendingPrimaryTargetId: string | null = null;
let pendingSecondaryTargetId: string | null = null;
let pendingZoneChoiceActions: PlayCardAction[] = [];
let pendingZoneCardChoiceActions: PlayCardAction[] = [];
let activeSkillModeId: string | null = null;
let pendingHumanResponse: PendingHumanResponse | null = null;
let selectedTuxiTargetIds: string[] = [];
let selectedDiscardCardIds: string[] = [];

if (!foundApp) {
  showFatalError(new Error("页面缺少 #app 容器节点"));
  throw new Error("#app not found");
}

const app = foundApp;

try {
  (window as typeof window & { __SGS_APP_BOOTED?: boolean }).__SGS_APP_BOOTED = true;
  render();
  ensureAutoLoop();
} catch (error) {
  showFatalError(error);
}

window.addEventListener("error", (event) => {
  showFatalError(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  showFatalError(event.reason);
});

function showFatalError(error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  document.body.innerHTML = `
    <main style="max-width: 920px; margin: 24px auto; padding: 12px; font-family: 'Microsoft YaHei', Arial, sans-serif;">
      <h1 style="font-size: 18px; margin: 0 0 12px;">SGS Web 运行错误</h1>
      <p style="margin: 0 0 10px; color: #4b556b;">页面没有成功初始化，请把下面错误信息发我，我会继续修。</p>
      <pre style="white-space: pre-wrap; word-break: break-word; border: 1px solid #e2e7f2; border-radius: 8px; background: #fbfcff; padding: 10px; color: #1d2433;">${escapeHtml(message)}</pre>
    </main>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createGame(seed: number): Game {
  const state = createInitialGame(seed, { nullifyResponsePolicy: "seat-order" });
  const human = state.players[0];
  if (human) {
    setResponsePreference(state, human.id, "peach", false);
    setBladeFollowUpPromptMode(state, human.id, true);
    setHalberdManualTargetMode(state, human.id, true);
    setManualDiscardMode(state, human.id, true);
    setManualHarvestSelectionMode(state, true);
    setManualMassTrickStepMode(state, true);
  }
  applyIdentitySetup(state, seed);
  alignFirstTurnToLord(state);
  playerGeneralIdByPlayerId = setupRoster(state, seed);
  applyManualInitialHandIfNeeded(state);
  return state;
}

function applyManualInitialHandIfNeeded(state: Game): void {
  if (!manualInitialHandMode) {
    return;
  }

  const human = getHumanPlayer(state);
  if (!human.alive) {
    return;
  }

  const desiredKinds = manualInitialHandKinds.slice(0, 4);
  if (desiredKinds.length === 0) {
    return;
  }

  const replaced = [...human.hand];
  human.hand = [];

  for (const kind of desiredKinds) {
    const deckIndex = state.deck.findIndex((card) => card.kind === kind);
    if (deckIndex >= 0) {
      const [selected] = state.deck.splice(deckIndex, 1);
      if (selected) {
        human.hand.push(selected);
        continue;
      }
    }

    const fallback = state.deck.shift();
    if (fallback) {
      human.hand.push(fallback);
    }
  }

  while (human.hand.length < 4) {
    const fallback = state.deck.shift();
    if (!fallback) {
      break;
    }
    human.hand.push(fallback);
  }

  state.deck.unshift(...replaced);
}

function resetUiSelections(): void {
  previewTargetIds = [];
  selectedCardId = null;
  pendingPrimaryTargetId = null;
  pendingSecondaryTargetId = null;
  pendingZoneChoiceActions = [];
  pendingZoneCardChoiceActions = [];
  activeSkillModeId = null;
  pendingHumanResponse = null;
  selectedTuxiTargetIds = [];
  selectedDiscardCardIds = [];
}

function startNewGame(seed = createRuntimeSeed()): void {
  game = createGame(seed);
  resetUiSelections();
}

function alignFirstTurnToLord(state: Game): void {
  const lord = state.players.find((player) => player.identity === "lord" && player.alive);
  if (!lord) {
    return;
  }

  state.currentPlayerId = lord.id;
}

function applyIdentitySetup(state: Game, seed: number): void {
  const standard: PlayerState["identity"][] = ["lord", "loyalist", "rebel", "rebel", "renegade"];

  if (identitySetupMode === "fixed-standard") {
    state.players.forEach((player, index) => {
      player.identity = standard[index] ?? "rebel";
    });
    return;
  }

  if (identitySetupMode === "random-all") {
    const shuffled = shuffleWithSeed([...standard], seed ^ 0x27d4eb2d);
    state.players.forEach((player, index) => {
      player.identity = shuffled[index] ?? "rebel";
    });
    return;
  }

  const pool = [...standard];
  const humanPickIndex = pool.indexOf(preferredHumanIdentity);
  if (humanPickIndex >= 0) {
    pool.splice(humanPickIndex, 1);
  }

  const shuffledRest = shuffleWithSeed(pool, seed ^ 0x165667b1);
  state.players[0].identity = preferredHumanIdentity;
  for (let index = 1; index < state.players.length; index += 1) {
    state.players[index].identity = shuffledRest[index - 1] ?? "rebel";
  }
}

function setupRoster(state: Game, seed: number): Record<string, string> {
  if (rosterMode === "fixed-demo") {
    return setupDemoRoster(state);
  }

  if (rosterMode === "random-all") {
    return setupRandomRoster(state, seed);
  }

  return setupPickHumanRoster(state, seed, preferredHumanGeneralId);
}

function setupDemoRoster(state: Game): Record<string, string> {
  const [player1, player2, player3, player4, player5] = state.players;
  const mapping: Record<string, string> = {};

  player1.name = "刘备";
  applyGeneralHp(player1, "liubei");
  assignSkillToPlayer(state, player1.id, STANDARD_SKILL_IDS.liubeiRende);
  assignSkillToPlayer(state, player1.id, STANDARD_SKILL_IDS.liubeiJijiang);
  mapping[player1.id] = "liubei";

  player2.name = "周瑜";
  applyGeneralHp(player2, "zhouyu");
  assignSkillToPlayer(state, player2.id, STANDARD_SKILL_IDS.zhouyuYingzi);
  assignSkillToPlayer(state, player2.id, STANDARD_SKILL_IDS.zhouyuFanjian);
  mapping[player2.id] = "zhouyu";

  player3.name = "甘宁";
  applyGeneralHp(player3, "ganning");
  assignSkillToPlayer(state, player3.id, STANDARD_SKILL_IDS.ganningQixi);
  mapping[player3.id] = "ganning";

  player4.name = "陆逊";
  applyGeneralHp(player4, "luxun");
  assignSkillToPlayer(state, player4.id, STANDARD_SKILL_IDS.luxunQianxun);
  assignSkillToPlayer(state, player4.id, STANDARD_SKILL_IDS.luxunLianying);
  mapping[player4.id] = "luxun";

  player5.name = "貂蝉";
  applyGeneralHp(player5, "diaochan");
  assignSkillToPlayer(state, player5.id, STANDARD_SKILL_IDS.diaochanBiyue);
  mapping[player5.id] = "diaochan";

  return mapping;
}

function setupPickHumanRoster(state: Game, seed: number, humanGeneralId: string): Record<string, string> {
  const byId = new Map(STANDARD_GENERAL_CHECKLIST.map((item) => [item.generalId, item]));
  const humanGeneral = byId.get(humanGeneralId) ?? byId.get("liubei");
  if (!humanGeneral) {
    return setupDemoRoster(state);
  }

  const pool = STANDARD_GENERAL_CHECKLIST.filter((item) => item.generalId !== humanGeneral.generalId);
  const shuffled = shuffleWithSeed(pool, seed ^ 0x9e3779b9);
  const aiGenerals = shuffled.slice(0, state.players.length - 1);
  const chosen = [humanGeneral, ...aiGenerals];
  return assignChosenGenerals(state, chosen);
}

function setupRandomRoster(state: Game, seed: number): Record<string, string> {
  const shuffled = shuffleWithSeed([...STANDARD_GENERAL_CHECKLIST], seed ^ 0x85ebca6b);
  const chosen = shuffled.slice(0, state.players.length);
  return assignChosenGenerals(state, chosen);
}

function assignChosenGenerals(
  state: Game,
  chosen: Array<{ generalId: string; generalName: string; skills: readonly string[] }>
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (let index = 0; index < state.players.length; index += 1) {
    const slot = state.players[index];
    const general = chosen[index];
    if (!general) {
      continue;
    }

    slot.name = general.generalName;
    applyGeneralHp(slot, general.generalId);
    mapping[slot.id] = general.generalId;
    for (const skillId of general.skills) {
      assignSkillToPlayer(state, slot.id, skillId);
    }
  }

  return mapping;
}

function applyGeneralHp(slot: PlayerState, generalId: string): void {
  slot.gender = GENERAL_GENDER[generalId] ?? "male";
  const baseMaxHp = GENERAL_BASE_MAX_HP[generalId] ?? 4;
  const roleBonus = slot.identity === "lord" ? 1 : 0;
  const finalMaxHp = baseMaxHp + roleBonus;
  slot.maxHp = finalMaxHp;
  slot.hp = finalMaxHp;
}

function getHumanPlayer(state: Game): PlayerState {
  return state.players[0];
}

function getGeneralIdByName(name: string): string {
  const found = STANDARD_GENERAL_CHECKLIST.find((item) => item.generalName === name);
  return found?.generalId ?? "default";
}

function isPendingLuoyiChoice(state: Game): boolean {
  if (state.winner || state.phase !== "draw") {
    return false;
  }

  const actor = state.players.find((player) => player.id === state.currentPlayerId);
  if (!actor || !actor.alive || actor.isAi) {
    return false;
  }

  const skillIds = state.skillSystem.playerSkills[actor.id] ?? [];
  if (!skillIds.includes(STANDARD_SKILL_IDS.xuchuLuoyi)) {
    return false;
  }

  return state.luoyiChosenInTurnByPlayer[actor.id] === undefined;
}

function getPendingTuxiChoice(state: Game): { actor: PlayerState; candidates: PlayerState[] } | null {
  if (state.winner || state.phase !== "draw") {
    return null;
  }

  const actor = state.players.find((player) => player.id === state.currentPlayerId);
  if (!actor || !actor.alive || actor.isAi) {
    return null;
  }

  const skillIds = state.skillSystem.playerSkills[actor.id] ?? [];
  if (!skillIds.includes(STANDARD_SKILL_IDS.zhangliaoTuxi)) {
    return null;
  }

  if (state.tuxiChosenTargetsByPlayer[actor.id] !== undefined) {
    return null;
  }

  const candidates = state.players.filter((player) => player.alive && player.id !== actor.id && player.hand.length > 0);
  if (candidates.length === 0) {
    return null;
  }

  return { actor, candidates };
}

function renderTuxiChoicePanel(pending: { actor: PlayerState; candidates: PlayerState[] }): string {
  const selected = pending.candidates.filter((candidate) => selectedTuxiTargetIds.includes(candidate.id));
  const selectedLabel = selected.length > 0 ? selected.map((candidate) => candidate.name).join("、") : "未选择";

  return `
    <div class="status">${pending.actor.name} 可发动【突袭】：请直接点击武将牌选择 1~2 名目标。</div>
    <div class="status">已选目标：${selectedLabel}</div>
    <div class="response-actions">
      <button data-role="tuxi-confirm" ${selected.length > 0 ? "" : "disabled"}>确认发动（${selected.length}/2）</button>
      <button data-role="tuxi-skip">不发动，正常摸牌</button>
    </div>
  `;
}

function renderLuoyiChoicePanel(state: Game): string {
  const actor = state.players.find((player) => player.id === state.currentPlayerId);
  if (!actor || !isPendingLuoyiChoice(state)) {
    return "";
  }

  return `
    <div class="status">${actor.name} 的摸牌阶段：是否发动【裸衣】？</div>
    <button data-role="luoyi-choice" data-enabled="1">发动裸衣（少摸1，伤害+1）</button>
    <button data-role="luoyi-choice" data-enabled="0">不发动裸衣（正常摸牌）</button>
  `;
}

function getPendingManualDiscardChoice(state: Game): { actor: PlayerState; needCount: number } | null {
  if (state.winner || state.phase !== "discard") {
    return null;
  }

  const actor = state.players.find((player) => player.id === state.currentPlayerId);
  if (!actor || !actor.alive || actor.isAi) {
    return null;
  }

  if (state.manualDiscardByPlayer[actor.id] !== true) {
    return null;
  }

  const needCount = actor.hand.length - actor.hp;
  if (needCount <= 0) {
    return null;
  }

  return { actor, needCount };
}

function renderManualDiscardPanel(pending: { actor: PlayerState; needCount: number }): string {
  const selectedCount = Math.min(selectedDiscardCardIds.length, pending.needCount);
  return `
    <div class="status">${pending.actor.name} 弃牌阶段：请选择 ${pending.needCount} 张手牌（已选 ${selectedCount}）。</div>
    <div class="response-actions">
      <button data-role="manual-discard-confirm" ${selectedCount >= pending.needCount ? "" : "disabled"}>确认弃牌</button>
    </div>
  `;
}

function renderHarvestChoicePanel(pending: { pickerId: string; revealed: Card[]; participantIds: string[] }): string {
  const picker = game.players.find((player) => player.id === pending.pickerId);
  const pickerName = picker?.name ?? pending.pickerId;
  const buttons = pending.revealed
    .map(
      (card) =>
        `<button data-role="harvest-choice" data-card-id="${card.id}" title="${getCardKindLabelZh(card.kind)}">
          <img class="card-icon" src="${ASSET_BASE}/cards/${card.kind}.png" alt="${getCardKindLabelZh(card.kind)}" />
        </button>`
    )
    .join("");

  return `
    <div class="status">五谷丰登：当前由 ${pickerName} 选牌（剩余 ${pending.revealed.length} 张）。</div>
    <div class="hand-list">${buttons}</div>
  `;
}

function renderHumanResponsePanel(pending: PendingHumanResponse): string {
  const allowLabel =
    pending.kind === "blade-follow-up"
      ? "允许追击"
      : pending.kind === "peach"
        ? "允许救援"
        : pending.kind === "hujia" || pending.kind === "jijiang"
          ? "允许代打"
          : "响应";
  const rejectLabel =
    pending.kind === "blade-follow-up"
      ? "不追击"
      : pending.kind === "peach"
        ? "不救援"
        : pending.kind === "hujia" || pending.kind === "jijiang"
          ? "不代打"
          : "不响应";

  if (pending.kind === "nullify") {
    const allowRespond = pending.allowRespond !== false;
    return `
      <div class="status">${pending.message}</div>
      <div class="response-actions">
      <button data-role="response-choice" data-enabled="1" ${allowRespond ? "" : "disabled"}>响应</button>
      <button data-role="response-choice" data-enabled="0">不响应</button>
      </div>
    `;
  }

  const allowRespond = pending.allowRespond !== false;

  return `
    <div class="status">${pending.message}</div>
    <div class="response-actions">
    <button data-role="response-choice" data-enabled="1" ${allowRespond ? "" : "disabled"}>${allowLabel}</button>
    <button data-role="response-choice" data-enabled="0">${rejectLabel}</button>
    </div>
  `;
}

function getFollowupResponseAfterNullify(state: Game, pending: PendingHumanResponse): PendingHumanResponse | null {
  if (pending.action.type !== "play-card") {
    return null;
  }

  const human = getHumanPlayer(state);
  const kind = inferActionCardKindForResponse(state, pending.action);
  if (!kind) {
    return null;
  }

  if (kind === "duel" && pending.action.targetId === human.id) {
    return {
      kind: "slash",
      message: "是否打出【杀】响应【决斗】？",
      action: pending.action,
      previewCardEventMessage: pending.previewCardEventMessage,
      allowRespond: canRespondWithSlash(state, human.id) || canAttemptJijiangSlashResponse(state, human.id)
    };
  }

  if (kind === "barbarian" && pending.action.targetId === human.id) {
    return {
      kind: "slash",
      message: "是否打出【杀】响应【南蛮入侵】？",
      action: pending.action,
      previewCardEventMessage: pending.previewCardEventMessage,
      allowRespond: canRespondWithSlash(state, human.id) || canAttemptJijiangSlashResponse(state, human.id)
    };
  }

  if (kind === "archery" && pending.action.targetId === human.id) {
    return {
      kind: "dodge",
      message: "是否打出【闪】响应【万箭齐发】？",
      action: pending.action,
      previewCardEventMessage: pending.previewCardEventMessage,
      allowRespond: canRespondWithDodge(state, human.id)
    };
  }

  return null;
}

function buildCardEventPreviewMessage(state: Game, action: TurnAction, inferredKind: string): string | null {
  if (action.type !== "play-card") {
    return null;
  }

  const actor = state.players.find((player) => player.id === action.actorId);
  if (!actor) {
    return null;
  }

  const target = action.targetId ? state.players.find((player) => player.id === action.targetId) : null;
  if (inferredKind === "slash" && target) {
    return `${actor.name} 对 ${target.name} 使用杀`;
  }

  if (inferredKind === "duel" && target) {
    return `${actor.name} 对 ${target.name} 使用决斗`;
  }

  if (inferredKind === "snatch" && target) {
    return `${actor.name} 对 ${target.name} 使用顺手牵羊`;
  }

  if (inferredKind === "dismantle" && target) {
    return `${actor.name} 对 ${target.name} 使用过河拆桥`;
  }

  if (inferredKind === "collateral" && target) {
    const secondary = action.secondaryTargetId
      ? state.players.find((player) => player.id === action.secondaryTargetId)
      : null;
    if (secondary) {
      return `${actor.name} 对 ${target.name} 使用借刀杀人，指定 ${secondary.name} 为目标`;
    }
    return `${actor.name} 对 ${target.name} 使用借刀杀人`;
  }

  if (inferredKind === "barbarian") {
    return `${actor.name} 使用南蛮入侵`;
  }

  if (inferredKind === "archery") {
    return `${actor.name} 使用万箭齐发`;
  }

  if (inferredKind === "taoyuan") {
    return `${actor.name} 使用桃园结义`;
  }

  if (inferredKind === "harvest") {
    return `${actor.name} 使用五谷丰登`;
  }

  if (inferredKind === "ex_nihilo") {
    return `${actor.name} 使用无中生有`;
  }

  return null;
}

function mayHaveAnyNullifyResponder(state: Game): boolean {
  return state.players.some((player) => player.alive && canRespondWithNullify(state, player.id));
}

function getNullifyPromptTargetIds(state: Game, action: TurnAction, kind: NonNullable<PendingHumanResponse["nullifyTrickKind"]>): string[] {
  if (action.type !== "play-card") {
    return [];
  }

  if (kind === "barbarian" || kind === "archery") {
    return action.targetId ? [action.targetId] : [];
  }

  if (kind === "taoyuan" || kind === "harvest") {
    return action.targetId ? [action.targetId] : [];
  }

  return action.targetId ? [action.targetId] : [];
}

function buildNullifyPromptMessage(
  state: Game,
  kind: NonNullable<PendingHumanResponse["nullifyTrickKind"]>,
  round: number,
  targetId?: string,
  targetIds?: string[],
  sourceId?: string,
  playedCount = 0,
  playedByNames: string[] = []
): string {
  const kindLabel = getCardKindLabelZh(kind);
  const progressLabel = getNullifyTargetProgress(state, kind, sourceId, targetId);
  const playedCountLabel = `（已打出${playedCount}张无懈）`;
  const playedByLabel = `（出牌者：${playedByNames.length > 0 ? playedByNames.join("、") : "无"}）`;
  const shouldShowTarget =
    !!targetId && (kind === "barbarian" || kind === "archery" || kind === "taoyuan" || kind === "harvest" || (targetIds?.length ?? 0) > 1);
  if (!shouldShowTarget) {
    return `无懈链第${round}轮：是否打出【无懈可击】响应 ${kindLabel}${progressLabel}${playedCountLabel}${playedByLabel}？`;
  }

  const target = state.players.find((player) => player.id === targetId);
  return `无懈链第${round}轮：是否打出【无懈可击】响应 ${kindLabel}（目标：${target?.name ?? targetId}）${progressLabel}${playedCountLabel}${playedByLabel}？`;
}

function getNullifyTargetProgress(
  state: Game,
  kind: NonNullable<PendingHumanResponse["nullifyTrickKind"]>,
  sourceId?: string,
  targetId?: string
): string {
  if (!sourceId) {
    return "";
  }

  const ordered = getAlivePlayersFromWeb(state, sourceId);
  if (ordered.length === 0) {
    return "";
  }

  const targetIds =
    kind === "barbarian" || kind === "archery"
      ? ordered.filter((player) => player.id !== sourceId).map((player) => player.id)
      : kind === "taoyuan" || kind === "harvest"
        ? ordered.map((player) => player.id)
        : targetId
          ? [targetId]
          : [];

  if (targetIds.length <= 1 || !targetId) {
    return "";
  }

  const index = targetIds.findIndex((id) => id === targetId);
  if (index < 0) {
    return "（按座次顺时针逐目标结算）";
  }

  return `（第${index + 1}/${targetIds.length}目标）`;
}

function getRemainingNullifyAfterQueued(state: Game, playerId: string, queuedTrueCount: number): number {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || !player.alive) {
    return 0;
  }

  const total = player.hand.reduce((count, card) => (card.kind === "nullify" ? count + 1 : count), 0);
  return Math.max(0, total - queuedTrueCount);
}

function getAlivePlayersFromWeb(state: Game, sourceId: string): PlayerState[] {
  const alive = state.players.filter((player) => player.alive);
  if (alive.length === 0) {
    return [];
  }

  const startIndex = alive.findIndex((player) => player.id === sourceId);
  if (startIndex < 0) {
    return alive;
  }

  return alive.map((_, offset) => alive[(startIndex + offset) % alive.length]!);
}

function isSameCampWeb(left: PlayerState["identity"], right: PlayerState["identity"]): boolean {
  if (left === "lord" || left === "loyalist") {
    return right === "lord" || right === "loyalist";
  }

  if (left === "rebel") {
    return right === "rebel";
  }

  return right === "renegade";
}

function shouldPlayNullifyWeb(
  state: Game,
  responder: PlayerState,
  trickKind: NonNullable<PendingHumanResponse["nullifyTrickKind"]>,
  target: PlayerState,
  currentlyNegated: boolean
): boolean {
  if (state.nullifyResponsePolicy === "seat-order") {
    return true;
  }

  const beneficialToTarget = trickKind === "taoyuan" || trickKind === "harvest" || trickKind === "ex_nihilo";
  if (!currentlyNegated) {
    return beneficialToTarget
      ? !isSameCampWeb(responder.identity, target.identity)
      : isSameCampWeb(responder.identity, target.identity);
  }

  return beneficialToTarget
    ? isSameCampWeb(responder.identity, target.identity)
    : !isSameCampWeb(responder.identity, target.identity);
}

function getNullifyChainProgress(
  state: Game,
  pending: PendingHumanResponse
): {
  shouldPromptHuman: boolean;
  playedCount: number;
  playedByNames: string[];
} {
  if (!pending.nullifySourceId || !pending.nullifyTargetId) {
    return { shouldPromptHuman: false, playedCount: 0, playedByNames: [] };
  }

  const nullifyKind = pending.nullifyTrickKind;
  if (!nullifyKind) {
    return { shouldPromptHuman: false, playedCount: 0, playedByNames: [] };
  }

  const source = state.players.find((player) => player.id === pending.nullifySourceId && player.alive);
  const target = state.players.find((player) => player.id === pending.nullifyTargetId && player.alive);
  const human = getHumanPlayer(state);
  if (!source || !target || !human.alive) {
    return { shouldPromptHuman: false, playedCount: 0, playedByNames: [] };
  }

  const remainingNullifyByPlayer = new Map<string, number>();
  for (const player of state.players) {
    if (!player.alive) {
      continue;
    }

    remainingNullifyByPlayer.set(
      player.id,
      player.hand.reduce((count, card) => (card.kind === "nullify" ? count + 1 : count), 0)
    );
  }

  const decided = pending.nullifyChosenDecisions ?? [];
  let decidedIndex = 0;
  let negated = false;
  let playedCount = 0;
  const playedByNames: string[] = [];

  while (true) {
    let played = false;
    for (const responder of getAlivePlayersFromWeb(state, source.id)) {
      const remaining = remainingNullifyByPlayer.get(responder.id) ?? 0;
      if (remaining <= 0) {
        continue;
      }

      if (!shouldPlayNullifyWeb(state, responder, nullifyKind, target, negated)) {
        continue;
      }

      if (responder.id === human.id) {
        if (decidedIndex >= decided.length) {
          return {
            shouldPromptHuman: true,
            playedCount,
            playedByNames
          };
        }

        const choosePlay = decided[decidedIndex] === true;
        decidedIndex += 1;
        if (!choosePlay) {
          continue;
        }
      }

      remainingNullifyByPlayer.set(responder.id, Math.max(0, remaining - 1));
      negated = !negated;
      played = true;
      playedCount += 1;
      playedByNames.push(responder.name);
      break;
    }

    if (!played) {
      break;
    }
  }

  return {
    shouldPromptHuman: false,
    playedCount,
    playedByNames
  };
}

function render(): void {
  if (!gameStarted) {
    const manualInitialHandSelects = manualInitialHandKinds
      .slice(0, 4)
      .map(
        (kind, index) => `
          <label class="header-control">
            手牌${index + 1}
            <select data-role="manual-hand-kind" data-index="${index}" ${manualInitialHandMode ? "" : "disabled"}>
              ${Object.entries(CARD_KIND_LABEL_ZH)
                .map(
                  ([cardKind, label]) =>
                    `<option value="${cardKind}" ${cardKind === kind ? "selected" : ""}>${label}</option>`
                )
                .join("")}
            </select>
          </label>
        `
      )
      .join("");

    app.innerHTML = `
      <main class="setup-page-layout">
        <section class="panel setup-page-panel">
          <h2>开局设置</h2>
          <div class="status">先选择模式与武将，点击“进入对局”后再开始正式游戏界面。</div>
          <div class="setup-controls">
            <label class="header-control">
              武将模式
              <select data-role="roster-mode">
                <option value="pick-human" ${rosterMode === "pick-human" ? "selected" : ""}>手选主将 + AI随机</option>
                <option value="random-all" ${rosterMode === "random-all" ? "selected" : ""}>全员随机</option>
                <option value="fixed-demo" ${rosterMode === "fixed-demo" ? "selected" : ""}>固定演示阵容</option>
              </select>
            </label>
            <label class="header-control">
              身份模式
              <select data-role="identity-mode">
                <option value="fixed-standard" ${identitySetupMode === "fixed-standard" ? "selected" : ""}>标准座次</option>
                <option value="random-all" ${identitySetupMode === "random-all" ? "selected" : ""}>全员随机</option>
                <option value="pick-human" ${identitySetupMode === "pick-human" ? "selected" : ""}>指定我的身份</option>
              </select>
            </label>
            <label class="header-control">
              我的身份
              <select data-role="human-identity" ${identitySetupMode === "pick-human" ? "" : "disabled"}>
                <option value="lord" ${preferredHumanIdentity === "lord" ? "selected" : ""}>主公</option>
                <option value="loyalist" ${preferredHumanIdentity === "loyalist" ? "selected" : ""}>忠臣</option>
                <option value="rebel" ${preferredHumanIdentity === "rebel" ? "selected" : ""}>反贼</option>
                <option value="renegade" ${preferredHumanIdentity === "renegade" ? "selected" : ""}>内奸</option>
              </select>
            </label>
            <label class="header-control">
              我的武将
              <select data-role="human-general" ${rosterMode === "pick-human" ? "" : "disabled"}>
                ${STANDARD_GENERAL_CHECKLIST.map(
                  (item) =>
                    `<option value="${item.generalId}" ${item.generalId === preferredHumanGeneralId ? "selected" : ""}>${item.generalName}</option>`
                ).join("")}
              </select>
            </label>
            <label class="header-control">
              <span>测试模式：手动初始手牌</span>
              <select data-role="manual-hand-mode">
                <option value="off" ${manualInitialHandMode ? "" : "selected"}>关闭</option>
                <option value="on" ${manualInitialHandMode ? "selected" : ""}>开启</option>
              </select>
            </label>
            ${manualInitialHandSelects}
          </div>
          <div class="setup-actions-row">
            <button data-role="random-human" ${rosterMode === "pick-human" ? "" : "disabled"}>随机我的武将</button>
            <button data-role="start-game">进入对局</button>
          </div>
        </section>
      </main>
    `;

    bindGlobalButtons();
    return;
  }

  const actor = game.players.find((player) => player.id === game.currentPlayerId);
  const pendingTuxiChoice = getPendingTuxiChoice(game);
  const pendingLuoyiChoice = isPendingLuoyiChoice(game);
  const pendingManualDiscard = getPendingManualDiscardChoice(game);
  const pendingHarvestChoiceRaw = getPendingHarvestChoice(game);
  const pendingHarvestChoice =
    pendingHarvestChoiceRaw && pendingHarvestChoiceRaw.pickerId === getHumanPlayer(game).id ? pendingHarvestChoiceRaw : null;
  const pendingResponse = pendingHumanResponse;

  if (pendingManualDiscard) {
    const handIds = new Set(getHumanPlayer(game).hand.map((card) => card.id));
    selectedDiscardCardIds = selectedDiscardCardIds.filter((cardId) => handIds.has(cardId)).slice(0, pendingManualDiscard.needCount);
  } else {
    selectedDiscardCardIds = [];
  }

  if (pendingTuxiChoice) {
    const validIds = new Set(pendingTuxiChoice.candidates.map((candidate) => candidate.id));
    selectedTuxiTargetIds = selectedTuxiTargetIds.filter((targetId) => validIds.has(targetId)).slice(0, 2);
  } else {
    selectedTuxiTargetIds = [];
  }
  const allLegalActions =
    !game.winner && actor && !actor.isAi && game.phase === "play"
      ? getLegalActions(game).filter((action) => action.actorId === actor.id)
      : [];

  const availableSkillModes = new Set(
    allLegalActions
      .map((action) => getActionModeId(action))
      .filter((modeId): modeId is string => modeId !== null)
  );
  if (activeSkillModeId && !availableSkillModes.has(activeSkillModeId)) {
    activeSkillModeId = null;
    selectedCardId = null;
    pendingPrimaryTargetId = null;
    pendingSecondaryTargetId = null;
    pendingZoneChoiceActions = [];
    previewTargetIds = [];
  }

  const legalActions = filterActionsBySkillMode(allLegalActions, activeSkillModeId);

  const humanHand = getHumanPlayer(game).hand;
  const handCardIds = new Set(humanHand.map((card) => card.id));
  if (selectedCardId && !handCardIds.has(selectedCardId)) {
    selectedCardId = null;
    pendingPrimaryTargetId = null;
    pendingSecondaryTargetId = null;
    pendingZoneChoiceActions = [];
    pendingZoneCardChoiceActions = [];
  }

  if (!selectedCardId && pendingPrimaryTargetId) {
    pendingPrimaryTargetId = null;
    pendingSecondaryTargetId = null;
  }

  if (!selectedCardId && pendingZoneChoiceActions.length > 0) {
    pendingZoneChoiceActions = [];
  }
  if (!selectedCardId && pendingZoneCardChoiceActions.length > 0) {
    pendingZoneCardChoiceActions = [];
  }

  const playableActions = legalActions.filter((action) => action.type === "play-card");
  const selectedCardActionsFromHand = selectedCardId
    ? playableActions.filter((action) => getActionSourceCardId(action) === selectedCardId)
    : [];
  const selectedCardActions =
    selectedCardActionsFromHand.length > 0
      ? selectedCardActionsFromHand
      : !selectedCardId && activeSkillModeId
        ? playableActions.filter((action) => {
            if (getActionModeId(action) !== activeSkillModeId) {
              return false;
            }

            const sourceCardId = getActionSourceCardId(action);
            return sourceCardId === null || !handCardIds.has(sourceCardId);
          })
        : [];
  const directTargetActionCandidates = pendingPrimaryTargetId && pendingSecondaryTargetId
    ? selectedCardActions.filter(
        (action) =>
          action.type === "play-card" &&
          action.targetId === pendingPrimaryTargetId &&
          action.secondaryTargetId === pendingSecondaryTargetId &&
          Boolean(action.tertiaryTargetId)
      )
    : pendingPrimaryTargetId
      ? selectedCardActions.filter(
          (action) =>
            action.type === "play-card" &&
            action.targetId === pendingPrimaryTargetId &&
            Boolean(action.secondaryTargetId)
        )
    : selectedCardActions.filter((action) => action.type === "play-card" && Boolean(action.targetId));
  let selectableTargetIds = Array.from(
    new Set(
      directTargetActionCandidates
        .map((action) => (pendingPrimaryTargetId && pendingSecondaryTargetId ? action.tertiaryTargetId : pendingPrimaryTargetId ? action.secondaryTargetId : action.targetId))
        .filter((targetId): targetId is string => Boolean(targetId))
    )
  );
  if (pendingTuxiChoice) {
    selectableTargetIds = pendingTuxiChoice.candidates.map((candidate) => candidate.id);
  }

  const endPlayAction = legalActions.find((action) => action.type === "end-play-phase") ?? null;
  const humanPlayer = getHumanPlayer(game);
  const humanGeneralId = playerGeneralIdByPlayerId[humanPlayer.id] ?? getGeneralIdByName(humanPlayer.name);
  const humanEquipmentSummary = getEquipmentSummary(humanPlayer);
  const humanJudgmentSummary = getJudgmentSummary(humanPlayer);
  const humanIdentityLabel = IDENTITY_LABEL_ZH[humanPlayer.identity];
  const selfIsTargeted = previewTargetIds.includes(humanPlayer.id);
  const selfIsPrimarySelected = pendingPrimaryTargetId === humanPlayer.id || pendingSecondaryTargetId === humanPlayer.id;
  const selfIsSelectable = selectableTargetIds.includes(humanPlayer.id);
  const selfRowClass = [
    "player-row",
    "self-general-card",
    selfIsTargeted ? "targeted" : "",
    selfIsPrimarySelected ? "primary-selected" : "",
    selfIsSelectable ? "clickable" : ""
  ]
    .filter(Boolean)
    .join(" ");

  app.innerHTML = `
    <main class="battle-layout">
      <section class="panel battle-table">
        <div class="player-list official-table">
          <div class="table-corner-info status">回合 ${game.turnCount} · 当前 ${actor?.name ?? "未知"} · 阶段 ${PHASE_LABEL[game.phase]} · 模式 ${activeSkillModeId ? `技能(${getSkillModeLabel(activeSkillModeId)})` : "普通出牌"}</div>
          <div class="table-corner-actions">
            <button data-role="new-game">重新开局</button>
            <button data-role="back-to-setup">返回设置</button>
            <button data-role="auto-toggle">${autoMode ? "停止自动推进" : "自动推进"}</button>
            <button data-role="step">单步推进</button>
          </div>
          ${renderPlayers(
            game,
            pendingTuxiChoice
              ? Array.from(new Set([...previewTargetIds, ...selectedTuxiTargetIds]))
              : previewTargetIds,
            selectableTargetIds,
            pendingPrimaryTargetId
          )}
          <section class="center-panels">
            <section class="center-log">
              <div class="center-log-title">事件日志</div>
              <ol class="log-list">${renderEvents(game, pendingResponse?.previewCardEventMessage)}</ol>
            </section>
            ${pendingResponse
              ? `<section class="center-response">
              <div class="center-log-title">响应窗口</div>
              <div class="action-list response-inline">${renderHumanResponsePanel(pendingResponse)}</div>
            </section>`
              : pendingHarvestChoice
                ? `<section class="center-response">
              <div class="center-log-title">五谷丰登</div>
              <div class="action-list response-inline">${renderHarvestChoicePanel(pendingHarvestChoice)}</div>
            </section>`
              : pendingManualDiscard
                ? `<section class="center-response">
              <div class="center-log-title">弃牌阶段</div>
              <div class="action-list response-inline">${renderManualDiscardPanel(pendingManualDiscard)}</div>
            </section>`
              : pendingTuxiChoice
                ? `<section class="center-response">
              <div class="center-log-title">摸牌阶段决策</div>
              <div class="action-list response-inline">${renderTuxiChoicePanel(pendingTuxiChoice)}</div>
            </section>`
                : pendingLuoyiChoice
                  ? `<section class="center-response">
              <div class="center-log-title">摸牌阶段决策</div>
              <div class="action-list response-inline">${renderLuoyiChoicePanel(game)}</div>
            </section>`
                  : ""}
          </section>
        </div>
      </section>

      <section class="panel self-zone">
        <div class="self-head">
          <div class="${selfRowClass}" data-player-id="${humanPlayer.id}">
            <img class="avatar" src="${ASSET_BASE}/generals/${humanGeneralId}.png" alt="${humanPlayer.name}" />
            <div class="player-name">${humanPlayer.name}</div>
            <div class="player-core">${humanPlayer.hp}/${humanPlayer.maxHp} ♥ · 手牌 ${humanPlayer.hand.length}</div>
            <div class="player-tags">
              <span class="badge">${humanIdentityLabel}</span>
              <span class="badge ${humanPlayer.alive ? "" : "dead"}">${humanPlayer.alive ? "存活" : "阵亡"}</span>
            </div>
          </div>
          <div class="self-status-panels">
            <section class="self-hand-panel">
              <div class="self-hand-main">
                ${renderZoneChoiceActions(pendingZoneChoiceActions)}
                ${renderZoneCardChoiceActions(pendingZoneCardChoiceActions)}
                <div class="hand-list">${renderHand(humanHand, legalActions, selectedCardId)}</div>
              </div>
              <aside class="self-side-status">
                <div class="hand-actions">
                  ${renderSkillToolbar(game, allLegalActions, activeSkillModeId)}
                  ${endPlayAction ? '<button data-role="end-play-inline">结束出牌阶段</button>' : ""}
                </div>
                <div class="status">装备区：${humanEquipmentSummary}</div>
                <div class="status">判定区：${humanJudgmentSummary}</div>
              </aside>
            </section>
          </div>
        </div>
      </section>
    </main>
  `;

  bindGlobalButtons();
  bindLuoyiChoiceButtons();
  bindHumanResponseButtons();
  bindTuxiChoiceButtons();
  bindSkillButtons(allLegalActions);
  bindHandButtons(legalActions);
  bindPlayerTargetButtons(selectedCardActions);
  bindZoneChoiceButtons();
  bindZoneCardChoiceButtons();
  bindInlineEndPlayButton(endPlayAction);
  bindManualDiscardButtons();
  bindHarvestChoiceButtons();
  adjustSkillPopoverDirectionByViewport();
  scrollEventLogToLatest();
}

function adjustSkillPopoverDirectionByViewport(): void {
  const seats = app.querySelectorAll<HTMLDivElement>(".player-seat");
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const edgePadding = 10;
  const gap = 6;

  seats.forEach((seat) => {
    const row = seat.querySelector<HTMLDivElement>(".player-row");
    const popover = seat.querySelector<HTMLDivElement>(".player-skill-popover");
    if (!row || !popover) {
      return;
    }

    popover.classList.remove("player-popover-left", "player-popover-right", "player-popover-up", "player-popover-down");

    const rowRect = row.getBoundingClientRect();
    const seatLeft = Number(popover.dataset.seatLeft ?? "50");
    const seatTop = Number(popover.dataset.seatTop ?? "0");
    const isTopRowSeat = popover.dataset.topRow === "1";
    const preferHorizontal = isTopRowSeat && seatTop <= 45;
    const popoverWidth = Math.max(220, popover.getBoundingClientRect().width || 220);
    const popoverHeight = Math.max(160, popover.getBoundingClientRect().height || 160);
    const fitsRight = rowRect.right + gap + popoverWidth <= viewportWidth - edgePadding;
    const fitsLeft = rowRect.left - gap - popoverWidth >= edgePadding;
    const fitsUp = rowRect.top - gap - popoverHeight >= edgePadding;
    const fitsDown = rowRect.bottom + gap + popoverHeight <= viewportHeight - edgePadding;

    if (isTopRowSeat) {
      popover.classList.add("player-popover-left");
      return;
    }

    if (!preferHorizontal) {
      if (!fitsUp && fitsDown) {
        popover.classList.add("player-popover-down");
        return;
      }

      if (!fitsDown && fitsUp) {
        popover.classList.add("player-popover-up");
        return;
      }

      popover.classList.add(fitsUp ? "player-popover-up" : "player-popover-down");
      return;
    }

    if (!fitsRight && fitsLeft) {
      popover.classList.add("player-popover-left");
      return;
    }

    if (!fitsLeft && fitsRight) {
      popover.classList.add("player-popover-right");
      return;
    }

    if (seatLeft < 50) {
      popover.classList.add("player-popover-left");
    } else {
      popover.classList.add("player-popover-right");
    }
  });
}

function scrollEventLogToLatest(): void {
  const logList = app.querySelector<HTMLOListElement>(".center-log .log-list");
  if (!logList) {
    return;
  }

  logList.scrollTop = logList.scrollHeight;
}

function getTargetSelectionHint(
  state: Game,
  selectedCardActions: TurnAction[],
  primaryTargetId: string | null,
  zoneChoiceActions: PlayCardAction[]
): string {
  if (!selectedCardId) {
    return "选择手牌后，点击武将区目标出牌。";
  }

  if (zoneChoiceActions.length > 0) {
    const target = zoneChoiceActions[0]?.targetId ? state.players.find((player) => player.id === zoneChoiceActions[0].targetId) : null;
    const targetName = target?.name ?? "该目标";
    return `请选择要操作 ${targetName} 的区域：手牌 / 装备区 / 判定区。`;
  }

  if (selectedCardActions.length === 0) {
    return "该牌当前无合法目标。";
  }

  if (primaryTargetId) {
    const primary = state.players.find((player) => player.id === primaryTargetId);
    const primaryName = primary?.name ?? primaryTargetId;
    return `已选第一目标：${primaryName}，请继续点击第二目标。`;
  }

  const needsSecondary = selectedCardActions.some((action) => action.type === "play-card" && Boolean(action.secondaryTargetId));
  return needsSecondary ? "该牌需要两个目标：先点第一目标，再点第二目标。" : "点击武将区角色即可出牌。";
}

function renderZoneChoiceActions(actions: PlayCardAction[]): string {
  if (actions.length === 0) {
    return "";
  }

  const byZone = new Map<string, PlayCardAction>();
  for (const action of actions) {
    const zone = action.targetZone ?? "hand";
    if (!byZone.has(zone)) {
      byZone.set(zone, action);
    }
  }

  const labelByZone: Record<string, string> = {
    hand: "手牌区",
    equipment: "装备区",
    judgment: "判定区"
  };

  const buttons = Array.from(byZone.entries())
    .map(
      ([zone, action], index) =>
        `<button data-role="zone-choice" data-index="${index}" data-zone="${zone}" data-target-id="${action.targetId ?? ""}">${labelByZone[zone] ?? zone}</button>`
    )
    .join("");

  return `<div class="zone-choice-list">${buttons}</div>`;
}

function renderZoneCardChoiceActions(actions: PlayCardAction[]): string {
  if (actions.length === 0) {
    return "";
  }

  const buttons = actions
    .map(
      (action, index) =>
        `<button data-role="zone-card-choice" data-index="${index}" data-card-id="${action.targetCardId ?? ""}">${formatTargetCardChoiceLabel(
          action,
          game
        )}</button>`
    )
    .join("");

  return `<div class="zone-choice-list">${buttons}</div>`;
}

function formatTargetCardChoiceLabel(action: PlayCardAction, state: Game): string {
  const zoneLabel = action.targetZone === "judgment" ? "判定" : action.targetZone === "equipment" ? "装备" : "手牌";
  if (!action.targetId || !action.targetCardId) {
    return `${zoneLabel}：${action.targetCardId ?? "未知牌"}`;
  }

  const target = state.players.find((player) => player.id === action.targetId);
  if (!target) {
    return `${zoneLabel}：${action.targetCardId}`;
  }

  let cardKind: string | null = null;
  if (action.targetZone === "equipment") {
    const equipmentCards = [
      target.equipment.weapon,
      target.equipment.armor,
      target.equipment.horsePlus,
      target.equipment.horseMinus
    ].filter((card): card is Card => Boolean(card));
    cardKind = equipmentCards.find((card) => card.id === action.targetCardId)?.kind ?? null;
  } else if (action.targetZone === "judgment") {
    cardKind = target.judgmentZone.delayedTricks.find((card) => card.id === action.targetCardId)?.kind ?? null;
  }

  const cardLabel = cardKind ? getCardKindLabelZh(cardKind) : action.targetCardId;
  return `${zoneLabel}：${cardLabel}`;
}

function filterActionsBySkillMode(actions: TurnAction[], modeId: string | null): TurnAction[] {
  return actions.filter((action) => {
    if (action.type === "end-play-phase") {
      return true;
    }

    const actionModeId = getActionModeId(action);
    if (modeId === null) {
      return actionModeId === null;
    }

    return actionModeId === modeId;
  });
}

function getActionModeId(action: TurnAction): string | null {
  if (action.type !== "play-card") {
    return null;
  }

  const matched = action.cardId.match(/^__virtual_(.+?)__(::.*)?$/);
  if (!matched) {
    return null;
  }

  return matched[1] ?? null;
}

function renderSkillPanel(state: Game, allLegalActions: TurnAction[], currentModeId: string | null): string {
  const human = getHumanPlayer(state);
  const skillIds = state.skillSystem.playerSkills[human.id] ?? [];

  if (skillIds.length === 0) {
    return `<div class="status">当前无可展示技能。</div>`;
  }

  return skillIds
    .map((skillId) => {
      const config = SKILL_UI_CONFIG[skillId] ?? {
        name: SKILL_NAME_ZH[skillId] ?? skillId,
        description: "规则层已实现该技能，当前为通用说明展示。",
        trigger: "response" as const,
        modeId: null
      };

      const available =
        config.modeId !== null && allLegalActions.some((action) => getActionModeId(action) === config.modeId);

      let actionUi = "";
      if (config.trigger === "manual" && config.modeId !== null) {
        actionUi = `<button data-role="skill-toggle" data-mode-id="${config.modeId}" ${available ? "" : "disabled"}>${
          currentModeId === config.modeId ? "退出" : "发动"
        }</button>`;
      } else if (config.trigger === "auto") {
        actionUi = `<span class="skill-state">自动触发</span>`;
      } else {
        actionUi = `<span class="skill-state">响应触发</span>`;
      }

      return `
        <article class="skill-item">
          <div class="skill-title">${config.name}</div>
          <div class="skill-desc">${config.description}</div>
          <div>${actionUi}</div>
        </article>
      `;
    })
    .join("");
}

function getEquipmentSummary(player: PlayerState): string {
  const equipmentParts: string[] = [];
  if (player.equipment.weapon) {
    equipmentParts.push(`武器:${getCardKindLabelZh(player.equipment.weapon.kind)}`);
  }
  if (player.equipment.armor) {
    equipmentParts.push(`防具:${getCardKindLabelZh(player.equipment.armor.kind)}`);
  }
  if (player.equipment.horsePlus) {
    equipmentParts.push(`+马:${getCardKindLabelZh(player.equipment.horsePlus.kind)}`);
  }
  if (player.equipment.horseMinus) {
    equipmentParts.push(`-马:${getCardKindLabelZh(player.equipment.horseMinus.kind)}`);
  }

  return equipmentParts.length > 0 ? equipmentParts.join(" · ") : "无";
}

function getJudgmentSummary(player: PlayerState): string {
  return player.judgmentZone.delayedTricks.length > 0
    ? player.judgmentZone.delayedTricks.map((card) => getCardKindLabelZh(card.kind)).join("、")
    : "无";
}

function renderSkillToolbar(state: Game, allLegalActions: TurnAction[], currentModeId: string | null): string {
  const human = getHumanPlayer(state);
  const skillIds = state.skillSystem.playerSkills[human.id] ?? [];
  const manualSkills = skillIds
    .map((skillId) => {
      const config = SKILL_UI_CONFIG[skillId];
      if (!config || config.trigger !== "manual" || !config.modeId) {
        return "";
      }

      const available = allLegalActions.some((action) => getActionModeId(action) === config.modeId);
      return `<button data-role="skill-toggle" data-mode-id="${config.modeId}" ${available ? "" : "disabled"}>${
        currentModeId === config.modeId ? `取消${config.name}` : config.name
      }</button>`;
    })
    .filter(Boolean)
    .join("");

  return manualSkills || '<span class="status">当前无主动技可发动</span>';
}

function renderSelfSkillToolbar(state: Game, allLegalActions: TurnAction[], currentModeId: string | null): string {
  const human = getHumanPlayer(state);
  const skillIds = state.skillSystem.playerSkills[human.id] ?? [];
  if (skillIds.length === 0) {
    return '<span class="status">当前无可用技能</span>';
  }

  return skillIds
    .map((skillId) => {
      const config = SKILL_UI_CONFIG[skillId] ?? {
        name: SKILL_NAME_ZH[skillId] ?? skillId,
        description: "规则层已实现该技能，当前为通用说明展示。",
        trigger: "response" as const,
        modeId: null
      };

      const available =
        config.modeId !== null && allLegalActions.some((action) => getActionModeId(action) === config.modeId);

      if (config.trigger === "manual" && config.modeId !== null) {
        return `<button class="self-skill-button manual" data-role="skill-toggle" data-mode-id="${config.modeId}" title="${config.description}" ${available ? "" : "disabled"}>${
          currentModeId === config.modeId ? `取消${config.name}` : config.name
        }</button>`;
      }

      const triggerLabel = config.trigger === "auto" ? "自动" : "响应";
      return `<button class="self-skill-button passive" type="button" title="${config.description}" disabled>${config.name}·${triggerLabel}</button>`;
    })
    .join("");
}

function isSelfImmediateCastCard(kind: string | null): boolean {
  return kind === "ex_nihilo" || kind === "lightning" || kind === "peach";
}

function getOpponentSeatPosition(index: number, seatCount: number): { left: number; top: number } {
  if (seatCount <= 0) {
    return { left: 50, top: 50 };
  }

  if (seatCount === 4) {
    const fixed = [
      { left: 8, top: 58 },
      { left: 28, top: 28 },
      { left: 72, top: 28 },
      { left: 92, top: 58 }
    ];
    return fixed[index] ?? fixed[0]!;
  }

  const angle = 180 + (180 / Math.max(seatCount - 1, 1)) * index;
  const rad = (angle * Math.PI) / 180;
  const horizontalRadius = seatCount >= 6 ? 46 : 44;
  const verticalRadius = seatCount >= 6 ? 38 : 36;
  const computedLeft = 50 + horizontalRadius * Math.cos(rad);
  return {
    left: Math.max(7, Math.min(93, computedLeft)),
    top: 54 + verticalRadius * Math.sin(rad)
  };
}

function renderPlayers(
  state: Game,
  targetedIds: string[],
  selectableTargetIds: string[],
  primaryTargetId: string | null
): string {
  const viewerId = getHumanPlayer(state).id;
  const viewerSeatIndex = state.players.findIndex((player) => player.id === viewerId);
  const playerCount = state.players.length;
  const orderedPlayers =
    viewerSeatIndex >= 0
      ? state.players.map((_, offset) => state.players[(viewerSeatIndex - offset + playerCount) % playerCount]!)
      : state.players;
  const opponents = orderedPlayers.filter((player) => player.id !== viewerId);
  const seatCount = opponents.length;

  return opponents
    .map((player, index) => {
      const isCurrent = player.id === state.currentPlayerId;
      const isTargeted = targetedIds.includes(player.id);
      const isSelectable = selectableTargetIds.includes(player.id);
      const identityVisible = player.identity === "lord" || player.id === viewerId || !player.alive;
      const identityLabel = identityVisible ? IDENTITY_LABEL_ZH[player.identity] : "未知";
      const generalId = getGeneralIdByName(player.name);
      const mappedGeneralId = playerGeneralIdByPlayerId[player.id] ?? generalId;
      const skillIds = GENERAL_SKILL_IDS_BY_GENERAL_ID[mappedGeneralId] ?? [];
      const skillItems =
        skillIds.length > 0
          ? skillIds
              .map((skillId) => {
                const config = SKILL_UI_CONFIG[skillId];
                const name = config?.name ?? SKILL_NAME_ZH[skillId] ?? skillId;
                const desc = config?.description ?? "规则层已实现该技能，当前为通用说明展示。";
                return `<div class="player-skill-item"><strong>${name}</strong>：${desc}</div>`;
              })
              .join("")
          : `<div class="player-skill-item">暂无技能信息</div>`;
      const tag = player.alive ? "存活" : "阵亡";
      const equipmentSummary = getEquipmentSummary(player);
      const judgmentSummary = getJudgmentSummary(player);
      const isPrimarySelected = primaryTargetId === player.id;
      const rowClass = [
        "player-row",
        isCurrent ? "current" : "",
        isTargeted ? "targeted" : "",
        isPrimarySelected ? "primary-selected" : "",
        isSelectable ? "clickable" : ""
      ]
        .filter(Boolean)
        .join(" ");
      const { left, top } = getOpponentSeatPosition(index, seatCount);
      const adjustedTop = Math.min(88, top + 6);
      const isTopRowSeat = adjustedTop <= 45;
      const skillPopoverClass = isTopRowSeat ? "player-popover-left" : "player-popover-up";
      const infoPopoverClass = isTopRowSeat ? "player-popover-right" : "player-popover-bottom";
      const realSeatIndex = state.players.findIndex((slot) => slot.id === player.id);
      const seatLabel = realSeatIndex >= 0 ? `#${realSeatIndex + 1}` : "未知";
      const seatDistance = getSeatDistance(state, viewerId, player.id);
      const distanceLabel = seatDistance === 0 ? "你" : `${seatDistance}`;
      const detailTitle = `装备区：${equipmentSummary}｜判定区：${judgmentSummary}`;

      return `
        <div class="player-seat" style="left:${left}%;top:${adjustedTop}%">
        <div class="${rowClass}" data-player-id="${player.id}" title="${detailTitle}">
          <div class="player-main-row">
            <img class="avatar ai-avatar" src="${ASSET_BASE}/generals/${mappedGeneralId}.png" alt="${player.name}" />
            <div class="player-right-info">
              <div class="player-name">${player.name}</div>
              <div class="player-core">${player.hp}/${player.maxHp} ♥ · 手牌 ${player.hand.length}</div>
              <div class="player-zone-line">装:${equipmentSummary}</div>
              <div class="player-zone-line">判:${judgmentSummary}</div>
            </div>
          </div>
          <div class="player-tags">
            <span class="badge ${identityVisible ? "" : "hidden"}">${identityLabel}</span>
            <span class="badge ${player.alive ? "" : "dead"}">${tag}</span>
          </div>
          <div class="player-popover player-skill-popover ${skillPopoverClass}" data-seat-left="${left}" data-seat-top="${adjustedTop}" data-top-row="${isTopRowSeat ? "1" : "0"}">
            <div class="player-popover-title">技能</div>
            <div class="player-skill-list">${skillItems}</div>
          </div>
          <div class="player-popover ${infoPopoverClass}">
            <div class="player-popover-title">${player.name}</div>
            <div>座位 ${seatLabel} · 距离 ${distanceLabel}</div>
            <div>体力 ${player.hp}/${player.maxHp} · 手牌 ${player.hand.length}</div>
            <div>身份：${identityLabel} · ${player.isAi ? "AI" : "玩家"}</div>
            <div>装备区：${equipmentSummary}</div>
            <div>判定区：${judgmentSummary}</div>
          </div>
        </div>
        </div>
      `;
    })
    .join("");
}

function getSeatDistance(state: Game, fromPlayerId: string, toPlayerId: string): number {
  const fromIndex = state.players.findIndex((player) => player.id === fromPlayerId);
  const toIndex = state.players.findIndex((player) => player.id === toPlayerId);
  if (fromIndex < 0 || toIndex < 0) {
    return 0;
  }

  const diff = Math.abs(fromIndex - toIndex);
  return Math.min(diff, state.players.length - diff);
}

function getSkillModeLabel(modeId: string): string {
  const map: Record<string, string> = {
    rende: "仁德",
    jijiang: "激将",
    fanjian: "反间",
    guose: "国色",
    qixi: "奇袭",
    lijian: "离间",
    zhiheng: "制衡",
    qingnang: "青囊"
  };
  return map[modeId] ?? modeId;
}

function renderHand(hand: Card[], legalActions: TurnAction[], currentSelectedCardId: string | null): string {
  if (hand.length === 0) {
    return "";
  }

  const pendingManualDiscard = getPendingManualDiscardChoice(game);

  return hand
    .map(
      (card, index) => `
      <button class="hand-card ${
        (pendingManualDiscard && selectedDiscardCardIds.includes(card.id)) || card.id === currentSelectedCardId ? "selected" : ""
      }" data-role="hand-card" data-card-id="${card.id}" style="z-index:${index + 1}" title="${getCardKindLabelZh(card.kind)}">
        <img class="card-icon" src="${ASSET_BASE}/cards/${card.kind}.png" alt="${getCardKindLabelZh(card.kind)}" />
      </button>
    `
    )
    .join("");
}

function getCardKindLabelZh(kind: string): string {
  return CARD_KIND_LABEL_ZH[kind] ?? kind;
}

function renderTargetActions(
  currentSelectedCardId: string | null,
  selectedCardActions: TurnAction[],
  endPlayAction: TurnAction | null
): string {
  if (game.winner) {
    return `<div class="status">对局结束，胜利方：${game.winner}</div>`;
  }

  if (!currentSelectedCardId && selectedCardActions.length === 0) {
    const endButton = endPlayAction
      ? `<button data-role="end-play">结束出牌阶段</button>`
      : "";
    return `<div class="status">请先在手牌区选择一张牌。</div>${endButton}`;
  }

  if (selectedCardActions.length === 0) {
    const endButton = endPlayAction
      ? `<button data-role="end-play">结束出牌阶段</button>`
      : "";
    return `<div class="status">该牌当前没有合法目标，请换一张牌或结束阶段。</div>${endButton}`;
  }

  const grouped = groupActionsByTarget(game, selectedCardActions);
  return grouped
    .map(
      (group) => `
        <section class="action-group">
          <div class="action-group-title">${group.title}</div>
          ${group.items
            .map(
              (item) =>
                `<button data-role="action" data-index="${item.index}">${item.index + 1}. ${describeAction(game, item.action)}</button>`
            )
            .join("")}
        </section>
      `
    )
    .join("") + (endPlayAction ? `<button data-role="end-play">结束出牌阶段</button>` : "");
}

function groupActionsByTarget(
  state: Game,
  actions: TurnAction[]
): Array<{ title: string; items: Array<{ action: TurnAction; index: number }> }> {
  const map = new Map<string, Array<{ action: TurnAction; index: number }>>();

  actions.forEach((action, index) => {
    const key = getActionTargetLabel(state, action);
    const list = map.get(key) ?? [];
    list.push({ action, index });
    map.set(key, list);
  });

  return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
}

function getActionTargetLabel(state: Game, action: TurnAction): string {
  if (action.type !== "play-card") {
    return "阶段操作";
  }

  const primary = action.targetId ? state.players.find((player) => player.id === action.targetId) : null;
  const secondary = action.secondaryTargetId
    ? state.players.find((player) => player.id === action.secondaryTargetId)
    : null;

  if (primary && secondary) {
    return `目标：${primary.name} / ${secondary.name}`;
  }

  if (primary) {
    return `目标：${primary.name}`;
  }

  return "无指定目标";
}

function renderEvents(state: Game, pendingPreviewMessage: string | undefined = undefined): string {
  const start = Math.max(0, state.events.length - 160);
  const rendered = state.events
    .slice(start)
    .map((event) => {
      const style = EVENT_STYLE[event.type] ?? { tag: event.type.toUpperCase() };
      const relatedClass = isHumanRelatedEventMessage(state, event.message) ? " log-item-human" : "";
      return `<li class="log-item${relatedClass}"><span class="log-tag">[${style.tag}]</span>${formatEventLogMessage(state, event.message)}</li>`;
    })
    .join("");

  if (!pendingPreviewMessage) {
    return rendered;
  }

  const pendingRelatedClass = isHumanRelatedEventMessage(state, pendingPreviewMessage) ? " log-item-human" : "";
  return `${rendered}<li class="log-item${pendingRelatedClass}"><span class="log-tag">[${EVENT_STYLE.card.tag}]</span>${formatEventLogMessage(state, pendingPreviewMessage)}</li>`;
}

function isHumanRelatedEventMessage(state: Game, message: string): boolean {
  const human = getHumanPlayer(state);
  if (!human.name) {
    return false;
  }

  return localizeEventMessage(message).includes(human.name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatEventLogMessage(state: Game, message: string): string {
  const localized = localizeEventMessage(message);
  const escapedMessage = escapeHtml(localized);
  const playerNames = state.players
    .map((player) => player.name)
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => right.length - left.length);

  if (playerNames.length === 0) {
    return escapedMessage;
  }

  const pattern = new RegExp(playerNames.map((name) => escapeRegExp(name)).join("|"), "g");
  return escapedMessage.replace(pattern, (matched) => `<span class="log-player">${matched}</span>`);
}

function describeAction(state: Game, action: TurnAction): string {
  if (action.type === "end-play-phase") {
    return "结束出牌阶段";
  }

  const actor = state.players.find((player) => player.id === action.actorId);
  const target = action.targetId ? state.players.find((player) => player.id === action.targetId) : null;
  const secondary = action.secondaryTargetId
    ? state.players.find((player) => player.id === action.secondaryTargetId)
    : null;

  const cardLabel = getActionCardLabel(state, action);
  const actorName = actor?.name ?? action.actorId;

  if (secondary) {
    return `${actorName} 使用 ${cardLabel} → ${target?.name ?? action.targetId} / ${secondary.name}`;
  }

  if (target) {
    return `${actorName} 使用 ${cardLabel} → ${target.name}`;
  }

  return `${actorName} 使用 ${cardLabel}`;
}

function simplifyCardId(cardId: string): string {
  const dividerIndex = cardId.lastIndexOf("::");
  if (dividerIndex >= 0 && dividerIndex < cardId.length - 2) {
    return cardId.slice(dividerIndex + 2);
  }

  return cardId;
}

function getActionSourceCardId(action: TurnAction): string | null {
  if (action.type !== "play-card") {
    return null;
  }

  return simplifyCardId(action.cardId);
}

function resolveActionCardKind(state: Game, action: TurnAction): string | null {
  if (action.type !== "play-card") {
    return null;
  }

  const actor = state.players.find((player) => player.id === action.actorId);
  if (!actor) {
    return null;
  }

  const sourceCardId = simplifyCardId(action.cardId);
  const sourceCard = actor.hand.find((card) => card.id === sourceCardId);
  return sourceCard?.kind ?? null;
}

function isEquipmentCardKind(kind: string | null): boolean {
  return kind !== null && EQUIPMENT_KINDS.has(kind);
}

function getActionCardLabel(state: Game, action: TurnAction): string {
  if (action.type !== "play-card") {
    return action.type;
  }

  if (action.cardId.startsWith("__virtual_jijiang__::")) {
    return "激将(杀)";
  }

  const kind = resolveActionCardKind(state, action);
  if (kind) {
    return getCardKindLabelZh(kind);
  }

  return simplifyCardId(action.cardId);
}

function localizeEventMessage(message: string): string {
  const pairs = Object.entries(CARD_KIND_LABEL_ZH).sort((left, right) => right[0].length - left[0].length);
  let result = message;
  for (const [kind, label] of pairs) {
    result = result.split(kind).join(label);
  }

  const phasePairs: Array<[string, string]> = [
    ["judge", "判定"],
    ["draw", "摸牌"],
    ["play", "出牌"],
    ["discard", "弃牌"],
    ["end", "结束"],
    ["进入judge阶段", "进入判定阶段"],
    ["进入draw阶段", "进入摸牌阶段"],
    ["进入play阶段", "进入出牌阶段"],
    ["进入discard阶段", "进入弃牌阶段"],
    ["进入end阶段", "进入结束阶段"]
  ];

  for (const [source, target] of phasePairs) {
    result = result.split(source).join(target);
  }

  return result;
}

function getActionPreviewTargets(action: TurnAction): string[] {
  if (action.type !== "play-card") {
    return [];
  }

  const ids: string[] = [];
  if (action.targetId) {
    ids.push(action.targetId);
  }

  if (action.secondaryTargetId) {
    ids.push(action.secondaryTargetId);
  }

  if (action.tertiaryTargetId) {
    ids.push(action.tertiaryTargetId);
  }

  return ids;
}

function updatePlayerPreview(targetedIds: string[]): void {
  const rows = app.querySelectorAll<HTMLDivElement>(".player-row[data-player-id]");
  rows.forEach((row) => {
    const playerId = row.dataset.playerId;
    if (!playerId) {
      return;
    }

    if (targetedIds.includes(playerId)) {
      row.classList.add("targeted");
    } else {
      row.classList.remove("targeted");
    }
  });
}

function bindGlobalButtons(): void {
  const startGameBtn = app.querySelector<HTMLButtonElement>("button[data-role='start-game']");
  const backToSetupBtn = app.querySelector<HTMLButtonElement>("button[data-role='back-to-setup']");
  const newGameBtn = app.querySelector<HTMLButtonElement>("button[data-role='new-game']");
  const randomHumanBtn = app.querySelector<HTMLButtonElement>("button[data-role='random-human']");
  const autoToggleBtn = app.querySelector<HTMLButtonElement>("button[data-role='auto-toggle']");
  const stepBtn = app.querySelector<HTMLButtonElement>("button[data-role='step']");
  const rosterModeSelect = app.querySelector<HTMLSelectElement>("select[data-role='roster-mode']");
  const identityModeSelect = app.querySelector<HTMLSelectElement>("select[data-role='identity-mode']");
  const humanIdentitySelect = app.querySelector<HTMLSelectElement>("select[data-role='human-identity']");
  const humanGeneralSelect = app.querySelector<HTMLSelectElement>("select[data-role='human-general']");
  const manualHandModeSelect = app.querySelector<HTMLSelectElement>("select[data-role='manual-hand-mode']");
  const manualHandKindSelects = app.querySelectorAll<HTMLSelectElement>("select[data-role='manual-hand-kind']");

  rosterModeSelect?.addEventListener("change", () => {
    const nextMode = rosterModeSelect.value as RosterMode;
    rosterMode = nextMode;
    render();
    ensureAutoLoop();
  });

  identityModeSelect?.addEventListener("change", () => {
    identitySetupMode = identityModeSelect.value as IdentitySetupMode;
    if (identitySetupMode === "random-all") {
      rosterMode = "random-all";
    }
    render();
    ensureAutoLoop();
  });

  humanIdentitySelect?.addEventListener("change", () => {
    preferredHumanIdentity = humanIdentitySelect.value as PlayerState["identity"];
    render();
    ensureAutoLoop();
  });

  humanGeneralSelect?.addEventListener("change", () => {
    preferredHumanGeneralId = humanGeneralSelect.value;
    render();
    ensureAutoLoop();
  });

  manualHandModeSelect?.addEventListener("change", () => {
    manualInitialHandMode = manualHandModeSelect.value === "on";
    render();
    ensureAutoLoop();
  });

  manualHandKindSelects.forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= manualInitialHandKinds.length) {
        return;
      }

      manualInitialHandKinds[index] = select.value as Card["kind"];
      render();
      ensureAutoLoop();
    });
  });

  randomHumanBtn?.addEventListener("click", () => {
    const shuffled = shuffleWithSeed([...STANDARD_GENERAL_CHECKLIST], createRuntimeSeed() ^ game.seed);
    preferredHumanGeneralId = shuffled[0]?.generalId ?? preferredHumanGeneralId;
    resetUiSelections();
    render();
    ensureAutoLoop();
  });

  startGameBtn?.addEventListener("click", () => {
    gameStarted = true;
    startNewGame(createRuntimeSeed());
    render();
    ensureAutoLoop();
  });

  backToSetupBtn?.addEventListener("click", () => {
    gameStarted = false;
    resetUiSelections();
    render();
    ensureAutoLoop();
  });

  newGameBtn?.addEventListener("click", () => {
    startNewGame(createRuntimeSeed());
    render();
    ensureAutoLoop();
  });

  autoToggleBtn?.addEventListener("click", () => {
    autoMode = !autoMode;
    render();
    ensureAutoLoop();
  });

  stepBtn?.addEventListener("click", () => {
    resetUiSelections();
    runOneTick();
    render();
    ensureAutoLoop();
  });
}

function shuffleWithSeed<T>(source: T[], seed: number): T[] {
  const result = [...source];
  let state = seed >>> 0;

  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function bindSkillButtons(allLegalActions: TurnAction[]): void {
  const skillButtons = app.querySelectorAll<HTMLButtonElement>("button[data-role='skill-toggle']");
  skillButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const modeId = button.dataset.modeId;
      if (!modeId) {
        return;
      }

      const hasModeActions = allLegalActions.some((action) => getActionModeId(action) === modeId);
      if (!hasModeActions) {
        return;
      }

      activeSkillModeId = activeSkillModeId === modeId ? null : modeId;
      previewTargetIds = [];
      selectedCardId = null;
      pendingPrimaryTargetId = null;
      pendingSecondaryTargetId = null;
      pendingZoneChoiceActions = [];
      render();
      ensureAutoLoop();
    });
  });
}

function bindLuoyiChoiceButtons(): void {
  const buttons = app.querySelectorAll<HTMLButtonElement>("button[data-role='luoyi-choice']");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const human = getHumanPlayer(game);
      const enabled = button.dataset.enabled === "1";
      setLuoyiChoice(game, human.id, enabled);
      stepPhase(game);
      runAutoUntilHumanChoice();
      render();
      ensureAutoLoop();
    });
  });
}

function bindTuxiChoiceButtons(): void {
  const confirmButton = app.querySelector<HTMLButtonElement>("button[data-role='tuxi-confirm']");
  confirmButton?.addEventListener("click", () => {
    const actor = game.players.find((player) => player.id === game.currentPlayerId);
    if (!actor || selectedTuxiTargetIds.length === 0) {
      return;
    }

    setTuxiTargets(game, actor.id, selectedTuxiTargetIds);
    selectedTuxiTargetIds = [];
    stepPhase(game);
    runAutoUntilHumanChoice();
    render();
    ensureAutoLoop();
  });

  const skipButton = app.querySelector<HTMLButtonElement>("button[data-role='tuxi-skip']");
  skipButton?.addEventListener("click", () => {
    const actor = game.players.find((player) => player.id === game.currentPlayerId);
    if (!actor) {
      return;
    }

    setTuxiTargets(game, actor.id, []);
    selectedTuxiTargetIds = [];
    stepPhase(game);
    runAutoUntilHumanChoice();
    render();
    ensureAutoLoop();
  });
}

function bindHumanResponseButtons(): void {
  const buttons = app.querySelectorAll<HTMLButtonElement>("button[data-role='response-choice']");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!pendingHumanResponse) {
        return;
      }

      const current = pendingHumanResponse;
      const human = getHumanPlayer(game);
      const enabled = button.dataset.enabled === "1";
      if (enabled && current.allowRespond === false) {
        return;
      }
      if (current.kind === "nullify") {
        queueResponseDecision(game, human.id, "nullify", enabled);
        const queuedTrueCount = (current.nullifyQueuedTrueCount ?? 0) + (enabled ? 1 : 0);
        const nextPending: PendingHumanResponse = {
          ...current,
          allowRespond: getRemainingNullifyAfterQueued(game, human.id, queuedTrueCount) > 0,
          nullifyChosenDecisions: [...(current.nullifyChosenDecisions ?? []), enabled],
          nullifyQueuedTrueCount: queuedTrueCount
        };
        const chainProgress = getNullifyChainProgress(game, nextPending);
        if (chainProgress.shouldPromptHuman) {
          const nextRound = chainProgress.playedCount + 1;
          pendingHumanResponse = {
            ...nextPending,
            message: buildNullifyPromptMessage(
              game,
              current.nullifyTrickKind ?? "dismantle",
              nextRound,
              current.nullifyTargetId,
              current.nullifyGroupTargetIds,
              current.nullifySourceId,
              chainProgress.playedCount,
              chainProgress.playedByNames
            )
          };
          render();
          ensureAutoLoop();
          return;
        }

        if (!enabled) {
          const followup = getFollowupResponseAfterNullify(game, current);
          if (followup) {
            pendingHumanResponse = followup;
            render();
            ensureAutoLoop();
            return;
          }
        }
        pendingHumanResponse = null;
        setResponsePreference(game, human.id, "nullify", false);
        if (current.pendingHarvestCardId) {
          chooseHarvestCard(game, current.pendingHarvestCardId);
          clearResponseDecisionState(game);
          runAutoUntilHumanChoice();
          render();
          ensureAutoLoop();
          return;
        }
        if (current.action.type === "play-card" && current.action.cardId.startsWith("__pending_harvest__")) {
          runAutoUntilHumanChoice();
          render();
          ensureAutoLoop();
          return;
        }
        applyAction(game, current.action);
        clearResponseDecisionState(game);
        runAutoUntilHumanChoice();
        render();
        ensureAutoLoop();
        return;
      }

      pendingHumanResponse = null;
      if (current.kind === "blade-follow-up") {
        resolvePendingBladeFollowUp(game, enabled);
        runAutoUntilHumanChoice();
        render();
        ensureAutoLoop();
        return;
      } else if (
        current.kind === "slash" ||
        current.kind === "dodge" ||
        current.kind === "double-sword" ||
        current.kind === "peach" ||
        current.kind === "hujia" ||
        current.kind === "jijiang"
      ) {
        queueResponseDecision(game, human.id, current.kind, enabled);
        setResponsePreference(game, human.id, current.kind, false);
      } else if (!enabled) {
        setResponsePreference(game, human.id, current.kind, false);
      }

      applyAction(game, current.action);
      runAutoUntilHumanChoice();
      render();
      ensureAutoLoop();
    });
  });
}

function inferActionCardKindForResponse(state: Game, action: TurnAction): string | null {
  if (action.type !== "play-card") {
    return null;
  }

  if (action.cardId.startsWith("__virtual_wusheng_slash__")) {
    return "slash";
  }

  if (action.cardId.startsWith("__virtual_longdan_slash__")) {
    return "slash";
  }

  if (action.cardId.startsWith("__virtual_spear_slash__")) {
    return "slash";
  }

  if (action.cardId.startsWith("__virtual_jijiang__")) {
    return "slash";
  }

  if (action.cardId.startsWith("__virtual_qixi__")) {
    return "dismantle";
  }

  if (action.cardId.startsWith("__pending_barbarian__")) {
    return "barbarian";
  }

  if (action.cardId.startsWith("__pending_archery__")) {
    return "archery";
  }

  if (action.cardId.startsWith("__pending_harvest__")) {
    return "harvest";
  }

  if (action.cardId.startsWith("__virtual_guose__")) {
    return "indulgence";
  }

  return resolveActionCardKind(state, action);
}

function getPendingHumanResponseForAiAction(state: Game, action: TurnAction): PendingHumanResponse | null {
  if (action.type !== "play-card") {
    return null;
  }

  const human = getHumanPlayer(state);
  if (!human.alive) {
    return null;
  }

  const kind = inferActionCardKindForResponse(state, action);
  if (!kind) {
    return null;
  }

  const previewCardEventMessage = buildCardEventPreviewMessage(state, action, kind);

  const nullifySingleTargetKinds = new Set(["dismantle", "snatch", "duel", "collateral"]);
  const nullifyGroupKinds = new Set(["barbarian", "archery", "taoyuan", "harvest"]);
  const canNullifyCurrentAction = nullifySingleTargetKinds.has(kind) || nullifyGroupKinds.has(kind);

  if (canNullifyCurrentAction) {
    const nullifyTrickKind = kind as PendingHumanResponse["nullifyTrickKind"];
    const nullifyTargetIds = getNullifyPromptTargetIds(state, action, nullifyTrickKind);
    const nullifyTargetId = nullifyTargetIds[0] ?? action.targetId;
    const forceShowForPendingHarvest = action.cardId.startsWith("__pending_harvest__");
    const forceShowForPendingMassTrick =
      action.cardId.startsWith("__pending_barbarian__") || action.cardId.startsWith("__pending_archery__");
    const basePending: PendingHumanResponse = {
      kind: "nullify",
      action,
      previewCardEventMessage,
      allowRespond: canRespondWithNullify(state, human.id),
      nullifyTrickKind,
      nullifySourceId: action.actorId,
      nullifyTargetId,
      nullifyChosenDecisions: [],
      nullifyGroupTargetIds: nullifyTargetIds,
      nullifyGroupCursor: 0,
      nullifyQueuedTrueCount: 0
    };

    const chainProgress = getNullifyChainProgress(state, basePending);
    if (!chainProgress.shouldPromptHuman && !forceShowForPendingHarvest && !forceShowForPendingMassTrick) {
      return null;
    }

    return {
      ...basePending,
      allowRespond: chainProgress.shouldPromptHuman && canRespondWithNullify(state, human.id),
      message: buildNullifyPromptMessage(
        state,
        nullifyTrickKind,
        chainProgress.playedCount + 1,
        nullifyTargetId,
        nullifyTargetIds,
        action.actorId,
        chainProgress.playedCount,
        chainProgress.playedByNames
      )
    };
  }

  const trickNeedsNullifyFirst = kind === "duel" || kind === "barbarian" || kind === "archery";
  if (trickNeedsNullifyFirst && mayHaveAnyNullifyResponder(state)) {
    return null;
  }

  if (kind === "slash" && action.targetId === human.id) {
    const source = state.players.find((player) => player.id === action.actorId);
    if (
      source &&
      source.equipment.weapon?.kind === "weapon_double_sword" &&
      source.gender !== human.gender &&
      human.hand.length > 0
    ) {
      return {
        kind: "double-sword",
        message: `是否弃置1张手牌响应【雌雄双股剑】？（否则${source.name}摸1张牌）`,
        action,
        previewCardEventMessage,
        allowRespond: true
      };
    }

    const armorIgnoredByQinggang = source?.equipment.weapon?.kind === "weapon_qinggang_sword";
    const sourceMayDisableDodgeByTieqi = source ? hasSkillOnPlayer(state, source.id, STANDARD_SKILL_IDS.machaoTieqi) : false;
    if (!armorIgnoredByQinggang && !sourceMayDisableDodgeByTieqi && human.equipment.armor?.kind === "armor_eight_diagram") {
      const judgedAsDodge = prepareEightDiagramJudge(state, human.id);
      if (judgedAsDodge === true) {
        return null;
      }
    }

    if (!canRespondWithDodge(state, human.id)) {
      return null;
    }

    return {
      kind: "dodge",
      message: `是否打出【闪】响应这张【杀】？`,
      action,
      previewCardEventMessage
    };
  }

  if (kind === "archery" && action.targetId === human.id && canRespondWithDodge(state, human.id)) {
    return {
      kind: "dodge",
      message: `是否打出【闪】响应【万箭齐发】？`,
      action,
      previewCardEventMessage
    };
  }

  if (kind === "duel" && action.targetId === human.id && canRespondWithSlash(state, human.id)) {
    return {
      kind: "slash",
      message: `是否打出【杀】响应【决斗】？`,
      action,
      previewCardEventMessage
    };
  }

  if (kind === "duel" && action.targetId === human.id && canAttemptJijiangSlashResponse(state, human.id)) {
    return {
      kind: "slash",
      message: `是否打出【杀】响应【决斗】？`,
      action,
      previewCardEventMessage,
      allowRespond: true
    };
  }

  if (kind === "barbarian" && action.targetId === human.id && canRespondWithSlash(state, human.id)) {
    return {
      kind: "slash",
      message: `是否打出【杀】响应【南蛮入侵】？`,
      action,
      previewCardEventMessage
    };
  }

  if (kind === "barbarian" && action.targetId === human.id && canAttemptJijiangSlashResponse(state, human.id)) {
    return {
      kind: "slash",
      message: `是否打出【杀】响应【南蛮入侵】？`,
      action,
      previewCardEventMessage,
      allowRespond: true
    };
  }

  const assistResponse = getPendingAssistResponseForAiAction(state, action, kind);
  if (assistResponse) {
    return {
      ...assistResponse,
      previewCardEventMessage
    };
  }

  if (shouldPromptHumanPeachResponseForAiAction(state, action)) {
    return {
      kind: "peach",
      message: "若有角色进入濒死，是否使用【桃】参与救援？",
      action,
      previewCardEventMessage,
      allowRespond: canRespondWithPeach(state, human.id)
    };
  }

  if (!canNullifyCurrentAction) {
    return null;
  }

  return null;
}

function hasSkillOnPlayer(state: Game, playerId: string, skillId: string): boolean {
  const skills = state.skillSystem.playerSkills[playerId] ?? [];
  return skills.includes(skillId);
}

function canAttemptJijiangSlashResponse(state: Game, playerId: string): boolean {
  const player = state.players.find((item) => item.id === playerId);
  if (!player || !player.alive) {
    return false;
  }

  if (player.identity !== "lord") {
    return false;
  }

  if (!hasSkillOnPlayer(state, player.id, STANDARD_SKILL_IDS.liubeiJijiang)) {
    return false;
  }

  return state.players.some(
    (candidate) => candidate.alive && candidate.id !== player.id && getPlayerKingdomById(state, candidate.id) === "shu"
  );
}

function getPendingAssistResponseForAiAction(state: Game, action: TurnAction, inferredKind: string): PendingHumanResponse | null {
  const human = getHumanPlayer(state);
  if (!human.alive) {
    return null;
  }

  const humanKingdom = getPlayerKingdomById(state, human.id);
  if (humanKingdom) {
    const hujiaLord =
      humanKingdom === "wei"
        ? state.players.find(
            (player) =>
              player.alive &&
              player.isAi &&
              player.identity === "lord" &&
              hasSkillOnPlayer(state, player.id, STANDARD_SKILL_IDS.caocaoHujia)
          )
        : undefined;
    if (hujiaLord && canRespondWithDodge(state, human.id) && actionMayRequireDodgeFromPlayer(state, action, inferredKind, hujiaLord.id)) {
      return {
        kind: "hujia",
        message: `是否允许本次为 ${hujiaLord.name} 发动【护驾】代打【闪】？`,
        action
      };
    }

    const jijiangLord =
      humanKingdom === "shu"
        ? state.players.find(
            (player) =>
              player.alive &&
              player.isAi &&
              player.identity === "lord" &&
              hasSkillOnPlayer(state, player.id, STANDARD_SKILL_IDS.liubeiJijiang)
          )
        : undefined;
    if (jijiangLord && canRespondWithSlash(state, human.id) && actionMayRequireSlashFromPlayer(state, action, inferredKind, jijiangLord.id)) {
      return {
        kind: "jijiang",
        message: `是否允许本次为 ${jijiangLord.name} 发动【激将】代打【杀】？`,
        action
      };
    }
  }

  return null;
}

function actionMayRequireDodgeFromPlayer(state: Game, action: TurnAction, inferredKind: string, ownerId: string): boolean {
  if (action.type !== "play-card") {
    return false;
  }

  if (inferredKind === "slash") {
    return action.targetId === ownerId;
  }

  if (inferredKind === "archery") {
    return action.actorId !== ownerId;
  }

  if (inferredKind === "collateral") {
    return action.secondaryTargetId === ownerId;
  }

  return false;
}

function actionMayRequireSlashFromPlayer(state: Game, action: TurnAction, inferredKind: string, ownerId: string): boolean {
  if (action.type !== "play-card") {
    return false;
  }

  if (action.cardId.startsWith("__virtual_jijiang__::") && action.actorId === ownerId) {
    return true;
  }

  if (inferredKind === "duel") {
    return action.targetId === ownerId;
  }

  if (inferredKind === "barbarian") {
    return action.actorId !== ownerId;
  }

  if (inferredKind === "collateral") {
    return action.targetId === ownerId;
  }

  return false;
}

function shouldPromptHumanPeachResponseForAiAction(state: Game, action: TurnAction): boolean {
  if (action.type !== "play-card") {
    return false;
  }

  const human = getHumanPlayer(state);
  if (!human.alive || !canRespondWithPeach(state, human.id)) {
    return false;
  }

  const kind = inferActionCardKindForResponse(state, action);
  if (!kind) {
    return false;
  }

  const targetIds = getPotentialDyingTargetsForAction(state, action, kind);
  if (targetIds.length === 0) {
    return false;
  }

  return targetIds.some((targetId) => {
    const target = state.players.find((player) => player.id === targetId);
    return target !== undefined && target.alive && target.hp <= 1;
  });
}

function getPotentialDyingTargetsForAction(state: Game, action: TurnAction, kind: string): string[] {
  if (kind === "slash" || kind === "duel") {
    return action.targetId ? [action.targetId] : [];
  }

  if (kind === "barbarian" || kind === "archery") {
    return state.players
      .filter((player) => player.alive && player.id !== action.actorId)
      .map((player) => player.id);
  }

  if (kind === "collateral") {
    return action.secondaryTargetId ? [action.secondaryTargetId] : [];
  }

  return [];
}

function queuePendingBladeFollowUpPrompt(): boolean {
  const pending = game.pendingBladeFollowUp;
  if (!pending) {
    return false;
  }

  const human = getHumanPlayer(game);
  if (pending.sourceId !== human.id) {
    return false;
  }

  const target = game.players.find((player) => player.id === pending.targetId);
  pendingHumanResponse = {
    kind: "blade-follow-up",
    message: `${target?.name ?? "目标"} 打出【闪】后，是否发动青龙偃月刀追击？`,
    action: { type: "end-play-phase", actorId: human.id },
    allowRespond: canRespondWithSlash(game, human.id)
  };
  return true;
}

function bindHandButtons(legalActions: TurnAction[]): void {
  const playableSourceIds = new Set(
    legalActions.map((action) => getActionSourceCardId(action)).filter((cardId): cardId is string => cardId !== null)
  );

  const handButtons = app.querySelectorAll<HTMLButtonElement>("button[data-role='hand-card']");
  handButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.dataset.cardId;
      if (!cardId) {
        return;
      }

      const pendingManualDiscard = getPendingManualDiscardChoice(game);
      if (pendingManualDiscard) {
        if (selectedDiscardCardIds.includes(cardId)) {
          selectedDiscardCardIds = selectedDiscardCardIds.filter((id) => id !== cardId);
        } else if (selectedDiscardCardIds.length < pendingManualDiscard.needCount) {
          selectedDiscardCardIds = [...selectedDiscardCardIds, cardId];
        }
        render();
        ensureAutoLoop();
        return;
      }

      if (selectedCardId === cardId && pendingPrimaryTargetId) {
        const sourceActions = legalActions.filter(
          (action) => action.type === "play-card" && getActionSourceCardId(action) === cardId
        );
        const confirmActions = pendingSecondaryTargetId
          ? sourceActions.filter(
              (action) =>
                action.type === "play-card" &&
                action.targetId === pendingPrimaryTargetId &&
                action.secondaryTargetId === pendingSecondaryTargetId &&
                !action.tertiaryTargetId
            )
          : sourceActions.filter(
              (action) => action.type === "play-card" && action.targetId === pendingPrimaryTargetId && !action.secondaryTargetId
            );

        if (confirmActions.length > 0) {
          const action = choosePreferredAction(confirmActions);
          previewTargetIds = [];
          selectedCardId = null;
          pendingPrimaryTargetId = null;
          pendingSecondaryTargetId = null;
          pendingZoneChoiceActions = [];
          pendingZoneCardChoiceActions = [];
          executeHumanChosenAction(action);
          return;
        }
      }

      if (!playableSourceIds.has(cardId)) {
        selectedCardId = cardId;
        pendingPrimaryTargetId = null;
        pendingSecondaryTargetId = null;
        pendingZoneChoiceActions = [];
        previewTargetIds = [];
        render();
        ensureAutoLoop();
        return;
      }

      selectedCardId = selectedCardId === cardId ? null : cardId;
      pendingPrimaryTargetId = null;
      pendingSecondaryTargetId = null;
      pendingZoneChoiceActions = [];
      pendingZoneCardChoiceActions = [];
      const selectedActions = selectedCardId
        ? legalActions.filter((action) => action.type === "play-card" && getActionSourceCardId(action) === selectedCardId)
        : [];
      const immediateAction =
        selectedActions.length === 1 && selectedActions[0].type === "play-card"
          ? selectedActions[0]
          : null;

      const humanId = getHumanPlayer(game).id;
      const autoEquipAction =
        selectedActions.length === 1 &&
        selectedActions[0].type === "play-card" &&
        selectedActions[0].targetId === humanId &&
        !selectedActions[0].secondaryTargetId &&
        isEquipmentCardKind(resolveActionCardKind(game, selectedActions[0]))
          ? selectedActions[0]
          : null;

      const autoDirectAction =
        selectedActions.find(
          (action) =>
            action.type === "play-card" &&
            action.targetId === humanId &&
            !action.secondaryTargetId &&
            resolveActionCardKind(game, action) === "peach"
        ) ??
        (immediateAction &&
        ((!immediateAction.targetId && !immediateAction.secondaryTargetId) ||
          (immediateAction.targetId === humanId &&
            !immediateAction.secondaryTargetId &&
            isSelfImmediateCastCard(resolveActionCardKind(game, immediateAction))))
          ? immediateAction
          : null);

      if (autoEquipAction) {
        previewTargetIds = [];
        selectedCardId = null;
        pendingPrimaryTargetId = null;
        pendingSecondaryTargetId = null;
        pendingZoneChoiceActions = [];
        pendingZoneCardChoiceActions = [];
        executeHumanChosenAction(autoEquipAction);
        return;
      }

      if (autoDirectAction) {
        previewTargetIds = [];
        selectedCardId = null;
        pendingPrimaryTargetId = null;
        pendingSecondaryTargetId = null;
        pendingZoneChoiceActions = [];
        pendingZoneCardChoiceActions = [];
        executeHumanChosenAction(autoDirectAction);
        return;
      }

      previewTargetIds = Array.from(
        new Set(selectedActions.map((action) => action.targetId).filter((targetId): targetId is string => Boolean(targetId)))
      );
      render();
      ensureAutoLoop();
    });
  });
}

function bindManualDiscardButtons(): void {
  const confirmButton = app.querySelector<HTMLButtonElement>("button[data-role='manual-discard-confirm']");
  confirmButton?.addEventListener("click", () => {
    const pending = getPendingManualDiscardChoice(game);
    if (!pending) {
      return;
    }

    if (selectedDiscardCardIds.length < pending.needCount) {
      return;
    }

    discardSelectedCards(game, pending.actor.id, selectedDiscardCardIds.slice(0, pending.needCount));
    selectedDiscardCardIds = [];
    stepPhase(game);
    runAutoUntilHumanChoice();
    render();
    ensureAutoLoop();
  });
}

function bindHarvestChoiceButtons(): void {
  const buttons = app.querySelectorAll<HTMLButtonElement>("button[data-role='harvest-choice']");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.dataset.cardId;
      if (!cardId) {
        return;
      }

      const human = getHumanPlayer(game);
      if (!hasQueuedNullifyDecision(game, human.id)) {
        const pendingNullify = getPendingHarvestNullifyResponse();
        if (pendingNullify) {
          pendingHumanResponse = pendingNullify;
          render();
          ensureAutoLoop();
          return;
        }
      }

      chooseHarvestCard(game, cardId);
      clearResponseDecisionState(game);
      runAutoUntilHumanChoice();
      render();
      ensureAutoLoop();
    });
  });
}

function getPendingHarvestNullifyResponse(cardId?: string): PendingHumanResponse | null {
  const pendingHarvest = getPendingHarvestChoice(game);
  if (!pendingHarvest) {
    return null;
  }

  const syntheticAction: PlayCardAction = {
    type: "play-card",
    actorId: pendingHarvest.sourceId,
    cardId: "__pending_harvest__",
    targetId: pendingHarvest.pickerId
  };

  const pending = getPendingHumanResponseForAiAction(game, syntheticAction);
  if (!pending || pending.kind !== "nullify") {
    return null;
  }

  if (!cardId) {
    return pending;
  }

  return {
    ...pending,
    pendingHarvestCardId: cardId
  };
}

function hasQueuedNullifyDecision(state: Game, playerId: string): boolean {
  const queue = state.responseDecisionQueueByPlayer[playerId]?.nullify;
  return Array.isArray(queue) && queue.length > 0;
}

function queuePendingHarvestNullifyPrompt(): boolean {
  if (pendingHumanResponse) {
    return false;
  }

  const pendingHarvest = getPendingHarvestChoice(game);
  if (!pendingHarvest) {
    return false;
  }

  const human = getHumanPlayer(game);
  if (pendingHarvest.pickerId !== human.id) {
    return false;
  }

  if (hasQueuedNullifyDecision(game, human.id)) {
    return false;
  }

  const pendingNullify = getPendingHarvestNullifyResponse();
  if (!pendingNullify) {
    return false;
  }

  pendingHumanResponse = pendingNullify;
  return true;
}

function getPendingMassTrickNullifyResponse(action: PlayCardAction): PendingHumanResponse | null {
  const isPendingMass = action.cardId.startsWith("__pending_barbarian__") || action.cardId.startsWith("__pending_archery__");
  if (!isPendingMass) {
    return null;
  }

  const human = getHumanPlayer(game);
  if (!human.alive) {
    return null;
  }

  const inferredKind = inferActionCardKindForResponse(game, action);
  if (inferredKind !== "barbarian" && inferredKind !== "archery") {
    return null;
  }

  const nullifyTrickKind = inferredKind as PendingHumanResponse["nullifyTrickKind"];
  const nullifyTargetIds = getNullifyPromptTargetIds(game, action, nullifyTrickKind);
  const nullifyTargetId = nullifyTargetIds[0] ?? action.targetId;
  const previewCardEventMessage = buildCardEventPreviewMessage(game, action, inferredKind);

  return {
    kind: "nullify",
    message: buildNullifyPromptMessage(game, nullifyTrickKind, 1, nullifyTargetId, nullifyTargetIds, action.actorId, 0, []),
    action,
    previewCardEventMessage,
    allowRespond: canRespondWithNullify(game, human.id),
    nullifyTrickKind,
    nullifySourceId: action.actorId,
    nullifyTargetId,
    nullifyChosenDecisions: [],
    nullifyGroupTargetIds: nullifyTargetIds,
    nullifyGroupCursor: 0,
    nullifyQueuedTrueCount: 0
  };
}

function queuePendingMassTrickNullifyPrompt(action: PlayCardAction): boolean {
  if (pendingHumanResponse) {
    return false;
  }

  const pending = getPendingMassTrickNullifyResponse(action);
  if (!pending) {
    return false;
  }

  pendingHumanResponse = pending;
  return true;
}

function autoChooseHarvestForAiIfNeeded(): boolean {
  const pending = getPendingHarvestChoice(game);
  if (!pending || pending.revealed.length === 0) {
    return false;
  }

  const picker = game.players.find((player) => player.id === pending.pickerId);
  if (!picker || !picker.alive || !picker.isAi) {
    return false;
  }

  const pendingNullify = getPendingHarvestNullifyResponse(pending.revealed[0].id);
  if (pendingNullify) {
    pendingHumanResponse = pendingNullify;
    return true;
  }

  chooseHarvestCard(game, pending.revealed[0].id);
  clearResponseDecisionState(game);
  return true;
}

function clearResponseDecisionState(state: Game): void {
  state.responsePreferenceByPlayer = {};
  state.responseDecisionQueueByPlayer = {};
}

function bindPlayerTargetButtons(selectedCardActions: TurnAction[]): void {
  const playerRows = app.querySelectorAll<HTMLDivElement>(".player-row[data-player-id]");
  const pendingTuxiChoice = getPendingTuxiChoice(game);
  const tuxiCandidateIds = new Set((pendingTuxiChoice?.candidates ?? []).map((candidate) => candidate.id));
  playerRows.forEach((row) => {
    row.addEventListener("click", () => {
      const playerId = row.dataset.playerId;
      if (!playerId) {
        return;
      }

      if (pendingTuxiChoice) {
        if (!tuxiCandidateIds.has(playerId)) {
          return;
        }

        if (selectedTuxiTargetIds.includes(playerId)) {
          selectedTuxiTargetIds = selectedTuxiTargetIds.filter((id) => id !== playerId);
        } else if (selectedTuxiTargetIds.length < 2) {
          selectedTuxiTargetIds = [...selectedTuxiTargetIds, playerId];
        }

        render();
        ensureAutoLoop();
        return;
      }

      if (!selectedCardId && selectedCardActions.length === 0) {
        return;
      }

      if (pendingPrimaryTargetId && pendingSecondaryTargetId) {
        const tertiaryActions = selectedCardActions.filter(
          (action) =>
            action.type === "play-card" &&
            action.targetId === pendingPrimaryTargetId &&
            action.secondaryTargetId === pendingSecondaryTargetId &&
            action.tertiaryTargetId === playerId
        );

        if (tertiaryActions.length > 0) {
          const action = choosePreferredAction(tertiaryActions);
          previewTargetIds = [];
          selectedCardId = null;
          pendingPrimaryTargetId = null;
          pendingSecondaryTargetId = null;
          pendingZoneChoiceActions = [];
          pendingZoneCardChoiceActions = [];
          executeHumanChosenAction(action);
          return;
        }
      }

      if (pendingPrimaryTargetId) {
        const secondaryActions = selectedCardActions.filter(
          (action) =>
            action.type === "play-card" && action.targetId === pendingPrimaryTargetId && action.secondaryTargetId === playerId
        );

        if (secondaryActions.length > 0) {
          const needsTertiaryActions = secondaryActions.filter((action) => Boolean(action.tertiaryTargetId));
          if (needsTertiaryActions.length > 0) {
            pendingSecondaryTargetId = playerId;
            previewTargetIds = Array.from(
              new Set(
                needsTertiaryActions
                  .map((action) => action.tertiaryTargetId)
                  .filter((targetId): targetId is string => Boolean(targetId))
              )
            );
            render();
            ensureAutoLoop();
            return;
          }

          const action = choosePreferredAction(secondaryActions);
          previewTargetIds = [];
          selectedCardId = null;
          pendingPrimaryTargetId = null;
          pendingSecondaryTargetId = null;
          pendingZoneChoiceActions = [];
          pendingZoneCardChoiceActions = [];
          executeHumanChosenAction(action);
          return;
        }
      }

      const primaryActions = selectedCardActions.filter((action) => action.type === "play-card" && action.targetId === playerId);
      if (primaryActions.length === 0) {
        return;
      }

      const zoneCandidateActions = primaryActions.filter((action) => !action.secondaryTargetId);
      const zones = Array.from(
        new Set(zoneCandidateActions.map((action) => action.targetZone).filter((zone): zone is string => Boolean(zone)))
      );
      if (zoneCandidateActions.length > 1 && zones.length > 1) {
        pendingZoneChoiceActions = zoneCandidateActions;
        pendingZoneCardChoiceActions = [];
        pendingPrimaryTargetId = null;
        pendingSecondaryTargetId = null;
        previewTargetIds = [playerId];
        render();
        ensureAutoLoop();
        return;
      }

      if (zoneCandidateActions.length > 1 && zones.length === 1) {
        pendingZoneChoiceActions = [];
        pendingZoneCardChoiceActions = zoneCandidateActions;
        pendingPrimaryTargetId = null;
        pendingSecondaryTargetId = null;
        previewTargetIds = [playerId];
        render();
        ensureAutoLoop();
        return;
      }

      const requiresSecondaryActions = primaryActions.filter((action) => action.secondaryTargetId);
      if (requiresSecondaryActions.length > 0) {
        pendingPrimaryTargetId = playerId;
        pendingSecondaryTargetId = null;
        pendingZoneChoiceActions = [];
        pendingZoneCardChoiceActions = [];
        previewTargetIds = Array.from(
          new Set(
            requiresSecondaryActions
              .map((action) => action.secondaryTargetId)
              .filter((targetId): targetId is string => Boolean(targetId))
          )
        );
        render();
        ensureAutoLoop();
        return;
      }

      const action = choosePreferredAction(primaryActions);
      previewTargetIds = [];
      selectedCardId = null;
      pendingPrimaryTargetId = null;
      pendingSecondaryTargetId = null;
      pendingZoneChoiceActions = [];
      pendingZoneCardChoiceActions = [];
      executeHumanChosenAction(action);
    });
  });
}

function bindInlineEndPlayButton(endPlayAction: TurnAction | null): void {
  const endPlayButton = app.querySelector<HTMLButtonElement>("button[data-role='end-play-inline']");
  if (!endPlayButton || !endPlayAction) {
    return;
  }

  endPlayButton.addEventListener("click", () => {
    previewTargetIds = [];
    selectedCardId = null;
    pendingPrimaryTargetId = null;
    pendingSecondaryTargetId = null;
    pendingZoneChoiceActions = [];
    pendingZoneCardChoiceActions = [];
    applyAction(game, endPlayAction);
    stepPhase(game);
    runAutoUntilHumanChoice();
    render();
    ensureAutoLoop();
  });
}

function bindZoneChoiceButtons(): void {
  const zoneButtons = app.querySelectorAll<HTMLButtonElement>("button[data-role='zone-choice']");
  zoneButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const zone = button.dataset.zone;
      if (!zone) {
        return;
      }

      const candidate = pendingZoneChoiceActions.filter((action) => action.targetZone === zone);
      if (candidate.length === 0) {
        return;
      }

      if (candidate.length > 1) {
        pendingZoneCardChoiceActions = candidate;
        render();
        ensureAutoLoop();
        return;
      }

      const action = choosePreferredAction(candidate);
      previewTargetIds = [];
      selectedCardId = null;
      pendingPrimaryTargetId = null;
      pendingSecondaryTargetId = null;
      pendingZoneChoiceActions = [];
      pendingZoneCardChoiceActions = [];
      executeHumanChosenAction(action);
    });
  });
}

function bindZoneCardChoiceButtons(): void {
  const buttons = app.querySelectorAll<HTMLButtonElement>("button[data-role='zone-card-choice']");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= pendingZoneCardChoiceActions.length) {
        return;
      }

      const action = pendingZoneCardChoiceActions[index];
      previewTargetIds = [];
      selectedCardId = null;
      pendingPrimaryTargetId = null;
      pendingSecondaryTargetId = null;
      pendingZoneChoiceActions = [];
      pendingZoneCardChoiceActions = [];
      executeHumanChosenAction(action);
    });
  });
}

function choosePreferredAction(actions: TurnAction[]): TurnAction {
  const concrete = actions.find((action) => action.type === "play-card" && !action.cardId.startsWith("__virtual_"));
  if (concrete) {
    return concrete;
  }

  const rende = actions.find((action) => action.type === "play-card" && action.cardId.startsWith("__virtual_rende__::"));
  if (rende) {
    return rende;
  }

  return actions[0];
}

function executeHumanChosenAction(action: TurnAction): void {
  const human = getHumanPlayer(game);
  const inferredKind = inferActionCardKindForResponse(game, action);
  const shouldSkipPreNullifyPromptForHumanGroupTrick =
    action.type === "play-card" &&
    action.actorId === human.id &&
    !action.targetId &&
    (inferredKind === "harvest" || inferredKind === "taoyuan" || inferredKind === "barbarian" || inferredKind === "archery");

  if (!shouldSkipPreNullifyPromptForHumanGroupTrick) {
    const pending = getPendingHumanResponseForAiAction(game, action);
    if (pending?.kind === "nullify") {
      pendingHumanResponse = pending;
      render();
      ensureAutoLoop();
      return;
    }
  }

  disableHumanAutoNullifyForAction(game, action);
  applyAction(game, action);
  clearResponseDecisionState(game);
  if (queuePendingBladeFollowUpPrompt()) {
    render();
    ensureAutoLoop();
    return;
  }
  if (action.type === "end-play-phase") {
    stepPhase(game);
  }
  runAutoUntilHumanChoice();
  render();
  ensureAutoLoop();
}

function isNullifiableActionKind(kind: string | null): boolean {
  if (!kind) {
    return false;
  }

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

function disableHumanAutoNullifyForAction(state: Game, action: TurnAction): void {
  if (action.type !== "play-card") {
    return;
  }

  const kind = inferActionCardKindForResponse(state, action);
  if (!isNullifiableActionKind(kind)) {
    return;
  }

  const human = getHumanPlayer(state);
  setResponsePreference(state, human.id, "nullify", false);
}

function bindTargetActionButtons(selectedCardActions: TurnAction[], endPlayAction: TurnAction | null): void {
  const actionButtons = app.querySelectorAll<HTMLButtonElement>("button[data-role='action']");
  actionButtons.forEach((button) => {
    const preview = (): void => {
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= selectedCardActions.length) {
        return;
      }

      previewTargetIds = getActionPreviewTargets(selectedCardActions[index]);
      updatePlayerPreview(previewTargetIds);
    };

    const clearPreview = (): void => {
      if (previewTargetIds.length === 0) {
        return;
      }

      previewTargetIds = [];
      updatePlayerPreview(previewTargetIds);
    };

    button.addEventListener("mouseenter", preview);
    button.addEventListener("focus", preview);
    button.addEventListener("mouseleave", clearPreview);
    button.addEventListener("blur", clearPreview);

    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= selectedCardActions.length) {
        return;
      }

      const action = selectedCardActions[index];
      previewTargetIds = [];
      selectedCardId = null;
      executeHumanChosenAction(action);
    });
  });

  const endPlayButton = app.querySelector<HTMLButtonElement>("button[data-role='end-play']");
  if (endPlayButton && endPlayAction) {
    endPlayButton.addEventListener("click", () => {
      previewTargetIds = [];
      selectedCardId = null;
      applyAction(game, endPlayAction);
      stepPhase(game);
      runAutoUntilHumanChoice();
      render();
      ensureAutoLoop();
    });
  }
}

function runOneTick(): void {
  if (game.winner) {
    return;
  }

  const pendingMassAction = getPendingMassTrickAction(game);
  if (pendingMassAction) {
    if (queuePendingMassTrickNullifyPrompt(pendingMassAction)) {
      return;
    }

    disableHumanAutoNullifyForAction(game, pendingMassAction);
    applyAction(game, pendingMassAction);
    clearResponseDecisionState(game);
    return;
  }

  if (queuePendingHarvestNullifyPrompt()) {
    return;
  }

  if (autoChooseHarvestForAiIfNeeded()) {
    return;
  }

  if (
    getPendingTuxiChoice(game) ||
    isPendingLuoyiChoice(game) ||
    pendingHumanResponse ||
    getPendingManualDiscardChoice(game) ||
    getPendingHarvestChoice(game)
  ) {
    return;
  }

  const actor = game.players.find((player) => player.id === game.currentPlayerId);
  if (!actor || !actor.alive) {
    stepPhase(game);
    return;
  }

  if (game.phase !== "play") {
    stepPhase(game);
    return;
  }

  if (!actor.isAi) {
    const legalActions = getLegalActions(game).filter((action) => action.actorId === actor.id);
    if (legalActions.length === 0) {
      stepPhase(game);
    }
    return;
  }

  const action = chooseAiAction({ state: game, actor });
  const pending = getPendingHumanResponseForAiAction(game, action);
  if (pending) {
    pendingHumanResponse = pending;
    return;
  }
  disableHumanAutoNullifyForAction(game, action);
  applyAction(game, action);
  clearResponseDecisionState(game);
  if (action.type === "end-play-phase") {
    stepPhase(game);
  }
}

function runAutoUntilHumanChoice(maxTicks = 500): void {
  let ticks = 0;
  while (!game.winner && ticks < maxTicks) {
    const pendingMassAction = getPendingMassTrickAction(game);
    if (pendingMassAction) {
      if (queuePendingMassTrickNullifyPrompt(pendingMassAction)) {
        break;
      }

      disableHumanAutoNullifyForAction(game, pendingMassAction);
      applyAction(game, pendingMassAction);
      clearResponseDecisionState(game);
      ticks += 1;
      continue;
    }

    if (queuePendingHarvestNullifyPrompt()) {
      break;
    }

    if (autoChooseHarvestForAiIfNeeded()) {
      ticks += 1;
      continue;
    }

    if (
      getPendingTuxiChoice(game) ||
      isPendingLuoyiChoice(game) ||
      pendingHumanResponse ||
      getPendingManualDiscardChoice(game) ||
      getPendingHarvestChoice(game)
    ) {
      break;
    }

    const actor = game.players.find((player) => player.id === game.currentPlayerId);
    if (!actor || !actor.alive || game.phase !== "play") {
      stepPhase(game);
      ticks += 1;
      continue;
    }

    if (!actor.isAi) {
      const legalActions = getLegalActions(game).filter((action) => action.actorId === actor.id);
      if (legalActions.length > 0) {
        break;
      }

      stepPhase(game);
      ticks += 1;
      continue;
    }

    const action = chooseAiAction({ state: game, actor });
    const pending = getPendingHumanResponseForAiAction(game, action);
    if (pending) {
      pendingHumanResponse = pending;
      break;
    }
    disableHumanAutoNullifyForAction(game, action);
    applyAction(game, action);
    clearResponseDecisionState(game);
    if (action.type === "end-play-phase") {
      stepPhase(game);
    }
    ticks += 1;
  }
}

function ensureAutoLoop(): void {
  if (autoplayTimer !== null) {
    window.clearTimeout(autoplayTimer);
    autoplayTimer = null;
  }

  if (!gameStarted || !autoMode || game.winner) {
    return;
  }

  autoplayTimer = window.setTimeout(() => {
    const actor = game.players.find((player) => player.id === game.currentPlayerId);
    const shouldWaitForHuman =
      (actor && !actor.isAi && game.phase === "play") ||
      !!getPendingTuxiChoice(game) ||
      isPendingLuoyiChoice(game) ||
      !!pendingHumanResponse ||
      !!getPendingManualDiscardChoice(game) ||
      (() => {
        const pendingHarvest = getPendingHarvestChoice(game);
        return !!pendingHarvest && pendingHarvest.pickerId === getHumanPlayer(game).id;
      })();
    if (!shouldWaitForHuman) {
      runAutoUntilHumanChoice();
      render();
    }
    ensureAutoLoop();
  }, 180);
}
