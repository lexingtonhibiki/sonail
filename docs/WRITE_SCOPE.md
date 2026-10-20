# Structured write scope / 结构化写入范围

Tasks may include `allowedWritePaths` in an imported or manager-generated plan, and users may configure it in the task editor. The confirmed plan shows the scope before publication.

Version 1 semantics:

- Missing: legacy task, no structured scope gate. No scope is inferred from prose.
- `[]`: read-only **delivery**, requiring an empty Git delivery diff.
- `["README.md", "src/widgets/"]`: exact file, or directory prefix with an explicit trailing slash. Prefixes do not match similarly named sibling directories. Case is preserved.
- No glob, regex, absolute paths, traversal, backslash, drive/colon or Git administrative paths. Up to 100 distinct entries, 500 characters each. Invalid input is rejected, not silently normalized.
- Editing without this field preserves an existing scope. There is no API to clear a configured scope back to legacy. Changing scope reopens the task and invalidates dependent acceptance, like other task-specification edits. Manager adjustments cannot change scope.

The server checks real Git paths before automatic staging/commit, after syncing the captured main-branch commit, after review, and during acceptance/integration freshness checks. Each check includes committed, staged, unstaged and non-ignored untracked changes. Renames are deletion plus addition, so both names must be permitted. NUL-delimited output preserves spaces and newline filenames. Scope is part of the review digest. Existing generation, dependency, baseline, independent-review and human-experience gates still apply.

Changed submodules (Git links) are unsupported and blocked for scoped tasks; untouched submodules remain permitted. Git diff configuration cannot suppress these checks. Changed, added or removed symbolic links are conservatively blocked for scoped tasks, including Git/index link modes; untouched existing links do not cause rejection. Checks do not follow links to inspect external targets. A violation blocks review/delivery with the paths listed, preserving the work for manual correction. Sonail does not automatically expand scope or undo files.

## Not a sandbox / 不是安全沙箱

This is an acceptance/delivery boundary, not runtime write prevention. It does not prevent a worker from writing outside its worktree, reading files, running commands or using the network. Ignored files are not checked. It does not prove that a file was never changed then restored. External concurrent changes remain possible; freshness rechecks narrow race windows but are not OS-level atomic isolation. No new command, installation, network or host permission is granted by this field.

中文：未配置字段保持旧任务行为；空数组表示不允许交付 Git 差异；目录范围必须以 `/` 结尾。验收门禁检查已提交、暂存、未暂存及未忽略的新文件，重命名两端均检查。越界保留产物并阻塞，不自动撤回、不扩大范围。它不是主机权限或沙箱，不覆盖 ignored 文件，也不能阻止执行期间的实际写入。原有独立审查、经理建议、用户体验确认和合入仍是不同步骤。
