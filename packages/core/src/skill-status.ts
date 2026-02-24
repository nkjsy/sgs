import { STANDARD_SKILL_CHECKLIST, STANDARD_SKILL_COMPLETION } from "./standard-skill-checklist";

function printSkillStatus(): void {
  const { total, implemented, pending, percent } = STANDARD_SKILL_COMPLETION;

  console.log("标准技能完成度");
  console.log(`- 总数: ${total}`);
  console.log(`- 已实现: ${implemented}`);
  console.log(`- 待实现: ${pending}`);
  console.log(`- 完成率: ${percent}%`);

  if (pending > 0) {
    const pendingItems = STANDARD_SKILL_CHECKLIST.filter((item) => !item.implemented);
    console.log("- 待实现列表:");
    for (const item of pendingItems) {
      console.log(`  - ${item.key} (${item.id})`);
    }
  }
}

printSkillStatus();
