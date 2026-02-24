import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { applyAction, chooseAiAction, createInitialGame, getLegalActions, stepPhase, TurnAction } from "@sgs/core";
import { setupSingleDemoRoster } from "./simulation";

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
  dying: { tag: "DYING", group: "濒死" },
  death: { tag: "DEATH", group: "濒死" },
  turn: { tag: "TURN", group: "回合" },
  discard: { tag: "DISCARD", group: "弃牌" },
  deck: { tag: "DECK", group: "牌堆" },
  skill: { tag: "SKILL", group: "技能" }
};

function formatActionLabel(state: ReturnType<typeof createInitialGame>, action: TurnAction): string {
  if (action.type === "end-play-phase") {
    return "结束出牌阶段";
  }

  const actor = state.players.find((player) => player.id === action.actorId);
  const target = action.targetId ? state.players.find((player) => player.id === action.targetId) : null;
  const secondary = action.secondaryTargetId
    ? state.players.find((player) => player.id === action.secondaryTargetId)
    : null;
  const actorName = actor?.name ?? action.actorId;

  if (secondary) {
    return `${actorName} 使用 ${action.cardId} -> ${target?.name ?? action.targetId} / ${secondary.name}`;
  }

  if (target) {
    return `${actorName} 使用 ${action.cardId} -> ${target.name}`;
  }

  return `${actorName} 使用 ${action.cardId}`;
}

function printTable(state: ReturnType<typeof createInitialGame>): void {
  console.log("\n当前场面：");
  for (const player of state.players) {
    const alive = player.alive ? "存活" : "阵亡";
    const turnMarker = player.id === state.currentPlayerId ? " <- 当前" : "";
    console.log(
      `- ${player.name}(${player.identity}) HP:${player.hp}/${player.maxHp} 手牌:${player.hand.length} ${alive}${turnMarker}`
    );
  }
}

function printHand(state: ReturnType<typeof createInitialGame>, playerId: string): void {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) {
    return;
  }

  console.log("\n你的手牌：");
  if (player.hand.length === 0) {
    console.log("- （空）");
    return;
  }

  for (const card of player.hand) {
    console.log(`- ${card.id} [${card.kind}]`);
  }
}

function printNewEvents(state: ReturnType<typeof createInitialGame>, cursor: number): number {
  const nextEvents = state.events.slice(cursor);
  let lastGroup = "";

  for (const event of nextEvents) {
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

  return state.events.length;
}

async function runInteractiveGame(): Promise<void> {
  const seedArg = Number(process.argv[2]);
  const seed = Number.isFinite(seedArg) ? seedArg : Date.now();
  const maxTicks = 1600;

  const state = createInitialGame(seed);
  setupSingleDemoRoster(state);

  const rl = createInterface({ input, output });
  let cursor = 0;
  let ticks = 0;

  console.log(`交互对局开始，seed=${seed}`);
  cursor = printNewEvents(state, cursor);

  try {
    while (!state.winner && ticks < maxTicks) {
      const actor = state.players.find((player) => player.id === state.currentPlayerId);
      if (!actor || !actor.alive) {
        stepPhase(state);
        ticks += 1;
        cursor = printNewEvents(state, cursor);
        continue;
      }

      if (state.phase !== "play") {
        stepPhase(state);
        ticks += 1;
        cursor = printNewEvents(state, cursor);
        continue;
      }

      if (actor.isAi) {
        const action = chooseAiAction({ state, actor });
        applyAction(state, action);
        if (action.type === "end-play-phase") {
          stepPhase(state);
        }
        ticks += 1;
        cursor = printNewEvents(state, cursor);
        continue;
      }

      let endHumanPlay = false;
      while (!endHumanPlay && !state.winner && state.phase === "play" && state.currentPlayerId === actor.id) {
        const legalActions = getLegalActions(state).filter((action) => action.actorId === actor.id);

        printTable(state);
        printHand(state, actor.id);

        if (legalActions.length === 0) {
          console.log("\n无可执行动作，自动结束出牌阶段。");
          stepPhase(state);
          ticks += 1;
          cursor = printNewEvents(state, cursor);
          break;
        }

        console.log("\n可执行动作：");
        legalActions.forEach((action, index) => {
          console.log(`${index + 1}. ${formatActionLabel(state, action)}`);
        });

        const answer = await rl.question("输入动作编号（q 退出）：");
        if (answer.trim().toLowerCase() === "q") {
          console.log("已退出交互对局。");
          return;
        }

        const pick = Number.parseInt(answer, 10);
        if (!Number.isInteger(pick) || pick < 1 || pick > legalActions.length) {
          console.log("输入无效，请重试。\n");
          continue;
        }

        const chosen = legalActions[pick - 1];
        applyAction(state, chosen);
        ticks += 1;

        if (chosen.type === "end-play-phase") {
          stepPhase(state);
          ticks += 1;
          endHumanPlay = true;
        }

        cursor = printNewEvents(state, cursor);
      }
    }
  } finally {
    rl.close();
  }

  if (!state.winner) {
    console.log(`对局在 ${maxTicks} 步后超时。`);
  }

  console.log(`对局结束，胜利方：${state.winner ?? "未决"}`);
}

void runInteractiveGame();
