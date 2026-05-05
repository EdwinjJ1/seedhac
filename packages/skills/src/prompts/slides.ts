import type {
  BitableRow,
  ChatMember,
  Message,
  SchemaLike,
  SlideCard,
  SlideDraft,
  SlideMilestone,
  SlideRisk,
  SlideTask,
  SlideType,
} from '@seedhac/contracts';

const SLIDE_TYPES: readonly SlideType[] = [
  'cover',
  'overview',
  'timeline',
  'risks',
  'nextSteps',
  'closing',
] as const;

export interface Outline {
  title: string;
  subtitle?: string;
  slides: SlideDraft[];
}

export const SLIDES_PROMPT = (
  history: readonly Message[],
  snapshots: readonly BitableRow[],
  members: readonly ChatMember[] = [],
): string =>
  `
你是一个项目协作助手。根据以下群聊记录和项目背景，生成一份可直接渲染为飞书原生 Slides 的结构化演示文稿方案。
要求：
- 标题简洁，体现项目核心价值
- 生成 5-6 页幻灯片，优先使用这些页面类型：cover、overview、timeline、risks、nextSteps、closing
- 第一页必须是 cover，最后一页必须是 closing，倒数第二页优先是 nextSteps
- 每页内容必须短，适合投屏汇报，不要把文档段落塞进 PPT
- overview 使用 cards 字段，timeline 使用 milestones 字段，risks 使用 risks 字段，nextSteps 使用 tasks 字段
- 除 cover 和 closing 外，每页都要给出 presenterName。请根据群聊中每个人参与/负责的内容来分配；如果无法判断，再均衡分配给群成员
- 如果信息不足，可以合理概括，但不要编造具体数据
输出严格遵循 JSON schema，不要有额外文字。

群成员列表：
${members.length > 0 ? members.map((m) => m.name).join('、') : '待定成员'}

群聊记录（最近）：
${history.map((m) => `${m.sender.name ?? m.sender.userId}: ${m.text}`).join('\n')}

项目背景：
${snapshots.map((s) => String(s['content'] ?? '')).join('\n')}
`.trim();

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be array`);
  return value.map((item) => {
    if (typeof item !== 'string') throw new Error(`${field} item must be string`);
    return item;
  });
}

function parseCards(value: unknown): SlideCard[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('slide.cards must be array');
  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new Error('slide card must be object');
    const c = raw as Record<string, unknown>;
    if (typeof c['title'] !== 'string') throw new Error('slide.card.title must be string');
    return {
      title: c['title'],
      ...(typeof c['value'] === 'string' && { value: c['value'] }),
      ...(typeof c['detail'] === 'string' && { detail: c['detail'] }),
    };
  });
}

function parseMilestones(value: unknown): SlideMilestone[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('slide.milestones must be array');
  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new Error('slide milestone must be object');
    const m = raw as Record<string, unknown>;
    if (typeof m['label'] !== 'string') throw new Error('slide.milestone.label must be string');
    return {
      label: m['label'],
      ...(typeof m['date'] === 'string' && { date: m['date'] }),
      ...(typeof m['status'] === 'string' && { status: m['status'] }),
    };
  });
}

function parseRisks(value: unknown): SlideRisk[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('slide.risks must be array');
  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new Error('slide risk must be object');
    const r = raw as Record<string, unknown>;
    if (typeof r['risk'] !== 'string') throw new Error('slide.risk.risk must be string');
    if (typeof r['impact'] !== 'string') throw new Error('slide.risk.impact must be string');
    if (typeof r['mitigation'] !== 'string')
      throw new Error('slide.risk.mitigation must be string');
    return { risk: r['risk'], impact: r['impact'], mitigation: r['mitigation'] };
  });
}

function parseTasks(value: unknown): SlideTask[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('slide.tasks must be array');
  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new Error('slide task must be object');
    const t = raw as Record<string, unknown>;
    if (typeof t['owner'] !== 'string') throw new Error('slide.task.owner must be string');
    if (typeof t['task'] !== 'string') throw new Error('slide.task.task must be string');
    return {
      owner: t['owner'],
      task: t['task'],
      ...(typeof t['due'] === 'string' && { due: t['due'] }),
    };
  });
}

function parseSlideItem(raw: unknown): SlideDraft {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid slide item');
  const s = raw as Record<string, unknown>;
  if (typeof s['type'] !== 'string' || !SLIDE_TYPES.includes(s['type'] as SlideType)) {
    throw new Error('slide.type must be a supported slide type');
  }
  if (typeof s['title'] !== 'string') throw new Error('slide.title must be string');
  const bullets = parseStringArray(s['bullets'], 'slide.bullets');
  const cards = parseCards(s['cards']);
  const milestones = parseMilestones(s['milestones']);
  const risks = parseRisks(s['risks']);
  const tasks = parseTasks(s['tasks']);
  return {
    type: s['type'] as SlideType,
    title: s['title'],
    ...(typeof s['presenterName'] === 'string' && { presenterName: s['presenterName'] }),
    ...(typeof s['subtitle'] === 'string' && { subtitle: s['subtitle'] }),
    ...(bullets !== undefined && { bullets }),
    ...(cards !== undefined && { cards }),
    ...(milestones !== undefined && { milestones }),
    ...(risks !== undefined && { risks }),
    ...(tasks !== undefined && { tasks }),
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
      ...(typeof o['subtitle'] === 'string' && { subtitle: o['subtitle'] }),
      slides: (o['slides'] as unknown[]).map(parseSlideItem),
    };
  },
  jsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      required: ['title', 'slides'],
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'title'],
            properties: {
              type: { type: 'string', enum: SLIDE_TYPES },
              title: { type: 'string' },
              presenterName: { type: 'string' },
              subtitle: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
              cards: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    value: { type: 'string' },
                    detail: { type: 'string' },
                  },
                },
              },
              milestones: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['label'],
                  properties: {
                    label: { type: 'string' },
                    date: { type: 'string' },
                    status: { type: 'string' },
                  },
                },
              },
              risks: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['risk', 'impact', 'mitigation'],
                  properties: {
                    risk: { type: 'string' },
                    impact: { type: 'string' },
                    mitigation: { type: 'string' },
                  },
                },
              },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['owner', 'task'],
                  properties: {
                    owner: { type: 'string' },
                    task: { type: 'string' },
                    due: { type: 'string' },
                  },
                },
              },
              notes: { type: 'string' },
            },
          },
        },
      },
    };
  },
};
