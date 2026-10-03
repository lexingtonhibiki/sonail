# First project

Open **Getting started** from the sidebar at any time. It shows the selected repository, integrated task count and links to the next step. **Load two-task example** fills the editor without creating cards; inspect and confirm it first. Use a separate demo project when trying the example.

1. Install Node.js 22/24, Git and your preferred harness. Authenticate the harness outside Sonail.
2. Run `Setup.cmd`, then `Open-Sonail.cmd`. The local preview uses API port 19100 and UI port 19101. Keep its extracted folder stable.
3. Create a project pointing at an existing, committed Git repository. Worktrees branch from its baseline; a dirty target blocks integration.
4. Configure the manager, executor and reviewer independently in **Roles & settings**. OpenCode discovers models from its installed provider catalog. Do not assume a model is free or supports every reasoning level.
5. Write the original idea. Ask the manager to draft a proposal, then read/confirm it. For a no-model setup demonstration, paste `examples/demo.en.json` into **Idea & specification → Import JSON**. Dependencies are zero-based indices of earlier tasks.
6. Start the first unlocked card. Follow concise conclusions in **Manager records**, or open **Raw execution activity (advanced) → Detailed execution** in task details. The embedded panel's main controls follow the selected language; model output stays verbatim. Copying a handoff reports success/failure.
7. Reviewers provide criterion-level evidence. Blocking findings require revision; advisory findings are optional. The manager checks the project fit. Human criteria remain for your actual experience.
8. Accept only when satisfied, then **Integrate** from the card. It rechecks revision/fingerprint and unlocks downstream tasks. Reopening invalidates downstream assumptions; merely moving a card is not acceptance.

## Import from another AI session

Issue a project credential in **Roles & settings**, then copy its MCP configuration and AI instructions. AI submissions and manual JSON imports both show a readable draft before confirmation creates cards. See [AI task import](AI-INTEGRATION.md).

## Autonomy

Manual control is the default. **Fully managed** discloses and synchronizes automatic advancement, objective acceptance, integration and supplemental manager guidance. It preserves human experience gates and configured concurrency/revision limits. The manager cannot rewrite the canonical goal or criteria through supplemental guidance. Pausing does not undo commands already executed.

## Startup and recovery

**Integrations & appearance → Service & startup** manages current-user Windows login startup and a desktop launcher. Login startup opens no browser. On restart, AI scheduling pauses instead of replaying uncertain calls. Inspect records before resuming.

If a port is occupied, the launcher refuses to kill unrelated processes. Read `data/runtime/launcher.log`. Stop this instance with `停止Sonail.cmd`. To use alternative ports directly: `powershell -File scripts/start-sonail.ps1 -ApiPort 19200 -UiPort 19201 -Open`. Shortcuts use the default ports.

Back up the entire `data/` directory after stopping. Never commit it. Endpoint keys are currently local plaintext; OS keyring support is planned.

## Scope of this preview

Windows launch integration and the default SQLite workflow are the tested product route. The upstream PostgreSQL/container features are retained in source but not a verified Sonail deployment. Native adapters may have account/model limitations. No long-lived native manager session, arbitrary plugin loader or balance fetch is claimed.

## Codex quota

Search for Codex in **Integrations & appearance** to show or hide the quota card. Community forecasts are optional and off by default; neither feature calls a model. See the [quota guide](QUOTA.md).

## Tools directory

Search **tools** in Integrations & appearance to edit the machine-wide installation root or restore the default. AI/native and manual handoffs share it. See [directory policy](TOOLS.md).
