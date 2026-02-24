import { runSingleSimulation } from "./simulation";

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

function runSingleAndPrint(): void {
  const maxTicks = 1200;
  const result = runSingleSimulation(20260222, { maxTicks, rosterMode: "fixed-demo" });

  printLayeredEvents(result.state.events);

  if (result.timeout) {
    console.log(`模拟在 ${maxTicks} 步后终止（未决出胜负），建议提升 AI 进攻性或扩充牌池。`);
  }

  console.log(`对局结束，胜利方: ${result.winner ?? "未决出"}`);
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

runSingleAndPrint();
