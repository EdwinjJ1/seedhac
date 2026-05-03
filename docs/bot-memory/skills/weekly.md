# Skill: weekly — 定时周报

## 触发条件

- **事件**：无（不监听 `message` 事件）
- **触发源**：runtime scheduler 按 cron 表达式推 `BotEvent`
- **Cron**：`0 17 * * 5`（每周五 17:00 北京时间）
- **必须 @bot**：否
- **描述**：每周五自动扫描本周群消息，生成 highlights / 决策 / 待办周报卡片

## 数据流

```
cron 触发（周五 17:00）
  → runtime scheduler 推 BotEvent（type: 'schedule'）
  → match()：type === 'schedule' && skillName === 'weekly' → true
  → run()：
      1. 拉取本周消息（周一 00:00 至周五 17:00）
      2. LLM 抽取：highlights / 决策 / 待办 / 下周预告
      3. CardBuilder 渲染 weekly 卡片
      4. runtime 推送到各目标群（可配置群列表）
      5. SideEffect：写 memory 表
```

## 卡片格式（CardBuilder template: `weekly`）

| 字段 | 说明 |
|------|------|
| `weekRange` | 周期（如 "2026-04-27 ~ 2026-05-01"） |
| `highlights` | 本周亮点（≤5 条） |
| `decisions` | 本周重要决策（≤5 条） |
| `todos` | 未完成待办（从 Bitable todo 表拉取 status=open） |
| `nextWeek` | 下周预告（LLM 从讨论中提取，可选） |

## 定时配置

- cron 表达式：`0 17 * * 5`（UTC+8，对应 UTC `0 9 * * 5`，需注意时区）
- 目标群列表由环境变量 `WEEKLY_CHAT_IDS` 配置（逗号分隔的 chat_id）
- 单次运行超时：60s

## 未完成待办来源

weekly 主动查询 Bitable `todo` 表：
```
where: { chatId: <当前群>, status: 'open' }
```
查询结果合并进卡片，让成员在周报中看到积压待办。

## 红线

- 仅在目标群推送，不广播到所有群
- 群消息为空时跳过，不发空周报
- todos 为空时卡片中不显示该模块（不要显示"无待办"占位）
- 推送失败须记录日志，不重试（下周自动再触发）

## Memory 写入

写入 `memory` 表，字段：
- `skillName = 'weekly'`
- `query`：`'weekly-cron'`（标识为定时触发）
- `reasoning`：共处理多少条消息、抽出多少条 highlights/决策
- `resultSummary`：highlights 前 3 条标题
