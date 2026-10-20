# Usage evidence / 用量证据

This is a bounded evidence foundation, **not a complete billing ledger**. No prices,
quota percentages or currency totals are inferred. It does not change routing,
selected effort, review or human acceptance.

每次 harness execute 结束（包括失败）保留一条结构化证据；不是完整账单，
不根据额度百分比或价格表推算费用，不改变模型路由、审查或人工验收。

## Contract

- One `metadata.sonailUsage` event per `HarnessProvider.execute` invocation. A UUID
  `attemptId` distinguishes executor reruns and manager/reviewer correction calls.
  `selectedModel` is configuration, **not proof of the model actually billed**.
- All roles persist as optional `WorkflowEvent.usage` in an existing project.
  Executor evidence also remains in task-event metadata for compatibility, with
  the same attemptId: these are copies, not additive reports. Workflow evidence
  deduplicates retained attempt IDs and survives manual task-event reset. Deleted
  projects are not recreated. Old files remain readable.
- `reports` are ordered provider-reported **snapshots**, never additive deltas.
  Repeated snapshots must not be summed. Cached/reasoning counters may overlap
  other counters. No cross-provider normalization or aggregation is provided.
- Codex: `turn.completed.usage`, turn scope; input/output/cached input/reasoning output retained.
  No cost is supplied by this SDK event, so cost remains null.
- Claude: `result.usage` plus explicit `result.total_cost_usd`, invocation scope.
  Error results are captured before classifying the invocation as failed. USD is
  justified by that SDK field, not a local pricing table. Provider-reported cost
  is not a verified invoice. Per-model breakdown is not included in this version.
- OpenCode: `session.prompt` response `info.tokens` and `info.cost`, **last-message
  scope only**, not all agent/tool turns. Currency is null: the SDK type says
  `cost: number`, not a currency. This version does not collect prior messages.
- DSH has no verified usage mapping here. An empty `reports` array means unknown,
  never zero. Missing fields are omitted; explicit zero is preserved. Invalid
  negative/nonfinite/fractional/unsafe-integer token counters are omitted and
  named in `invalidFields`; malformed costs are likewise rejected.
- Sources: locked SDK declarations (`@openai/codex-sdk` `TurnCompletedEvent`,
  `@anthropic-ai/claude-agent-sdk` `SDKResultMessage`,
  `@opencode-ai/sdk/v2` `AssistantMessage`). Offline fixtures verify extraction;
  no live-provider/account billing support is claimed.

## Limits / 边界

Workflow history is capped at 250 events. Existing executor-event retention also
applies; manual executor rerun clears task-event copies via `resetEvents()`,
not the bounded project workflow evidence. Pre-session start failures and process crashes may leave no usage record;
provider-internal retries may not be separately exposed. Cancellation may produce
an empty report. A completed invocation with a report is not a complete project
cost: missing/expired history, unreported usage, unknown currencies, and partial
OpenCode scope remain unknown. Do not label sums over this data “total run cost.”

工作流最多保留 250 条事件，历史淘汰、崩溃、调用前失败、供应商内部重试和
未上报用量可能导致缺失。OpenCode 仅记录最后消息。未知费用始终未知，
不能将现有事件相加后称为项目总成本。
