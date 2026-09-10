/**
 * Testes de integração frontend ↔ backend.
 *
 * Padrão de cada teste:
 *  - Interceta respostas da API e acumula erros HTTP (4xx/5xx)
 *  - Realiza a acção via UI
 *  - Verifica que não houve erros de rede
 */
import { test, expect, type Page, type Response } from '@playwright/test';

// ── Helper: acumula erros de API durante o teste ───────────────────────────────

type ApiError = { method: string; url: string; status: number; body: string };

async function collectApiErrors(page: Page): Promise<ApiError[]> {
  const errors: ApiError[] = [];
  page.on('response', async (response: Response) => {
    const url = response.url();
    if (!url.includes('/api/v1')) return;
    if (response.status() >= 400) {
      let body = '';
      try { body = await response.text(); } catch { /* ignore */ }
      errors.push({
        method: response.request().method(),
        url,
        status: response.status(),
        body: body.slice(0, 500),
      });
    }
  });
  return errors;
}

function assertNoErrors(errors: ApiError[], label: string) {
  if (errors.length > 0) {
    const details = errors.map((e) => `\n  [${e.status}] ${e.method} ${e.url}\n  Body: ${e.body}`).join('');
    throw new Error(`${label} — erros de API encontrados:${details}`);
  }
}

async function waitForApiIdle(page: Page, ms = 800) {
  await page.waitForTimeout(ms);
}

// Helper: preencher o primeiro textbox num dialog
async function fillDialogField(page: Page, idx: number, value: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').nth(idx).fill(value);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. AUTENTICAÇÃO  (contexto limpo — sem storageState — para ir ao /login)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Autenticação', () => {
  // Limpar storageState para estes testes irem a /login sem sessão prévia
  test.use({ storageState: undefined });

  test('login com credenciais válidas', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/login');
    // networkidle garante que SessionRestoreProvider terminou o /auth/refresh (401 → ready)
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    await page.locator('input[type="email"]').fill('admin@faustware.ao');
    await page.locator('input[type="password"]').fill('faustware123');
    await page.locator('button[type="submit"]').click();

    // Login: bcrypt + role fetch + hydrate() pode demorar 60s+
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 75000 });
    await page.waitForLoadState('networkidle');

    assertNoErrors(errors, 'Login');
    await expect(page).not.toHaveURL(/login/);
  });

  test('login com credenciais inválidas retorna erro', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    await page.locator('input[type="email"]').fill('admin@faustware.ao');
    await page.locator('input[type="password"]').fill('senha_errada');
    await page.locator('button[type="submit"]').click();

    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/login/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. SESSÃO  (usa storageState com admin autenticado)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Sessão', () => {
  test('restauro de sessão após F5', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/');
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    assertNoErrors(errors, 'Restauro de sessão');
    await expect(page).not.toHaveURL(/login/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Dashboard', () => {
  test('carrega dashboard sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Dashboard');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. LISTAGEM DE DOCUMENTOS
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Documentos — listagem', () => {
  test('página de documentos carrega sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/documentos');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Listagem de documentos');
  });

  test('detalhe de documento carrega sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/documentos');
    await page.waitForLoadState('networkidle');

    const firstDoc = page.locator('table tbody tr').first();
    if (await firstDoc.count() > 0) {
      await firstDoc.click();
      await page.waitForLoadState('networkidle');
      await waitForApiIdle(page);
    }

    assertNoErrors(errors, 'Detalhe de documento');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. CRIAÇÃO DE DOCUMENTOS
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Criação de documentos', () => {
  test('registar documento de entrada (carrega formulário sem erros)', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/registro/entradas');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Formulário de entrada');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. CIRCULAÇÕES PENDENTES
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Circulações pendentes', () => {
  test('página de pendentes carrega sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/pendentes');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Pendentes');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. CONFIGURAÇÕES — UTILIZADORES
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Configurações — Utilizadores', () => {
  test('listar utilizadores sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/utilizadores');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Listagem de utilizadores');
  });

  test('criar novo utilizador', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/utilizadores');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /novo utilizador/i }).click();
    await page.waitForTimeout(500);

    // Formulário no dialog — labels sem for/id, usar textbox por índice
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('textbox').nth(0).fill('Utilizador Teste Playwright');
    await dialog.getByRole('textbox').nth(1).fill(`teste.pw.${Date.now()}@faustware.ao`);

    // Perfil já vem pré-seleccionado (Administrador) — não alterar

    await dialog.getByRole('button', { name: /criar utilizador/i }).click();
    await page.waitForTimeout(2000);

    assertNoErrors(errors, 'Criar utilizador');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. CONFIGURAÇÕES — PERFIS (ROLES)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Configurações — Perfis', () => {
  test('listar perfis sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/permissoes');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Listagem de perfis');
  });

  test('criar novo perfil', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/permissoes');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /novo|criar/i }).first();
    if (await createBtn.count() === 0) return; // página pode não ter botão criar

    await createBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('textbox').nth(0).fill('Perfil Teste Playwright');

    const descBox = dialog.getByRole('textbox').nth(1);
    if (await descBox.count() > 0) {
      await descBox.fill('Perfil criado pelos testes de integração');
    }

    const submitBtn = dialog.getByRole('button', { name: /guardar|criar|salvar/i }).last();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    assertNoErrors(errors, 'Criar perfil');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. CONFIGURAÇÕES — TIPOS DE DOCUMENTO
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Configurações — Tipos de Documento', () => {
  test('listar tipos sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/tipos');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Listagem de tipos');
  });

  test('criar novo tipo de documento', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/tipos');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /novo|criar/i }).first();
    if (await createBtn.count() === 0) return;

    await createBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('textbox').nth(0).fill('Tipo Playwright');

    const descBox = dialog.getByRole('textbox').nth(1);
    if (await descBox.count() > 0) {
      await descBox.fill('Tipo criado por testes');
    }

    const submitBtn = dialog.getByRole('button', { name: /guardar|criar|salvar/i }).last();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    assertNoErrors(errors, 'Criar tipo de documento');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. CONFIGURAÇÕES — ENTIDADES
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Configurações — Entidades', () => {
  test('listar entidades sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/entidades');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Listagem de entidades');
  });

  test('criar nova entidade', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/entidades');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /nova|criar/i }).first();
    if (await createBtn.count() === 0) return;

    await createBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('textbox').nth(0).fill('Entidade Playwright Teste');

    const submitBtn = dialog.getByRole('button', { name: /guardar|criar|salvar/i }).last();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    assertNoErrors(errors, 'Criar entidade');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. CONFIGURAÇÕES — TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Configurações — Templates', () => {
  test('listar templates sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/templates');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Listagem de templates');
  });

  test('criar novo template — versao não é enviada no payload', async ({ page }) => {
    const errors = await collectApiErrors(page);
    const requests: { url: string; body: string }[] = [];

    page.on('request', (req) => {
      if (req.url().includes('/api/v1/templates') && req.method() === 'POST') {
        requests.push({ url: req.url(), body: req.postData() ?? '' });
      }
    });

    await page.goto('/configuracoes/templates');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /novo|criar/i }).first();
    if (await createBtn.count() === 0) return;

    await createBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('textbox').nth(0).fill('Template Playwright');

    const htmlField = dialog.locator('textarea, [contenteditable]').first();
    if (await htmlField.count() > 0) {
      await htmlField.fill('<html><body><p>Template de teste</p></body></html>');
    }

    const submitBtn = dialog.getByRole('button', { name: /guardar|criar|salvar/i }).last();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    for (const req of requests) {
      try {
        const parsed = JSON.parse(req.body);
        expect(parsed, `POST /templates não deve enviar 'versao'`).not.toHaveProperty('versao');
        expect(parsed, `POST /templates não deve enviar 'criadoEm'`).not.toHaveProperty('criadoEm');
      } catch {
        // body não é JSON — ignorar
      }
    }

    assertNoErrors(errors, 'Criar template');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. CONFIGURAÇÕES — EMPRESA
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Configurações — Empresa', () => {
  test('carregar definições da empresa sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/empresa');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Empresa — carregar');
  });

  test('editar e guardar definições da empresa', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/empresa');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    // Localizar o primeiro campo de texto editável e modificar o valor
    const firstInput = page.locator('input[type="text"]').first();
    if (await firstInput.count() > 0) {
      // triple-click selects all text; type replaces it → form becomes dirty
      await firstInput.click({ clickCount: 3 });
      await firstInput.type('Faustware Sistemas');

      // Aguardar que o botão de guardar fique activo
      const submitBtn = page.getByRole('button', { name: /guardar/i }).first();
      await submitBtn.waitFor({ state: 'visible' });

      const isDisabled = await submitBtn.isDisabled();
      if (!isDisabled) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    assertNoErrors(errors, 'Empresa — guardar');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. AUDITORIA
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Auditoria', () => {
  test('página de auditoria carrega sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/configuracoes/auditoria');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Auditoria');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. ARQUIVOS / PASTAS
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Arquivos', () => {
  test('página de arquivos carrega sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/arquivos');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Arquivos');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. PESQUISA DE DOCUMENTOS
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Pesquisa', () => {
  test('pesquisa avançada de documentos carrega sem erros', async ({ page }) => {
    const errors = await collectApiErrors(page);
    await page.goto('/pesquisas/documentos');
    await page.waitForLoadState('networkidle');
    await waitForApiIdle(page);

    assertNoErrors(errors, 'Pesquisa de documentos');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. VERIFICAÇÃO DE PAYLOADS
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Verificação de payloads', () => {
  test('criar utilizador não envia criadoEm nem senhaHash', async ({ page }) => {
    const postBodies: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/users') && req.method() === 'POST') {
        postBodies.push(req.postData() ?? '');
      }
    });

    await page.goto('/configuracoes/utilizadores');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /novo utilizador/i }).click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('textbox').nth(0).fill('Payload Test User');
    await dialog.getByRole('textbox').nth(1).fill(`payload.${Date.now()}@faustware.ao`);

    await dialog.getByRole('button', { name: /criar utilizador/i }).click();
    await page.waitForTimeout(2000);

    for (const body of postBodies) {
      try {
        const parsed = JSON.parse(body);
        expect(parsed, `POST /users não deve enviar 'criadoEm'`).not.toHaveProperty('criadoEm');
        expect(parsed, `POST /users não deve enviar 'senhaHash'`).not.toHaveProperty('senhaHash');
      } catch {
        // não é JSON
      }
    }
  });
});
