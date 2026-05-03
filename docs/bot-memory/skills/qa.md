# Skill: qa — 被动问答

## 触发条件

- **事件**：`message`
- **必须 @bot**：是
- **关键词**：`?`、`？`、`吗`、`呢`（疑问句特征）
- **描述**：用户 @bot 并附带疑问句，Bot 检索相关内容后回答

## 数据流

```
@bot + 疑问句
  → match()：关键词命中疑问句尾
  → run()：
      1. 拉取群历史（最近 N 条）
      2. 并行检索：群聊 Bitable memory + 向量检索（Chroma）+ docx Wiki
      3. LLM 整合多路结果 → 生成回答
      4. CardBuilder 渲染 qa 卡片
      5. SideEffect：写 memory 表（reasoning + resultSummary）
```

## 卡片格式（CardBuilder template: `qa`）

| 字段 | 说明 |
|------|------|
| `question` | 用户原始问题（脱敏后） |
| `answer` | LLM 生成的回答正文 |
| `sources` | 引用来源列表（文档名 + 跳转链接，≤5 条） |
| `confidence` | 高 / 中 / 低（LLM 自评） |

## 红线

- 检索无结果时不捏造答案，必须明确回复"未找到相关记录"
- 不跨群读取历史记录
- confidence=低 时需在卡片上标注"仅供参考"

## Memory 写入

写入 `memory` 表，字段：
- `skillName = 'qa'`
- `query`：用户问题
- `reasoning`：选择哪些来源、为何排除其他
- `resultSummary`：回答前 200 字
