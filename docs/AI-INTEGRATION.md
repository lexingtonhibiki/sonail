# AI task import / AI 任务导入

## 中文：在原生工具里规划，在 Sonail 里确认

1. 选择还没有任务卡的项目，确认项目目录是已有提交的 Git 仓库。
2. 打开“角色与设置 → 授权 AI 连接当前项目”，填写凭据名称。选“送审”用于规划导入，或选“只读”用于查看与建议。
3. 创建凭据，选择 Codex、OpenCode 1.x 或通用 MCP JSON，复制配置到对应工具的 MCP 设置。密钥只显示一次，配置文件会明文保存它。复制不会自动改动工具设置。
4. 复制“给 AI 的说明”，在原生工具的项目会话里粘贴，并补充你的原始想法。MCP 会读取凭据绑定的项目，并送入任务方案。
5. 控制台会显示待确认方案提示。打开“想法与规格”，核对预期结果、任务依赖和“你体验确认”条件，点击“符合我的想法，发布任务”。这里只创建卡片，执行仍按项目授权启动。

不想配置 MCP 时，可粘贴 JSON，点“预览导入方案”，经过相同的可读预览与确认。示例在 `examples/`，侧边栏“使用指引”可以直接载入。

凭据绑定一个项目及其仓库身份，有效30天。“只读”不能送审，“送审”也不能发布、执行、验收、合入或签发其他凭据。撤销立即阻止后续调用。服务端只保存密钥摘要，列表不会读回原密钥。项目目录或仓库身份改变，需要重新签发；方案版本或确认前的 Git 基线改变，需要重新送审。

已有待确认方案不会被新来稿静默覆盖；同一份内容重试不会重复占位。已有任务的项目暂不支持整包替换，请用卡片修订及经理意见。分级的任务修改权限属于后续工作。方案可附带 `originalIdea` 保留原始需求；仅在确认时、项目原始需求为空才填入。只读连接也能查看待确认草稿，供另一个 AI 给出建议。

这些权限约束的是带凭据的 HTTP 集成。默认控制台是本机信任环境，不提供终端或文件系统沙箱，也不是未经配置的公网服务。已获本机终端权限的 harness 仍拥有其原有权限。

## English: plan in your harness, confirm in Sonail

Select an empty project backed by a committed Git repository. In **Roles & settings → Connect AI to this project**, issue a named **Preview** credential. **Read-only** is available for inspection and recommendations.

Copy the generated MCP configuration into your harness settings, then paste **AI instructions** with your original request in its project session. The key is shown once; the local MCP configuration stores it as plaintext. Sonail shows a pending-plan banner. Review the intended result, dependencies and human experience checks in **Idea & specification**, then **Confirm and publish tasks**. This creates cards; execution follows project permissions. Manual JSON import uses the same preview/confirmation flow.

Each credential is bound to one project/repository identity, expires in 30 days and is revocable. The server persists only its hash. Neither permission grants publication, execution, acceptance, integration or credential administration. Changed repository identity requires a new credential; changed plan revision or Git confirmation baseline requires a fresh draft. Identical retries are idempotent, and a conflicting draft does not replace the pending one. Existing cards require per-card revision rather than package replacement. Include `originalIdea` to preserve the original request; it is adopted on confirmation only when the project has no existing idea.

This scopes authenticated HTTP integration, not local filesystem or terminal access. The default console trusts the local machine and is not an unconfigured public deployment or OS sandbox.

## Skill and protocol / 技能与接口

- The shipped [sonail-plan skill](../.agents/skills/sonail-plan/SKILL.md) generates the current [Proposal format](../.agents/skills/sonail-plan/references/proposal.md). Install/copy that folder into your harness's skills directory, or use the MCP instructions directly.
- `node scripts/validate-plan.mjs plan.json` uses the actual shared workflow validator. Build Sonail first. Old Python-console task packages are not converted.
- `scripts/sonail-mcp.mjs` uses the official MCP SDK and stdio. Configure `SONAIL_URL` and `SONAIL_AI_TOKEN` in its process environment. It exposes only `get_project_context` and `preview_task_plan`.
- HTTP integration: `GET /api/ai/context`, `POST /api/ai/preview`, both with `Authorization: Bearer <project-key>`. Preview body: `{ "fingerprint": "from context", "expectedRevision": 1, "proposal": { ... } }`. Use the returned revision, not a hardcoded value. No key in the body or URL.
- Context includes the original idea, specifications, pending draft and task summaries/criteria; it omits role/provider keys and raw execution logs.

Configuration references: [Codex MCP](https://developers.openai.com/codex/mcp), [OpenCode MCP](https://opencode.ai/docs/mcp-servers/), [official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk). OpenCode 2.x uses `mcp.servers` instead of the 1.x `mcp` server map; use its version's configuration documentation.
