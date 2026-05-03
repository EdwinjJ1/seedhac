# Skill: summary — 会议纪要

## 触发条件

- **事件**：`message`
- **必须 @bot**：是
- **关键词**：`整理`、`纪要`、`总结`
- **描述**：用户 @bot 要求整理，Bot 拉取群历史生成 4 段式纪要

## 数据流

```
@bot 整理 / 纪要 / 总结
  → match()：关键词命中
  → run()：
      1. 解析时间窗（消息中提取"今天"/"最近 2 小时"等，默认最近 100 条）
      2. 拉取群历史（runtime.getHistory）
      3. LLM 抽取 4 段：议题 / 决议 / 待办 / 待跟进
      4. CardBuilder 渲染 summary 卡片
      5. SideEffect：写 memory 表
```

## 卡片格式（CardBuilder template: `summary`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 纪要标题（LLM 生成，≤30 字） |
| `topics` | string[] | 议题列表 |
| `decisions` | string[] | 决议列表 |
| `todos` | `{ text: string; assignee?: string; due?: string }[]` | 待办列表 |
| `followUps` | string[] | 待跟进事项 |

## 时间窗解析规则

| 用户说 | 拉取范围 |
|--------|---------|
| 无特别说明 | 最近 100 条消息 |
| "今天" | 当日 00:00 至今 |
| "最近 2 小时" | 当前时间 -2h 至今 |
| 显式时间段 | 按指定范围 |

## 红线

- 不捏造参与人——只提 LLM 在历史消息中明确看到的人名
- `todos[].due` 为 `string | undefined`，TypeScript 禁止传 `undefined` 给 CardBuilder（用条件展开）
- 群历史为空时回复"暂无可整理的消息"，不生成空卡片

## Memory 写入

写入 `memory` 表，字段：
- `skillName = 'summary'`
- `query`：用户原始指令
- `reasoning`：时间窗如何确定、共处理多少条消息
- `resultSummary`：决议 + 待办数量摘要
