import type { Skill, SkillName } from '@seedhac/contracts';

import { archiveSkill } from './archive.js';
import { docIterateSkill } from './doc-iterate.js';
import { qaSkill } from './qa.js';
import { recallSkill } from './recall.js';
import { requirementDocSkill } from './requirement-doc.js';
import { slidesSkill } from './slides.js';
import { summarySkill } from './summary.js';
import { weeklySkill } from './weekly.js';

export { archiveSkill } from './archive.js';
export { docIterateSkill } from './doc-iterate.js';
export { qaSkill } from './qa.js';
export { recallSkill } from './recall.js';
export { requirementDocSkill } from './requirement-doc.js';
export { slidesSkill } from './slides.js';
export { summarySkill } from './summary.js';
export { weeklySkill } from './weekly.js';

/** 8 条业务主线注册表 — bot runtime 直接 import 这一行 */
export const skills: readonly Skill[] = [
  qaSkill,
  recallSkill,
  summarySkill,
  slidesSkill,
  archiveSkill,
  weeklySkill,
  requirementDocSkill,
  docIterateSkill,
];

export const skillsByName: Readonly<Record<SkillName, Skill>> = {
  qa: qaSkill,
  recall: recallSkill,
  summary: summarySkill,
  slides: slidesSkill,
  archive: archiveSkill,
  weekly: weeklySkill,
  requirementDoc: requirementDocSkill,
  docIterate: docIterateSkill,
};
