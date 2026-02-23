import { GameEvent, GameState, SkillDefinition, SkillSystemState } from "./types";

export const STANDARD_SKILL_IDS = {
  zhangfeiPaoxiao: "std.zhangfei.paoxiao",
  machaoMashu: "std.machao.mashu",
  machaoTieqi: "std.machao.tieqi",
  guanyuWusheng: "std.guanyu.wusheng",
  guojiaYiji: "std.guojia.yiji",
  zhugeliangKongcheng: "std.zhugeliang.kongcheng",
  lvbuWushuang: "std.lvbu.wushuang",
  zhaoyunLongdan: "std.zhaoyun.longdan",
  huangyueyingJizhi: "std.huangyueying.jizhi"
} as const;

export function createSkillSystemState(): SkillSystemState {
  return {
    definitions: {},
    playerSkills: {}
  };
}

export function registerSkill(state: GameState, definition: SkillDefinition): void {
  state.skillSystem.definitions[definition.id] = definition;
}

export function assignSkillToPlayer(state: GameState, playerId: string, skillId: string): void {
  const skills = state.skillSystem.playerSkills[playerId] ?? [];
  if (!skills.includes(skillId)) {
    skills.push(skillId);
  }
  state.skillSystem.playerSkills[playerId] = skills;
}

export function hasSkill(state: GameState, playerId: string, skillId: string): boolean {
  const skills = state.skillSystem.playerSkills[playerId] ?? [];
  return skills.includes(skillId);
}

export function emitSkillEvent(state: GameState, event: GameEvent): void {
  for (const player of state.players) {
    if (!player.alive) {
      continue;
    }

    const skillIds = state.skillSystem.playerSkills[player.id] ?? [];
    for (const skillId of skillIds) {
      const definition = state.skillSystem.definitions[skillId];
      if (!definition?.onEvent) {
        continue;
      }

      definition.onEvent({
        state,
        event,
        owner: player
      });
    }
  }
}
