import { GameEvent, Identity } from "./types";

export interface PublicRelationPlayer {
  id: string;
  name: string;
  identity: Identity;
  alive?: boolean;
}

export type PublicInteractionKind = "hostile" | "damage" | "rescue" | "heal";

export interface PublicInteractionMatch {
  kind: PublicInteractionKind;
  sourceName: string;
  targetName: string;
}

export interface PublicEventPatterns {
  hostilePattern: RegExp;
  damagePattern: RegExp;
  rescuePattern: RegExp;
  healPattern: RegExp;
}

export function inferPublicRelationScoreFromEvents(
  events: GameEvent[],
  observer: PublicRelationPlayer,
  candidate: PublicRelationPlayer
): number {
  let score = 0;
  const recentEvents = events.slice(-120);

  for (const event of recentEvents) {
    const message = event.message;

    if (message.includes(`${candidate.name} 对 ${observer.name} 造成`)) {
      score += 3;
    }
    if (message.includes(`${candidate.name} 使用桃救回 ${observer.name}`)) {
      score -= 3;
    }

    if (observer.identity === "lord" || observer.identity === "loyalist") {
      if (message.includes(`${candidate.name} 对`) && message.includes("造成") && message.includes("主公")) {
        score += 2;
      }
      if (message.includes(`${candidate.name} 使用桃救回`) && message.includes("主公")) {
        score -= 2;
      }
    }

    if (observer.identity === "rebel") {
      if (message.includes(`${candidate.name} 对`) && message.includes("造成") && message.includes("主公")) {
        score -= 2;
      }
      if (message.includes(`${candidate.name} 使用桃救回`) && message.includes("主公")) {
        score += 2;
      }
    }
  }

  return score;
}

export function buildPublicEventPatterns(playerNames: string[]): PublicEventPatterns | null {
  const namePattern = playerNames
    .map((name) => escapeRegExp(name))
    .sort((left, right) => right.length - left.length)
    .join("|");
  if (!namePattern) {
    return null;
  }

  return {
    hostilePattern: new RegExp(
      `(${namePattern}) 对 (${namePattern}) 使用(?:杀|决斗|过河拆桥|顺手牵羊|乐不思蜀|借刀杀人|南蛮入侵|万箭齐发)`
    ),
    damagePattern: new RegExp(`(${namePattern}) 对 (${namePattern}) 造成 \\d+ 点伤害`),
    rescuePattern: new RegExp(`(${namePattern}) 使用桃救回 (${namePattern})`),
    healPattern: new RegExp(`(${namePattern}) 发动(?:青囊|结姻).*?(?:令|与) (${namePattern}) .*回复`)
  };
}

export function extractPublicInteractionMatch(
  message: string,
  patterns: PublicEventPatterns
): PublicInteractionMatch | null {
  const hostileMatch = message.match(patterns.hostilePattern);
  if (hostileMatch) {
    return { kind: "hostile", sourceName: hostileMatch[1] ?? "", targetName: hostileMatch[2] ?? "" };
  }

  const damageMatch = message.match(patterns.damagePattern);
  if (damageMatch) {
    return { kind: "damage", sourceName: damageMatch[1] ?? "", targetName: damageMatch[2] ?? "" };
  }

  const rescueMatch = message.match(patterns.rescuePattern);
  if (rescueMatch) {
    return { kind: "rescue", sourceName: rescueMatch[1] ?? "", targetName: rescueMatch[2] ?? "" };
  }

  const healMatch = message.match(patterns.healPattern);
  if (healMatch) {
    return { kind: "heal", sourceName: healMatch[1] ?? "", targetName: healMatch[2] ?? "" };
  }

  return null;
}

export function computeEventRecencyWeight(total: number, index: number): number {
  if (total <= 1) {
    return 1;
  }

  const ratio = index / (total - 1);
  return 0.6 + ratio * 0.8;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
