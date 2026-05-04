import type { Result } from './result.js';

export interface SlideDraft {
  readonly heading: string;
  readonly bullets: readonly string[];
  readonly notes?: string;
}

export interface SlidesOutline {
  readonly title: string;
  readonly slides: readonly SlideDraft[];
}

export interface SlidesRef {
  readonly slidesToken: string;
  readonly url: string;
}

export interface SlidesClient {
  /** 创建原生飞书演示文稿，返回可直接打开的 slides URL。 */
  createFromOutline(title: string, outline: SlidesOutline): Promise<Result<SlidesRef>>;
}
