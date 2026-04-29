/**
 * 飞书卡片输出契约。
 * 7 种卡片对应 7 条业务主线（qa / recall / summary / slides / archive / crossChat / weekly）。
 *
 * 实现层（CardBuilder）负责把这里定义的 Input 渲染成飞书 Card 2.0 JSON。
 * 模板 ID 在飞书卡片搭建工具 (open.feishu.cn/tool/cardbuilder) 上建好后回填。
 */

export type CardTemplateName =
  | 'qa'
  | 'recall'
  | 'summary'
  | 'slides'
  | 'archive'
  | 'crossChat'
  | 'weekly';

export interface CardSource {
  readonly title: string;
  readonly url?: string;
  /** 来源类型：飞书 Wiki / Bitable / 群历史消息 / 妙记 / Web ... */
  readonly kind: 'wiki' | 'bitable' | 'chat' | 'minutes' | 'web' | 'other';
  readonly snippet?: string;
}

export interface CardButton {
  readonly text: string;
  /** 按钮被点时透传的业务参数，进 CardAction.value */
  readonly value: Record<string, unknown>;
  readonly variant?: 'primary' | 'default' | 'danger';
}

export interface QaCardInput {
  readonly question: string;
  readonly answer: string;
  readonly sources: readonly CardSource[];
  readonly buttons?: readonly CardButton[];
}

export interface RecallCardInput {
  readonly trigger: string; // "上次/之前/我记得"命中的原句
  readonly summary: string;
  readonly sources: readonly CardSource[];
  readonly buttons?: readonly CardButton[];
}

export interface SummaryCardInput {
  readonly title: string;
  readonly topics: readonly string[];
  readonly decisions: readonly string[];
  readonly todos: readonly { text: string; assignee?: string; due?: string }[];
  readonly followUps: readonly string[];
}

export interface SlidesCardInput {
  readonly title: string;
  readonly presentationUrl: string;
  readonly pageCount: number;
  readonly preview?: readonly { title: string; bullets: readonly string[] }[];
}

export interface ArchiveCardInput {
  readonly recordId: string;
  readonly title: string;
  readonly bitableUrl: string;
  readonly tags: readonly string[];
}

export interface CrossChatCardInput {
  readonly query: string;
  readonly hits: readonly {
    chatId: string;
    chatName: string;
    snippet: string;
    timestamp: number;
  }[];
}

export interface WeeklyCardInput {
  readonly weekRange: string; // "2026-04-22 ~ 2026-04-28"
  readonly highlights: readonly string[];
  readonly decisions: readonly string[];
  readonly todos: readonly string[];
  readonly metrics?: Record<string, number>;
}

/** 模板 → 输入参数 的映射 */
export interface CardInputMap {
  qa: QaCardInput;
  recall: RecallCardInput;
  summary: SummaryCardInput;
  slides: SlidesCardInput;
  archive: ArchiveCardInput;
  crossChat: CrossChatCardInput;
  weekly: WeeklyCardInput;
}

/** 渲染后的飞书 Card 2.0 JSON 信封 — 直接喂给 im.message.create */
export interface Card {
  readonly templateName: CardTemplateName;
  /** 飞书 Card 2.0 schema 完整 JSON */
  readonly content: Record<string, unknown>;
  readonly meta?: Record<string, unknown>;
}

/** 卡片渲染器 */
export interface CardBuilder {
  build<K extends CardTemplateName>(template: K, input: CardInputMap[K]): Card;
}
