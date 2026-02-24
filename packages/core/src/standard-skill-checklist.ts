import { STANDARD_SKILL_IDS } from "./skills";

export interface StandardSkillChecklistItem {
  key: keyof typeof STANDARD_SKILL_IDS;
  id: (typeof STANDARD_SKILL_IDS)[keyof typeof STANDARD_SKILL_IDS];
  implemented: boolean;
}

export const STANDARD_SKILL_CHECKLIST: ReadonlyArray<StandardSkillChecklistItem> =
  (Object.keys(STANDARD_SKILL_IDS) as Array<keyof typeof STANDARD_SKILL_IDS>).map((key) => ({
    key,
    id: STANDARD_SKILL_IDS[key],
    implemented: true
  }));

export const STANDARD_SKILL_COMPLETION = {
  total: STANDARD_SKILL_CHECKLIST.length,
  implemented: STANDARD_SKILL_CHECKLIST.filter((item) => item.implemented).length,
  pending: STANDARD_SKILL_CHECKLIST.filter((item) => !item.implemented).length,
  get percent(): number {
    if (this.total === 0) {
      return 0;
    }

    return Math.round((this.implemented / this.total) * 100);
  }
} as const;
