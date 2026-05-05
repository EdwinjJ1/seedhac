/**
 * 一次性建表脚本：在指定的 Bitable 应用里建 4 张表（memory/decision/todo/knowledge）
 * 并把对应的 table_id 输出，方便 copy-paste 到 .env
 *
 * 前置：你需要先在飞书里**手动建一个空的 Bitable 应用**（10 秒）：
 *   工作台 → 多维表格 → 新建 → 命名「Lark Loom 测试记忆库」
 *   打开后浏览器 URL 里 feishu.cn/base/<APP_TOKEN>，复制 APP_TOKEN
 *   然后跑：
 *     BITABLE_APP_TOKEN=<上一步的 token> pnpm --filter @seedhac/bot dev:setup-bitable
 *
 * 为什么不连 app 一起建？飞书 OpenAPI 创建 base 应用需要更复杂的 user_access_token + 用户授权流程，
 * 而手动建 app 只需要 10 秒；建表 API 用 tenant_access_token 即可，自动化建表才是真正省时间的部分。
 *
 * 跑完后会把 4 行 BITABLE_TABLE_* 直接打印出来，复制粘到 .env。
 */

import * as lark from '@larksuiteoapi/node-sdk';

const APP_ID = process.env['LARK_APP_ID'];
const APP_SECRET = process.env['LARK_APP_SECRET'];
const APP_TOKEN = process.env['BITABLE_APP_TOKEN'];

if (!APP_ID || !APP_SECRET) {
  console.error('❌ LARK_APP_ID / LARK_APP_SECRET 缺失');
  process.exit(1);
}

if (!APP_TOKEN) {
  console.error('❌ 必须先 export BITABLE_APP_TOKEN=<手动建的 Bitable 的 app_token>');
  console.error('');
  console.error('  操作步骤：');
  console.error('    1. 浏览器打开 feishu.cn → 工作台 → 多维表格 → 新建');
  console.error('    2. 命名「Lark Loom 测试记忆库」');
  console.error('    3. 复制浏览器地址栏 feishu.cn/base/ 后面的那一段（这就是 app_token）');
  console.error('    4. 重跑：BITABLE_APP_TOKEN=<那一段> pnpm --filter @seedhac/bot dev:setup-bitable');
  process.exit(1);
}

const client = new lark.Client({ appId: APP_ID, appSecret: APP_SECRET });

// ─── 表结构定义（与 docs/bot-memory/MEMORY-SCHEMA.md 对齐）────────────────────

interface FieldSpec {
  field_name: string;
  type: number; // 1=文本 2=数字 3=单选 5=日期时间 17=附件 18=单向关联 21=双向关联
  property?: Record<string, unknown>;
  description?: { text: string };
}

interface TableSpec {
  table_name: string;
  envKey: string;
  fields: FieldSpec[];
}

const TABLES: readonly TableSpec[] = [
  {
    table_name: 'memory',
    envKey: 'BITABLE_TABLE_MEMORY',
    fields: [
      // 飞书的"主键字段"（第一个字段）必须是 文本/数字/公式 等少数类型；这里我们用 key 做主键最清晰
      { field_name: 'key', type: 1 },
      {
        field_name: 'kind',
        type: 3,
        property: {
          options: [
            { name: 'project', color: 0 },
            { name: 'chat', color: 1 },
            { name: 'user', color: 2 },
            { name: 'skill_log', color: 3 },
          ],
        },
      },
      { field_name: 'chat_id', type: 1 },
      { field_name: 'user_id', type: 1 },
      { field_name: 'content', type: 1 },
      { field_name: 'importance', type: 2, property: { formatter: '0' } },
      { field_name: 'last_access', type: 2, property: { formatter: '0' } },
      { field_name: 'created_at', type: 2, property: { formatter: '0' } },
      { field_name: 'source_skill', type: 1 },
    ],
  },
  {
    table_name: 'decision',
    envKey: 'BITABLE_TABLE_DECISION',
    fields: [
      { field_name: 'title', type: 1 },
      { field_name: 'chatId', type: 1 },
      { field_name: 'archivedAt', type: 5 },
      { field_name: 'content', type: 1 },
      { field_name: 'deciders', type: 1 },
      {
        field_name: 'status',
        type: 3,
        property: {
          options: [
            { name: 'open', color: 0 },
            { name: 'closed', color: 1 },
            { name: 'superseded', color: 2 },
          ],
        },
      },
    ],
  },
  {
    table_name: 'todo',
    envKey: 'BITABLE_TABLE_TODO',
    fields: [
      { field_name: 'title', type: 1 },
      { field_name: 'chatId', type: 1 },
      { field_name: 'archivedAt', type: 5 },
      { field_name: 'assignee', type: 1 },
      { field_name: 'due', type: 5 },
      {
        field_name: 'status',
        type: 3,
        property: {
          options: [
            { name: 'open', color: 0 },
            { name: 'done', color: 1 },
            { name: 'cancelled', color: 2 },
          ],
        },
      },
    ],
  },
  {
    table_name: 'knowledge',
    envKey: 'BITABLE_TABLE_KNOWLEDGE',
    fields: [
      { field_name: 'name', type: 1 },
      { field_name: 'chatId', type: 1 },
      {
        field_name: 'kind',
        type: 3,
        property: {
          options: [
            { name: 'project', color: 0 },
            { name: 'person', color: 1 },
            { name: 'metric', color: 2 },
            { name: 'concept', color: 3 },
            { name: 'event', color: 4 },
          ],
        },
      },
      { field_name: 'description', type: 1 },
    ],
  },
];

// ─── 主流程 ────────────────────────────────────────────────────────────────────

async function listExistingTables(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let pageToken: string | undefined = undefined;
  do {
    const resp = (await client.bitable.appTable.list({
      path: { app_token: APP_TOKEN! },
      params: { page_size: 100, ...(pageToken && { page_token: pageToken }) },
    })) as {
      code: number;
      msg: string;
      data?: {
        items?: { table_id?: string; name?: string }[];
        page_token?: string;
        has_more?: boolean;
      };
    };
    if (resp.code !== 0) {
      throw new Error(`list tables failed: ${resp.code} ${resp.msg}`);
    }
    for (const item of resp.data?.items ?? []) {
      if (item.name && item.table_id) map.set(item.name, item.table_id);
    }
    pageToken = resp.data?.has_more ? resp.data.page_token : undefined;
  } while (pageToken);
  return map;
}

async function createTable(spec: TableSpec): Promise<string> {
  const resp = (await client.bitable.appTable.create({
    path: { app_token: APP_TOKEN! },
    data: {
      table: {
        name: spec.table_name,
        default_view_name: 'Grid',
        // 飞书 create-table API 在创建时直接带字段
        fields: spec.fields as unknown as never[],
      },
    },
  })) as {
    code: number;
    msg: string;
    data?: { table_id?: string };
  };
  if (resp.code !== 0 || !resp.data?.table_id) {
    throw new Error(`create table ${spec.table_name} failed: ${resp.code} ${resp.msg}`);
  }
  return resp.data.table_id;
}

async function main(): Promise<void> {
  console.log('Lark Loom · 一键建 Bitable 4 张表\n');
  console.log(`目标 app_token: ${APP_TOKEN!.slice(0, 8)}...${APP_TOKEN!.slice(-4)}`);

  console.log('\n[1/2] 列出 Bitable 中已存在的表...');
  const existing = await listExistingTables();
  console.log(`     已存在 ${existing.size} 张表: ${[...existing.keys()].join(', ') || '(无)'}`);

  console.log('\n[2/2] 建表（已存在的跳过）...');
  const results: { table_name: string; table_id: string; status: 'created' | 'exists' }[] = [];

  for (const spec of TABLES) {
    if (existing.has(spec.table_name)) {
      const id = existing.get(spec.table_name)!;
      console.log(`     ⊘ ${spec.table_name}: 已存在，跳过 (${id})`);
      results.push({ table_name: spec.table_name, table_id: id, status: 'exists' });
      continue;
    }
    try {
      const id = await createTable(spec);
      console.log(`     ✅ ${spec.table_name}: 创建成功 (${id})`);
      results.push({ table_name: spec.table_name, table_id: id, status: 'created' });
    } catch (e) {
      console.error(`     ❌ ${spec.table_name}: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  完成！把下面 5 行追加/替换到 .env：');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`BITABLE_APP_TOKEN=${APP_TOKEN}`);
  for (const spec of TABLES) {
    const r = results.find((x) => x.table_name === spec.table_name)!;
    console.log(`${spec.envKey}=${r.table_id}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
