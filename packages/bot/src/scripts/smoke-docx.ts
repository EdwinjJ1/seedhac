/**
 * smoke-docx.ts — DocxClient 真实调用验证脚本
 *
 * 运行：pnpm --filter @seedhac/bot dev:smoke-docx
 *
 * 前置条件：
 *   - .env 中填好 LARK_APP_ID / LARK_APP_SECRET
 *   - 飞书 App 已申请 docx:document 和 drive:drive 权限并发布
 *
 * 验证场景：
 *   1. create        — 创建空文档，拿到 docToken
 *   2. appendBlocks  — 写入 heading1 / heading2 / paragraph / bullet
 *   3. getShareLink  — 获取可分享链接
 *   4. createFromMarkdown — 一步完成解析 + 创建 + 写入
 */

import { createDocxClient } from '../docx-client.js';

const docx = createDocxClient();

function section(title: string): void {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`▶ ${title}`);
  console.log('─'.repeat(50));
}

// ---------- 场景 1：create ----------

section('场景 1 · create — 创建空文档');

const createResult = await docx.create('【smoke test】Lark Loom 验证文档');

if (!createResult.ok) {
  console.error('❌ 失败:', createResult.error);
  process.exit(1);
}

const { docToken, url } = createResult.value;
console.log('✅ 成功');
console.log('docToken:', docToken);
console.log('url:', url);

// ---------- 场景 2：appendBlocks ----------

section('场景 2 · appendBlocks — 写入各类 block');

const appendResult = await docx.appendBlocks(docToken, [
  { type: 'heading1', text: '一级标题（block_type 3）' },
  { type: 'heading2', text: '二级标题（block_type 4）' },
  { type: 'paragraph', text: '正文段落（block_type 2）' },
  { type: 'bullet', text: '无序列表项（block_type 12）' },
]);

if (!appendResult.ok) {
  console.error('❌ 失败:', appendResult.error);
  process.exit(1);
}

console.log('✅ 成功，请打开文档确认 4 个 block 内容和格式正确：');
console.log(url);

// ---------- 场景 3：getShareLink ----------

section('场景 3 · getShareLink — 获取分享链接');

const shareResult = await docx.getShareLink(docToken);

if (!shareResult.ok) {
  console.error('❌ 失败:', shareResult.error);
  process.exit(1);
}

console.log('✅ 成功');
console.log('分享链接:', shareResult.value);

// ---------- 场景 4：createFromMarkdown ----------

section('场景 4 · createFromMarkdown — markdown 一键建文档');

const md = `
# 需求背景

本文档由 smoke test 自动生成。

## 核心功能

- 用户研究转化率分析
- 多源数据聚合展示

产品目标：帮助 PM 在对话中自动发现信息缺口。
`.trim();

const mdResult = await docx.createFromMarkdown('【smoke test】markdown 文档', md);

if (!mdResult.ok) {
  console.error('❌ 失败:', mdResult.error);
  process.exit(1);
}

console.log('✅ 成功');
console.log('文档链接:', mdResult.value.url);
console.log('请打开确认：# → heading1，## → heading2，- → bullet，其余 → paragraph');

// ---------- 完成 ----------

console.log(`\n${'─'.repeat(50)}`);
console.log('🎉 全部场景通过，DocxClient 真实调用验证完成');
console.log('─'.repeat(50));
