import { describe, it, expect, vi } from 'vitest';
import { ErrorCode } from '@seedhac/contracts';
import { LarkSlidesClient } from '../slides-client.js';

const OUTLINE = {
  title: '项目进展汇报',
  slides: [
    { heading: '项目背景', bullets: ['提升协作效率', '覆盖核心流程'] },
    { heading: '下一步计划', bullets: ['上线演示', '收集反馈'] },
  ],
};

describe('LarkSlidesClient', () => {
  it('calls lark-cli slides +create and returns the generated slides URL', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        ok: true,
        data: {
          presentation: {
            token: 'sldcn123',
            url: 'https://example.feishu.cn/slides/sldcn123',
          },
        },
      }),
      stderr: '',
    });
    const slidesClient = new LarkSlidesClient({ bin: 'lark-cli', as: 'user', execFile });

    const result = await slidesClient.createFromOutline(OUTLINE.title, OUTLINE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slidesToken).toBe('sldcn123');
      expect(result.value.url).toBe('https://example.feishu.cn/slides/sldcn123');
    }
    expect(execFile).toHaveBeenCalledWith(
      'lark-cli',
      expect.arrayContaining([
        'slides',
        '+create',
        '--as',
        'user',
        '--title',
        OUTLINE.title,
        '--slides',
      ]),
      expect.objectContaining({ maxBuffer: expect.any(Number) }),
    );
    const firstCall = execFile.mock.calls[0];
    expect(firstCall).toBeDefined();
    const args = firstCall?.[1] as string[];
    const slidesJson = args[args.indexOf('--slides') + 1];
    expect(slidesJson).toBeDefined();
    if (!slidesJson) throw new Error('missing --slides argument');
    expect(JSON.parse(slidesJson)).toHaveLength(2);
    expect(slidesJson).toContain('项目背景');
    expect(slidesJson).toContain('height=\\"540\\"');
    expect(slidesJson).not.toContain('height=\\"720\\"');
  });

  it('can parse a slides URL from plain CLI output', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: 'created: https://example.feishu.cn/slides/sldcn456\n',
      stderr: '',
    });
    const slidesClient = new LarkSlidesClient({ execFile });

    const result = await slidesClient.createFromOutline(OUTLINE.title, OUTLINE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slidesToken).toBe('sldcn456');
      expect(result.value.url).toBe('https://example.feishu.cn/slides/sldcn456');
    }
  });

  it('constructs a slides URL from lark-cli xml_presentation_id output', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        ok: true,
        identity: 'user',
        data: {
          revision_id: 1,
          slide_ids: ['puu'],
          slides_added: 1,
          title: 'Lark Loom 手测',
          xml_presentation_id: 'FPQ8sgoUhlsLdMd43e3crZaAnkg',
        },
      }),
      stderr: '',
    });
    const slidesClient = new LarkSlidesClient({ execFile, baseUrl: 'https://feishu.cn' });

    const result = await slidesClient.createFromOutline(OUTLINE.title, OUTLINE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slidesToken).toBe('FPQ8sgoUhlsLdMd43e3crZaAnkg');
      expect(result.value.url).toBe('https://feishu.cn/slides/FPQ8sgoUhlsLdMd43e3crZaAnkg');
    }
  });

  it('returns INVALID_INPUT when the outline has no slides', async () => {
    const execFile = vi.fn();
    const slidesClient = new LarkSlidesClient({ execFile });
    const result = await slidesClient.createFromOutline('空演示文稿', { title: '空演示文稿', slides: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.INVALID_INPUT);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('returns FEISHU_API_ERROR when lark-cli fails', async () => {
    const execFile = vi.fn().mockRejectedValue(new Error('keychain not initialized'));
    const slidesClient = new LarkSlidesClient({ execFile });
    const result = await slidesClient.createFromOutline(OUTLINE.title, OUTLINE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.FEISHU_API_ERROR);
      expect(result.error.message).toContain('keychain not initialized');
    }
  });
});
