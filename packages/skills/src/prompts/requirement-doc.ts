import type { Message, SchemaLike } from '@seedhac/contracts';

export interface RequirementDoc {
  title: string;
  background: string;
  goals: string[];
  scope: string;
  deliverables: string[];
}

export const REQ_PROMPT = (history: readonly Message[]): string => `
根据以下群聊记录，提取项目需求并整理成结构化文档。
要求：
- title：项目标题，简洁体现核心价值（10 字内）
- background：项目背景，1-2 段，说明缘由与上下文
- goals：项目目标列表，每条单一目标
- scope：项目范围，1 段，明确包含与不包含的内容
- deliverables：具体交付物列表（文档/接口/页面/演示等可验收物）

只返回 JSON，不要有额外文字。

群聊记录：
${history.map((m) => `[${m.sender.name ?? m.sender.userId}]: ${m.text}`).join('\n')}
`.trim();

function asStringArray(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) throw new Error(`${field} must be array`);
  return raw.map((v) => {
    if (typeof v !== 'string') throw new Error(`${field}[] must be string`);
    return v;
  });
}

export const RequirementDocSchema: SchemaLike<RequirementDoc> = {
  parse(value: unknown): RequirementDoc {
    if (typeof value !== 'object' || value === null) throw new Error('requirement doc must be object');
    const o = value as Record<string, unknown>;
    if (typeof o['title'] !== 'string') throw new Error('title must be string');
    if (typeof o['background'] !== 'string') throw new Error('background must be string');
    if (typeof o['scope'] !== 'string') throw new Error('scope must be string');
    return {
      title: o['title'],
      background: o['background'],
      scope: o['scope'],
      goals: asStringArray(o['goals'], 'goals'),
      deliverables: asStringArray(o['deliverables'], 'deliverables'),
    };
  },
  jsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      required: ['title', 'background', 'goals', 'scope', 'deliverables'],
      properties: {
        title: { type: 'string' },
        background: { type: 'string' },
        goals: { type: 'array', items: { type: 'string' } },
        scope: { type: 'string' },
        deliverables: { type: 'array', items: { type: 'string' } },
      },
    };
  },
};

export function renderRequirementDocMarkdown(doc: RequirementDoc): string {
  return [
    `# ${doc.title}`,
    '',
    '## 项目背景',
    doc.background,
    '',
    '## 目标',
    ...doc.goals.map((g) => `- ${g}`),
    '',
    '## 范围',
    doc.scope,
    '',
    '## 交付物',
    ...doc.deliverables.map((d) => `- ${d}`),
  ].join('\n');
}
