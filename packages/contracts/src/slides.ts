import type { Result } from './result.js';

export type SlideType = 'cover' | 'overview' | 'timeline' | 'risks' | 'nextSteps' | 'closing';

export interface SlideCard {
  readonly title: string;
  readonly value?: string;
  readonly detail?: string;
}

export interface SlideMilestone {
  readonly label: string;
  readonly date?: string;
  readonly status?: string;
}

export interface SlideRisk {
  readonly risk: string;
  readonly impact: string;
  readonly mitigation: string;
}

export interface SlideTask {
  readonly owner: string;
  readonly task: string;
  readonly due?: string;
}

export interface SlideDraft {
  readonly type: SlideType;
  readonly title: string;
  readonly presenterName?: string;
  readonly subtitle?: string;
  readonly bullets?: readonly string[];
  readonly cards?: readonly SlideCard[];
  readonly milestones?: readonly SlideMilestone[];
  readonly risks?: readonly SlideRisk[];
  readonly tasks?: readonly SlideTask[];
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

  /**
   * 把演示文稿按成员粒度授权（每个 user 一个 openid）。
   * 实现方需用与创建者一致的身份调用（默认 lark-cli `--as bot`，bot 即 owner）；
   * 否则会因为没有管理权限而失败。
   */
  grantMembersEdit(slidesToken: string, userIds: readonly string[]): Promise<Result<void>>;
}
