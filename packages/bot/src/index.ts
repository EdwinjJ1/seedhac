import * as lark from '@larksuiteoapi/node-sdk';
import type { Logger, SkillContext } from '@seedhac/contracts';
import { skillsByName } from '@seedhac/skills';
import { createBotRuntime } from './bot-runtime.js';
import { LarkBitableClient } from './bitable-client.js';
import { larkCardBuilder } from './card-builder.js';
import { createDocxClient } from './docx-client.js';
import { VolcanoLLMClient } from './llm-client.js';
import { SkillRouter } from './skill-router.js';
import { handleEvent } from './wiring.js';

const logger: Logger = {
  debug: (msg, meta) => console.debug(`[bot] ${msg}`, meta ?? ''),
  info: (msg, meta) => console.info(`[bot] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[bot] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[bot] ${msg}`, meta ?? ''),
};

function buildDeps() {
  const appId = process.env['LARK_APP_ID'];
  const appSecret = process.env['LARK_APP_SECRET'];
  if (!appId) throw new Error('Missing env var: LARK_APP_ID');
  if (!appSecret) throw new Error('Missing env var: LARK_APP_SECRET');

  const runtime = createBotRuntime();
  const router = new SkillRouter(process.env['LARK_BOT_OPEN_ID'] ?? '');

  const llm = new VolcanoLLMClient({
    apiKey: process.env['ARK_API_KEY'] ?? '',
    modelIds: {
      lite: process.env['ARK_MODEL_LITE'] ?? '',
      pro: process.env['ARK_MODEL_PRO'] ?? '',
    },
  });

  const bitable = new LarkBitableClient({
    appId,
    appSecret,
    appToken: process.env['BITABLE_APP_TOKEN'] ?? '',
    tableIds: {
      memory: process.env['BITABLE_TABLE_MEMORY'] ?? '',
      decision: process.env['BITABLE_TABLE_DECISION'] ?? '',
      todo: process.env['BITABLE_TABLE_TODO'] ?? '',
      knowledge: process.env['BITABLE_TABLE_KNOWLEDGE'] ?? '',
    },
  });

  const larkClient = new lark.Client({ appId, appSecret });
  const docx = new LarkDocxClient(larkClient);

  return { runtime, router, llm, bitable, docx };
}

async function main(): Promise<void> {
  logger.info('booting');

  const { runtime, router, llm, bitable, docx } = buildDeps();

  runtime.on(async (event) => {
    if (event.type === 'message') {
      const msg = event.payload;
      const intent = router.route(msg);
      logger.info(
        `message received: text="${msg.text}" mentions=${JSON.stringify(msg.mentions.map((m) => m.user.userId))} → intent=${intent}`,
      );
    }
    if (event.type === 'cardAction') {
      logger.info('card action received', {
        chatId: event.payload.chatId,
        messageId: event.payload.messageId,
        value: event.payload.value,
      });
    }

    const ctx: SkillContext = {
      event,
      runtime,
      llm,
      bitable,
      docx,
      retrievers: {},
      logger,
      docx: createDocxClient(),
      cardBuilder: larkCardBuilder,
    };
    await handleEvent(ctx, router, skillsByName);
  });

  const startResult = await runtime.start();
  if (!startResult.ok) {
    logger.error('runtime start failed', { message: startResult.error.message });
    process.exit(1);
  }

  logger.info('WSClient ready');

  const shutdown = (signal: string): void => {
    logger.info(`received ${signal}, shutting down`);
    void runtime.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[bot] fatal:', e);
  process.exit(1);
});
