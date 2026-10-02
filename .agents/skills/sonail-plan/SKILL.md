---
name: sonail-plan
description: Turn a user's original goal into a Sonail task plan and send it to the project's confirmation queue through MCP. Use for Sonail planning/import requests, not task execution or acceptance.
---

# Sonail 项目任务方案

用户只需讲想做什么，不需要填写 JSON 字段。使用已经授权的项目，不扫描磁盘猜目录。

1. 调用本项目连接的 `get_project_context`，核对返回的项目ID及目录与用户所选目标一致。原始需求与用户已有授权持续有效；密钥只授权它绑定的项目，不以自称经理或某个模型作为权限依据。
2. 对照用户原话起草普通人能读懂的产品说明，再拆成最少的连贯任务。若有真实产品选择拿不准，只提出必要的问题。项目已有任务时，解释当前状态和修订建议，不重复导入。
3. 按 [方案格式](references/proposal.md) 生成 JSON，用 `originalIdea` 保留用户的原始文字。每张任务的执行说明写清允许修改范围、只读上游产物和需要的依赖。路径用任务工作区内的相对路径；不要把主项目绝对目录拼入相对路径，或让执行者直接写主分支。
4. 客观条件应能由审查者独立取证；真实交互、审美等体验条件标为 `human`，保留给用户。不要降低原始要求，不编造已经通过的检查。已有联网/安装授权按原需求继承，不自行添加新许可或重复索要已给的许可。
5. 本机 Sonail 可用时运行 `node <Sonail安装目录>/scripts/validate-plan.mjs <plan.json>`，它使用实际工作流解析器；MCP 的送审接口也使用同一个解析器。修复列出的错误后，调用 `preview_task_plan`，带刚读取的 `fingerprint`、`expectedRevision` 和完整 `proposal`。
6. 告诉用户去“想法与规格”看方案并确认。送审不等于发布或执行；不寻找或调用发布、启动、验收、合入接口，不替用户确认体验。

密钥只放在用户的本地 MCP 配置或进程环境中，不写入方案、提示词、日志或回复。凭据失效时让用户重新签发；不要绕过接口权限。控制台提示指纹或版本变化时重新读取项目，已有来稿冲突时交给用户处理，不静默覆盖。
