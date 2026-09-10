/**
 * Testes de edição (PATCH) — utilizadores, entidades, tipos de documento, templates.
 *
 * Padrão: clicar Pencil na primeira linha da lista → Sheet abre → modificar nome → Guardar.
 * Verificar que nenhum pedido API retorna 4xx/5xx.
 */
import { test, expect, type Page, type Response } from '@playwright/test';

type ApiError = { method: string; url: string; status: number; body: string };

async function collectApiErrors(page: Page): Promise<ApiError[]> {
  const errors: ApiError[] = [];
  page.on('response', async (response: Response) => {
    const url = response.url();
    if (!url.includes('/api/v1')) return;
    if (response.status() >= 400) {
      let body = '';
      try { body = await response.text(); } catch { /* ignore */ }
      errors.push({ method: response.request().method(), url, status: response.status(), body: body.slice(0, 500) });
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

// Clica no primeiro botão Pencil da tabela e aguarda o Sheet abrir
async function openEditSheet(page: Page) {
  // Aguardar que haja linhas na tabela
  const rows = page.locator('tbody tr');
  await rows.first().waitFor({ state: 'visible', timeout: 15000 });

  // Botão Pencil é o primeiro ghost button com ícone SVG na primeira linha
  await rows.first().locator('button svg.lucide-pencil').first().click({ force: true });

  // Aguardar que o Sheet/formulário de edição seja visível (pelo botão "Guardar")
  await page.getByRole('button', { name: 'Guardar' }).waitFor({ state: 'visible', timeout: 10000 });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. EDITAR UTILIZADOR
// ══════════════════════════════════════════════════════════════════════════════

test('Editar — utilizador: alterar nome e guardar', async ({ page }) => {
  const errors = await collectApiErrors(page);
  await page.goto('/configuracoes/utilizadores');
  await page.waitForLoadState('networkidle');

  await openEditSheet(page);

  // Modificar nome (input registado como name="nome" pelo react-hook-form)
  const nomeInput = page.locator('[name="nome"]');
  await nomeInput.click({ clickCount: 3 });
  await nomeInput.fill('Admin Faustware (Editado)');

  // Guardar
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(2000);

  assertNoErrors(errors, 'Editar utilizador');
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. EDITAR ENTIDADE
// ══════════════════════════════════════════════════════════════════════════════

test('Editar — entidade: alterar nome e guardar', async ({ page }) => {
  const errors = await collectApiErrors(page);
  await page.goto('/configuracoes/entidades');
  await page.waitForLoadState('networkidle');

  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    test.skip(true, 'Sem entidades para editar');
    return;
  }

  await openEditSheet(page);

  const nomeInput = page.locator('[name="nome"]');
  await nomeInput.click({ clickCount: 3 });
  await nomeInput.fill('Entidade Editada Playwright');

  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(2000);

  assertNoErrors(errors, 'Editar entidade');
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. EDITAR TIPO DE DOCUMENTO
// ══════════════════════════════════════════════════════════════════════════════

test('Editar — tipo de documento: alterar nome e guardar', async ({ page }) => {
  const errors = await collectApiErrors(page);
  await page.goto('/configuracoes/tipos');
  await page.waitForLoadState('networkidle');

  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    test.skip(true, 'Sem tipos para editar');
    return;
  }

  await openEditSheet(page);

  const nomeInput = page.locator('[name="nome"]');
  await nomeInput.click({ clickCount: 3 });
  await nomeInput.fill('Tipo Editado Playwright');

  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(2000);

  assertNoErrors(errors, 'Editar tipo de documento');
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. EDITAR TEMPLATE
// ══════════════════════════════════════════════════════════════════════════════

test('Editar — template: alterar nome e guardar sem enviar versao', async ({ page }) => {
  const errors = await collectApiErrors(page);
  await page.goto('/configuracoes/templates');
  await page.waitForLoadState('networkidle');

  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    test.skip(true, 'Sem templates para editar');
    return;
  }

  await openEditSheet(page);

  // O form de templates usa useState (não react-hook-form register), portanto
  // os inputs não têm atributo name — scopar ao dialog e usar o primeiro input text
  const sheet = page.locator('[role="dialog"]').last();
  const nomeInput = sheet.locator('input[type="text"]').first();
  await nomeInput.click({ clickCount: 3 });
  await nomeInput.fill('Template Editado Playwright');

  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(2000);

  // Verificar que o PATCH de template não incluiu o campo "versao" (400 se incluído)
  assertNoErrors(errors, 'Editar template');
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. VERIFICAR PAYLOAD DO PATCH — UTILIZADOR NÃO ENVIA senhaHash NEM criadoEm
// ══════════════════════════════════════════════════════════════════════════════

test('Payload PATCH — utilizador não envia senhaHash nem criadoEm', async ({ page }) => {
  const patchBodies: { url: string; body: string }[] = [];

  page.on('request', (req) => {
    if (req.url().includes('/api/v1/users') && req.method() === 'PATCH') {
      patchBodies.push({ url: req.url(), body: req.postData() ?? '' });
    }
  });

  await page.goto('/configuracoes/utilizadores');
  await page.waitForLoadState('networkidle');

  await openEditSheet(page);

  const nomeInput = page.locator('[name="nome"]');
  await nomeInput.click({ clickCount: 3 });
  await nomeInput.fill('Admin Faustware Payload Check');

  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(2500);

  expect(patchBodies.length, 'Devia ter enviado pelo menos um PATCH /users').toBeGreaterThan(0);
  for (const { body } of patchBodies) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { continue; }
    expect(parsed, 'PATCH /users não devia ter senhaHash').not.toHaveProperty('senhaHash');
    expect(parsed, 'PATCH /users não devia ter criadoEm').not.toHaveProperty('criadoEm');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. VERIFICAR PAYLOAD DO PATCH — TEMPLATE NÃO ENVIA versao NEM criadoEm
// ══════════════════════════════════════════════════════════════════════════════

test('Payload PATCH — template não envia versao nem criadoEm', async ({ page }) => {
  const patchBodies: { url: string; body: string }[] = [];

  page.on('request', (req) => {
    if (req.url().includes('/api/v1/templates') && req.method() === 'PATCH') {
      patchBodies.push({ url: req.url(), body: req.postData() ?? '' });
    }
  });

  await page.goto('/configuracoes/templates');
  await page.waitForLoadState('networkidle');

  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    test.skip(true, 'Sem templates para editar');
    return;
  }

  await openEditSheet(page);

  // Templates usam useState — sem atributo name; scopar ao dialog
  const sheet = page.locator('[role="dialog"]').last();
  const nomeInput = sheet.locator('input[type="text"]').first();
  await nomeInput.click({ clickCount: 3 });
  await nomeInput.fill('Template Payload Check');

  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(2500);

  expect(patchBodies.length, 'Devia ter enviado pelo menos um PATCH /templates').toBeGreaterThan(0);
  for (const { body } of patchBodies) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { continue; }
    expect(parsed, 'PATCH /templates não devia ter versao').not.toHaveProperty('versao');
    expect(parsed, 'PATCH /templates não devia ter criadoEm').not.toHaveProperty('criadoEm');
  }
});
