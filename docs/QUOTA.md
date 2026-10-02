# Codex quota card / Codex 额度悬浮卡

## 中文

在 **集成与外观** 搜索 `Codex`，选择「始终显示」；默认在项目配置了 Codex 角色或任务覆盖时显示。卡片可收起，右上角隐藏后能在同一设置中重新打开。这些全局设置重启后保留。

卡片显示本机已登录 Codex 的**剩余额度**和账户重置时间。它只调用原生 `codex app-server` 的 `account/rateLimits/read`，不启动会话、不调用模型、不打开认证文件。先用 ChatGPT 账号登录 Codex；API key 登录不提供订阅额度。若找不到程序，将 `SONAIL_CODEX_COMMAND` 设为 Codex 可执行文件的完整路径，再重启 Sonail。它读取的是 CLI 当前账号，请确认与桌面账号一致。

**开启社区刷新预测**是独立的可选设置，默认关闭。启用且卡片显示时才读取公开数据，展示未来 24/48 小时概率、置信度、来源更新时间和最近全局刷新。数据来自 [codex-reset.com](https://codex-reset.com/)；原站的[中文信号页](https://codex-reset.com/zh/#signals)可核对公告。这是社区预测，不能保证你的账号刷新，也不会自动替你启动任务。

多个页面共用服务端一分钟缓存。手动刷新会给出反馈，也遵守缓存与来源的限流时间。隐藏卡片或页面不可见时停止定时读取；无法读取、旧数据和未知重置时间会明确标记。账户用量、凭据及项目内容不会发送给预测站点。

## English

Search for `Codex` in **Integrations & appearance** and choose **Always show**. By default, the card appears when a project role or task override uses Codex. Collapse it for a compact summary; hiding it is synchronized with the persistent global setting.

The card shows **remaining account quota** and account reset times. It only uses the native `codex app-server` `account/rateLimits/read` RPC: no threads, model calls or direct authentication-file reads. Sign in to Codex with ChatGPT; API-key authentication has no subscription limits. If the executable is not on PATH, set `SONAIL_CODEX_COMMAND` to its full path and restart Sonail. Limits belong to the CLI's current account, which should match your desktop account.

**Enable community reset forecast** is separate and off by default. A visible card then reads public 24/48-hour probabilities, confidence, source timestamps and the last global reset. Data: [codex-reset.com](https://codex-reset.com/), with its [signals page](https://codex-reset.com/zh/#signals) available for checking announcements. This community outlook cannot guarantee an account reset and does not launch work.

All cards share a one-minute server cache. Manual refresh gives feedback and honors that cache plus source `Retry-After`. Hidden cards and hidden pages stop interval reads. Unavailable, old and unknown values remain explicit. No account usage, credentials or project contents are sent to the forecast source.

## Adapter contract

- Types: `shared/quota.ts`; versioned interface: `IntegrationAdapter<T>` in `shared/workbench.ts`.
- Implementation: `packages/server/src/services/quota.ts`. `QuotaService` accepts separate account and forecast adapters; a replacement returns the same normalized values and its own source URL.
- Owner-only endpoint: `GET /api/workflow/quota`. Project-scoped AI credentials cannot read account quota.
- The source adapter uses only documented [public forecast fields](https://codex-reset.com/developers), carries the source URL and an identifying User-Agent, caches at least 60 seconds and honors HTTP 429. An unavailable source does not block project work.
- The account adapter uses the documented [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server). It closes only the read process it started. Balances and arbitrary plugin loading remain future work.
