import { Card, CardKind } from "./types";
import { isCardKindInCurrentScope } from "./standard-scope";

/**
 * 根据预设分布生成一副用于 MVP 测试的卡牌堆。
 *
 * 当前分布并非官方完整牌堆，仅用于规则迭代阶段：
 * - 杀 30
 * - 闪 20
 * - 桃 12
 * - 过河拆桥 8
 * - 顺手牵羊 8
 * - 无懈可击 6
 * - 决斗 6
 * - 南蛮入侵 4
 * - 万箭齐发 4
 * - 桃园结义 4
 * - 五谷丰登 4
 * - 无中生有 4
 * - 借刀杀人 4
 * - 武器（攻击范围+1） 4
 * - +1坐骑 4
 * - -1坐骑 4
 * - 乐不思蜀 4
 * - 闪电 2
 *
 * @param totalPerKind 兼容参数，若传入则会覆盖每种牌数量为同一值。
 * @returns 未洗牌的卡牌列表。
 */
export function createDeck(totalPerKind = 24): Card[] {
  const deck: Card[] = [];
  const distribution: Array<{ kind: CardKind; count: number }> = totalPerKind === 24
    ? [
      { kind: "slash", count: 30 },
      { kind: "dodge", count: 20 },
      { kind: "peach", count: 12 },
      { kind: "dismantle", count: 8 },
      { kind: "snatch", count: 8 },
      { kind: "nullify", count: 6 },
      { kind: "duel", count: 6 },
      { kind: "barbarian", count: 4 },
      { kind: "archery", count: 4 },
      { kind: "taoyuan", count: 4 },
      { kind: "harvest", count: 4 },
      { kind: "ex_nihilo", count: 4 },
      { kind: "collateral", count: 4 },
      { kind: "weapon_blade", count: 4 },
      { kind: "horse_plus", count: 4 },
      { kind: "horse_minus", count: 4 },
      { kind: "indulgence", count: 4 },
      { kind: "lightning", count: 2 }
    ]
    : [
      { kind: "slash", count: totalPerKind },
      { kind: "dodge", count: totalPerKind },
      { kind: "peach", count: totalPerKind },
      { kind: "dismantle", count: totalPerKind },
      { kind: "snatch", count: totalPerKind },
      { kind: "nullify", count: totalPerKind },
      { kind: "duel", count: totalPerKind },
      { kind: "barbarian", count: totalPerKind },
      { kind: "archery", count: totalPerKind },
      { kind: "taoyuan", count: totalPerKind },
      { kind: "harvest", count: totalPerKind },
      { kind: "ex_nihilo", count: totalPerKind },
      { kind: "collateral", count: totalPerKind },
      { kind: "weapon_blade", count: totalPerKind },
      { kind: "horse_plus", count: totalPerKind },
      { kind: "horse_minus", count: totalPerKind },
      { kind: "indulgence", count: totalPerKind },
      { kind: "lightning", count: totalPerKind }
    ];

  for (const entry of distribution) {
    if (!isCardKindInCurrentScope(entry.kind)) {
      throw new Error(`当前范围仅支持标准版身份场，检测到超出范围牌种: ${entry.kind}`);
    }
  }

  let seq = 1;

  for (const entry of distribution) {
    for (let index = 0; index < entry.count; index += 1) {
      deck.push({
        id: `${entry.kind}-${seq}`,
        kind: entry.kind
      });
      seq += 1;
    }
  }

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
