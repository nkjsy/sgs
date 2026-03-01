import {
  STANDARD_GENERAL_CHECKLIST,
  STANDARD_SKILL_IDS,
  applyAction,
  assignSkillToPlayer,
  chooseAiAction,
  createAiDecisionContext,
  createInitialGame,
  stepPhase
} from "@sgs/core";

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

function applyGeneralHp(slot: ReturnType<typeof createInitialGame>["players"][number], generalId: string): void {
  const baseMaxHp = GENERAL_BASE_MAX_HP[generalId] ?? 4;
  const roleBonus = slot.identity === "lord" ? 1 : 0;
  const finalMaxHp = baseMaxHp + roleBonus;
  slot.maxHp = finalMaxHp;
  slot.hp = finalMaxHp;
}

export type SingleRosterMode = "fixed-demo" | "random-general-pool";

export interface RunSingleSimulationOptions {
  maxTicks?: number;
  rosterMode?: SingleRosterMode;
}

export interface SingleSimulationResult {
  winner: ReturnType<typeof createInitialGame>["winner"];
  ticks: number;
  timeout: boolean;
  state: ReturnType<typeof createInitialGame>;
}

export function runSingleSimulation(seed: number, options: RunSingleSimulationOptions = {}): SingleSimulationResult {
  const maxTicks = options.maxTicks ?? 1200;
  const rosterMode = options.rosterMode ?? "fixed-demo";
  const state = createInitialGame(seed);
  if (rosterMode === "random-general-pool") {
    setupRandomGeneralPoolRoster(state, seed);
  } else {
    setupSingleDemoRoster(state);
  }

  let ticks = 0;
  while (!state.winner && ticks < maxTicks) {
    if (state.phase === "play") {
      const actor = state.players.find((player) => player.id === state.currentPlayerId);
      if (!actor || !actor.alive) {
        stepPhase(state);
        ticks += 1;
        continue;
      }

        const action = chooseAiAction(createAiDecisionContext(state, actor.id));
      applyAction(state, action);

      if (action.type === "end-play-phase") {
        stepPhase(state);
      }
      ticks += 1;
      continue;
    }

    stepPhase(state);
    ticks += 1;
  }

  return {
    winner: state.winner,
    ticks,
    timeout: !state.winner && ticks >= maxTicks,
    state
  };
}

export function setupSingleDemoRoster(state: ReturnType<typeof createInitialGame>): void {
  const [player1, player2, player3, player4, player5] = state.players;

  player1.name = "刘备";
  applyGeneralHp(player1, "liubei");
  assignSkillToPlayer(state, player1.id, STANDARD_SKILL_IDS.liubeiRende);
  assignSkillToPlayer(state, player1.id, STANDARD_SKILL_IDS.liubeiJijiang);

  player2.name = "周瑜";
  applyGeneralHp(player2, "zhouyu");
  assignSkillToPlayer(state, player2.id, STANDARD_SKILL_IDS.zhouyuYingzi);
  assignSkillToPlayer(state, player2.id, STANDARD_SKILL_IDS.zhouyuFanjian);

  player3.name = "甘宁";
  applyGeneralHp(player3, "ganning");
  assignSkillToPlayer(state, player3.id, STANDARD_SKILL_IDS.ganningQixi);

  player4.name = "陆逊";
  applyGeneralHp(player4, "luxun");
  assignSkillToPlayer(state, player4.id, STANDARD_SKILL_IDS.luxunQianxun);
  assignSkillToPlayer(state, player4.id, STANDARD_SKILL_IDS.luxunLianying);

  player5.name = "貂蝉";
  applyGeneralHp(player5, "diaochan");
  assignSkillToPlayer(state, player5.id, STANDARD_SKILL_IDS.diaochanBiyue);
}

function setupRandomGeneralPoolRoster(state: ReturnType<typeof createInitialGame>, seed: number): void {
  const pool = [...STANDARD_GENERAL_CHECKLIST];
  const shuffled = shuffleWithSeed(pool, seed ^ 0x9e3779b9);
  const chosen = shuffled.slice(0, state.players.length);

  for (let index = 0; index < chosen.length; index += 1) {
    const slot = state.players[index];
    const general = chosen[index];
    slot.name = general.generalName;
    applyGeneralHp(slot, general.generalId);

    for (const skillId of general.skills) {
      assignSkillToPlayer(state, slot.id, skillId);
    }
  }
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
