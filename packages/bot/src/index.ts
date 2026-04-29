/**
 * SeedHAC bot 入口（v0.1 占位）。
 *
 * 真正的 BotRuntime / SkillRouter / adapters 在后续 PR 实现。
 * 当前只验证：能 build、能起进程、能从 @seedhac/skills 拉 7 个 skill。
 */

import { skills } from '@seedhac/skills';

const main = (): void => {
  console.info('[seedhac/bot] booting v0.1 (scaffold)');
  console.info(`[seedhac/bot] loaded ${skills.length} skill(s):`);
  for (const skill of skills) {
    console.info(`  - ${skill.name}: ${skill.trigger.description}`);
  }
  console.info(
    '[seedhac/bot] runtime / WSClient / router not yet implemented — see follow-up issues.',
  );
};

main();
