/**
 * CardBuilder 单元测试
 * 每种卡片各 1 个 case，验证：
 *   1. templateName 正确
 *   2. content 包含必要字段（schema / header / body）
 *   3. 无未替换的 {{xxx}} 占位符
 *   4. 特殊验收条件（recall 有「这条不相关」按钮，summary 四分区，slides H2 等）
 */

import { describe, expect, it } from 'vitest';
import { larkCardBuilder } from '../card-builder.js';

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function stringify(card: unknown): string {
  return JSON.stringify(card);
}

function noUnreplacedPlaceholders(json: string): boolean {
  return !/\{\{[^}]+\}\}/.test(json);
}

function getContent(card: ReturnType<typeof larkCardBuilder.build>) {
  return card.content as {
    schema: string;
    header: { title: { content: string }; template: string };
    body: { elements: Array<{ tag: string; [k: string]: unknown }> };
  };
}

// ─── qa ────────────────────────────────────────────────────────────────────

describe('qa card', () => {
  it('builds valid structure with question, answer, sources, and buttons', () => {
    const card = larkCardBuilder.build('qa', {
      question: '这个项目的截止日期是什么时候？',
      answer: '根据分工表，截止日期是 2026-05-14。',
      sources: [
        { title: '分工表', url: 'https://example.com/bitable', kind: 'bitable', snippet: '决赛答辩' },
      ],
      buttons: [{ text: '查看原文', value: { url: 'https://example.com' }, variant: 'primary' }],
    });

    expect(card.templateName).toBe('qa');

    const c = getContent(card);
    expect(c.schema).toBe('2.0');
    expect(c.header.title.content).toBe('智能问答');
    expect(c.body.elements.length).toBeGreaterThan(0);

    const json = stringify(card);
    expect(noUnreplacedPlaceholders(json)).toBe(true);

    // question 和 answer 应出现在 JSON 里
    expect(json).toContain('这个项目的截止日期是什么时候？');
    expect(json).toContain('根据分工表，截止日期是 2026-05-14。');
    // sources 应出现
    expect(json).toContain('分工表');
  });
});

// ─── recall ────────────────────────────────────────────────────────────────

describe('recall card', () => {
  it('contains 「这条不相关」button and shows trigger + summary', () => {
    const card = larkCardBuilder.build('recall', {
      trigger: '之前讨论的那个技术方案',
      summary: '团队在 4 月 28 日决定采用 WebSocket 长连接方案。',
      sources: [{ title: '群历史消息', kind: 'chat' }],
    });

    expect(card.templateName).toBe('recall');

    const json = stringify(card);
    expect(noUnreplacedPlaceholders(json)).toBe(true);
    expect(json).toContain('这条不相关');
    expect(json).toContain('之前讨论的那个技术方案');
    expect(json).toContain('WebSocket 长连接方案');

    const c = getContent(card);
    // 必须有 button 元素（Card 2.0 按钮直接放在 elements，不用 action 包裹）
    const hasButton = c.body.elements.some((el) => el.tag === 'button');
    expect(hasButton).toBe(true);
  });
});

// ─── summary ───────────────────────────────────────────────────────────────

describe('summary card', () => {
  it('renders 议题 / 决策 / 待办 / 待跟进 four sections', () => {
    const card = larkCardBuilder.build('summary', {
      title: '第一次碰头会',
      topics: ['产品方向确认', '技术选型'],
      decisions: ['采用飞书 Card 2.0', '使用 pnpm monorepo'],
      todos: [
        { text: '实现 CardBuilder', assignee: 'Antares', due: '2026-05-06' },
        { text: '接入 WSClient', assignee: 'Evan' },
      ],
      followUps: ['确认飞书 API 配额', '补充 CLAUDE.md'],
    });

    expect(card.templateName).toBe('summary');

    const json = stringify(card);
    expect(noUnreplacedPlaceholders(json)).toBe(true);

    // 四个分区关键词
    expect(json).toContain('议题');
    expect(json).toContain('决策');
    expect(json).toContain('待办');
    expect(json).toContain('待跟进');

    // 内容正确替换
    expect(json).toContain('产品方向确认');
    expect(json).toContain('Antares');
    expect(json).toContain('2026-05-06');
  });
});

// ─── slides ────────────────────────────────────────────────────────────────

describe('slides card', () => {
  it('shows page count, H2 titles, bullets, and open button', () => {
    const card = larkCardBuilder.build('slides', {
      title: '业务探索汇报',
      presentationUrl: 'https://feishu.cn/slides/abc123',
      pageCount: 3,
      preview: [
        { title: '背景与目标', bullets: ['市场机会', '团队优势'] },
        { title: '技术方案', bullets: ['架构图', 'API 设计'] },
        { title: '下一步', bullets: ['MVP 上线', '用户反馈'] },
      ],
    });

    expect(card.templateName).toBe('slides');

    const json = stringify(card);
    expect(noUnreplacedPlaceholders(json)).toBe(true);

    // 页数标注
    expect(json).toContain('3 页');
    // H2 标题（## 1. ...)
    expect(json).toContain('## 1. 背景与目标');
    expect(json).toContain('## 2. 技术方案');
    // bullets
    expect(json).toContain('市场机会');
    // 打开链接按钮
    expect(json).toContain('打开演示文稿');
    expect(json).toContain('feishu.cn/slides/abc123');
  });
});

// ─── archive ───────────────────────────────────────────────────────────────

describe('archive card', () => {
  it('shows recordId, title, tags and bitable link button', () => {
    const card = larkCardBuilder.build('archive', {
      recordId: 'rec_archive_001',
      title: '业务探索项目 · 最终归档',
      bitableUrl: 'https://feishu.cn/bitable/archive',
      tags: ['2026-Q2', '探索项目', '已完成'],
    });

    expect(card.templateName).toBe('archive');

    const json = stringify(card);
    expect(noUnreplacedPlaceholders(json)).toBe(true);

    expect(json).toContain('rec_archive_001');
    expect(json).toContain('业务探索项目 · 最终归档');
    expect(json).toContain('2026-Q2');
    expect(json).toContain('查看归档表格');
  });
});

// ─── crossChat ─────────────────────────────────────────────────────────────

describe('crossChat card', () => {
  it('shows query and hit snippets from multiple chats', () => {
    const card = larkCardBuilder.build('crossChat', {
      query: '飞书 API 频控限制',
      hits: [
        {
          chatId: 'chat_001',
          chatName: '技术讨论群',
          snippet: '飞书 API 限制为每分钟 100 次请求。',
          timestamp: 1714406400000,
        },
        {
          chatId: 'chat_002',
          chatName: '基础设施群',
          snippet: '已配置 token bucket 进行限流。',
          timestamp: 1714492800000,
        },
      ],
    });

    expect(card.templateName).toBe('crossChat');

    const json = stringify(card);
    expect(noUnreplacedPlaceholders(json)).toBe(true);

    expect(json).toContain('飞书 API 频控限制');
    expect(json).toContain('技术讨论群');
    expect(json).toContain('基础设施群');
    expect(json).toContain('每分钟 100 次请求');
  });
});

// ─── weekly ────────────────────────────────────────────────────────────────

describe('weekly card', () => {
  it('renders weekRange, highlights, decisions, todos, and metrics', () => {
    const card = larkCardBuilder.build('weekly', {
      weekRange: '2026-04-22 ~ 2026-04-28',
      highlights: ['完成 CardBuilder 实现', '通过所有单元测试'],
      decisions: ['CardBuilder 放在 bot 包', 'contracts 包不引入运行时依赖'],
      todos: ['接入 WSClient', '实现 SkillRouter'],
      metrics: { 'Skill 完成数': 3, '测试覆盖率': 92 },
    });

    expect(card.templateName).toBe('weekly');

    const json = stringify(card);
    expect(noUnreplacedPlaceholders(json)).toBe(true);

    expect(json).toContain('2026-04-22 ~ 2026-04-28');
    expect(json).toContain('完成 CardBuilder 实现');
    expect(json).toContain('接入 WSClient');
    expect(json).toContain('Skill 完成数');
    expect(json).toContain('92');
  });
});
