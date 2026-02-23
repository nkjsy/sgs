import { GameEvent, GameState, SkillDefinition, SkillSystemState } from "./types";

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
