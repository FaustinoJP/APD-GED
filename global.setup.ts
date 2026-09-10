import { test as setup } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '.auth', 'admin.json');

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');

  // networkidle ensures SessionRestoreProvider finishes its /auth/refresh check
  // (POST /auth/refresh → 401 → setReady(true) → login form appears)
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  await page.locator('input[type="email"]').fill('admin@faustware.ao');
  await page.locator('input[type="password"]').fill('faustware123');
  await page.locator('button[type="submit"]').click();

  // Login: bcrypt(10) + role fetch + adapter.hydrate() (12 collections) can take 60s+
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 75000 });
  await page.waitForLoadState('networkidle');

  await page.context().storageState({ path: authFile });
});
