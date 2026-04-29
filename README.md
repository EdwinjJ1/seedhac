# SeedHAC

字节跳动飞书 AI 校园挑战赛 · 参赛项目

## 团队

- Evan 贾岱林
- Antares Yuan 袁晨杰
- 齐沛彤

## 参赛赛道

**飞书 AI 产品创新赛道**

志愿课题（按优先级）：

1. 基于 IM 的办公协同智能助手（第一志愿）
2. Multi-Agent Network · 多维表格上的多智能体虚拟组织（第二志愿）
3. 基于 AI 驱动的需求交付流程引擎（第三志愿）
4. 基于 Agent 的服务自动化修复系统（备选）

## 方向目标

做一个住在飞书里的 **"办公效能 Agent"**，让员工的**会议贡献、任务执行、绩效表现**全部可量化、可追踪、可干预。

三大核心能力：

- **会议贡献分析** —— AI 识别挂会行为，量化每个人的真实贡献度
- **任务自动化巡检** —— Agent 主动催办、识别停滞任务、判断真实完成度
- **绩效智能分析** —— 多维数据汇总，输出客观的个人/团队效能画像

帮助员工看见自己贡献，而不是帮老板监视员工。（为了过审）

## 时间节点

| 节点 | 日期 |
|------|------|
| 报名截止 | 2026-04-17 |
| 入营公布 | 2026-04-22 |
| 复赛 | 2026-05-06 |
| 决赛答辩 | 2026-05-14 |

## 资源

- 火山方舟 Coding 豪华套餐
- 飞书 OpenAPI 无限调用额度

---

## 工程结构

pnpm monorepo，三个 package：

```
packages/
├── contracts/    # 跨包接口契约（Message/Card/BotRuntime/BitableClient/CardBuilder/LLMClient/Retriever/Skill）
├── bot/          # 飞书 bot 进程入口（WSClient + Skill Router + 限流）
└── skills/       # 7 条业务主线 Skill 实现（qa/recall/summary/slides/archive/crossChat/weekly）
```

> 改 `packages/contracts` 必须 PR + 三人 review（CLAUDE.md 硬约束）。

## 跑起来（四步）

```bash
# 1. clone
git clone git@github.com:EdwinjJ1/seedhac.git
cd seedhac

# 2. install
pnpm install

# 3. build
pnpm build

# 4. dev（启动 bot 进程，v0.1 仅打印加载到的 skill 清单）
pnpm dev
```

辅助命令：

```bash
pnpm lint            # ESLint 全包
pnpm typecheck       # 全包 tsc --noEmit
pnpm format          # Prettier 全包格式化
pnpm clean           # 清掉 dist / .tsbuildinfo
```

环境要求：Node ≥ 20、pnpm ≥ 8。

## 文档地图

读懂这个项目从这四份开始：

1. [`README.md`](README.md) — 你正在看的这份
2. [`docs/Q&A-产品方向.md`](docs/Q&A-产品方向.md) — 产品定位、红线（不能监听员工 1v1 私聊）
3. [`docs/飞书权限与能力边界.md`](docs/飞书权限与能力边界.md) — 5 个 UI 入口、API 频控、合规边界
4. [`docs/技术栈与可复用能力.md`](docs/技术栈与可复用能力.md) — 技术选型 + 架构图 + Skill Router

会议纪要：[`docs/MEETING-NOTES.md`](docs/MEETING-NOTES.md)
个人阶段成果（每 3 天一份）：[`docs/REPORTS/`](docs/REPORTS/)

## 给 Claude Code

仓库根目录的 [`CLAUDE.md`](CLAUDE.md) 写明了项目背景、技术约束、Git 协作规范、`lark-cli` 用法。新会话或 agent 都从这里读起。
