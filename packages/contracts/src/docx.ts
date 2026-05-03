import type { Result } from './result.js';

export interface DocRef {
  readonly docToken: string;
  readonly url: string;
}

export type DocBlock =
  | { type: 'heading1'; text: string }
  | { type: 'heading2'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string };

export interface DocxClient {
  create(title: string): Promise<Result<DocRef>>;
  appendBlocks(docToken: string, blocks: readonly DocBlock[]): Promise<Result<void>>;
  getShareLink(docToken: string): Promise<Result<string>>;
  /** 解析 markdown，调 create + appendBlocks，一步完成 */
  createFromMarkdown(title: string, markdown: string): Promise<Result<DocRef>>;
}
