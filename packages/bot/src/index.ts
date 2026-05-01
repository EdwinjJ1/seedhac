/**
 * SeedHAC bot 入口（v0.1 联调脚手架）。
 *
 * 这一版只做 issue #13 的最后一步验收：
 *   - 读 .env 里的 4 个凭证
 *   - 启 WSClient 长连接
 *   - 收到群消息时把发送人 / 群 ID / 文本打到控制台
 *
 * BotRuntime / SkillRouter / 限流等真实运行时在后续 issue 实现。
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { skills } from '@seedhac/skills';

interface LarkEnv {
  readonly appId: string;
  readonly appSecret: string;
  readonly verificationToken: string;
  readonly encryptKey: string;
  readonly logLevel: lark.LoggerLevel;
}

const LOG_LEVELS: Record<string, lark.LoggerLevel> = {
  debug: lark.LoggerLevel.debug,
  info: lark.LoggerLevel.info,
  warn: lark.LoggerLevel.warn,
  error: lark.LoggerLevel.error,
};

function readEnv(): LarkEnv {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  const verificationToken = process.env.LARK_VERIFICATION_TOKEN ?? '';
  const encryptKey = process.env.LARK_ENCRYPT_KEY ?? '';
  const logLevelRaw = (process.env.LARK_LOG_LEVEL ?? 'info').toLowerCase();

  const missing: string[] = [];
  if (!appId) missing.push('LARK_APP_ID');
  if (!appSecret) missing.push('LARK_APP_SECRET');
  if (missing.length > 0) {
    throw new Error(
      `缺少环境变量：${missing.join(', ')}。复制 .env.example 为 .env 并填值。`,
    );
  }

  return {
    appId: appId as string,
    appSecret: appSecret as string,
    verificationToken,
    encryptKey,
    logLevel: LOG_LEVELS[logLevelRaw] ?? lark.LoggerLevel.info,
  };
}

function printSkillRoster(): void {
  console.info(`[seedhac/bot] loaded ${skills.length} skill(s):`);
  for (const skill of skills) {
    console.info(`  - ${skill.name}: ${skill.trigger.description}`);
  }
}

async function main(): Promise<void> {
  console.info('[seedhac/bot] booting v0.1 (WSClient scaffold)');
  printSkillRoster();

  const env = readEnv();

  const wsClient = new lark.WSClient({
    appId: env.appId,
    appSecret: env.appSecret,
    loggerLevel: env.logLevel,
  });

  const dispatcher = new lark.EventDispatcher({
    verificationToken: env.verificationToken,
    encryptKey: env.encryptKey,
    loggerLevel: env.logLevel,
  }).register({
    'im.message.receive_v1': async (data) => {
      const sender = data.sender?.sender_id?.open_id ?? '<unknown>';
      const chatId = data.message?.chat_id ?? '<unknown>';
      const msgType = data.message?.message_type ?? '<unknown>';
      const rawContent = data.message?.content ?? '';

      let preview = rawContent;
      if (msgType === 'text') {
        try {
          const parsed = JSON.parse(rawContent) as { text?: string };
          preview = parsed.text ?? rawContent;
        } catch {
          // SDK 偶尔会给已经反序列化的字符串，直接用
        }
      }

      console.info(
        `[seedhac/bot] 群消息 chat=${chatId} sender=${sender} type=${msgType} text=${preview}`,
      );
      return { code: 0 };
    },
  });

  console.info('[seedhac/bot] starting WSClient long connection...');
  await wsClient.start({ eventDispatcher: dispatcher });
  console.info('[seedhac/bot] WSClient ready — 在测试群发一句话试试');

  const shutdown = (signal: string): void => {
    console.info(`[seedhac/bot] received ${signal}, closing WSClient...`);
    wsClient.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[seedhac/bot] fatal:', error);
  process.exit(1);
});
