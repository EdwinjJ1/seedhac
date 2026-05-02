/* eslint-disable @typescript-eslint/no-explicit-any */
import * as lark from '@larksuiteoapi/node-sdk';
import {
  ErrorCode,
  err,
  makeError,
  ok,
  type DocBlock,
  type DocRef,
  type DocxClient,
  type Result,
} from '@seedhac/contracts';

export class LarkDocxClient implements DocxClient {
  constructor(private readonly client: lark.Client) {}

  async create(title: string): Promise<Result<DocRef>> {
    try {
      const res = await this.client.docx.v1.document.create({
        data: { title },
      });

      if (res.code !== 0) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, `create document failed: ${res.msg}`));
      }

      const docToken = res.data?.document?.document_id;
      if (!docToken) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, 'no document_id returned'));
      }

      return ok({
        docToken,
        url: `https://feishu.cn/docx/${docToken}`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(makeError(ErrorCode.FEISHU_API_ERROR, `create document error: ${msg}`));
    }
  }

  async appendBlocks(docToken: string, blocks: readonly DocBlock[]): Promise<Result<void>> {
    try {
      const children = blocks.map((block) => {
        switch (block.type) {
          case 'heading1':
            return {
              block_type: 3,
              heading1: { elements: [{ text_run: { content: block.text } }] },
            };
          case 'heading2':
            return {
              block_type: 4,
              heading2: { elements: [{ text_run: { content: block.text } }] },
            };
          case 'paragraph':
            return { block_type: 2, text: { elements: [{ text_run: { content: block.text } }] } };
          case 'bullet':
            return {
              block_type: 12,
              bullet: { elements: [{ text_run: { content: block.text } }] },
            };
        }
      });

      const res = await (this.client.docx.v1.documentBlockChildren as any).create({
        path: {
          document_id: docToken,
          block_id: docToken,
        },
        data: { children },
      });

      if (res.code !== 0) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, `append blocks failed: ${res.msg}`));
      }

      return ok(undefined);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(makeError(ErrorCode.FEISHU_API_ERROR, `append blocks error: ${msg}`));
    }
  }

  async getShareLink(docToken: string): Promise<Result<string>> {
    try {
      const res = await (this.client.drive.v1.permissionPublic as any).patch({
        params: { type: 'docx' },
        path: { token: docToken },
        data: { link_share_entity: 'tenant_readable' },
      });

      if (res.code !== 0) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, `set share permission failed: ${res.msg}`));
      }

      return ok(`https://feishu.cn/docx/${docToken}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(makeError(ErrorCode.FEISHU_API_ERROR, `get share link error: ${msg}`));
    }
  }

  async createFromMarkdown(title: string, markdown: string): Promise<Result<DocRef>> {
    const lines = markdown.split('\n');
    const blocks: DocBlock[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('# ')) {
        blocks.push({ type: 'heading1', text: trimmed.substring(2) });
      } else if (trimmed.startsWith('## ')) {
        blocks.push({ type: 'heading2', text: trimmed.substring(3) });
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        blocks.push({ type: 'bullet', text: trimmed.substring(2) });
      } else {
        blocks.push({ type: 'paragraph', text: trimmed });
      }
    }

    const createRes = await this.create(title);
    if (!createRes.ok) {
      return createRes;
    }

    const docToken = createRes.value.docToken;
    const appendRes = await this.appendBlocks(docToken, blocks);

    if (!appendRes.ok) {
      return err(makeError(ErrorCode.FEISHU_API_ERROR, appendRes.error.message));
    }

    return ok(createRes.value);
  }
}

export function createDocxClient(): LarkDocxClient {
  const appId = process.env['LARK_APP_ID'];
  const appSecret = process.env['LARK_APP_SECRET'];
  if (!appId) throw new Error('Missing required env var: LARK_APP_ID');
  if (!appSecret) throw new Error('Missing required env var: LARK_APP_SECRET');

  const client = new lark.Client({ appId, appSecret });
  return new LarkDocxClient(client);
}
