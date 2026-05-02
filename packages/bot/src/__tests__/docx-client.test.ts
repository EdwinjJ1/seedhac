/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type * as lark from '@larksuiteoapi/node-sdk';
import { LarkDocxClient } from '../docx-client.js';

describe('LarkDocxClient', () => {
  let client: Mocked<lark.Client>;
  let docxClient: LarkDocxClient;

  beforeEach(() => {
    client = {
      docx: {
        v1: {
          document: {
            create: vi.fn(),
          },
          documentBlock: {
            batchUpdate: vi.fn(),
          },
        },
      },
      drive: {
        v1: {
          file: {
            createShareLink: vi.fn(),
          },
        },
      },
    } as any;
    docxClient = new LarkDocxClient(client);
  });

  describe('create()', () => {
    it('should return DocRef when create is successful', async () => {
      (client.docx.v1.document.create as any).mockResolvedValueOnce({
        code: 0,
        msg: 'success',
        data: {
          document: {
            document_id: 'doc-token-123',
          },
        },
      });

      const result = await docxClient.create('Test Title');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.docToken).toBe('doc-token-123');
      }
      expect(client.docx.v1.document.create).toHaveBeenCalledTimes(1);
    });

    it('should return err when SDK create fails', async () => {
      (client.docx.v1.document.create as any).mockResolvedValueOnce({
        code: 1001,
        msg: 'error from feishu',
      });

      const result = await docxClient.create('Test Title');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('error from feishu');
      }
    });
  });

  describe('appendBlocks()', () => {
    it('should correctly transform and pass block JSON', async () => {
      (client.docx.v1.documentBlock as any).batchUpdate.mockResolvedValueOnce({
        code: 0,
        msg: 'success',
      });

      const result = await docxClient.appendBlocks('doc-token-123', [
        { type: 'heading1', text: 'H1' },
        { type: 'heading2', text: 'H2' },
        { type: 'paragraph', text: 'Para' },
        { type: 'bullet', text: 'Bul' },
      ]);

      expect(result.ok).toBe(true);
      expect((client.docx.v1.documentBlock as any).batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { document_id: 'doc-token-123', block_id: 'doc-token-123' },
          data: {
            requests: [
              {
                insert_blocks_request: {
                  payload: `[{"block_type":2,"heading1":{"elements":[{"text_run":{"content":"H1"}}]}},{"block_type":3,"heading2":{"elements":[{"text_run":{"content":"H2"}}]}},{"block_type":1,"text":{"elements":[{"text_run":{"content":"Para"}}]}},{"block_type":12,"bullet":{"elements":[{"text_run":{"content":"Bul"}}]}}]`,
                  payload_document_revision_id: -1,
                },
              },
            ],
          },
        }),
      );
    });
  });

  describe('getShareLink()', () => {
    it('should return URL string when successful', async () => {
      (client.drive.v1.file as any).createShareLink.mockResolvedValueOnce({
        code: 0,
        msg: 'success',
        data: {
          share_link: { share_url: 'https://feishu.cn/docx/link' },
        },
      });

      const result = await docxClient.getShareLink('doc-token-123');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('https://feishu.cn/docx/link');
      }
    });
  });

  describe('createFromMarkdown()', () => {
    it('should correctly parse markdown and call create then appendBlocks', async () => {
      (client.docx.v1.document.create as any).mockResolvedValueOnce({
        code: 0,
        msg: 'success',
        data: { document: { document_id: 'doc-token-123' } },
      });
      (client.docx.v1.documentBlock as any).batchUpdate.mockResolvedValueOnce({
        code: 0,
        msg: 'success',
      });

      const markdown = `
# H1 Title
## H2 Subtitle
- Bullet 1
* Bullet 2
A normal paragraph.
      `;

      const result = await docxClient.createFromMarkdown('MD Title', markdown);
      expect(result.ok).toBe(true);

      // Verify appendBlocks transformation
      const batchUpdateCall = (client.docx.v1.documentBlock as any).batchUpdate.mock.calls[0][0];
      const payloadString = batchUpdateCall.data.requests[0].insert_blocks_request.payload;
      const payload = JSON.parse(payloadString);

      expect(payload).toEqual([
        { block_type: 2, heading1: { elements: [{ text_run: { content: 'H1 Title' } }] } },
        { block_type: 3, heading2: { elements: [{ text_run: { content: 'H2 Subtitle' } }] } },
        { block_type: 12, bullet: { elements: [{ text_run: { content: 'Bullet 1' } }] } },
        { block_type: 12, bullet: { elements: [{ text_run: { content: 'Bullet 2' } }] } },
        { block_type: 1, text: { elements: [{ text_run: { content: 'A normal paragraph.' } }] } },
      ]);
    });

    it('should return err if create fails and not call appendBlocks', async () => {
      (client.docx.v1.document.create as any).mockResolvedValueOnce({
        code: 2002,
        msg: 'create error',
      });

      const result = await docxClient.createFromMarkdown('MD Title', '# H1');
      expect(result.ok).toBe(false);
      expect((client.docx.v1.documentBlock as any).batchUpdate).not.toHaveBeenCalled();
    });
  });
});
