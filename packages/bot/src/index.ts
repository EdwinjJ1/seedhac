/**
 * Lark Loom bot 入口（联调脚手架）。
 *
 * 当前职责：
 *   - 读 .env 里的 4 个凭证
 *   - 启 WSClient 长连接
 *   - 收到群消息时把发送人 / 群 ID / 文本打到控制台
 *
 * BotRuntime / SkillRouter / 限流等真实运行时在 issue #22 wiring 完成后接入。
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { skills } from '@seedhac/skills';

// ─── 硬编码回复（临时好玩用，Skill Router 上线后删） ──────────────────────────

const BARE_MENTION_REPLIES = [
  '傻逼吧，@你爹我不说话',
];

const KEYWORD_REPLIES: Array<{ test: RegExp; replies: string[] }> = [
  {
    test: /你好|hi|hello|嗨/i,
    replies: ['你好你好，有事吗', '哦', '嗯', "来了老6"],
  },
  {
    test: /谢谢|感谢|thx|thanks/i,
    replies: ['不客气，但你下次能不能别那么晚才谢', '嗯', '应该的，毕竟我是爸爸'],
  },
  {
    test: /废物|没用|垃圾/i,
    replies: ['你行你来', '…我记仇', '好的，已记录，复盘时翻出来', '好啊，等你来打我啊', '滚吧，傻逼'],
  },
  {
    test: /nb|牛|厉害|强/i,
    replies: ['那是', '我知道', '当然，废话'],
  },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * 根据消息文本决定回复内容。
 * 返回 null 表示不回复（正常业务消息交给 Skill Router 处理）。
 */
function hardcodedReply(text: string, isMentioned: boolean): string | null {
  const cleaned = text.replace(/@\S+/g, '').trim();

  // 光 @ 不说话
  if (isMentioned && cleaned.length === 0) return pick(BARE_MENTION_REPLIES);

  // 关键词命中
  for (const { test, replies } of KEYWORD_REPLIES) {
    if (test.test(cleaned)) return pick(replies);
  }

  return null;
}

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
  console.info('[seedhac/bot] booting (WSClient scaffold)');
  printSkillRoster();

  const env = readEnv();

  const wsClient = new lark.WSClient({
    appId: env.appId,
    appSecret: env.appSecret,
    loggerLevel: env.logLevel,
  });

  const imClient = new lark.Client({ appId: env.appId, appSecret: env.appSecret });

  const dispatcher = new lark.EventDispatcher({
    verificationToken: env.verificationToken,
    encryptKey: env.encryptKey,
    loggerLevel: env.logLevel,
  }).register({
    'im.message.receive_v1': async (data) => {
      const sender = data.sender?.sender_id?.open_id ?? '<unknown>';
      const chatId = data.message?.chat_id ?? '<unknown>';
      const msgId = data.message?.message_id ?? '';
      const msgType = data.message?.message_type ?? '<unknown>';
      const rawContent = data.message?.content ?? '';

      let text = '';
      if (msgType === 'text') {
        try {
          const parsed = JSON.parse(rawContent) as { text?: string };
          text = parsed.text ?? rawContent;
        } catch {
          text = rawContent;
        }
      }

      const mentions = data.message?.mentions ?? [];
      const isMentioned = mentions.length > 0;

      console.info(`[seedhac/bot] 群消息 chat=${chatId} sender=${sender} mentioned=${isMentioned} text=${text}`);

      // 硬编码回复（临时）
      const reply = hardcodedReply(text, isMentioned);
      if (reply) {
        await imClient.im.message.reply({
          path: { message_id: msgId },
          data: {
            msg_type: 'text',
            content: JSON.stringify({ text: reply }),
          },
        });
        console.info(`[seedhac/bot] 回复: ${reply}`);
      }

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
