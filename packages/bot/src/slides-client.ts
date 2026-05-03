import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ErrorCode,
  err,
  makeError,
  ok,
  type Result,
  type SlidesClient,
  type SlidesOutline,
  type SlidesRef,
} from '@seedhac/contracts';

type ExecFileResult = { stdout: string; stderr: string };
type ExecFile = (
  file: string,
  args: readonly string[],
  options?: { maxBuffer?: number },
) => Promise<ExecFileResult>;

const execFile = promisify(execFileCallback) as ExecFile;

export interface LarkSlidesClientOptions {
  readonly bin?: string;
  readonly as?: 'user' | 'bot';
  readonly baseUrl?: string;
  readonly execFile?: ExecFile;
}

export class LarkSlidesClient implements SlidesClient {
  private readonly bin: string;
  private readonly as: 'user' | 'bot';
  private readonly baseUrl: string;
  private readonly execFile: ExecFile;

  constructor(options: LarkSlidesClientOptions = {}) {
    this.bin = options.bin ?? 'lark-cli';
    this.as = options.as ?? 'user';
    this.baseUrl = options.baseUrl ?? 'https://feishu.cn';
    this.execFile = options.execFile ?? execFile;
  }

  async createFromOutline(title: string, outline: SlidesOutline): Promise<Result<SlidesRef>> {
    const slides = outline.slides.map((slide, index) => renderSlideXml(slide, index));
    if (!slides.length) {
      return err(makeError(ErrorCode.INVALID_INPUT, 'slides outline must contain at least one page'));
    }

    try {
      const { stdout, stderr } = await this.execFile(
        this.bin,
        [
          'slides',
          '+create',
          '--as',
          this.as,
          '--title',
          title,
          '--slides',
          JSON.stringify(slides),
        ],
        { maxBuffer: 1024 * 1024 * 10 },
      );

      const ref = parseSlidesRef(stdout, this.baseUrl);
      if (!ref) {
        return err(
          makeError(
            ErrorCode.FEISHU_API_ERROR,
            'lark-cli did not return a slides url or xml_presentation_id',
            undefined,
            { stdout, stderr },
          ),
        );
      }

      return ok(ref);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return err(makeError(ErrorCode.FEISHU_API_ERROR, `lark-cli slides +create failed: ${message}`));
    }
  }
}

function renderSlideXml(slide: SlidesOutline['slides'][number], index: number): string {
  const bgColor = index % 2 === 0 ? 'rgb(246,248,250)' : 'rgb(255,250,240)';
  const accentColor = index % 2 === 0 ? 'rgb(37,99,235)' : 'rgb(217,119,6)';
  const bullets = slide.bullets
    .slice(0, 5)
    .map((bullet) => `<li><p>${escapeXml(bullet)}</p></li>`)
    .join('');
  const notes = slide.notes
    ? `<shape type="text" topLeftX="80" topLeftY="465" width="820" height="44"><content textType="caption"><p>${escapeXml(slide.notes)}</p></content></shape>`
    : '';

  return [
    '<slide xmlns="http://www.larkoffice.com/sml/2.0">',
    '<style>',
    `<fill><fillColor color="${bgColor}"/></fill>`,
    '</style>',
    '<data>',
    `<shape type="rect" topLeftX="0" topLeftY="0" width="18" height="540"><style><fill><fillColor color="${accentColor}"/></fill></style></shape>`,
    `<shape type="text" topLeftX="80" topLeftY="52" width="820" height="86"><content textType="title"><p>${escapeXml(slide.heading)}</p></content></shape>`,
    `<shape type="text" topLeftX="86" topLeftY="170" width="800" height="260"><content textType="body"><ul>${bullets}</ul></content></shape>`,
    notes,
    '</data>',
    '</slide>',
  ].join('');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseSlidesRef(output: string, baseUrl: string): SlidesRef | undefined {
  const parsed = parseJsonOutput(output);
  const url = parsed ? findString(parsed, (value) => /https?:\/\/\S+\/slides\//.test(value)) : undefined;
  const xmlPresentationId = parsed ? findStringByKey(parsed, 'xml_presentation_id') : undefined;
  const tokenFromJson = parsed
    ? findString(parsed, (value) => /^[A-Za-z0-9_-]{8,}$/.test(value) && !value.startsWith('http'))
    : undefined;
  const urlFromText = output.match(/https?:\/\/\S+\/slides\/[A-Za-z0-9_-]+/)?.[0];
  const finalUrl = stripTrailingPunctuation(url ?? urlFromText);
  const slidesToken = extractTokenFromUrl(finalUrl ?? '') ?? xmlPresentationId ?? tokenFromJson;
  if (!slidesToken) return undefined;

  return {
    slidesToken,
    url: finalUrl ?? `${baseUrl.replace(/\/$/, '')}/slides/${slidesToken}`,
  };
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStart = trimmed.indexOf('{');
    const jsonEnd = trimmed.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd <= jsonStart) return undefined;
    try {
      return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    } catch {
      return undefined;
    }
  }
}

function findString(value: unknown, predicate: (value: string) => boolean): string | undefined {
  if (typeof value === 'string') return predicate(value) ? value : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      const found = findString(item, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

function findStringByKey(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKey(item, key);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record[key] === 'string') return record[key];
    for (const item of Object.values(record)) {
      const found = findStringByKey(item, key);
      if (found) return found;
    }
  }
  return undefined;
}

function stripTrailingPunctuation(value: string | undefined): string | undefined {
  return value?.replace(/[),.;\]]+$/, '');
}

function extractTokenFromUrl(url: string): string | undefined {
  return url.match(/\/slides\/([A-Za-z0-9_-]+)/)?.[1];
}

export function createSlidesClient(): LarkSlidesClient {
  const bin = process.env['LARK_CLI_BIN'];
  const as = process.env['LARK_SLIDES_CLI_AS'];
  const baseUrl = process.env['LARK_SLIDES_BASE_URL'];
  return new LarkSlidesClient({
    ...(bin && { bin }),
    ...(as === 'bot' || as === 'user' ? { as } : {}),
    ...(baseUrl && { baseUrl }),
  });
}
