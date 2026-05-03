# Bitable Memory Schema

四张核心表的字段定义。代码层面对应 `BitableTableKind`（`packages/contracts/src/bitable.ts`）。

---

## memory 表

每次 Skill 成功执行后写入一条记录，供后续 `memory.read` 检索。

| 字段 | 类型 | 说明 |
|------|------|------|
| `chatId` | 文本 | 飞书群 chat_id |
| `skillName` | 单选 | qa / recall / summary / slides / archive / weekly |
| `triggeredAt` | 日期时间 | 触发时间（ISO 8601） |
| `messageId` | 文本 | 触发消息的 message_id |
| `query` | 文本 | 用户原始意图（GapDetector 提取或原文） |
| `reasoning` | 长文本 | Skill 决策原因（SkillResult.reasoning） |
| `resultSummary` | 长文本 | 输出卡片的摘要文字（≤200 字） |
| `relatedDecisions` | 关联字段 | → decision 表（知识图谱边） |
| `relatedTodos` | 关联字段 | → todo 表（知识图谱边） |

---

## decision 表

由 archive Skill 从群历史中抽取的决策条目。

| 字段 | 类型 | 说明 |
|------|------|------|
| `chatId` | 文本 | 所在群 |
| `archivedAt` | 日期时间 | 归档时间 |
| `title` | 文本 | 决策标题（≤50 字） |
| `content` | 长文本 | 决策详情 |
| `deciders` | 文本 | 决策人（open_id 逗号分隔） |
| `status` | 单选 | open / closed / superseded |
| `relatedMemory` | 关联字段 | → memory 表（归档记录） |
| `relatedKnowledge` | 关联字段 | → knowledge 表（1-2 跳图谱） |

---

## todo 表

由 archive Skill 从群历史中抽取的待办条目。

| 字段 | 类型 | 说明 |
|------|------|------|
| `chatId` | 文本 | 所在群 |
| `archivedAt` | 日期时间 | 归档时间 |
| `title` | 文本 | 待办标题 |
| `assignee` | 文本 | 负责人 open_id |
| `due` | 日期 | 截止日期（可选） |
| `status` | 单选 | open / done / cancelled |
| `relatedMemory` | 关联字段 | → memory 表 |

---

## knowledge 表

双向关联节点，作为知识图谱的顶点，支持 1-2 跳关系查询。

| 字段 | 类型 | 说明 |
|------|------|------|
| `chatId` | 文本 | 所在群 |
| `kind` | 单选 | project / person / metric / concept / event |
| `name` | 文本 | 节点名称（实体名） |
| `description` | 长文本 | 节点描述 |
| `relatedDecisions` | 关联字段 | → decision 表 |
| `relatedMemory` | 关联字段 | → memory 表 |

---

## 写入规则

- `batchInsert` 须满足原子性：全部成功或全部回滚（对应红线 R4）
- 单批上限 500 条（飞书硬上限）
- 所有写操作通过 `BitableClient` 接口，禁止直接调飞书 REST API
- `chatId` 作为行级数据隔离边界，不允许跨群查询
