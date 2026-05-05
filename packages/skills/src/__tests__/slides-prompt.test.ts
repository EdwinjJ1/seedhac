import { describe, expect, it } from 'vitest';
import { OutlineSchema, SLIDES_PROMPT } from '../prompts/slides.js';

describe('slides prompt/schema', () => {
  it('asks for templated slide types', () => {
    const prompt = SLIDES_PROMPT([], [], [{ userId: 'ou_1', name: '张三' }]);

    expect(prompt).toContain('cover、overview、timeline、risks、nextSteps、closing');
    expect(prompt).toContain('overview 使用 cards 字段');
    expect(prompt).toContain('presenterName');
    expect(prompt).toContain('张三');
  });

  it('parses a templated outline', () => {
    const outline = OutlineSchema.parse({
      title: '项目进展汇报',
      subtitle: '基于 IM 的办公协同智能助手',
      slides: [
        { type: 'cover', title: '项目进展汇报', subtitle: '挑战赛 Demo' },
        {
          type: 'overview',
          title: '核心进展',
          presenterName: '张三',
          cards: [{ title: 'MVP', value: '已完成', detail: '主链路可演示' }],
        },
        {
          type: 'nextSteps',
          title: '下一步计划',
          tasks: [{ owner: '张三', task: '手机端联调', due: '明天' }],
        },
      ],
    });

    expect(outline.slides[0]?.type).toBe('cover');
    expect(outline.slides[1]?.presenterName).toBe('张三');
    expect(outline.slides[1]?.cards?.[0]?.title).toBe('MVP');
    expect(outline.slides[2]?.tasks?.[0]?.owner).toBe('张三');
  });

  it('rejects legacy slides without type', () => {
    expect(() =>
      OutlineSchema.parse({
        title: '旧版大纲',
        slides: [{ heading: '背景', bullets: ['一句话'] }],
      }),
    ).toThrow(/slide.type/);
  });

  it('exports schema fields for all templates', () => {
    const schema = OutlineSchema.jsonSchema?.();
    const asText = JSON.stringify(schema);

    expect(asText).toContain('milestones');
    expect(asText).toContain('risks');
    expect(asText).toContain('tasks');
    expect(asText).toContain('presenterName');
  });
});
