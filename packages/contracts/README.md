# @seedhac/contracts

> Lark Loom **跨包接口契约**单一来源。所有 `interface` / `type` / `Schema` 都在这里。

> 注：包名仍为 `@seedhac/*` 以避免大规模 import 改动；产品名是 Lark Loom。

## 改这个包的规则

> **改 contracts 必须 PR + 三人 review**（CLAUDE.md 项目级硬约束）

- 改字段名、改方法签名 → 三人 review
- 加 optional 字段、加新类型 → 一人 review
- 修复 typo / 注释 → 直接合

约定：可能扩展的字段统一用 `meta?: Record<string, unknown>`。

## 模块速查

| 文件 | 导出 | 谁要 import |
|------|------|------------|
| `result.ts` | `Result<T,E>` / `ok` / `err` / `ErrorCode` / `AppError` / `makeError` | 所有 package |
| `message.ts` | `Message` / `BotEvent` / `CardAction` / `UserRef` / `Mention` / `ChatType` | bot, skills |
| `card.ts` | `Card` / `CardBuilder` / 7 种 `*CardInput` / `CardSource` / `CardButton` | bot, skills |
| `llm.ts` | `LLMClient` / `AskOptions` / `SchemaLike<T>` / `ChatMessage` / `LLMModel` | bot, skills |
| `bot-runtime.ts` | `BotRuntime` / `SendTextParams` / `SendCardParams` / `SentMessage` / `EventHandler` | bot, skills |
| `bitable.ts` | `BitableClient` / `BitableTableKind` / `RecordRef` / CRUD params | bot, skills |
| `retriever.ts` | `Retriever` / `RetrieverSource` / `RetrieveQuery` / `RetrieveHit` | bot, skills |
| `skill.ts` | `Skill` / `SkillContext` / `SkillResult` / `SkillName` / `TriggerSpec` / `SideEffect` / `Logger` | bot, skills |

## 设计要点

### Result<T, E> — 不要 throw

跨 package 调用都返回 `Result<T, E>`。业务 throw 只发生在 adapter 实现内部（接飞书 SDK / fetch 那一层），由 runtime 捕获后包成 `Result`。

```ts
import { ok, err, ErrorCode, makeError } from '@seedhac/contracts';

async function findUser(id: string) {
  if (!id) return err(makeError(ErrorCode.INVALID_INPUT, 'id required'));
  return ok({ id, name: 'Evan' });
}
```

### Skill 写法

每个 Skill 实现 `Skill` 接口，从 `SkillContext` 拿全部依赖（依赖注入便于 mock）。

```ts
import type { Skill } from '@seedhac/contracts';
import { ok } from '@seedhac/contracts';

export const qaSkill: Skill = {
  name: 'qa',
  trigger: {
    events: ['message'],
    requireMention: true,
    description: '@bot + 疑问句 → 检索群历史回答',
  },
  match: (ctx) => ctx.event.type === 'message' && ctx.event.payload.text.includes('?'),
  run: async (ctx) => {
    // ...
    return ok({ text: 'TODO' });
  },
};
```

### LLM SchemaLike<T> — contracts 层不绑定校验库

`SchemaLike<T>` 是极简描述，实现层（bot package）可以用 zod / valibot 适配进来。
这样 contracts 包保持零运行时依赖。

## 版本

初始冻结，覆盖 7 条业务主线最小集。

下一步可能扩展点（不算"改契约"）：
- Bitable 4 张表的 Row 类型从 `Record<string, unknown>` 收紧到具体接口
- 加 `ToolUse` / `Function calling` 相关类型（如果接 MCP）
