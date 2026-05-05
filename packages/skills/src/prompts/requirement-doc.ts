import type { Message, SchemaLike } from '@seedhac/contracts';

// ─── Relevance pre-filter ─────────────────────────────────────────────────────
// 群里历史消息可能掺杂多个不相关项目的讨论，不能一股脑塞给主 LLM。
// 这里跑一次 lite 模型判断每条候选（消息 / 文档）是否与本次「整理项目需求」
// 触发的目标项目相关，只保留相关的再喂给主提取流程。

export interface RelevanceCandidate {
  readonly id: string;
  readonly kind: 'message' | 'doc' | 'wiki';
  /** 短摘要：消息文本前 200 字 / 文档标题 + 正文前 200 字 */
  readonly excerpt: string;
}

export interface RelevanceJudgment {
  readonly results: readonly { readonly id: string; readonly keep: boolean }[];
}

export const RELEVANCE_PROMPT = (
  triggerText: string,
  candidates: readonly RelevanceCandidate[],
): string => `
你是一个项目需求整理助手的预筛选模块。
当前用户在群里发了一条消息触发"整理项目需求"技能，触发消息是：

[trigger]
${triggerText}

下面有 ${candidates.length} 条候选上下文（最近群聊消息 / 群里出现的飞书文档）。
判断**每条**是否与触发消息指向的需求项目相关：
- 直接讨论同一项目 / 同一需求场景 / 同一目标用户 → keep: true
- 完全无关的闲聊、其他项目讨论、机器人诊断噪音、重复触发消息 → keep: false
- 不确定时**倾向 keep: true**，宁可多带一点上下文

只返回如下 JSON，不要有额外文字：
{"results":[{"id":"<候选 id>","keep":true},...]}

候选列表：
${candidates
  .map((c) => `[${c.id}] (${c.kind}) ${c.excerpt}`)
  .join('\n')}
`.trim();

export const RelevanceJudgmentSchema: SchemaLike<RelevanceJudgment> = {
  parse(value: unknown): RelevanceJudgment {
    if (typeof value !== 'object' || value === null) throw new Error('relevance must be object');
    const o = value as Record<string, unknown>;
    if (!Array.isArray(o['results'])) throw new Error('relevance.results must be array');
    return {
      results: (o['results'] as unknown[]).map((r, i) => {
        if (typeof r !== 'object' || r === null) throw new Error(`results[${i}] must be object`);
        const obj = r as Record<string, unknown>;
        if (typeof obj['id'] !== 'string') throw new Error(`results[${i}].id must be string`);
        if (typeof obj['keep'] !== 'boolean') throw new Error(`results[${i}].keep must be boolean`);
        return { id: obj['id'], keep: obj['keep'] };
      }),
    };
  },
  jsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'keep'],
            properties: { id: { type: 'string' }, keep: { type: 'boolean' } },
          },
        },
      },
    };
  },
};

// ─── Main extraction ──────────────────────────────────────────────────────────

export interface RequirementDoc {
  title: string;
  background: string;
  goals: string[];
  scope: string;
  deliverables: string[];
}

/**
 * 群里被同步过来的关联文档（doc / wiki）正文片段。
 * requirementDoc 把它们与聊天记录一起喂给 LLM —— 真实场景下需求往往写在
 * 共享文档里，单看群文本不够。
 */
export interface LinkedDocSnippet {
  readonly kind: 'doc' | 'wiki';
  readonly title?: string;
  readonly url: string;
  readonly content: string;
}

const MAX_DOC_CHARS_EACH = 4000;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…（已截断 ${value.length - max} 字）`;
}

export const REQ_PROMPT = (
  history: readonly Message[],
  linkedDocs: readonly LinkedDocSnippet[] = [],
): string => {
  const historyBlock = history.length
    ? history.map((m) => `[${m.sender.name ?? m.sender.userId}]: ${m.text}`).join('\n')
    : '（无群聊记录）';

  const docsBlock = linkedDocs.length
    ? linkedDocs
        .map((d, i) => {
          const head = `--- 文档 ${i + 1}（${d.kind}${d.title ? `：${d.title}` : ''}） ${d.url} ---`;
          return `${head}\n${truncate(d.content, MAX_DOC_CHARS_EACH)}`;
        })
        .join('\n\n')
    : '';

  const hasDocs = linkedDocs.length > 0;

  // 关键：当用户贴了文档时，文档是唯一权威源，群聊记录只能作为「补充上下文」用，
  // 不能反过来把群聊里其他无关讨论混进 PRD —— 否则会出现「老王在群里问 K12 备课
  // 项目，新人贴了协作 Bot 的 wiki，最后生成的 PRD 一半 K12 一半协作 Bot」这种情况。
  const priorityDirective = hasDocs
    ? `本次输入中包含关联文档（见下方「关联文档」段落）。**关联文档是本次需求的唯一权威来源**：
- title / background / goals / scope / deliverables 必须**主要来自关联文档正文**。
- 群聊记录仅在文档明确缺失某字段时作为补充参考；与文档主题无关的历史讨论必须忽略。
- 若群聊里讨论的是「项目 A」而文档讲的是「项目 B」，本次只输出项目 B 的 PRD，不要混合。`
    : `本次输入只有群聊记录，没有关联文档。结合最近的多轮上下文综合判断真实需求。`;

  return `
根据以下输入，提取项目需求并整理成结构化文档。

输入可能形态：
- 单条消息直接说出需求
- 多轮对话逐步澄清需求
- 群里只发了一个文档链接，真实需求写在文档正文里
- 上述组合

${priorityDirective}

输出要求：
- title：项目标题，简洁体现核心价值（10 字内）
- background：项目背景，1-2 段，说明缘由与上下文
- goals：项目目标列表，每条单一目标
- scope：项目范围，1 段，明确包含与不包含的内容
- deliverables：具体交付物列表（文档/接口/页面/演示等可验收物）

只返回 JSON，不要有额外文字。

群聊记录${hasDocs ? '（仅供参考，文档优先）' : ''}：
${historyBlock}
${docsBlock ? `\n关联文档（**主要依据**）：\n${docsBlock}\n` : ''}
`.trim();
};

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

// ─── Feishu URL parsing ───────────────────────────────────────────────────────

/** 仅识别 doc / docx / wiki —— slides/bitable 不作为需求来源。 */
const FEISHU_DOC_RE =
  /https?:\/\/[^/\s)\]]*(?:feishu\.cn|lark\.cn|larkoffice\.com)\/(docx?|wiki)\/([A-Za-z0-9_-]{5,})/g;

export interface ParsedDocUrl {
  readonly kind: 'doc' | 'wiki';
  readonly token: string;
  readonly url: string;
}

/** 从一组消息里抽取所有飞书 doc / wiki 链接，最多 5 条以限制下游 API 调用。 */
export function parseFeishuDocUrls(messages: readonly Message[]): ParsedDocUrl[] {
  const seen = new Set<string>();
  const out: ParsedDocUrl[] = [];

  for (const msg of messages) {
    const haystacks = [msg.text];
    if (msg.rawContent && msg.rawContent !== msg.text) haystacks.push(msg.rawContent);

    for (const haystack of haystacks) {
      const normalized = haystack.replaceAll('\\/', '/');
      FEISHU_DOC_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FEISHU_DOC_RE.exec(normalized)) !== null) {
        const type = m[1] ?? '';
        const token = m[2] ?? '';
        if (!token || seen.has(token)) continue;
        seen.add(token);
        out.push({
          kind: type === 'wiki' ? 'wiki' : 'doc',
          token,
          url: m[0],
        });
        if (out.length >= 5) return out;
      }
    }
  }

  return out;
}
