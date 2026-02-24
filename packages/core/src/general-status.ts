import { STANDARD_GENERAL_CHECKLIST, STANDARD_GENERAL_COMPLETION } from "./standard-general-checklist";

function printGeneralStatus(): void {
  const { totalGenerals, completedGenerals, pendingGenerals, percent } = STANDARD_GENERAL_COMPLETION;

  console.log("标准武将完成度");
  console.log(`- 总武将数: ${totalGenerals}`);
  console.log(`- 已完成武将: ${completedGenerals}`);
  console.log(`- 待完成武将: ${pendingGenerals}`);
  console.log(`- 完成率: ${percent}%`);

  if (pendingGenerals > 0) {
    console.log("- 未完成武将:");
    for (const item of STANDARD_GENERAL_CHECKLIST.filter((general) => !general.completed)) {
      const pendingSkills = item.skills.filter((skillId) => !item.implementedSkills.includes(skillId));
      console.log(`  - ${item.generalName} (${item.generalId}): ${pendingSkills.join(", ")}`);
    }
  }
}

printGeneralStatus();
