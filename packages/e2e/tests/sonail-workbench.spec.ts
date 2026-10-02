import { test, expect } from '@playwright/test';
import { API, prepareTestRepo } from './helpers';

test('Sonail imports a manual plan, explains dependencies and switches language without a model call', async ({ page, request }) => {
  const repoPath = prepareTestRepo('sonail-manual-onboarding', { clean: true });
  const projectRes = await request.post(`${API}/api/projects`, { data: { name: 'Sonail onboarding', repoPath, defaultAgentType: 'opencode', defaultUseWorktree: true } });
  expect(projectRes.ok()).toBeTruthy();
  const project = await projectRes.json();
  const emptyProjectRes = await request.post(`${API}/api/projects`, { data: { name: 'Sonail no repository' } });
  expect(emptyProjectRes.ok()).toBeTruthy();
  const emptyProject = await emptyProjectRes.json();
  try {
    await page.goto('/workbench');
    await expect(page.getByLabel('选择项目')).toBeVisible();
    await page.getByLabel('选择项目').selectOption(emptyProject.id);
    await page.getByRole('button', { name: '使用指引', exact: true }).click();
    await expect(page.locator('.sb-guide').getByRole('button', { name: '新建项目', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '载入两任务示例', exact: true })).toBeDisabled();
    await page.getByLabel('选择项目').selectOption(project.id);
    await page.getByRole('button', { name: '使用指引', exact: true }).click();
    await expect(page.getByRole('heading', { name: '不用懂代码，也能掌握项目进展', exact: true })).toBeVisible();
    await expect(page.getByText(repoPath, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '配置角色', exact: true }).click();
    await expect(page.getByRole('heading', { name: '三个角色，分别配置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '使用指引', exact: true }).click();
    await page.getByRole('button', { name: '载入两任务示例', exact: true }).click();
    await expect(page.getByLabel('任务方案 JSON')).toBeVisible();
    expect(JSON.parse(await page.getByLabel('任务方案 JSON').inputValue()).tasks).toHaveLength(2);
    const beforeImport = await (await request.get(`${API}/api/workflow/${project.id}`)).json();
    expect(Object.keys(beforeImport.tasks)).toHaveLength(0);
    await page.getByRole('button', { name: '预览导入方案', exact: true }).click();
    await expect(page.getByRole('heading', { name: '这是不是你想要的结果？', exact: true })).toBeVisible();
    const staged = await (await request.get(`${API}/api/workflow/${project.id}`)).json();
    expect(staged.proposal.tasks).toHaveLength(2);
    expect(Object.keys(staged.tasks)).toHaveLength(0);
    await expect(page.getByText('等待：01 · 项目简介', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '符合我的想法，发布任务', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('方案已确认，任务卡已发布');
    await page.getByRole('button', { name: '任务看板', exact: true }).click();
    await expect(page.getByRole('button', { name: '01 · 项目简介', exact: true })).toBeVisible();
    await expect(page.getByText('等待上游合入', { exact: true })).toBeVisible();
    const state = await (await request.get(`${API}/api/workflow/${project.id}`)).json();
    expect(state.autonomous).toBe(false);
    expect(state.autoAccept).toBe(false);
    expect(Object.values(state.tasks).every((t: any) => t.phase === 'ready' && !t.acceptedAt)).toBeTruthy();
    await page.getByRole('button', { name: '01 · 项目简介', exact: true }).click();
    await page.getByText('原始执行过程（高级）', { exact: true }).click();
    await page.getByRole('button', { name: '详细执行过程', exact: true }).click();
    await expect(page.locator('#agent-panel').getByRole('button', { name: '执行记录', exact: true })).toBeVisible();
    await expect(page.locator('#agent-panel').getByRole('button', { name: '任务说明', exact: true })).toBeVisible();
    await page.getByTitle('关闭详情（Esc）', { exact: true }).click();
    await expect(page.locator('#agent-panel')).not.toBeVisible();
    await page.locator('.sb-drawer > header .sb-icon').click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Manager records', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Getting started', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Keep control without reading every line of code', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue current work', exact: true }).click();
    await page.getByRole('button', { name: '01 · 项目简介', exact: true }).click();
    await page.getByText('Raw execution activity (advanced)', { exact: true }).click();
    await page.getByRole('button', { name: 'Detailed execution', exact: true }).click();
    await expect(page.locator('#agent-panel').getByRole('button', { name: 'Events', exact: true })).toBeVisible();
    await page.getByTitle('Close panel (Esc)', { exact: true }).click();
    await expect(page.locator('#agent-panel')).not.toBeVisible();
    await page.locator('.sb-drawer > header .sb-icon').click();
    await page.getByRole('button', { name: 'Integrations & appearance', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Service & startup', exact: true })).toBeVisible();
  } finally {
    await request.delete(`${API}/api/projects/${project.id}`);
    await request.delete(`${API}/api/projects/${emptyProject.id}`);
  }
});


test('Codex quota card keeps account limits, source attribution and global visibility in sync', async ({ page }) => {
  let settings = { theme: 'sage', quotaVisibility: 'shown', resetForecast: true };
  await page.route('**/api/workflow/settings', async route => {
    if (route.request().method() === 'PUT') settings = { ...settings, ...route.request().postDataJSON() };
    await route.fulfill({ json: settings });
  });
  await page.route('**/api/workflow/quota', route => route.fulfill({ json: {
    account: { status: 'available', observedAt: Date.now(), buckets: [{ id: 'codex', name: 'codex', windows: [{ usedPercent: 28, remainingPercent: 72, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, { usedPercent: 9, remainingPercent: 91, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86400 }] }] },
    forecast: { status: 'available', source: 'https://codex-reset.com/', observedAt: Date.now(), updatedAt: new Date().toISOString(), probability24h: 16, probability48h: 29, confidence: 'low', officialSignal: false },
  } }));
  await page.goto('/workbench');
  const card = page.getByRole('complementary', { name: 'Codex 额度悬浮卡' });
  await card.getByRole('button', { name: /Codex/ }).click();
  await expect(card.getByText('72% 剩余')).toBeVisible();
  await expect(card.getByText('91% 剩余')).toBeVisible();
  await expect(card.getByRole('link', { name: '数据来源：codex-reset.com' })).toHaveAttribute('href', 'https://codex-reset.com/');
  await card.getByRole('button', { name: '刷新额度', exact: true }).click();
  await expect(card.getByText('读取已完成（缓存一分钟）')).toBeVisible();
  await card.getByRole('button', { name: '隐藏额度卡', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '集成与外观', exact: true }).click();
  await page.getByLabel('搜索集成设置').fill('Codex');
  await expect(page.getByLabel('悬浮卡显示方式', { exact: true })).toHaveValue('hidden');
  await page.getByLabel('悬浮卡显示方式', { exact: true }).selectOption('shown');
  await expect(card).toBeVisible();
  await page.getByLabel('开启社区刷新预测', { exact: true }).uncheck();
  await expect(card.getByText('社区预测未开启，可在集成设置中打开。')).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Codex quota card' }).getByText('72% remaining')).toBeVisible();
});
