/**
 * 一次性辅助脚本：拿 bot 自己的 open_id。
 * 跑：pnpm --filter @seedhac/bot dev:get-bot-open-id
 * 输出只打 open_id，不打 secret。
 */

const APP_ID = process.env['LARK_APP_ID'];
const APP_SECRET = process.env['LARK_APP_SECRET'];

if (!APP_ID || !APP_SECRET) {
  console.error('❌ LARK_APP_ID / LARK_APP_SECRET 未配置');
  process.exit(1);
}

async function main(): Promise<void> {
  // 1) 拿 tenant_access_token
  const tokenResp = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
    },
  );
  const tokenJson = (await tokenResp.json()) as {
    code: number;
    msg: string;
    tenant_access_token?: string;
  };
  if (tokenJson.code !== 0 || !tokenJson.tenant_access_token) {
    console.error(`❌ 拿 tenant_access_token 失败: code=${tokenJson.code} msg=${tokenJson.msg}`);
    process.exit(1);
  }
  console.log('✅ tenant_access_token 拿到');

  // 2) 拿 bot info
  const infoResp = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
    headers: { Authorization: `Bearer ${tokenJson.tenant_access_token}` },
  });
  const infoJson = (await infoResp.json()) as {
    code: number;
    msg: string;
    bot?: {
      activate_status: number;
      app_name: string;
      open_id: string;
    };
  };
  if (infoJson.code !== 0 || !infoJson.bot) {
    console.error(`❌ 拿 bot info 失败: code=${infoJson.code} msg=${infoJson.msg}`);
    process.exit(1);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Bot 名称       : ${infoJson.bot.app_name}`);
  console.log(`  激活状态       : ${infoJson.bot.activate_status === 1 ? '✅ 已激活' : '⚠️  未激活'}`);
  console.log(`  open_id        : ${infoJson.bot.open_id}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('把下面这一行追加到 .env 末尾（替换原有的 LARK_BOT_OPEN_ID 行）：');
  console.log('');
  console.log(`LARK_BOT_OPEN_ID=${infoJson.bot.open_id}`);
  console.log('');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
