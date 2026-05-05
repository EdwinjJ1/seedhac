import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_PROMPT, AssignmentSchema } from '../prompts/slides-assignment.js';

const OUTLINE = {
  title: '项目进展汇报',
  slides: [
    { type: 'overview' as const, title: '项目背景', bullets: ['说明目标', '讲清痛点'] },
    { type: 'nextSteps' as const, title: '下一步计划', bullets: ['安排上线', '收集反馈'] },
  ],
};

describe('slides assignment prompt/schema', () => {
  it('includes outline and member names in prompt', () => {
    const prompt = ASSIGNMENT_PROMPT(OUTLINE, [
      { userId: 'ou_1', name: '张三' },
      { userId: 'ou_2', name: '李四' },
    ]);

    expect(prompt).toContain('项目进展汇报');
    expect(prompt).toContain('张三、李四');
  });

  it('uses fallback member text when member list is empty', () => {
    const prompt = ASSIGNMENT_PROMPT(OUTLINE, []);

    expect(prompt).toContain('待定成员');
  });

  it('parses a valid assignment', () => {
    const assignment = AssignmentSchema.parse({
      assignments: [
        {
          memberName: '张三',
          pages: [{ pageIndex: 0, heading: '项目背景', talkingPoints: ['先讲背景'] }],
        },
      ],
    });

    expect(assignment.assignments[0]?.memberName).toBe('张三');
    expect(assignment.assignments[0]?.pages[0]?.pageIndex).toBe(0);
  });

  it('rejects missing assignments array', () => {
    expect(() => AssignmentSchema.parse({})).toThrow(/assignments/);
  });

  it('exports a JSON schema for structured LLM calls', () => {
    const schema = AssignmentSchema.jsonSchema?.();

    expect(schema?.required).toEqual(['assignments']);
    expect(JSON.stringify(schema)).toContain('talkingPoints');
  });
});
