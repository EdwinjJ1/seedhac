# Skill: slides — 幻灯片生成

## 触发条件

- **事件**：`message`
- **必须 @bot**：是
- **关键词**：`做 PPT`、`生成幻灯片`、`slides`
- **描述**：Bot 根据群聊上下文生成 PPT 大纲，创建飞书文档，用户一键转 PPT

## 数据流

```
@bot 做 PPT / 幻灯片
  → match()：关键词命中
  → run()：
      1. 拉取群历史（默认最近 100 条）
      2. LLM 生成 PPT 大纲（Markdown 格式，H1=封面/H2=章节/H3=要点）
      3. 调 docx.create（飞书 docx-v1 API）创建 Markdown 云文档
      4. CardBuilder 渲染 slides 卡片（含文档跳转链接）
      5. SideEffect：写 memory 表
```

## 飞书 Docx API 说明

- 通过 `@larksuiteoapi/node-sdk` 调用，使用 bot tenant token
- 创建文档后返回 `docUrl`（飞书文档跳转链接）
- 用户在飞书文档内点击"转为 PPT"即可一键生成幻灯片（飞书原生功能）

## 卡片格式（CardBuilder template: `slides`）

对应合约类型 `SlidesCardInput`（`packages/contracts/src/card.ts`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | `string` | PPT 标题（LLM 从大纲提取） |
| `presentationUrl` | `string` | 飞书演示文稿跳转链接 |
| `pageCount` | `number` | 幻灯片页数 |
| `preview?` | `{ title: string; bullets: string[] }[]` | 章节预览（可选，≤8 章） |

## 大纲格式规范

LLM 生成的 Markdown 须符合以下结构，飞书 docx API 能正确解析：

```markdown
# 封面标题

## 第一章

### 要点 1
### 要点 2

## 第二章
...
```

## 红线

- docx 创建失败时返回错误卡片，不静默失败
- 不直接生成 PPT 文件（二进制），只生成飞书 Markdown 文档
- 大纲章节数 ≤ 8，每章要点 ≤ 5（防止内容过长）

## Memory 写入

写入 `memory` 表，字段：
- `skillName = 'slides'`
- `query`：用户原始指令
- `reasoning`：大纲章节逻辑说明
- `resultSummary`：生成的 PPT 标题 + 章节数
