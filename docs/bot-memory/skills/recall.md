# Skill: recall — 主动浮信息 🔥

## 触发条件

- **事件**：`message`
- **必须 @bot**：否（被动监听所有消息）
- **关键词**：`上次`、`之前`、`我记得`、`那个`、`上回`、`是多少来着`
- **描述**：群消息中出现模糊指代词，Bot 主动召回历史信息（**事中介入**）

## 数据流

```
群消息（无需 @bot）
  → match()：
      1. 关键词预筛（快速路径）
      2. GapDetector（豆包 Lite）检测信息缺口
         → 返回 { shouldRecall, reason, query }
      3. shouldRecall=false → 跳过，不打扰
  → run()（仅 shouldRecall=true）：
      1. 从 gapCache 取 match() 的检测结果（避免重复调 LLM）
      2. cache miss 时重新调 GapDetector
      3. 并行检索：Bitable memory + 向量检索
      4. 无结果 → 静默退出（不发卡片）
      5. 有结果 → CardBuilder 渲染 recall 卡片
      6. SideEffect：写 memory 表
```

## GapDetector 行为规范

- 使用豆包 Lite（低延迟小模型），单次调用 ≤ 2s
- 输入：最近 N 条消息批次
- 输出：`{ shouldRecall: boolean; reason: string; query: string }`
- 保守判断：宁可漏召回，不可误触发骚扰用户
- `messages.length === 0` 时直接返回 `shouldRecall=false`

## gapCache 规则

- 类型：`Map<messageId, GapDetection>`，最大 200 条
- 超出上限时 FIFO 淘汰最旧条目
- match() 写入，run() 读取；cache miss 时 run() 重新检测

## 卡片格式（CardBuilder template: `recall`）

对应合约类型 `RecallCardInput`（`packages/contracts/src/card.ts`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `trigger` | `string` | 触发召回的原始消息片段（GapDetector 提取） |
| `summary` | `string` | 召回结果摘要文字 |
| `sources` | `CardSource[]` | 召回来源列表（名称 + 跳转链接，≤3 条） |
| `buttons?` | `CardButton[]` | 可选操作按钮（如"展开详情"） |

## 红线

- **绝对不能骚扰**：shouldRecall=false 时必须静默，不发任何消息
- 召回结果为空时静默退出，不发"未找到"提示
- 不跨群读取历史记录
- match() 必须快（关键词预筛 → LLM 兜底），不阻塞消息处理

## Memory 写入

写入 `memory` 表，字段：
- `skillName = 'recall'`
- `query`：GapDetector 提取的检索意图
- `reasoning`：shouldRecall 的判断依据
- `resultSummary`：命中的前 N 条摘要
