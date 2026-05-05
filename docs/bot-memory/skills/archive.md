# Skill: archive — 复盘归档

## 触发条件

- **事件**：`message`
- **必须 @bot**：是
- **关键词**：`复盘`、`归档`
- **描述**：Bot 拉取群历史，抽取决策/数据/待办并写入 Bitable，形成知识图谱节点

## 数据流

```
@bot 复盘 / 归档
  → match()：关键词命中
  → run()：
      1. 拉取群历史（默认全部或时间窗）
      2. LLM 抽取三类条目：
         - decisions：决策列表
         - todos：待办列表
         - summary：本次讨论摘要
      3. 批量写入 Bitable：
         - decision 表（每条决策一行）
         - todo 表（每条待办一行）
         - memory 表（本次归档记录）
      4. link()：建立 memory ↔ decision / todo 双向关联
      5. CardBuilder 渲染 archive 卡片（含 Bitable 跳转链接）
```

## 卡片格式（CardBuilder template: `archive`）

| 字段 | 说明 |
|------|------|
| `recordId` | memory 表记录 ID（内部用，不暴露给用户） |
| `title` | 归档标题（LLM 生成） |
| `bitableUrl` | Bitable 多维表格跳转链接 |
| `tags` | 标签列表（LLM 提取的主题标签） |
| `summary` | 本次讨论摘要（≤200 字） |

## Bitable 写入规则

- `batchInsert` 须原子性（decision + todo 全成功或全失败，对应红线 R4）
- `link()` 在 insert 成功后才调用
- `chatId` 必须写入每条记录（隔离边界）
- `status` 默认为 `open`

## 知识图谱

archive 是知识图谱的**主要入口**：
- decision 节点 → 关联 knowledge 节点（人物/项目/指标）
- 后续 recall 可沿图谱 1-2 跳检索相关决策

## 红线

- 不修改历史归档记录（只追加，不删改）
- `recordId` 不出现在卡片正文中（仅作内部标识）
- 群历史为空时拒绝归档，返回"无可归档的消息"
- batchInsert 失败须回滚并告知用户，不写半截数据

## Memory 写入

写入 `memory` 表，字段：
- `skillName = 'archive'`
- `query`：用户指令（"复盘"/"归档"）
- `reasoning`：共抽出多少条决策/待办，使用了多少条历史消息
- `resultSummary`：归档标题 + 决策数 + 待办数
- `relatedDecisions`：本次写入的 decision 记录 ID 列表
- `relatedTodos`：本次写入的 todo 记录 ID 列表
