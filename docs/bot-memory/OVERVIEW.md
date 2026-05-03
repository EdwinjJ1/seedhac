# Lark Loom Bot — 记忆与上下文系统总览

## 定位

Lark Loom 是飞书群聊 AI 助手。Bot 的核心差异化在于**事中主动介入**：不等用户问，当对话中出现信息缺口时自动浮出历史记录。

记忆系统采用 Harness 架构：**无固定系统提示**，模型在推理时按需调用 `memory.read` / `skill.read` 工具，拿到的内容直接进 context window，用完丢弃。

---

## 红线（不可逾越）

| 编号 | 规则 |
|------|------|
| R1 | 不主动推送未被触发的 Skill 结果（recall 除外，但须有明确信息缺口） |
| R2 | 不读取非本群的聊天记录 |
| R3 | 不在卡片中暴露原始 Bitable record_id 给普通用户 |
| R4 | Bitable 写操作须全成功或全失败（batchInsert 原子性） |
| R5 | 不调用 10 QPS 以上的飞书 API |
| R6 | 不存储任何个人敏感信息（手机号、身份证等） |

---

## 工具索引（模型可调用）

| 工具 | 作用 |
|------|------|
| `memory.read` | 按 chatId + 关键词查 Bitable memory 表 |
| `skill.read` | 获取指定 Skill 的行为规范文档（本目录下 `skills/*.md`） |
| `bitable.find` | 通用多维表格查询 |
| `bitable.insert` | 写入 memory / decision / todo / knowledge 表 |
| `retriever.search` | 向量检索（Chroma）或 Bitable 全文检索 |
| `docx.read` | 读取飞书文档正文（Wiki / 云文档） |

---

## 四张核心表

| 表 | 用途 |
|----|------|
| `memory` | 每次 Skill 调用的决策摘要与 reasoning |
| `decision` | archive Skill 抽出的决策条目 |
| `todo` | archive Skill 抽出的待办事项 |
| `knowledge` | 双向关联节点（知识图谱 1-2 跳） |

字段详见 [MEMORY-SCHEMA.md](./MEMORY-SCHEMA.md)。

---

## Skill 列表

| Skill | 触发方式 | 文档 |
|-------|---------|------|
| qa | @bot + 疑问句 | [skills/qa.md](./skills/qa.md) |
| recall | 群消息出现模糊指代词 | [skills/recall.md](./skills/recall.md) |
| summary | @bot 整理/纪要/总结 | [skills/summary.md](./skills/summary.md) |
| slides | @bot 做 PPT/幻灯片 | [skills/slides.md](./skills/slides.md) |
| archive | @bot 复盘/归档 | [skills/archive.md](./skills/archive.md) |
| weekly | cron 周五 17:00 | [skills/weekly.md](./skills/weekly.md) |
