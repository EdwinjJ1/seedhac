import { describe, it, expect, vi } from 'vitest';
import { SystemPromptCache } from '../../memory/system-prompt.js';

// Mock node:fs/promises so tests don't hit disk
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

const mockReadFile = readFile as ReturnType<typeof vi.fn>;

// ─── helpers ─────────────────────────────────────────────────────────────────

function setupReadFile(overviewContent: string, skillContent: string): void {
  mockReadFile.mockImplementation((filePath: string) => {
    const p = String(filePath);
    if (p.endsWith('OVERVIEW.md')) return Promise.resolve(overviewContent);
    if (p.includes('/skills/')) return Promise.resolve(skillContent);
    return Promise.reject(new Error('ENOENT'));
  });
}

// ─── load ────────────────────────────────────────────────────────────────────

describe('SystemPromptCache.load', () => {
  it('loads overview first non-title line and skill summaries', async () => {
    setupReadFile(
      '# Lark Loom Bot\n群聊 AI 助手，主动介入信息缺口。\n\n更多内容...',
      '# recall — 主动浮信息\n触发条件：...',
    );
    const cache = await SystemPromptCache.load('/fake/docs');
    const prompt = cache.build({ chatId: 'oc_1' });
    expect(prompt).toContain('群聊 AI 助手');
    expect(prompt).toContain('oc_1');
  });

  it('gracefully handles missing files — does not throw', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(SystemPromptCache.load('/nonexistent')).resolves.toBeDefined();
  });
});

// ─── build ───────────────────────────────────────────────────────────────────

describe('SystemPromptCache.build', () => {
  it('happy path: returns non-empty prompt with chatId and tool list', async () => {
    setupReadFile('项目定位句。', '# Skill 文档');
    const cache = await SystemPromptCache.load('/fake/docs');
    const prompt = cache.build({ chatId: 'oc_chat_123' });

    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('oc_chat_123');
    expect(prompt).toContain('memory.read');
    expect(prompt).toContain('memory.search');
    expect(prompt).toContain('skill.list');
    expect(prompt).toContain('skill.read');
  });

  it('chatId 为空时不崩溃，使用占位符', async () => {
    setupReadFile('', '');
    const cache = await SystemPromptCache.load('/fake/docs');
    expect(() => cache.build({})).not.toThrow();
    const prompt = cache.build({});
    expect(prompt).toContain('(unknown)');
  });

  it('mention=true 时 prompt 包含主动回应提示', async () => {
    setupReadFile('', '');
    const cache = await SystemPromptCache.load('/fake/docs');
    const withMention = cache.build({ chatId: 'oc_1', mention: true });
    const withoutMention = cache.build({ chatId: 'oc_1', mention: false });
    expect(withMention).toContain('@了 Bot');
    expect(withoutMention).not.toContain('@了 Bot');
  });

  it('prompt 不超过 2KB', async () => {
    // 用超长内容测试截断
    const longLine = '这是非常非常长的描述行。'.repeat(50);
    setupReadFile(longLine, longLine);
    const cache = await SystemPromptCache.load('/fake/docs');
    const prompt = cache.build({ chatId: 'oc_1' });
    const bytes = new TextEncoder().encode(prompt).length;
    expect(bytes).toBeLessThanOrEqual(2 * 1024);
  });
});
