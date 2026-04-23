# 入营分享会议记录

**日期**：2026-04-23
**主题**：飞书 OpenClaw / CLI + Skills · 面向 Agent 的统一接入层

---

## 项目方向

**SeedHAC · 办公效能 Agent**，三个子能力：

1. **会议贡献分析** —— 量化每个人在飞书会议中的真实参与度
2. **任务自动化巡检** —— 主动催办、识别停滞任务
3. **绩效智能分析** —— 多维数据汇总，输出客观效能画像

---

## 我们的解决方案（对齐 CLI + Skills 方法论）

### 1. CLI 化：三个子能力 = 三组命令

```bash
seedhac meeting analyze <id>
seedhac task check --user=<id>
seedhac perf report --team=<id> --week
```

不藏 MCP 黑盒，命令本身就是 API。

### 2. 每个业务域配一份 SKILL.md（三段式）

```markdown
# meeting/SKILL.md
## 何时使用 → 分析会议参与度、识别挂会
## 常用操作 → seedhac meeting analyze / score / flag
## 坑       → 静音 ≠ 摸鱼；1v1 不适用；ID 用 omm_xxx 格式
```

### 3. 中间结果落盘 = 写飞书多维表格

| 讲师的话 | 我们的实现 |
|---------|-----------|
| 中间结果写文件 | 写飞书多维表格 |
| jq 过滤 | 多维表格 filter API |
| Agent 读文件 | Agent 查多维表格 |
| 文件系统是工作台 | **多维表格是工作台** |

既符合方法论，又紧贴飞书生态。

### 4. 管道组合：三个 Agent 通过表协作

```
会议 Agent → 写 bitable_meeting_scores
任务 Agent → 写 bitable_task_anomalies
绩效 Agent → 读上面两张表 → 出报告
```

不互相直接调用（避免回到 MCP 的坑），契约 = 表的 schema。

---

## 技术栈

| 层 | 技术选型 | 用途 |
|----|---------|------|
| **用户入口** | 飞书 IM @机器人 | 不做前端，对话即入口 |
| **Agent 身份** | 三个独立飞书账号 | 让 Agent 作为团队成员上飞书干活，不只是"机器人" |
| **Agent 层** | Python | 三个 Agent 的核心逻辑 |
| **能力层** | `lark-cli`（已开源 github.com/larksuite/cli）| 飞书所有 API 走这里，subprocess 调用 |
| **AI 模型** | 火山方舟豆包（赛事免费额度）| 语义分析、贡献评分 |
| **存储** | 飞书多维表格 | 中间结果 + 最终报告 |
| **触发** | 飞书 Webhook + Cron | 会议结束触发 / 定时巡检 |
| **部署** | 单机 / 火山方舟容器 | MVP 阶段够用 |

### lark-cli 四层架构怎么用

飞书 CLI 有四层（L1 通用 API → L2 Meta API → L3 Shortcuts → L4 Workflow），
我们的 `seedhac` 命令本质上是**自己造一层 L4 Workflow**，底下能力全部
用 lark-cli 的 L1/L2 拼出来，不重复造轮子。

### 我们要用到的 lark-cli 业务域

| 业务域 | 用途 |
|--------|------|
| `lark vc` / `meeting` | 会议数据采集（参会、发言、纪要） |
| `lark task` | 任务巡检（状态、deadline、负责人） |
| `lark bitable` | 多维表格读写（中间结果、最终报告） |
| `lark im` | 推送评分/告警/报告卡片 |
| `lark calendar` | 日历事件、会议关联 |

---

## 开发原则

- Agent 用 subprocess 调 `lark xxx` + `seedhac xxx`，不写 SDK 封装
- 不熟的命令 `--help` 现查，不预加载到 context
- 大返回值 `> output.json` 落盘 + jq/Python 处理片段
- 出错读 stderr 改命令重试

## Agent 身份设计（差异化）

讲师强调 Agent 可以**拥有独立飞书账号**，作为团队成员参与协作。
我们的三个 Agent 各自一个账号：

| Agent 账号 | 在飞书里的角色 |
|-----------|---------------|
| `seedhac-meeting-bot` | 会议结束后在群里发评分卡片 |
| `seedhac-task-bot` | 主动 @ 用户催办、回复任务问询 |
| `seedhac-perf-bot` | 周报私信管理者、生成多维表格 |

这样评委看到的是"3 个 AI 同事在团队里干活"，而不是"一个机器人有多个命令"。

## 加分项（决赛前可做）

- 反向贡献 SKILL.md 给 `larksuite/cli` 仓库
  （讲师明确说"你们做的 Agent 也可以直接接上来"，这是官方背书）
- 提 issue / PR 显示我们参与了生态建设

---

## 待办

- [ ] 三人对齐 MVP 范围
- [ ] 调研 lark-cli 实际命令清单（哪些是 L3 Shortcuts 直接能用）
- [ ] 跑通最小闭环：一场真实会议 → 一份评分 → 飞书消息卡片
- [ ] 写三份 SKILL.md
- [ ] 决定团队分工

## 时间节点

| 节点 | 日期 |
|------|------|
| 复赛 | 2026-05-06 |
| 决赛答辩 | 2026-05-14 |
