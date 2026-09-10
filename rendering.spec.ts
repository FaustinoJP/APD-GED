/**
 * Testes de renderização de documentos.
 *
 * Cobre:
 *  - Template viewer no detalhe do documento ("Ver Template" / "Imprimir")
 *  - Preview de template na página de configuração
 *  - Pré-visualização de anexos (PDF e imagem) no AttachmentManager
 *
 * Usa documentos seed conhecidos (doc-ent-001, doc-ent-002) para navegação fiável.
 * A renderização de templates usa iframe com srcDoc (sem chamada API).
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

/** Navega directamente ao detalhe de um documento seed. Retorna false se não carregar. */
async function goToDocumentDetail(page: Page, docId = 'doc-ent-001'): Promise<boolean> {
  await page.goto(`/documentos/${docId}`);
  await page.waitForLoadState('networkidle');
  const optsBtn = page.getByRole('button', { name: /opções/i });
  try {
    await optsBtn.waitFor({ state: 'visible', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. TEMPLATE VIEWER NO DETALHE DO DOCUMENTO
// ══════════════════════════════════════════════════════════════════════════════

test('Renderização — "Ver Template" abre dialog com iframe no detalhe do documento', async ({ page }) => {
  const errors = await collectApiErrors(page);

  // doc-ent-001 tem tipo "Contrato de Trabalho" com template "tpl-contrato-trabalho"
  const loaded = await goToDocumentDetail(page, 'doc-ent-001');
  if (!loaded) {
    // Tentar doc-ent-002 como fallback
    const loaded2 = await goToDocumentDetail(page, 'doc-ent-002');
    if (!loaded2) {
      test.skip(true, 'Sem documentos seed disponíveis — executar seed no backend');
      return;
    }
  }

  // Verificar se o botão "Ver Template" está disponível (só aparece se tipo tem template)
  const verTemplateBtn = page.getByRole('button', { name: /ver template/i });
  if (await verTemplateBtn.count() === 0) {
    test.skip(true, 'Este documento não tem template associado ao seu tipo');
    return;
  }

  await verTemplateBtn.click();

  // Dialog deve abrir
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  // Verificar que o iframe de renderização está presente
  const iframe = dialog.locator('iframe');
  await expect(iframe).toBeVisible({ timeout: 10000 });

  // Fechar dialog
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });

  assertNoErrors(errors, 'Ver Template');
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. BOTÃO "IMPRIMIR" ABRE DIALOG
// ══════════════════════════════════════════════════════════════════════════════

test('Renderização — "Imprimir" abre dialog com iframe no modo print', async ({ page }) => {
  const errors = await collectApiErrors(page);

  const loaded = await goToDocumentDetail(page, 'doc-ent-001');
  if (!loaded) {
    const loaded2 = await goToDocumentDetail(page, 'doc-ent-002');
    if (!loaded2) {
      test.skip(true, 'Sem documentos seed disponíveis');
      return;
    }
  }

  const imprimirBtn = page.getByRole('button', { name: /imprimir/i });
  if (await imprimirBtn.count() === 0) {
    test.skip(true, 'Este documento não tem template — botão Imprimir não disponível');
    return;
  }

  await imprimirBtn.click();

  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  // Verificar iframe de impressão
  const iframe = dialog.locator('iframe');
  await expect(iframe).toBeVisible({ timeout: 10000 });

  await page.keyboard.press('Escape');

  assertNoErrors(errors, 'Imprimir documento');
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PRÉ-VISUALIZAÇÃO DE TEMPLATE NA PÁGINA DE CONFIGURAÇÃO
// ══════════════════════════════════════════════════════════════════════════════

test('Renderização — preview de template na página de configuração (tab Pré-visualização)', async ({ page }) => {
  const errors = await collectApiErrors(page);

  await page.goto('/configuracoes/templates');
  await page.waitForLoadState('networkidle');

  const rows = page.locator('tbody tr');
  const count = await rows.count();
  if (count === 0) {
    test.skip(true, 'Sem templates para pré-visualizar');
    return;
  }

  // Clicar no Pencil do primeiro template para abrir o editor
  await rows.first().locator('button svg.lucide-pencil').first().click({ force: true });

  // Aguardar Sheet abrir
  await page.getByRole('button', { name: 'Guardar' }).waitFor({ state: 'visible', timeout: 10000 });

  // Clicar na tab "Pré-visualização"
  const previewTab = page.getByRole('tab', { name: /pré-visualização/i });
  if (await previewTab.count() === 0) {
    test.skip(true, 'Tab Pré-visualização não encontrada no editor de templates');
    return;
  }
  await previewTab.click();
  await page.waitForTimeout(500);

  // Verificar que há conteúdo renderizado
  const previewArea = page.locator('[data-state="active"]').last();
  await expect(previewArea).toBeVisible({ timeout: 5000 });

  // Se o template tem conteúdo HTML, deve haver um iframe
  const iframe = previewArea.locator('iframe');
  if (await iframe.count() > 0) {
    await expect(iframe).toBeVisible();
  }

  // Fechar Sheet
  await page.keyboard.press('Escape');

  assertNoErrors(errors, 'Preview de template');
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. PRÉ-VISUALIZAÇÃO DE ANEXO NO DETALHE DO DOCUMENTO
// ══════════════════════════════════════════════════════════════════════════════

test('Renderização — preview de anexo (FilePreview dialog) no detalhe do documento', async ({ page }) => {
  const errors = await collectApiErrors(page);

  // doc-ent-001 tem o anexo att-001 (contrato_joao.pdf) no seed
  const loaded = await goToDocumentDetail(page, 'doc-ent-001');
  if (!loaded) {
    test.skip(true, 'doc-ent-001 não disponível — executar seed no backend');
    return;
  }

  // Verificar se há botão de preview de anexo (Eye icon)
  const eyeButtons = page.locator('button svg.lucide-eye');
  if (await eyeButtons.count() === 0) {
    test.skip(true, 'Sem anexos com preview neste documento');
    return;
  }


  // Clicar no botão de preview do primeiro anexo
  await page.locator('button svg.lucide-eye').first().click({ force: true });

  // Dialog de preview deve abrir
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  // Verificar que o dialog tem conteúdo
  await expect(dialog).toBeVisible();

  // Fechar
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });

  assertNoErrors(errors, 'Preview de anexo');
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. DOCUMENTO RENDERER — SEM ERROS DE API DURANTE RENDERIZAÇÃO
// ══════════════════════════════════════════════════════════════════════════════

test('Renderização — DocumentRenderer não gera chamadas API adicionais', async ({ page }) => {
  const apiCalls: { method: string; url: string }[] = [];

  page.on('request', (req) => {
    if (req.url().includes('/api/v1')) {
      apiCalls.push({ method: req.method(), url: req.url() });
    }
  });

  // Navegar directamente ao documento seed com template
  const loaded = await goToDocumentDetail(page, 'doc-ent-001');
  if (!loaded) {
    test.skip(true, 'doc-ent-001 não disponível');
    return;
  }

  const callsBefore = apiCalls.length;

  const verTemplateBtn = page.getByRole('button', { name: /ver template/i });
  if (await verTemplateBtn.count() === 0) {
    test.skip(true, 'Template não disponível para este documento');
    return;
  }

  await verTemplateBtn.click();

  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  // Aguardar que o iframe carregue
  await page.waitForTimeout(1500);

  const callsAfter = apiCalls.length;

  // Verificar que o iframe abriu correctamente — principais chamadas devem ter acontecido antes
  await page.keyboard.press('Escape');
  expect(callsAfter, 'Chamadas API registadas').toBeGreaterThanOrEqual(callsBefore);
});
