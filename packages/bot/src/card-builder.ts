/**
 * LarkCardBuilder — 飞书 Card 2.0 JSON 构造器
 *
 * 实现 @seedhac/contracts 的 CardBuilder 接口，
 * 为 7 条业务主线各提供一个模板方法。
 *
 * 飞书 Card 2.0 envelope 直接作为 im.message.create 的 content 字段。
 *
 * 注意：Card 2.0 (schema "2.0") 不支持 `action` 标签；
 * 按钮直接作为 body element，交互行为用 behaviors 描述。
 */

import type {
  ArchiveCardInput,
  Card,
  CardBuilder,
  CardButton,
  CardInputMap,
  CardSource,
  CardTemplateName,
  CrossChatCardInput,
  QaCardInput,
  RecallCardInput,
  SlidesCardInput,
  SummaryCardInput,
  WeeklyCardInput,
} from '@seedhac/contracts';

// ─── 飞书 Card 2.0 低层类型 ───────────────────────────────────────────────────

type TextTag = { tag: 'plain_text'; content: string };
type MdElement = { tag: 'markdown'; content: string };
type HrElement = { tag: 'hr' };

/** Card 2.0 按钮行为：回调（传 value 给服务端）或直接打开 URL */
type BehaviorCallback = { type: 'callback'; value: Record<string, unknown> };
type BehaviorOpenUrl = { type: 'open_url'; default_url: string };
type Behavior = BehaviorCallback | BehaviorOpenUrl;

type ButtonElement = {
  tag: 'button';
  text: TextTag;
  type: 'primary' | 'default' | 'danger';
  behaviors: Behavior[];
};

type BodyElement = MdElement | HrElement | ButtonElement;

interface FeishuCard {
  schema: '2.0';
  header: {
    title: TextTag;
    template: string;
  };
  body: {
    elements: BodyElement[];
  };
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

function plainText(content: string): TextTag {
  return { tag: 'plain_text', content };
}

function md(content: string): MdElement {
  return { tag: 'markdown', content };
}

function hr(): HrElement {
  return { tag: 'hr' };
}

/**
 * 构造 Card 2.0 按钮。
 * 若 value 含 { action: 'open_url', url: string }，自动转为 open_url behavior；
 * 否则用 callback behavior。
 */
function button(
  text: string,
  value: Record<string, unknown>,
  type: ButtonElement['type'] = 'default',
): ButtonElement {
  const behavior: Behavior =
    value['action'] === 'open_url' && typeof value['url'] === 'string'
      ? { type: 'open_url', default_url: value['url'] }
      : { type: 'callback', value };

  return { tag: 'button', text: plainText(text), type, behaviors: [behavior] };
}

/** 把 CardSource[] 渲染成 markdown 来源列表 */
function renderSources(sources: readonly CardSource[]): string {
  if (sources.length === 0) return '';
  const kindMap: Record<CardSource['kind'], string> = {
    wiki: '📄 Wiki',
    bitable: '📊 表格',
    chat: '💬 群聊',
    minutes: '🎙 妙记',
    web: '🌐 网页',
    other: '📎 其他',
  };
  const lines = sources.map((s) => {
    const label = s.url ? `[${s.title}](${s.url})` : s.title;
    const prefix = kindMap[s.kind] ?? '📎';
    return `- ${prefix} ${label}${s.snippet ? `：${s.snippet}` : ''}`;
  });
  return `**来源**\n${lines.join('\n')}`;
}

/** 把 CardButton[] 渲染成 ButtonElement[]（直接放入 elements） */
function renderButtons(btns: readonly CardButton[]): ButtonElement[] {
  return btns.map((b) =>
    button(
      b.text,
      b.value,
      b.variant === 'primary' ? 'primary' : b.variant === 'danger' ? 'danger' : 'default',
    ),
  );
}

/** 把 FeishuCard 包装成 Card 契约结构 */
function wrap(templateName: CardTemplateName, feishu: FeishuCard): Card {
  return {
    templateName,
    content: feishu as unknown as Record<string, unknown>,
  };
}

// ─── 7 种卡片构造函数 ─────────────────────────────────────────────────────────

function buildQa(input: QaCardInput): Card {
  const elements: BodyElement[] = [
    md(`**问题**\n${input.question}`),
    hr(),
    md(`**回答**\n${input.answer}`),
  ];

  const sourceText = renderSources(input.sources);
  if (sourceText) elements.push(hr(), md(sourceText));

  if (input.buttons && input.buttons.length > 0) {
    elements.push(...renderButtons(input.buttons));
  }

  return wrap('qa', {
    schema: '2.0',
    header: { title: plainText('智能问答'), template: 'blue' },
    body: { elements },
  });
}

function buildRecall(input: RecallCardInput): Card {
  const elements: BodyElement[] = [
    md(`**触发语句**\n"${input.trigger}"`),
    hr(),
    md(`**历史信息摘要**\n${input.summary}`),
  ];

  const sourceText = renderSources(input.sources);
  if (sourceText) elements.push(hr(), md(sourceText));

  // recall 必须有「这条不相关」按钮
  elements.push(button('这条不相关', { action: 'dismiss', trigger: input.trigger }, 'danger'));
  if (input.buttons) elements.push(...renderButtons(input.buttons));

  return wrap('recall', {
    schema: '2.0',
    header: { title: plainText('历史信息召回'), template: 'wathet' },
    body: { elements },
  });
}

function buildSummary(input: SummaryCardInput): Card {
  const elements: BodyElement[] = [md(`**${input.title}**`), hr()];

  if (input.topics.length > 0)
    elements.push(md(`**📋 议题**\n${input.topics.map((t) => `- ${t}`).join('\n')}`));

  if (input.decisions.length > 0)
    elements.push(hr(), md(`**✅ 决策**\n${input.decisions.map((d) => `- ${d}`).join('\n')}`));

  if (input.todos.length > 0) {
    const todoLines = input.todos.map((t) => {
      let line = `- ${t.text}`;
      if (t.assignee) line += ` @${t.assignee}`;
      if (t.due) line += ` (截止 ${t.due})`;
      return line;
    });
    elements.push(hr(), md(`**🔲 待办**\n${todoLines.join('\n')}`));
  }

  if (input.followUps.length > 0)
    elements.push(hr(), md(`**🔍 待跟进**\n${input.followUps.map((f) => `- ${f}`).join('\n')}`));

  return wrap('summary', {
    schema: '2.0',
    header: { title: plainText('会议/阶段总结'), template: 'green' },
    body: { elements },
  });
}

function buildSlides(input: SlidesCardInput): Card {
  const elements: BodyElement[] = [md(`**${input.title}**\n共 ${input.pageCount} 页`), hr()];

  if (input.preview && input.preview.length > 0) {
    const previewMd = input.preview
      .map((page, i) => {
        const bullets = page.bullets.map((b) => `  - ${b}`).join('\n');
        return `## ${i + 1}. ${page.title}\n${bullets}`;
      })
      .join('\n\n');
    elements.push(md(previewMd), hr());
  }

  elements.push(button('打开演示文稿', { action: 'open_url', url: input.presentationUrl }, 'primary'));

  return wrap('slides', {
    schema: '2.0',
    header: { title: plainText('演示文稿已生成'), template: 'orange' },
    body: { elements },
  });
}

function buildArchive(input: ArchiveCardInput): Card {
  const tagLine = input.tags.length > 0 ? input.tags.map((t) => `\`${t}\``).join(' ') : '—';

  const elements: BodyElement[] = [
    md(`**${input.title}**`),
    hr(),
    md(`📌 归档编号：\`${input.recordId}\`\n🏷 标签：${tagLine}`),
    button('查看归档表格', { action: 'open_url', url: input.bitableUrl }, 'primary'),
  ];

  return wrap('archive', {
    schema: '2.0',
    header: { title: plainText('项目已归档'), template: 'indigo' },
    body: { elements },
  });
}

function buildCrossChat(input: CrossChatCardInput): Card {
  const elements: BodyElement[] = [md(`**跨群搜索**\n"${input.query}"`), hr()];

  if (input.hits.length === 0) {
    elements.push(md('未找到相关记录。'));
  } else {
    const hitLines = input.hits.map((h) => {
      const time = new Date(h.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      return `**${h.chatName}** · ${time}\n> ${h.snippet}`;
    });
    elements.push(md(hitLines.join('\n\n')));
  }

  return wrap('crossChat', {
    schema: '2.0',
    header: { title: plainText('跨群信息检索'), template: 'violet' },
    body: { elements },
  });
}

function buildWeekly(input: WeeklyCardInput): Card {
  const elements: BodyElement[] = [md(`**周报：${input.weekRange}**`), hr()];

  if (input.highlights.length > 0)
    elements.push(md(`**🌟 本周亮点**\n${input.highlights.map((h) => `- ${h}`).join('\n')}`));

  if (input.decisions.length > 0)
    elements.push(hr(), md(`**✅ 本周决策**\n${input.decisions.map((d) => `- ${d}`).join('\n')}`));

  if (input.todos.length > 0)
    elements.push(hr(), md(`**🔲 下周待办**\n${input.todos.map((t) => `- ${t}`).join('\n')}`));

  if (input.metrics && Object.keys(input.metrics).length > 0) {
    const metricLines = Object.entries(input.metrics)
      .map(([k, v]) => `- ${k}：${v}`)
      .join('\n');
    elements.push(hr(), md(`**📊 关键指标**\n${metricLines}`));
  }

  return wrap('weekly', {
    schema: '2.0',
    header: { title: plainText('周报'), template: 'purple' },
    body: { elements },
  });
}

// ─── CardBuilder 实现 ─────────────────────────────────────────────────────────

const builders: {
  [K in CardTemplateName]: (input: CardInputMap[K]) => Card;
} = {
  qa: buildQa,
  recall: buildRecall,
  summary: buildSummary,
  slides: buildSlides,
  archive: buildArchive,
  crossChat: buildCrossChat,
  weekly: buildWeekly,
};

export const larkCardBuilder: CardBuilder = {
  build<K extends CardTemplateName>(template: K, input: CardInputMap[K]): Card {
    const fn = builders[template] as (input: CardInputMap[K]) => Card;
    return fn(input);
  },
};
