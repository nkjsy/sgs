import { Card, CardKind, CardSuit } from "./types";
import { CURRENT_STANDARD_IDENTITY_CARD_KINDS, isCardKindInCurrentScope } from "./standard-scope";

interface DeckEntry {
  kind: CardKind;
  suit: CardSuit;
  point: number;
}

/**
 * 根据预设分布生成一副牌堆。
 *
 * 默认（totalPerKind=24）返回“标准版身份场”官方口径牌堆（当前采用标准+EX并入的108张口径）：
 * - 含显式花色与点数。
 * - 含标准装备牌名壳（暂未实现全部装备技能）。
 *
 * 兼容模式（totalPerKind!=24）用于测试：
 * - 按当前范围内每种牌等量生成。
 * - 花色与点数按固定模式轮转。
 *
 * @param totalPerKind 兼容参数，传入非 24 时启用等量测试牌堆。
 * @returns 未洗牌的卡牌列表。
 */
export function createDeck(totalPerKind = 24): Card[] {
  if (totalPerKind !== 24) {
    return createUniformDeck(totalPerKind);
  }

  const blueprint = getStandardIdentityOfficialBlueprint();
  for (const entry of blueprint) {
    if (!isCardKindInCurrentScope(entry.kind)) {
      throw new Error(`当前范围仅支持标准版身份场，检测到超出范围牌种: ${entry.kind}`);
    }
  }

  let seq = 1;
  return blueprint.map((entry) => {
    const card: Card = {
      id: `${entry.kind}-${entry.suit}-${entry.point}-${seq}`,
      kind: entry.kind,
      suit: entry.suit,
      point: entry.point
    };
    seq += 1;
    return card;
  });
}

function createUniformDeck(totalPerKind: number): Card[] {
  const deck: Card[] = [];
  const kinds = [...CURRENT_STANDARD_IDENTITY_CARD_KINDS.values()];
  const suits: CardSuit[] = ["spade", "heart", "club", "diamond"];
  let seq = 1;

  for (const kind of kinds) {
    for (let index = 0; index < totalPerKind; index += 1) {
      const point = (index % 13) + 1;
      const suit = suits[index % suits.length];
      deck.push({
        id: `${kind}-${suit}-${point}-${seq}`,
        kind,
        suit,
        point
      });
      seq += 1;
    }
  }

  return deck;
}

function getStandardIdentityOfficialBlueprint(): DeckEntry[] {
  const deck: DeckEntry[] = [];

  const add = (kind: CardKind, suit: CardSuit, point: number, count = 1): void => {
    for (let index = 0; index < count; index += 1) {
      deck.push({ kind, suit, point });
    }
  };

  add("slash", "spade", 7);
  add("slash", "spade", 8, 2);
  add("slash", "spade", 9, 2);
  add("slash", "spade", 10, 2);
  add("slash", "club", 2);
  add("slash", "club", 3);
  add("slash", "club", 4);
  add("slash", "club", 5);
  add("slash", "club", 6);
  add("slash", "club", 7);
  add("slash", "club", 8, 2);
  add("slash", "club", 9, 2);
  add("slash", "club", 10, 2);
  add("slash", "club", 11, 2);
  add("slash", "heart", 10, 2);
  add("slash", "heart", 11);
  add("slash", "diamond", 6);
  add("slash", "diamond", 7);
  add("slash", "diamond", 8);
  add("slash", "diamond", 9);
  add("slash", "diamond", 10);
  add("slash", "diamond", 13);

  add("dodge", "heart", 2, 2);
  add("dodge", "heart", 13);
  add("dodge", "diamond", 2, 2);
  add("dodge", "diamond", 3);
  add("dodge", "diamond", 4);
  add("dodge", "diamond", 5);
  add("dodge", "diamond", 6);
  add("dodge", "diamond", 7);
  add("dodge", "diamond", 8);
  add("dodge", "diamond", 9);
  add("dodge", "diamond", 10);
  add("dodge", "diamond", 11, 2);

  add("peach", "heart", 3);
  add("peach", "heart", 4);
  add("peach", "heart", 6);
  add("peach", "heart", 7);
  add("peach", "heart", 8);
  add("peach", "heart", 9);
  add("peach", "heart", 12);
  add("peach", "diamond", 12);

  add("weapon_crossbow", "club", 1);
  add("weapon_crossbow", "diamond", 1);
  add("weapon_double_sword", "spade", 2);
  add("weapon_qinggang_sword", "spade", 6);
  add("weapon_blade", "spade", 5);
  add("weapon_spear", "spade", 12);
  add("weapon_axe", "diamond", 5);
  add("weapon_halberd", "diamond", 12);
  add("weapon_kylin_bow", "heart", 5);
  add("armor_eight_diagram", "spade", 2);
  add("armor_eight_diagram", "club", 2);
  add("horse_jueying", "spade", 5);
  add("horse_dilu", "club", 5);
  add("horse_zhuahuangfeidian", "heart", 13);
  add("horse_chitu", "heart", 5);
  add("horse_dayuan", "spade", 13);
  add("horse_zixing", "diamond", 13);

  add("harvest", "heart", 3);
  add("harvest", "heart", 4);
  add("taoyuan", "heart", 1);
  add("barbarian", "spade", 7);
  add("barbarian", "spade", 13);
  add("barbarian", "club", 7);
  add("archery", "heart", 1);
  add("duel", "spade", 1);
  add("duel", "club", 1);
  add("duel", "diamond", 1);
  add("ex_nihilo", "heart", 7);
  add("ex_nihilo", "heart", 8);
  add("ex_nihilo", "heart", 9);
  add("ex_nihilo", "heart", 11);
  add("snatch", "spade", 3);
  add("snatch", "spade", 4);
  add("snatch", "spade", 11);
  add("snatch", "diamond", 3);
  add("snatch", "diamond", 4);
  add("dismantle", "spade", 3);
  add("dismantle", "spade", 4);
  add("dismantle", "spade", 12);
  add("dismantle", "club", 3);
  add("dismantle", "club", 4);
  add("dismantle", "heart", 12);
  add("collateral", "club", 12);
  add("collateral", "club", 13);
  add("nullify", "spade", 11);
  add("nullify", "club", 12);
  add("nullify", "club", 13);
  add("indulgence", "spade", 6);
  add("indulgence", "club", 6);
  add("indulgence", "heart", 6);
  add("lightning", "spade", 1);

  add("weapon_ice_sword", "spade", 2);
  add("armor_renwang_shield", "club", 2);
  add("lightning", "heart", 12);
  add("nullify", "diamond", 12);

  return deck;
}

/**
 * 使用线性同余发生器对卡牌堆进行可复现洗牌。
 *
 * @param input 原始卡牌列表。
 * @param seed 随机种子。
 * @returns 洗牌后的新数组。
 */
export function shuffleWithSeed(input: Card[], seed: number): Card[] {
  const output = [...input];
  let state = seed >>> 0;

  const random = (): number => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temp = output[index];
    output[index] = output[swapIndex];
    output[swapIndex] = temp;
  }

  return output;
}
