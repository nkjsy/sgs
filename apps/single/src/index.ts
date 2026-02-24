import { STANDARD_SKILL_IDS, applyAction, assignSkillToPlayer, chooseAiAction, createInitialGame, stepPhase } from "@sgs/core";

const EVENT_STYLE: Record<string, { tag: string; group: string }> = {
  "game-start": { tag: "START", group: "系统" },
  "game-over": { tag: "END", group: "系统" },
  phase: { tag: "PHASE", group: "阶段" },
  draw: { tag: "DRAW", group: "阶段" },
  action: { tag: "ACTION", group: "出牌" },
  card: { tag: "CARD", group: "出牌" },
  trick: { tag: "TRICK", group: "锦囊" },
  equip: { tag: "EQUIP", group: "装备" },
  response: { tag: "RESP", group: "响应" },
  nullify: { tag: "NULLIFY", group: "响应" },
  judge: { tag: "JUDGE", group: "判定" },
  damage: { tag: "DAMAGE", group: "伤害" },
  rescue: { tag: "RESCUE", group: "濒死" },
  death: { tag: "DEATH", group: "濒死" },
  turn: { tag: "TURN", group: "回合" },
  discard: { tag: "DISCARD", group: "弃牌" },
  deck: { tag: "DECK", group: "牌堆" },
  skill: { tag: "SKILL", group: "技能" }
};

/**
 * 启动单机模拟局。
 *
 * 当前版本会将所有玩家按 AI 逻辑运行，主要用于验证规则主循环。
 */
function runSingleSimulation(): void {
  const state = createInitialGame(20260222);
  setupSingleDemoRoster(state);
  /**
   * 单次模拟允许的最大推进步数。
   *
   * 该上限用于防止规则或 AI 导致死循环；当达到上限时会输出诊断信息。
   */
  const maxTicks = 1200;
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

  printLayeredEvents(state.events);

  if (!state.winner && ticks >= maxTicks) {
    console.log(`模拟在 ${maxTicks} 步后终止（未决出胜负），建议提升 AI 进攻性或扩充牌池。`);
  }

  console.log(`对局结束，胜利方: ${state.winner ?? "未决出"}`);
}

function setupSingleDemoRoster(state: ReturnType<typeof createInitialGame>): void {
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

/**
 * 按事件类别分层打印日志，便于观察复杂时序。
 *
 * @param events 对局事件列表。
 */
function printLayeredEvents(events: Array<{ type: string; message: string }>): void {
  let lastGroup = "";

  for (const event of events) {
    const style = EVENT_STYLE[event.type] ?? {
      tag: event.type.toUpperCase(),
      group: "其他"
    };

    if (style.group !== lastGroup) {
      if (lastGroup !== "") {
        console.log("");
      }
      console.log(`==== ${style.group} ====`);
      lastGroup = style.group;
    }

    console.log(`- [${style.tag}] ${event.message}`);
  }
}

runSingleSimulation();
