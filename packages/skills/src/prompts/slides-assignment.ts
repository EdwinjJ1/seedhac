import type { ChatMember, SchemaLike } from '@seedhac/contracts';
import type { Outline } from './slides.js';

export interface AssignmentPage {
  readonly pageIndex: number;
  readonly heading: string;
  readonly talkingPoints: readonly string[];
}

export interface AssignmentItem {
  readonly memberName: string;
  readonly pages: readonly AssignmentPage[];
}

export interface Assignment {
  readonly assignments: readonly AssignmentItem[];
}

export const ASSIGNMENT_PROMPT = (
  outline: Outline,
  members: readonly ChatMember[],
): string => {
  const memberCount = members.length || 1;
  const memberList = members.length > 0 ? members.map((m) => m.name).join('、') : '待定成员';
  return `
根据以下演示文稿大纲和汇报成员列表，为每位成员分配负责讲解的页面，并给出每页的发言要点。

成员列表（共 ${memberCount} 人）：${memberList}

要求：
- 必须为上方列出的每一位成员都生成一条 assignment，输出的 assignments 数组长度必须等于 ${memberCount}
- 每位成员分配 1-3 页，尽量均衡分配，不要让某一位承担过多页面
- 发言要点 2-3 句，简洁口语化
- pageIndex 对应 outline.slides 的 0-based 下标
- 输出严格遵循 JSON schema，不要有额外文字

大纲：
${JSON.stringify(outline, null, 2)}
`.trim();
};

function parseAssignmentPage(raw: unknown): AssignmentPage {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid assignment page');
  const p = raw as Record<string, unknown>;
  if (typeof p['pageIndex'] !== 'number') throw new Error('assignment.pageIndex must be number');
  if (typeof p['heading'] !== 'string') throw new Error('assignment.heading must be string');
  if (!Array.isArray(p['talkingPoints'])) {
    throw new Error('assignment.talkingPoints must be array');
  }
  return {
    pageIndex: p['pageIndex'],
    heading: p['heading'],
    talkingPoints: p['talkingPoints'].map((point) => {
      if (typeof point !== 'string') throw new Error('talking point must be string');
      return point;
    }),
  };
}

function parseAssignmentItem(raw: unknown): AssignmentItem {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid assignment item');
  const a = raw as Record<string, unknown>;
  if (typeof a['memberName'] !== 'string') throw new Error('assignment.memberName must be string');
  if (!Array.isArray(a['pages'])) throw new Error('assignment.pages must be array');
  return {
    memberName: a['memberName'],
    pages: a['pages'].map(parseAssignmentPage),
  };
}

export const AssignmentSchema: SchemaLike<Assignment> = {
  parse(value: unknown): Assignment {
    if (typeof value !== 'object' || value === null) throw new Error('assignment must be object');
    const a = value as Record<string, unknown>;
    if (!Array.isArray(a['assignments'])) throw new Error('assignment.assignments must be array');
    return {
      assignments: a['assignments'].map(parseAssignmentItem),
    };
  },
  jsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      required: ['assignments'],
      properties: {
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            required: ['memberName', 'pages'],
            properties: {
              memberName: { type: 'string' },
              pages: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['pageIndex', 'heading', 'talkingPoints'],
                  properties: {
                    pageIndex: { type: 'number' },
                    heading: { type: 'string' },
                    talkingPoints: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    };
  },
};
