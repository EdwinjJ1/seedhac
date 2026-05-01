# 本地联调环境搭建

三个人共用同一个飞书测试 bot（`Sentinel-Dev`）和测试群（`Sentinel-Dev-测试群`），本文记录从零跑通的全部步骤。

## 前置

- Node ≥ 20（项目 CI 在 20，本地用 22 也可）
- pnpm ≥ 8
- 测试 bot 的 4 个凭证（找队长拿，或自己有 owner 权限的话从飞书开放平台拿）

## 一、克隆 + 安装

```bash
git clone git@github.com:EdwinjJ1/seedhac.git
cd seedhac
pnpm install
```

## 二、填 `.env`

```bash
cp .env.example .env
```

打开 `.env`，把这 4 个字段填上：

| 字段 | 在飞书开放平台哪里找 |
|------|---------------------|
| `LARK_APP_ID` | 应用详情 → 凭证与基础信息 → App ID |
| `LARK_APP_SECRET` | 应用详情 → 凭证与基础信息 → App Secret |
| `LARK_VERIFICATION_TOKEN` | 事件订阅 → Verification Token |
| `LARK_ENCRYPT_KEY` | 事件订阅 → Encrypt Key（没开加密就留空） |

> `.env` 已经在 `.gitignore`，不会被提交。**不要**把凭证贴到 PR 描述、issue 或群里。

## 三、确认应用配置

应用 `Sentinel-Dev` 必须满足下面几条，否则 WSClient 启不起来或者收不到消息。

### 1. 权限（开发配置 → 权限管理）

- `im:message`、`im:message.group_at_msg`、`im:message.group_at_msg:readonly`、`im:message:send_as_bot`
- `im:chat`、`im:chat:readonly`
- `bitable:app`
- `contact:user.base:readonly`

权限改完要点一次"创建版本并申请发布" / "重新发布"，否则 token 拿不到对应作用域。

### 2. 事件订阅（开发配置 → 事件订阅）

- 推送方式：**长连接**（WSClient）
- 订阅事件：`im.message.receive_v1`（接收消息）

### 3. 机器人能力（应用能力 → 机器人）

打开"启用机器人能力"，否则 bot 不能被加进群。

### 4. 测试群

- 名字：`Sentinel-Dev-测试群`
- 成员：`Sentinel-Dev` bot + 三个开发同学（Evan / Antares / 沛彤）
- 群内 @bot → 添加成员 → 找到 `Sentinel-Dev`

## 四、跑起来

```bash
pnpm build          # 第一次跑必须 build，bot 依赖 contracts 和 skills 的 dist
pnpm --filter @seedhac/bot dev
```

成功的话控制台会输出大致这样的内容：

```
[seedhac/bot] booting v0.1 (WSClient scaffold)
[seedhac/bot] loaded 7 skill(s):
  - qa: ...
  - recall: ...
  ...
[seedhac/bot] starting WSClient long connection...
[seedhac/bot] WSClient ready — 在测试群发一句话试试
```

## 五、验收：群里发一句话

在 `Sentinel-Dev-测试群` 里随便发一句 "hello bot"，本地控制台应该出现：

```
[seedhac/bot] 群消息 chat=oc_xxxxxxxx sender=ou_xxxxxxxx type=text text=hello bot
```

看到这一行就算 issue #13 验收通过 —— **截图存档** 到 PR 评论或 `docs/REPORTS/`。

## 常见问题

**`缺少环境变量：LARK_APP_ID, LARK_APP_SECRET`**
没拷 `.env`，或者拷了但没填值。回到第二步。

**`pnpm dev` 启动后没报错，但群里发消息控制台没反应**
- 检查 bot 是不是真的在 `Sentinel-Dev-测试群`（@一下试试）
- 检查事件订阅订了 `im.message.receive_v1` 没
- 权限改过的话，**必须重新发布版本**才会生效

**`Cannot find module '@seedhac/contracts'`**
没跑 `pnpm build`。bot 是 ESM + workspace 依赖，得先 build 出 dist。

**WSClient 一直 reconnect**
大概率是 App ID / App Secret 错了，或者所在网络访问不到 `wss://`。换网试试。
