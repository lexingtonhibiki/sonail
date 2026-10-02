# Changelog / 更新记录

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
