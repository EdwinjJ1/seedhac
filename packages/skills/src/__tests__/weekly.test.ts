import { describe, it, expect, vi } from 'vitest';
import { ok } from '@seedhac/contracts';
import type { MemoryRecord, SkillContext } from '@seedhac/contracts';
import { weeklySkill } from '../weekly.js';

function makeLog(id: string, sourceSkill: string, content: string): MemoryRecord {
  return {
    id,
    kind: 'skill_log',
    chat_id: 'oc_chat1',
    key: id,
    content,
    importance: 8,
    last_access: 1,
    created_at: 1,
    source_skill: sourceSkill,
  };
}

function makeCtx(logs: readonly MemoryRecord[]): SkillContext {
  return {
    event: {
      type: 'schedule',
      payload: { chatId: 'oc_chat1', skillName: 'weekly', timestamp: Date.now() },
    },
    runtime: {} as SkillContext['runtime'],
    llm: {
      ask: vi.fn().mockResolvedValue(
        ok(
          JSON.stringify({
            title: '项目周快照',
            highlights: ['完成 M6 自动写入'],
            decisions: ['memory 表作为单一持久化层'],
            todos: ['观察表容量'],
            summary: '本周完成 memory 闭环。',
          }),
        ),
      ),
      chat: vi.fn(),
      askStructured: vi.fn(),
      chatWithTools: vi.fn(),
    } as unknown as SkillContext['llm'],
    bitable: {} as SkillContext['bitable'],
    docx: {} as SkillContext['docx'],
    cardBuilder: {
      build: vi.fn().mockReturnValue({ templateName: 'weekly', content: { ok: true } }),
    } as unknown as SkillContext['cardBuilder'],
    retrievers: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    memoryStore: {
      read: vi.fn(),
      search: vi.fn(),
      list: vi.fn().mockResolvedValue(ok(logs)),
      write: vi.fn().mockResolvedValue(
        ok({
          id: 'project_1',
          kind: 'project',
          chat_id: 'oc_chat1',
          key: 'weekly',
          content: 'snapshot',
          importance: 9,
          last_access: 1,
          created_at: 1,
          source_skill: 'weekly',
        }),
      ),
      delete: vi.fn().mockResolvedValue(ok(undefined)),
      score: vi.fn(),
    },
  };
}

describe('weeklySkill', () => {
  it('compresses high-importance skill_log into project snapshot and deletes logs', async () => {
    const logs = [
      makeLog('log_1', 'qa', '回答了项目范围问题'),
      makeLog('log_2', 'summary', '整理了关键会议结论'),
    ];
    const ctx = makeCtx(logs);

    expect(await weeklySkill.match(ctx)).toBe(true);
    const result = await weeklySkill.run(ctx);

    expect(result.ok).toBe(true);
    expect(ctx.memoryStore?.list).toHaveBeenCalledWith({
      chatId: 'oc_chat1',
      kind: 'skill_log',
      minImportance: 7,
      limit: 100,
    });
    expect(ctx.memoryStore?.write).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'project',
        chat_id: 'oc_chat1',
        source_skill: 'weekly',
        importance: 9,
      }),
    );
    expect(ctx.memoryStore?.delete).toHaveBeenCalledTimes(2);
    if (result.ok) {
      expect(result.value.card?.templateName).toBe('weekly');
      expect(result.value.reasoning).toContain('压缩 2 条');
    }
  });
});
