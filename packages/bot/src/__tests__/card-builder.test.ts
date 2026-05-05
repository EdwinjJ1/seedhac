/**
 * CardBuilder 单元测试
 * 主链路 7 种 + 附属 3 种，各 1 个 case。
 * 验证：templateName 正确、JSON 结构合法、无 {{xxx}} 占位符、关键内容存在。
 */

import { describe, expect, it } from 'vitest';
import { larkCardBuilder } from '../card-builder.js';

function json(card: ReturnType<typeof larkCardBuilder.build>): string {
  return JSON.stringify(card);
}

function noPlaceholders(s: string): boolean {
  return !/\{\{[^}]+\}\}/.test(s);
}

function schema(card: ReturnType<typeof larkCardBuilder.build>) {
  return card.content as {
    schema: string;
    header: { title: { content: string }; template: string };
    body: { elements: Array<{ tag: string; [k: string]: unknown }> };
  };
}

// ── 主链路 ────────────────────────────────────────────────────────────────────

describe('activation card', () => {
  it('has yes/no buttons and chat name', () => {
    const card = larkCardBuilder.build('activation', {
      chatName: 'Lark Loom 测试群',
    });
    expect(card.templateName).toBe('activation');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('Lark Loom 测试群');
    expect(j).toContain('开启助手');
    expect(j).toContain('暂不需要');
    // 必须有两个按钮
    const btns = schema(card).body.elements.filter((e) => e.tag === 'button');
    expect(btns.length).toBe(2);
  });
});

describe('docPush card', () => {
  it('shows doc title, type label, open button, and permission note', () => {
    const card = larkCardBuilder.build('docPush', {
      docTitle: '业务探索需求文档 v1',
      docUrl: 'https://feishu.cn/docs/abc',
      docType: 'requirement',
      summary: '梳理了核心用户场景和验收标准。',
    });
    expect(card.templateName).toBe('docPush');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('业务探索需求文档 v1');
    expect(j).toContain('📋 需求文档');
    expect(j).toContain('打开文档');
    expect(j).toContain('仅群内成员');
  });
});

describe('tablePush card', () => {
  it('shows task count, members, nearest due, and open button', () => {
    const card = larkCardBuilder.build('tablePush', {
      tableTitle: '业务探索 · 分工表',
      bitableUrl: 'https://feishu.cn/bitable/xyz',
      taskCount: 5,
      members: ['Antares', 'Evan', '沛彤'],
      nearestDue: '2026-05-06',
    });
    expect(card.templateName).toBe('tablePush');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('5 个任务');
    expect(j).toContain('@Antares');
    expect(j).toContain('2026-05-06');
    expect(j).toContain('查看分工表');
  });
});

describe('qa card', () => {
  it('shows question, answer, sources, and buttons', () => {
    const card = larkCardBuilder.build('qa', {
      question: '复赛截止日期是什么时候？',
      answer: '复赛日期为 **2026-05-06**。',
      sources: [
        {
          title: '群聊历史消息',
          kind: 'chat',
          snippet: '复赛日期是 2026-05-06',
          authorName: 'Antares',
          timestamp: Date.parse('2026-05-03T10:30:00+08:00'),
        },
        { title: 'README', kind: 'wiki', snippet: '时间节点表' },
      ],
      buttons: [
        { text: '查看原文', value: { action: 'open', target: 'readme' }, variant: 'primary' },
      ],
    });
    expect(card.templateName).toBe('qa');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('复赛截止日期');
    expect(j).toContain('2026-05-06');
    expect(j).toContain('Antares');
    expect(j).toContain('README');
  });
});

describe('summary card', () => {
  it('renders 议题 / 决策 / 待办 / 待跟进 four sections', () => {
    const card = larkCardBuilder.build('summary', {
      title: '第一次碰头会',
      topics: ['产品方向', '技术选型'],
      decisions: ['采用飞书 Card 2.0'],
      todos: [{ text: '实现 CardBuilder', assignee: 'Antares', due: '2026-05-06' }],
      followUps: ['确认 API 配额'],
    });
    expect(card.templateName).toBe('summary');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('议题');
    expect(j).toContain('决策');
    expect(j).toContain('待办');
    expect(j).toContain('待跟进');
    expect(j).toContain('@Antares');
  });
});

describe('slides card', () => {
  it('shows page count, H2 titles, bullets, and open button', () => {
    const card = larkCardBuilder.build('slides', {
      title: '业务探索汇报',
      presentationUrl: 'https://feishu.cn/slides/abc',
      pageCount: 3,
      preview: [
        { title: '背景', bullets: ['市场机会'] },
        { title: '方案', bullets: ['架构图'] },
        { title: '下一步', bullets: ['MVP'] },
      ],
    });
    expect(card.templateName).toBe('slides');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('3 页');
    expect(j).toContain('## 1. 背景');
    expect(j).toContain('市场机会');
    expect(j).toContain('打开演示文稿');
  });
});

describe('archive card', () => {
  it('shows title, summary, tags, recordId, and open button', () => {
    const card = larkCardBuilder.build('archive', {
      recordId: 'rec_001',
      title: '业务探索 · 最终归档',
      bitableUrl: 'https://feishu.cn/bitable/archive',
      tags: ['2026-Q2', '已完成'],
      summary: '完成了需求验证，形成了 MVP 方案。',
    });
    expect(card.templateName).toBe('archive');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('rec_001');
    expect(j).toContain('2026-Q2');
    expect(j).toContain('完成了需求验证');
    expect(j).toContain('查看归档表格');
  });
});

// ── 附属链路 ──────────────────────────────────────────────────────────────────

describe('offlineSummary card', () => {
  it('shows offline time range, message count, and highlights', () => {
    const from = new Date('2026-05-01T10:00:00+08:00').getTime();
    const to = new Date('2026-05-01T12:00:00+08:00').getTime();
    const card = larkCardBuilder.build('offlineSummary', {
      offlineFrom: from,
      offlineTo: to,
      highlights: ['Evan 完成了 WSClient 接入', '沛彤更新了需求文档', '确定了复赛演示顺序'],
      messageCount: 52,
    });
    expect(card.templateName).toBe('offlineSummary');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('52 条新消息');
    expect(j).toContain('Evan 完成了 WSClient 接入');
  });
});

describe('docChange card', () => {
  it('shows editor, change summary, affected tasks, and open button', () => {
    const card = larkCardBuilder.build('docChange', {
      editorName: '沛彤',
      docTitle: '业务探索需求文档',
      docUrl: 'https://feishu.cn/docs/abc',
      changeSummary: '修改了验收标准，新增了两个边界场景。',
      affectedTasks: ['CardBuilder 实现', 'Skill Router 设计'],
    });
    expect(card.templateName).toBe('docChange');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('沛彤');
    expect(j).toContain('修改了验收标准');
    expect(j).toContain('CardBuilder 实现');
    expect(j).toContain('查看文档');
  });
});

describe('weekly card', () => {
  it('renders weekRange, highlights, decisions, todos, metrics', () => {
    const card = larkCardBuilder.build('weekly', {
      weekRange: '2026-04-29 ~ 2026-05-05',
      highlights: ['CardBuilder 完成'],
      decisions: ['recall 走文本输出'],
      todos: ['接入 WSClient'],
      metrics: { 'PR 合并数': 3 },
    });
    expect(card.templateName).toBe('weekly');
    const j = json(card);
    expect(noPlaceholders(j)).toBe(true);
    expect(j).toContain('2026-04-29 ~ 2026-05-05');
    expect(j).toContain('CardBuilder 完成');
    expect(j).toContain('PR 合并数');
  });
});
