import { CardKind } from "./types";

/**
 * 当前实现阶段的规则范围定义。
 *
 * 约束：仅支持“标准版三国杀”的“身份场”主线能力。
 * 该常量用于对外声明范围与在内部做防误用校验。
 */
export const CURRENT_SCOPE = {
  edition: "standard",
  mode: "identity",
  generalPool: "standard-only"
} as const;

/**
 * 当前阶段允许进入牌堆的牌种集合。
 *
 * 说明：
 * - 仅收录本项目当前已实现并允许在标准身份场内使用的牌种。
 * - 后续扩展（军争、国战、EX 等）应新增独立范围常量，不应直接改写当前集合语义。
 */
export const CURRENT_STANDARD_IDENTITY_CARD_KINDS: ReadonlySet<CardKind> = new Set<CardKind>([
  "slash",
  "dodge",
  "peach",
  "dismantle",
  "snatch",
  "nullify",
  "duel",
  "barbarian",
  "archery",
  "taoyuan",
  "harvest",
  "ex_nihilo",
  "collateral",
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
  "horse_minus",
  "indulgence",
  "lightning"
]);

/**
 * 判断牌种是否在“当前标准身份场范围”内。
 *
 * @param kind 待校验牌种。
 * @returns 若属于当前范围返回 true。
 */
export function isCardKindInCurrentScope(kind: CardKind): boolean {
  return CURRENT_STANDARD_IDENTITY_CARD_KINDS.has(kind);
}
