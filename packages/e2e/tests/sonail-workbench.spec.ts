import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { API, prepareTestRepo } from './helpers';

test('Sonail imports a manual plan, explains dependencies and switches language without a model call', async ({ page, request }) => {
  const repoPath = prepareTestRepo('sonail-manual-onboarding', { clean: true });
  const projectRes = await request.post(`${API}/api/projects`, { data: { name: 'Sonail onboarding', repoPath, defaultAgentType: 'opencode', defaultUseWorktree: true } });
  expect(projectRes.ok()).toBeTruthy();
  const project = await projectRes.json();
  try {
    await page.goto('/workbench');
    await expect(page.getByLabel('选择项目')).toBeVisible();
    await page.getByLabel('选择项目').selectOption(project.id);
    await page.getByRole('button', { name: '想法与规格', exact: true }).click();
    await page.locator('summary').filter({ hasText: '手动导入 JSON' }).click();
    await page.getByLabel('任务方案 JSON').fill(readFileSync('../../examples/demo.zh-CN.json', 'utf8'));
    await page.getByRole('button', { name: '确认导入任务', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('任务已导入');
    await page.getByRole('button', { name: '任务看板', exact: true }).click();
    await expect(page.getByRole('button', { name: '01 · 项目简介', exact: true })).toBeVisible();
    await expect(page.getByText('等待上游合入', { exact: true })).toBeVisible();
    const state = await (await request.get(`${API}/api/workflow/${project.id}`)).json();
    expect(state.autonomous).toBe(false);
    expect(state.autoAccept).toBe(false);
    expect(Object.values(state.tasks).every((t: any) => t.phase === 'ready' && !t.acceptedAt)).toBeTruthy();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Manager records', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Integrations & appearance', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Service & startup', exact: true })).toBeVisible();
  } finally {
    await request.delete(`${API}/api/projects/${project.id}`);
  }
});
