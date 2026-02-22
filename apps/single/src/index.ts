import { applyAction, chooseAiAction, createInitialGame, stepPhase } from "@sgs/core";

/**
 * 启动单机模拟局。
 *
 * 当前版本会将所有玩家按 AI 逻辑运行，主要用于验证规则主循环。
 */
function runSingleSimulation(): void {
  const state = createInitialGame(20260222);
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

  for (const event of state.events) {
    console.log(`[${event.type}] ${event.message}`);
  }

  if (!state.winner && ticks >= maxTicks) {
    console.log(`模拟在 ${maxTicks} 步后终止（未决出胜负），建议提升 AI 进攻性或扩充牌池。`);
  }

  console.log(`对局结束，胜利方: ${state.winner ?? "未决出"}`);
}

runSingleSimulation();
