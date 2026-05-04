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
        return err(
          makeError(ErrorCode.FEISHU_API_ERROR, `set share permission failed: ${res.msg}`),
        );
      }

      return ok(`https://feishu.cn/docx/${docToken}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(makeError(ErrorCode.FEISHU_API_ERROR, `get share link error: ${msg}`));
    }
  }

  private async readDocxRawContent(token: string): Promise<Result<string>> {
    try {
      const res = await (
        this.client.docx.v1.document as unknown as {
          rawContent: (
            p: unknown,
          ) => Promise<{ code?: number; msg?: string; data?: { content?: string } }>;
        }
      ).rawContent({
        path: { document_id: token },
        params: { lang: 0 },
      });
      if (res.code !== 0) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, `readContent failed: ${res.msg}`));
      }
      return ok(res.data?.content ?? '');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(makeError(ErrorCode.FEISHU_API_ERROR, `readContent error: ${msg}`, e));
    }
  }

  private async resolveWikiNode(token: string): Promise<
    Result<{
      objToken: string;
      objType: 'doc' | 'docx' | 'sheet' | 'mindnote' | 'bitable' | 'file' | 'slides';
      title?: string;
    }>
  > {
    try {
      const res = await this.client.wiki.v2.space.getNode({
        params: { token, obj_type: 'wiki' },
      });
      if (res.code !== 0) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, `resolve wiki failed: ${res.msg}`));
      }
      const node = res.data?.node;
      if (!node?.obj_token || !node.obj_type) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, 'resolve wiki failed: empty node'));
      }
      return ok({
        objToken: node.obj_token,
        objType: node.obj_type,
        ...(node.title ? { title: node.title } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(makeError(ErrorCode.FEISHU_API_ERROR, `resolve wiki error: ${msg}`, e));
    }
  }

  private async readDriveTitle(
    token: string,
    kind: 'doc' | 'docx' | 'wiki' | 'slides',
  ): Promise<Result<string>> {
    try {
      const res = await this.client.drive.v1.meta.batchQuery({
        data: {
          request_docs: [{ doc_token: token, doc_type: kind }],
          with_url: true,
        },
      });
      if (res.code !== 0) {
        return err(makeError(ErrorCode.FEISHU_API_ERROR, `read meta failed: ${res.msg}`));
      }
      const title = res.data?.metas?.[0]?.title;
      return ok(title ? `标题：${title}` : '');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(makeError(ErrorCode.FEISHU_API_ERROR, `read meta error: ${msg}`, e));
    }
  }

  async readContent(
    token: string,
    kind: 'doc' | 'wiki' | 'slides' = 'doc',
  ): Promise<Result<string>> {
    if (kind === 'wiki') {
      const node = await this.resolveWikiNode(token);
      if (!node.ok) return node;
      if (node.value.objType === 'doc' || node.value.objType === 'docx') {
        const raw = await this.readDocxRawContent(node.value.objToken);
        if (!raw.ok) return raw;
        const title = node.value.title ? `标题：${node.value.title}\n` : '';
        return ok(`${title}${raw.value}`);
      }
      if (node.value.objType === 'slides') {
        const title = node.value.title ? `标题：${node.value.title}` : '';
        if (title) return ok(title);
        return this.readDriveTitle(node.value.objToken, 'slides');
      }
      return ok(node.value.title ? `标题：${node.value.title}` : '');
    }

    if (kind === 'slides') {
      const title = await this.readDriveTitle(token, 'slides');
      if (title.ok && title.value.trim()) return title;
      return this.readDocxRawContent(token);
    }

    return this.readDocxRawContent(token);
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
