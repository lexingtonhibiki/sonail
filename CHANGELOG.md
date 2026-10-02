# Changelog / 更新记录

## 0.1.0-preview.4 — 2026-10-03

- Project-bound, revocable read/preview credentials with hashed storage and a copyable Codex/OpenCode/generic MCP configuration.
- Official SDK stdio MCP and a dedicated `sonail-plan` skill send AI drafts into the console without model calls or automatic publication.
- Readable manual/AI previews show the original request, intended result, task dependencies and human experience checks before confirmation.
- Repository identity, plan revision and Git baseline checks prevent stale imports; pending drafts appear in project attention and open directly.

项目范围凭据支持只读、送审和撤销；密钥仅保存摘要。新增原生工具 MCP 配置与任务规划 skill，AI 来稿和手动 JSON 都先展示结果、依赖与体验条件，确认后创建卡片。待确认方案在项目总览中提醒，不会自动执行或代替用户验收。

## 0.1.0-preview.3 — 2026-10-03

- Always reachable Chinese/English getting-started guide with the selected repository, real integration progress and direct next-step links.
- Load the existing two-task example into the editor for confirmation, without an automatic model call or task publication.
- Localize the workbench's embedded execution controls, event categories, copy feedback and failure guidance while preserving model output.
- Extend the existing onboarding browser flow to cover guide navigation, explicit import confirmation and both detail-panel languages.

常驻中英使用指引显示真实项目进度；两任务示例先填入编辑区、确认后发布。工作台执行详情的主要操作、记录分类与失败说明跟随语言切换，模型原文保持原样。

## 0.1.0-preview.2 — 2026-10-03

- Give Linux worktree cleanup contracts the process visibility required by their safety checks.
- Isolate browser-test workflow storage from server-contract fixtures and local runtime data.
- Keep cleanup blocked when process usage cannot be verified; no product acceptance gates changed.

修复 Linux CI 的测试权限与数据隔离：清理测试获得所需的进程读取权限，浏览器测试使用独立状态文件。保留产品的保守清理规则与验收门槛。

## 0.1.0-preview.1 — 2026-10-02

First public Sonail preview, derived from AI Agent Board under MIT.

- Chinese/English light workbench and three palettes.
- Project specifications, configurable manager/executor/reviewer roles and model candidates.
- Independent review, manager recommendations, bounded revisions, human acceptance and Git integration gates.
- Project overview, categories, pins, search, archive/restore and card integration shortcut.
- Persistent manager records, disclosed fully managed settings and feedback for blocked workflows.
- Owned Windows launch/stop, current-user login startup and desktop entry.
- Compiled runtime launch, bilingual guides, demo proposals and actual UI GIFs.

首个公开预览版：亮色中英工作台、三个AI角色、独立审核与经理把关、受限自动推进、多项目管理、持久化及Windows启动入口。未完成能力见路线图。
