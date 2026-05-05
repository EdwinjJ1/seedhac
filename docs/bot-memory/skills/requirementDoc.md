---
name: requirementDoc
when_to_use: 群里出现项目背景、PRD、产品需求或功能需求，需要整理成结构化文档。
triggers:
  - 项目需求
  - 需求文档
  - PRD
  - 产品需求
inputs:
  - 当前消息
  - 近期群聊历史
outputs:
  - docPush 卡片
side_effects:
  - 创建飞书文档
  - 写入 memory
---

# requirementDoc — 需求文档生成

用于把零散需求讨论整理成结构化飞书文档。适合首次沉淀项目背景、目标、范围、用户故事、验收标准和待确认问题。

示例：

- “这是项目需求，请整理成文档”
- “我们要写一版 PRD”
- “以下是产品背景和核心功能”

不要用于普通问答、会议纪要总结或已有文档的小幅增量修改；这些分别交给 qa、summary、docIterate。
