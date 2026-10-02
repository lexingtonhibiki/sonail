# 当前 Sonail 方案格式

使用当前工作台的 `Proposal`，旧 Python 控制台的 schemaVersion 3 任务包不会被转换。

```json
{
  "originalIdea": "用户的原始需求文字，保留原意（推荐填写）",
  "productSpec": "面向用户的结果、使用方式与成功表现（字符串）",
  "technicalSpec": "实现思路、执行边界与验证方式（字符串）",
  "tasks": [{
    "title": "01 · 清楚的任务名",
    "description": "完整执行说明。允许写 notes/intro.txt；上游只读；继承项目已授予的联网/安装权限。交付路径为工作区相对路径。",
    "criteria": [{"id":"A1","text":"能独立核实的具体结果","kind":"objective"},{"id":"A2","text":"用户实际体验确认点","kind":"human"}],
    "dependsOn": [],
    "complexity": "small"
  }]
}
```

最多30项任务；标题最长200字符，执行说明最长5000字符；`complexity` 为 `small` / `standard` / `deep`。`dependsOn` 使用前序任务从0开始的索引，不依赖后序、不成环。验收标识在单张任务内唯一，每项至少一条条件。不要把 token 估算、模型选型或密钥塞进执行说明。

调用 `preview_task_plan` 时传 `{ "fingerprint": "上下文返回值", "expectedRevision": 1, "proposal": { ... } }`。版本必须来自刚读取的上下文。权限由绑定项目的凭据决定，方案自身不能声明权限。成功响应只证明格式有效且已送入待确认区。
