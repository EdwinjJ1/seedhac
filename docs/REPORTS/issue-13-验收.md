# Issue #13 · 测试机器人 + 测试群搭建 · 验收记录

**验收日期**：2026-05-01
**验收人**：Evan
**关闭 issue**：[#13](https://github.com/EdwinjJ1/seedhac/issues/13)

## 飞书侧

| 项 | 状态 | 备注 |
|---|---|---|
| 创建应用 | ✅ | 名字 `seedhac`（issue 里写的 `Sentinel-Dev` 是建议名，沿用现有应用） |
| App ID | ✅ | `cli_a965800ce139dcc7` |
| 权限申请 | ✅ | `im:message.*` / `im:chat.*` / `bitable:app` / `contact:user.base:readonly` 全部已开通 |
| 启用机器人能力 | ✅ | 应用能力 → 机器人 |
| 事件订阅推送方式 | ✅ | **长连接** |
| 订阅事件 | ✅ | `im.message.receive_v1`（含 5 个其他消息事件） |
| 版本发布 | ✅ | `0.0.1` 已发布生效 |
| 测试群 | ✅ | bot + Evan 已在群（其余成员后续邀请） |

## 仓库侧

| 文件 | 内容 |
|---|---|
| `.env.example` | 4 个凭证字段 + `LARK_LOG_LEVEL`，注释写了去哪儿找 |
| `packages/bot/src/index.ts` | 启动 `WSClient`，订阅 `im.message.receive_v1`，控制台打印 chat/sender/text |
| `packages/bot/package.json` | `dev` / `start` 加 `--env-file=../../.env`，`pnpm dev` 自动读 `.env` |
| `docs/dev-setup.md` | clone → install → 填 .env → 配权限 → 跑起来 → 验收，含常见报错排查 |

## 端到端验收日志

启动：

```
[seedhac/bot] booting v0.1 (WSClient scaffold)
[seedhac/bot] loaded 7 skill(s):
  - qa: @bot + 疑问句 → 检索群历史回答
  - recall: 群消息出现模糊表述 → 主动召回历史信息（事中介入）
  - summary: @bot 整理 → 拉群历史出 4 段纪要
  - slides: @bot 做 PPT → 群聊大纲转 SML XML → 飞书原生 PPT
  - archive: @bot 复盘 → 抽取决策/数据/待办 → 写 Bitable + 知识图谱
  - crossChat: @bot + 跨群引用 → 多 chatId 语义搜索
  - weekly: 周五 17:00 → 扫本周消息生成周报卡片
[info]: [ 'event-dispatch is ready' ]
[seedhac/bot] starting WSClient long connection...
[info]: [ '[ws]', 'ws client ready' ]
[seedhac/bot] WSClient ready — 在测试群发一句话试试
```

群里发 `hello`：

```
[seedhac/bot] 群消息 chat=oc_6991989f88e37b22ca0f44b4459356c8 sender=ou_8fb39320416f39c26a3ef9416d1e58eb type=text text=hello
```

✅ 长连接握手 → 事件路由 → SDK 反序列化 → 控制台打印，全链路通。

## 凭证安全提醒

- 第一版 App Secret 在沟通过程中暴露过，**已重置一次**
- 当前 Secret 只存在于 Evan 本地 `.env`，**未进 git**
- `.env.example` 用占位值，可安全提交
- 后续给队友拿凭证：1Password / 飞书私聊，**不在 issue / PR / 群里贴**
