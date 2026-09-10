import { test as setup } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '.auth', 'gestor.json');

setup('authenticate as gestor', async ({ page }) => {
  await page.goto('/login');
  // Aguardar networkidle para garantir que SessionRestoreProvider tentou /auth/refresh (→ 401 → ready)
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await page.locator('input[type="email"]').fill('gestor@faustware.ao');
  await page.locator('input[type="password"]').fill('faustware123');
  await page.locator('button[type="submit"]').click();
  // Login: bcrypt(10) + role fetch + adapter.hydrate() pode demorar 60-90s
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 75000 });
  await page.waitForLoadState('networkidle');
  await page.context().storageState({ path: authFile });
});
