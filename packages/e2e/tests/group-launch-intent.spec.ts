import { test, expect } from '@playwright/test';

const cases = [
  { name: 'first run click', checked: false, actions: ['Create & Run'], expected: [true] },
  { name: 'plain create overrides checked auto-run', checked: true, actions: ['Create Group'], expected: [false] },
  { name: 'failed run followed by plain create', checked: false, actions: ['Create & Run', 'Create Group'], expected: [true, false] },
  { name: 'failed plain create followed by run', checked: false, actions: ['Create Group', 'Create & Run'], expected: [false, true] },
];

for (const scenario of cases) {
  test(`group launch intent: ${scenario.name}`, async ({ page }) => {
    const intents: boolean[] = [];
    // Never create a real group or invoke agents: every create request is intercepted.
    await page.route('**/api/groups', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      intents.push(route.request().postDataJSON().autoRun);
      await route.fulfill({ status: 503, json: { error: 'controlled create failure' } });
    });
    try {
      await page.goto('/projects/default');
      await page.getByRole('button', { name: 'New Group', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Create Task Group', exact: true })).toBeVisible();
      await page.getByPlaceholder('e.g., Q2 Feature Sprint').fill('Launch intent');
      const children = page.getByPlaceholder('Task title', { exact: true });
      await children.nth(0).fill('First child');
      await children.nth(1).fill('Second child');
      await page.getByLabel('Auto-run — start agents immediately after creating', { exact: true }).setChecked(scenario.checked);
      for (let i = 0; i < scenario.actions.length; i++) {
        await page.getByRole('button', { name: scenario.actions[i], exact: true }).click();
        await expect.poll(() => intents.length).toBe(i + 1);
        await expect(page.getByRole('button', { name: 'Create Group', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Create & Run', exact: true })).toBeEnabled();
      }
      expect(intents).toEqual(scenario.expected);
      await expect(page.getByRole('heading', { name: 'Create Task Group', exact: true })).toBeVisible();
    } finally {
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
