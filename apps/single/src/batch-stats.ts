import { runSingleSimulation } from "./simulation";

type WinnerKind = "lord-side" | "rebel-side" | "renegade" | "undecided";
type Identity = "lord" | "loyalist" | "rebel" | "renegade";

interface GeneralStat {
  name: string;
  games: number;
  wins: number;
}

type StatsRosterMode = "fixed-demo" | "random-general-pool";

interface BatchSummary {
  total: number;
  timeout: number;
  avgTicks: number;
  minTicks: number;
  maxTicks: number;
  winners: Record<WinnerKind, number>;
  generalStats: GeneralStat[];
  rosterMode: StatsRosterMode;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRosterMode(value: string | undefined): StatsRosterMode {
  return value === "fixed-demo" ? "fixed-demo" : "random-general-pool";
}

function runBatch(total: number, maxTicks: number, seedBase: number, rosterMode: StatsRosterMode): BatchSummary {
  const winners: Record<WinnerKind, number> = {
    "lord-side": 0,
    "rebel-side": 0,
    renegade: 0,
    undecided: 0
  };
  const generalStatMap = new Map<string, GeneralStat>();

  let timeout = 0;
  let tickSum = 0;
  let minTicks = Number.POSITIVE_INFINITY;
  let maxObservedTicks = 0;

  for (let index = 0; index < total; index += 1) {
    const seed = seedBase + index;
    const result = runSingleSimulation(seed, {
      maxTicks,
      rosterMode
    });

    tickSum += result.ticks;
    minTicks = Math.min(minTicks, result.ticks);
    maxObservedTicks = Math.max(maxObservedTicks, result.ticks);

    const winnerKind: WinnerKind = result.timeout || !result.winner ? "undecided" : result.winner;
    winners[winnerKind] += 1;

    const winningIdentities = getWinningIdentities(winnerKind);
    for (const player of result.state.players) {
      const stat = generalStatMap.get(player.name) ?? { name: player.name, games: 0, wins: 0 };
      generalStatMap.set(player.name, stat);

      stat.games += 1;
      if (winningIdentities.has(player.identity)) {
        stat.wins += 1;
      }
    }

    if (winnerKind === "undecided") {
      timeout += 1;
    }
  }

  const generalStats = [...generalStatMap.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return {
    total,
    timeout,
    avgTicks: Number((tickSum / total).toFixed(2)),
    minTicks: minTicks === Number.POSITIVE_INFINITY ? 0 : minTicks,
    maxTicks: maxObservedTicks,
    winners,
    generalStats,
    rosterMode
  };
}

function getWinningIdentities(winnerKind: WinnerKind): Set<Identity> {
  if (winnerKind === "lord-side") {
    return new Set<Identity>(["lord", "loyalist"]);
  }

  if (winnerKind === "rebel-side") {
    return new Set<Identity>(["rebel"]);
  }

  if (winnerKind === "renegade") {
    return new Set<Identity>(["renegade"]);
  }

  return new Set<Identity>();
}

function printSummary(summary: BatchSummary, maxTicks: number, seedBase: number): void {
  console.log("单机批量对战统计");
  console.log(`- 总局数: ${summary.total}`);
  console.log(`- 种子起点: ${seedBase}`);
  console.log(`- 每局上限步数: ${maxTicks}`);
  console.log(`- 平均步数: ${summary.avgTicks}`);
  console.log(`- 最短/最长步数: ${summary.minTicks}/${summary.maxTicks}`);
  console.log(`- 超时未决: ${summary.timeout}`);
  console.log("- 胜方分布:");
  console.log(`  - 主忠阵营: ${summary.winners["lord-side"]}`);
  console.log(`  - 反贼阵营: ${summary.winners["rebel-side"]}`);
  console.log(`  - 内奸: ${summary.winners.renegade}`);
  console.log(`  - 未决: ${summary.winners.undecided}`);
  console.log(`- 武将胜率(${summary.rosterMode === "random-general-pool" ? "随机阵容" : "固定演示阵容"}):`);
  for (const stat of summary.generalStats) {
    const winRate = stat.games === 0 ? 0 : Number(((stat.wins / stat.games) * 100).toFixed(2));
    console.log(`  - ${stat.name}: ${stat.wins}/${stat.games} (${winRate}%)`);
  }
}

const total = parsePositiveInt(process.argv[2], 100);
const maxTicks = parsePositiveInt(process.argv[3], 1200);
const seedBase = parsePositiveInt(process.argv[4], 20260224);
const rosterMode = parseRosterMode(process.argv[5]);

const summary = runBatch(total, maxTicks, seedBase, rosterMode);
printSummary(summary, maxTicks, seedBase);
