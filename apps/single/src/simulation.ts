import {
  STANDARD_GENERAL_CHECKLIST,
  STANDARD_SKILL_IDS,
  applyAction,
  assignSkillToPlayer,
  chooseAiAction,
  createInitialGame,
  stepPhase
} from "@sgs/core";

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

      const action = chooseAiAction({ state, actor });
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
  assignSkillToPlayer(state, player1.id, STANDARD_SKILL_IDS.liubeiRende);
  assignSkillToPlayer(state, player1.id, STANDARD_SKILL_IDS.liubeiJijiang);

  player2.name = "周瑜";
  assignSkillToPlayer(state, player2.id, STANDARD_SKILL_IDS.zhouyuYingzi);
  assignSkillToPlayer(state, player2.id, STANDARD_SKILL_IDS.zhouyuFanjian);

  player3.name = "甘宁";
  assignSkillToPlayer(state, player3.id, STANDARD_SKILL_IDS.ganningQixi);

  player4.name = "陆逊";
  assignSkillToPlayer(state, player4.id, STANDARD_SKILL_IDS.luxunQianxun);
  assignSkillToPlayer(state, player4.id, STANDARD_SKILL_IDS.luxunLianying);

  player5.name = "貂蝉";
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
