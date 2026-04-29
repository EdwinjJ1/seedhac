# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目背景

**SeedHAC / Sentinel** — 飞书 AI 校园挑战赛参赛项目。"住在飞书群里的隐形同事"：监听群聊 → 检测信息缺口 → 主动召回历史 / 生成纪要 / 出 PPT。

定位关键：**事中介入**（区别于妙记的事后总结），主动浮信息能力是核心差异化。

代码尚未开始。当前阶段以文档调研 + GitHub Issue 拆解为主，所有产物先放在 `docs/`。

## 文档地图

读懂这个项目从这四份开始（按顺序）：
- `README.md` — 赛道、时间节点、资源
- `docs/Q&A-产品方向.md` — 产品定位 / 红线（不能监听员工 1v1 私聊）
- `docs/飞书权限与能力边界.md` — **5 个 UI 入口对比、API 频控、合规边界**，决定能做什么
- `docs/技术栈与可复用能力.md` — 技术选型 + 架构图 + Skill Router 设计

`docs/MEETING-NOTES.md` 是会议纪要累积；`docs/REPORTS/` 是每 3 天一份的个人阶段成果小结（参赛硬性产出）。

## 技术栈（已定型）

| 层 | 选型 | 备注 |
|----|------|------|
| 语言 | TypeScript + Node 20 | strict mode |
| 包管理 | pnpm（monorepo workspace） | `packages/contracts` / `packages/bot` / `packages/skills` |
| 飞书 SDK | `@larksuiteoapi/node-sdk` | WSClient 长连接，免公网部署 |
| 调试 CLI | **`lark-cli`**（详见下节） | 看 schema、dry-run、JQ 过滤响应 |
| LLM | 豆包 Lite（缺口检测） + 豆包 Pro（路由 + 卡片） | 通过 `LLMClient` 统一调用 |
| 结构化存储 | 飞书多维表格 (Bitable) | Memory / 决策 / 待办 / 知识图谱（双向关联字段） |
| 向量存储 | Chroma（Docker 起容器） | 只存向量 + id，原文留 Bitable |
| 卡片 | 飞书 CardKit | 7 种卡片模板（qa/recall/summary/slides/archive/crossChat/weekly） |

不做：自建后端框架、SQLite、Redis、k8s。**单进程裸 Node + 本地 demo**。

## 飞书 lark-cli（团队主力调试工具）

`lark-cli` 已全局安装（`/Users/edwinj/.npm-global/bin/lark-cli`）。**写飞书 API 调用前先用它跑一遍 schema 和 dry-run，比看 apifox 快**。

### 高频命令

```bash
# 主帮助：查所有子命令（im / docs / sheets / slides / minutes / bitable / wiki / vc / approval ...）
lark-cli --help

# 查某个 API 的参数 / scope / 返回字段（不需登录）
lark-cli schema im.message.create
lark-cli schema slides.xml_presentation.slide.create

# 通用 API 调用
lark-cli api GET /open-apis/calendar/v4/calendars
lark-cli api POST /open-apis/im/v1/messages --params '{"receive_id_type":"chat_id"}' --data '...'

# 带过滤 / 分页 / dry-run
lark-cli <cmd> --dry-run                  # 打印请求不执行
lark-cli <cmd> --jq '.data.items[].name'  # JQ 过滤响应
lark-cli <cmd> --page-all --page-limit 5  # 自动翻页
lark-cli <cmd> --as bot                   # 强制以 bot 身份（默认 auto）
```

### Slides（PPT）—— 🅳 主线直接用这个

飞书云文档"演示文稿"有完整开放 API，**bot tenant token 即可调用**，不需要用户授权：

```bash
lark-cli slides +create --title "..." --slides '["<slide>...</slide>"]'   # 创建（含最多 10 页）
lark-cli slides xml_presentation.slide create   # 已有 PPT 追加页面
lark-cli slides xml_presentation.slide delete   # 删除页面
lark-cli slides xml_presentations get           # 读全文（XML）
```

页面格式是飞书自定义的 SML 2.0：`<slide xmlns="http://www.larkoffice.com/sml/2.0"><data>...</data></slide>`。

实现路径：群聊上下文 → LLM 出大纲 → 程序拼 SML XML → 调 `slides +create` → 返回飞书原生 PPT 链接给用户（用户可在飞书内直接编辑）。

### 配置（首次使用）

```bash
lark-cli config init --new   # 阻塞式输出验证 URL，浏览器打开完成 OAuth
lark-cli doctor              # 健康检查：config + auth + 网络
```

## 7 条业务主线（决定哪些功能要做）

每条主线对应一个 Skill；Issue 标签 `area/skill` 里的所有任务都围绕这些：

| 编号 | 主线 | 触发 | 核心能力 |
|------|------|------|----------|
| 🅰 qa | 被动问答 | @bot + 疑问句 | 检索群历史回答 |
| 🅱 recall | **主动浮信息** 🔥 | "上次/之前/我记得" | 自动召回 + 摘要（核心差异化） |
| 🅲 summary | 会议纪要 | @bot 整理 | 议题/决议/待办/待跟进 4 段 |
| 🅳 slides | 幻灯片 | @bot 做 PPT | 群聊 → SML XML → 飞书原生 PPT |
| 🅴 archive | 复盘归档 | @bot 复盘 | 写回 Bitable |
| 🅵 crossChat | 跨群联动 | @bot 之前在 X 群 | 多 chatId 语义搜索 |
| 🅶 weekly | 定时周报 | cron 周五 17:00 | 自动扫本周消息生成 |

## 核心约束（写代码时必看）

### 飞书侧硬限制
- **API 频控**：100 req/min + 5 req/sec per bot — 必须做 token bucket 限流，不是优化项
- **批量上限**：Bitable 写入 500/batch，Bitable 整体 10 QPS
- **合规红线**：不能监听员工 1v1 私聊（飞书 API 不开放）；产品永远只在群里出现
- **bot 不能冷启动 DM 用户**：必须用户先 @ 或管理员推送

### 工程约束
- 单文件 ≤ 400 行；超过必须拆
- 接口契约统一在 `packages/contracts`，**改 contracts 必须 PR + 三人 review**
- 所有 LLM 调用走 `LLMClient.ask` / `askStructured`，不允许直接 fetch
- 所有飞书调用走 `BotRuntime` / `BitableClient` / `CardBuilder`，不允许散落 SDK 调用

## Git 协作

- 主分支 `main`，禁止直推；PR + Squash merge
- 分支命名：`feat/<area>-<短描述>` / `fix/<area>-<短描述>` / `docs/<短描述>`，area 取 `infra` / `ai` / `skill`
- commit 信息：`<type>(<scope>): <描述>`，type 取 `feat` / `fix` / `docs` / `refactor` / `test` / `chore`
- Issue 标签体系：
  - 领域：`area/infra` / `area/ai` / `area/skill` / `area/process`
  - 周期：`period-3` / `period-4` / `period-5`
  - 优先级：`blocker`（阻塞）/ `priority/high` / `priority/normal`
  - 必交付：`mvp-required`

## 时间节点

| 节点 | 日期 |
|------|------|
| 复赛 | 2026-05-06 |
| 决赛答辩 | 2026-05-14 |

每 3 天一个周期，每个周期需在 `docs/REPORTS/YYYY-MM-DD_period-N_<英文名>.md` 提交个人阶段成果小结，并同步到飞书 wiki（评委凭这个看过程表现）。
