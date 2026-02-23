import assert from "node:assert/strict";
import test from "node:test";
import { createInitialGame, stepPhase } from "../engine";
import { assignSkillToPlayer, registerSkill } from "../skills";

test("skill system should initialize empty in initial game", () => {
  const state = createInitialGame(42);
  assert.deepEqual(state.skillSystem.definitions, {});
  assert.deepEqual(state.skillSystem.playerSkills, {});
});

test("registered skill should receive emitted game events", () => {
  const state = createInitialGame(42);
  const owner = state.players[0];
  let triggered = 0;

  registerSkill(state, {
    id: "probe.skill",
    onEvent: ({ event, owner: skillOwner }) => {
      if (event.type === "phase" && skillOwner.id === owner.id) {
        triggered += 1;
      }
    }
  });
  assignSkillToPlayer(state, owner.id, "probe.skill");

  stepPhase(state);

  assert.equal(triggered >= 1, true);
});
