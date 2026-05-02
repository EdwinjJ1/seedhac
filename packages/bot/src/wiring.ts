import type { Skill, SkillContext, SkillName } from '@seedhac/contracts';
import type { RouteIntent } from './skill-router.js';
import type { SkillRouter } from './skill-router.js';

export const intentToSkill: Partial<Record<RouteIntent, SkillName>> = {
  qa: 'qa',
  meetingNotes: 'summary',
  slides: 'slides',
};

export async function handleEvent(
  ctx: SkillContext,
  router: SkillRouter,
  skills: Readonly<Partial<Record<SkillName, Skill>>>,
): Promise<void> {
  const { event, logger, runtime } = ctx;
  if (event.type !== 'message') return;
  const intent = router.route(event.payload);
  const skillName = intentToSkill[intent];
  if (!skillName) return;
  const skill = skills[skillName];
  if (!skill) return;
  if (!await skill.match(ctx)) return;
  const result = await skill.run(ctx);
  if (!result.ok) {
    logger.error('skill failed', { code: result.error.code, message: result.error.message });
    return;
  }
  const { card, text } = result.value;
  if (card) await runtime.sendCard({ chatId: event.payload.chatId, card });
  if (text) await runtime.sendText({ chatId: event.payload.chatId, text });
}
