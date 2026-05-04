import type { BitableRow, Message, SchemaLike } from '@seedhac/contracts';

export interface SlideItem {
  heading: string;
  bullets: string[];
  notes?: string;
}

export interface Outline {
  title: string;
  slides: SlideItem[];
}

export const SLIDES_PROMPT = (
  history: readonly Message[],
  snapshots: readonly BitableRow[],
): string => `
你是一个项目协作助手。根据以下群聊记录和项目背景，生成一份演示文稿大纲。
要求：
- 标题简洁，体现项目核心价值
- 4-6 页幻灯片，最后一页为"下一步计划"
- 每页 2-4 个要点，语言简练
输出严格遵循 JSON schema，不要有额外文字。

群聊记录（最近）：
${history.map((m) => `${m.sender.name ?? m.sender.userId}: ${m.text}`).join('\n')}

项目背景：
${snapshots.map((s) => String(s['content'] ?? '')).join('\n')}
`.trim();

function parseSlideItem(raw: unknown): SlideItem {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid slide item');
  const s = raw as Record<string, unknown>;
  if (typeof s['heading'] !== 'string') throw new Error('slide.heading must be string');
  if (!Array.isArray(s['bullets'])) throw new Error('slide.bullets must be array');
  return {
    heading: s['heading'],
    bullets: s['bullets'].map((b) => {
      if (typeof b !== 'string') throw new Error('bullet must be string');
      return b;
    }),
    ...(typeof s['notes'] === 'string' && { notes: s['notes'] }),
  };
}

export const OutlineSchema: SchemaLike<Outline> = {
  parse(value: unknown): Outline {
    if (typeof value !== 'object' || value === null) throw new Error('outline must be object');
    const o = value as Record<string, unknown>;
    if (typeof o['title'] !== 'string') throw new Error('outline.title must be string');
    if (!Array.isArray(o['slides'])) throw new Error('outline.slides must be array');
    return {
      title: o['title'],
      slides: (o['slides'] as unknown[]).map(parseSlideItem),
    };
  },
  jsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      required: ['title', 'slides'],
      properties: {
        title: { type: 'string' },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            required: ['heading', 'bullets'],
            properties: {
              heading: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' },
            },
          },
        },
      },
    };
  },
};
