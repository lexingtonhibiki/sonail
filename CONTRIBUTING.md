# Contributing / 贡献指南

Chinese and English are welcome. Report expected/actual behavior, Sonail version, OS/Node and minimal steps. Remove keys and personal paths from screenshots/logs. Start larger changes with an issue to align scope.

中文或英文均可。请说明预期、实际行为、版本及复现步骤；截图和日志先去除密钥与个人路径。较大改动先开 Issue 对齐范围。

## Development

Install Node 22/24 and Git. Run `npm ci`, `npm run build`, then `npm run dev`. Dev UI/API use 8081/8080; Windows product launch uses 19101/19100. Visit /workbench; /projects retains upstream detail.

Run `npm run build:shared`, `npx playwright install chromium` in packages/e2e, then `npm run gate:required`. The gate includes server contracts, Python integration tests, builds and deterministic E2E without paid model calls. CI installs Chromium with system dependencies.

Maintain bilingual labels/docs and review/human gates. Live-provider checks require separate evidence; mocks do not establish account support. Prefer small changes without new dependencies. Contributions remain MIT; retain upstream notices.
### Existing browser runtime

If Chromium installation is unavailable, local E2E checks can explicitly use an existing Chrome Headless Shell executable through `E2E_CHROMIUM_EXECUTABLE`. No automatic fallback is applied. CI installs the matching Playwright browser.
