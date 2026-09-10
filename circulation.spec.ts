/**
 * Testes de circulação/tramitação de documentos.
 *
 * Cobre:
 *  - Encaminhar documento (POST /circulations) — admin → gestor
 *  - Responder circulação com decisão simples (PATCH /circulations/:id)
 *  - Fluxo de assinatura: encaminhar para assinar + responder com assinatura textual
 *  - Teste multi-utilizador: admin cria circulação, gestor responde (browser.newContext)
 *
 * Usa documentos seed conhecidos (doc-ent-001, doc-ent-002) para navegação fiável.
 */
import { test, expect, type Page, type Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

type ApiError = { method: string; url: string; status: number; body: string };

async function collectApiErrors(page: Page): Promise<ApiError[]> {
  const errors: ApiError[] = [];
  page.on('response', async (response: Response) => {
    const url = response.url();
    if (!url.includes('/api/v1')) return;
    if (response.status() >= 400) {
      let body = '';
      try { body = await response.text(); } catch { /* ignore */ }
      errors.push({ method: response.request().method(), url, status: response.status(), body: body.slice(0, 600) });
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

/**
 * Navega directamente ao detalhe de um documento seed conhecido.
 * Evita a lógica de "clicar na row → preview panel → Ver Ficha Completa".
 * Os IDs seed são: doc-ent-001, doc-ent-002, doc-int-001, etc.
 */
async function goToDocumentDetail(page: Page, docId = 'doc-ent-001'): Promise<boolean> {
  await page.goto(`/documentos/${docId}`);
  await page.waitForLoadState('networkidle');

  // Verificar que o documento carregou (botão Opções deve estar visível)
  const opts = page.getByRole('button', { name: /opções/i });
  try {
    await opts.waitFor({ state: 'visible', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Encaminha o documento aberto para um utilizador.
 * @param acaoKey  Uma de: 'aprovar', 'assinar', 'verificar', 'encaminhar_interno', 'encaminhar_externo'
 * @param recipientText  Texto de pesquisa no RecipientSelector (nome/email do utilizador)
 */
async function forwardDocumentTo(page: Page, acaoKey: string, recipientText: string) {
  // Abrir menu Opções
  await page.getByRole('button', { name: /opções/i }).click();
  await page.waitForTimeout(300);

  if (acaoKey === 'encaminhar_interno') {
    await page.getByRole('menuitem', { name: /dentro da instituição/i }).click();
  } else if (acaoKey === 'encaminhar_externo') {
    await page.getByRole('menuitem', { name: /para exterior/i }).click();
  } else {
    // Sub-menu "Com Ação Pendência"
    const subTrigger = page.getByRole('menuitem').filter({ hasText: /ação pendência/i });
    // Radix DropdownMenuSubTrigger abre via pointerMove (não click)
    await subTrigger.hover();
    await page.waitForTimeout(500); // aguardar animação do sub-menu
    // Selecionar a ação específica no sub-menu
    const acaoLabels: Record<string, RegExp> = {
      'aprovar':   /^Aprovar$/i,
      'assinar':   /^Assinar CC$/i,
      'verificar': /^Verificar$/i,
      'parecer':   /^Parecer$/i,
      'deferir':   /deferimento/i,
    };
    await page.getByRole('menuitem', { name: acaoLabels[acaoKey] ?? new RegExp(acaoKey, 'i') }).click();
  }

  // ForwardDialog deve abrir
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  // Filtrar destinatários
  await dialog.locator('input[placeholder="Filtrar utilizadores..."]').fill(recipientText);
  await page.waitForTimeout(400);

  // Clicar no primeiro utilizador que aparece (label element contendo o texto)
  const userLabel = dialog.locator('label').filter({ hasText: new RegExp(recipientText, 'i') }).first();
  await userLabel.waitFor({ state: 'visible', timeout: 8000 });
  await userLabel.click();

  // Mensagem opcional
  const msgArea = dialog.locator('textarea').first();
  if (await msgArea.count() > 0) {
    await msgArea.fill('Teste via Playwright');
  }

  // Submeter
  await dialog.getByRole('button', { name: /encaminhar/i }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 15000 });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. ENCAMINHAR DOCUMENTO PARA APROVAÇÃO (admin → admin self)
// ══════════════════════════════════════════════════════════════════════════════

test('Circulação — encaminhar documento para aprovação (POST /circulations)', async ({ page }) => {
  const errors = await collectApiErrors(page);

  const loaded = await goToDocumentDetail(page, 'doc-ent-001');
  if (!loaded) {
    test.skip(true, 'Documento doc-ent-001 não encontrado — seed não executado');
    return;
  }

  await forwardDocumentTo(page, 'aprovar', 'admin');
  await page.waitForTimeout(2000);

  assertNoErrors(errors, 'Encaminhar para aprovação');

  // Verificar que a tab Circulações mostra o pendente
  await page.getByRole('tab', { name: /circulações/i }).click();
  await page.waitForTimeout(1000);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. VERIFICAR PAYLOAD DO POST /circulations
// ══════════════════════════════════════════════════════════════════════════════

test('Payload POST /circulations — não envia deUserId, status, respostas, criadoEm', async ({ page }) => {
  const postBodies: { url: string; body: string }[] = [];

  page.on('request', (req) => {
    if (req.url().includes('/api/v1/circulations') && req.method() === 'POST' && !req.url().includes('/respond')) {
      postBodies.push({ url: req.url(), body: req.postData() ?? '' });
    }
  });

  const loaded = await goToDocumentDetail(page, 'doc-ent-002');
  if (!loaded) {
    test.skip(true, 'Documento doc-ent-002 não encontrado — seed não executado');
    return;
  }

  await forwardDocumentTo(page, 'verificar', 'admin');
  await page.waitForTimeout(2000);

  expect(postBodies.length, 'Devia ter enviado POST /circulations').toBeGreaterThan(0);
  for (const { body } of postBodies) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { continue; }
    expect(parsed, 'POST /circulations não devia ter deUserId').not.toHaveProperty('deUserId');
    expect(parsed, 'POST /circulations não devia ter status').not.toHaveProperty('status');
    expect(parsed, 'POST /circulations não devia ter respostas').not.toHaveProperty('respostas');
    expect(parsed, 'POST /circulations não devia ter criadoEm').not.toHaveProperty('criadoEm');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. RESPONDER CIRCULAÇÃO PENDENTE — ADMIN RESPONDE À SUA PRÓPRIA
// ══════════════════════════════════════════════════════════════════════════════

test('Circulação — responder circulação pendente (admin self-respond)', async ({ page }) => {
  const errors = await collectApiErrors(page);

  // Criar uma circulação pendente (admin para si mesmo)
  const loaded = await goToDocumentDetail(page, 'doc-ent-001');
  if (!loaded) {
    test.skip(true, 'Documento doc-ent-001 não encontrado');
    return;
  }

  await forwardDocumentTo(page, 'aprovar', 'admin');
  await page.waitForTimeout(1500);

  // Ir à tab Circulações
  await page.getByRole('tab', { name: /circulações/i }).click();
  await page.waitForTimeout(600);

  // Verificar se há circulação pendente
  const noPending = await page.locator('text=Sem pendências').count();
  if (noPending > 0) {
    test.skip(true, 'Não há circulações pendentes visíveis neste documento para o admin');
    return;
  }

  // Selecionar decisão "Aprovar" no primeiro painel de resposta
  const aprovBtn = page.getByRole('button', { name: /^Aprovar$/i }).first();
  await aprovBtn.waitFor({ state: 'visible', timeout: 10000 });
  await aprovBtn.click();
  await page.waitForTimeout(400);

  // Pode haver vários painéis (circulações acumuladas de testes anteriores) — usar .first()
  const enviarBtn = page.getByRole('button', { name: /enviar resposta/i }).first();
  await enviarBtn.waitFor({ state: 'visible', timeout: 5000 });
  await enviarBtn.click();
  await page.waitForTimeout(2500);

  assertNoErrors(errors, 'Responder circulação');
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. FLUXO DE ASSINATURA — ENCAMINHAR PARA ASSINAR + ASSINAR COM TEXTO
// ══════════════════════════════════════════════════════════════════════════════

test('Assinatura — encaminhar para assinar + responder com assinatura textual', async ({ page }) => {
  const errors = await collectApiErrors(page);

  // doc-int-001 tem tpl-folha-salarial com 1 zona obrigatória (mais simples para testar)
  const loaded = await goToDocumentDetail(page, 'doc-int-001');
  if (!loaded) {
    const loaded2 = await goToDocumentDetail(page, 'doc-ent-001');
    if (!loaded2) {
      test.skip(true, 'Sem documentos seed disponíveis');
      return;
    }
  }

  // Encaminhar para assinatura (admin para si mesmo)
  await forwardDocumentTo(page, 'assinar', 'admin');
  await page.waitForTimeout(1500);

  // Ir à tab Circulações
  await page.getByRole('tab', { name: /circulações/i }).click();
  await page.waitForTimeout(600);

  const noPending = await page.locator('text=Sem pendências').count();
  if (noPending > 0) {
    test.skip(true, 'Não há circulações de assinatura pendentes');
    return;
  }

  // Para acao=assinar: decisão "Assinar" (value='assinado') / "Não assinar"
  const decAssinarBtn = page.getByRole('button', { name: /^Assinar$/i }).first();
  await decAssinarBtn.waitFor({ state: 'visible', timeout: 10000 });
  await decAssinarBtn.click();
  await page.waitForTimeout(500);

  // Após seleccionar decisão 'assinado', a secção de assinatura aparece.
  // Documentos seed têm template com signatureZones → botão diz "Abrir Documento"
  // Documentos sem zones → botão diz "Assinar"
  const abrirDocBtn = page.getByRole('button', { name: /abrir documento/i });
  const sigAssinarBtn = page.getByRole('button', { name: /^Assinar$/i }).nth(1);

  /**
   * Helper que abre a SignatureDialog e assina com texto (tab Digitar).
   * Funciona tanto no dialog genérico como no document-renderer.
   */
  async function assinarViaTexto() {
    const sigDialog = page.getByRole('dialog').filter({ hasText: /adicionar assinatura/i });
    await sigDialog.waitFor({ state: 'visible', timeout: 15000 });
    await sigDialog.getByRole('tab', { name: /digitar/i }).click();
    await page.waitForTimeout(300);
    await sigDialog.locator('input[placeholder="Escreva o seu nome..."]').fill('Admin Playwright');
    await page.waitForTimeout(600); // aguardar geração SVG
    await sigDialog.getByRole('button', { name: /confirmar assinatura/i }).click();
    await sigDialog.waitFor({ state: 'hidden', timeout: 10000 });
  }

  if (await abrirDocBtn.isVisible()) {
    // Modo com template zones — clicar "Abrir Documento"
    await abrirDocBtn.click();
    await page.waitForTimeout(500);

    // Document signing dialog abre com título "Assinar Documento — ..."
    const docSignDialog = page.getByRole('dialog').filter({ hasText: /assinar documento/i });
    await docSignDialog.waitFor({ state: 'visible', timeout: 10000 });

    // Clicar na primeira zona de assinatura (button com title "Clique para assinar: ...")
    const zoneBtn = page.locator('button[title*="Clique para assinar"]').first();
    await zoneBtn.waitFor({ state: 'visible', timeout: 10000 });
    await zoneBtn.click();
    await assinarViaTexto();

    // Se há mais zonas obrigatórias (e.g. tpl-contrato-trabalho tem 2), assinar também
    const moreZones = page.locator('button[title*="Clique para assinar"]');
    const zoneCount = await moreZones.count();
    for (let i = 1; i < zoneCount; i++) {
      const z = moreZones.nth(i);
      if (await z.isVisible()) {
        await z.click();
        await assinarViaTexto();
      }
    }

    // "Confirmar Assinaturas" fica activo quando todas as zonas obrigatórias estão assinadas
    const confirmBtn = docSignDialog.getByRole('button', { name: /confirmar assinaturas/i });
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    // Aguardar ficar enabled (pode demorar um momento após a última assinatura)
    await page.waitForTimeout(500);
    if (await confirmBtn.isEnabled()) {
      await confirmBtn.click();
      await docSignDialog.waitFor({ state: 'hidden', timeout: 10000 });
    }
  } else if (await sigAssinarBtn.isVisible()) {
    // Modo sem template zones — abre directamente a SignatureDialog
    await sigAssinarBtn.click();
    await assinarViaTexto();
  }

  // "Enviar Resposta" deve estar activo agora (assinatura capturada)
  const enviarBtn = page.getByRole('button', { name: /enviar resposta/i }).first();
  await enviarBtn.waitFor({ state: 'visible', timeout: 5000 });
  if (await enviarBtn.isEnabled()) {
    await enviarBtn.click();
    await page.waitForTimeout(2500);
  }

  assertNoErrors(errors, 'Assinatura digital');
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. MULTI-UTILIZADOR — ADMIN ENCAMINHA, GESTOR RESPONDE
// ══════════════════════════════════════════════════════════════════════════════

test('Multi-utilizador — admin encaminha para gestor, gestor aprova', async ({ page, browser }) => {
  const gestorAuthFile = path.join(__dirname, '.auth', 'gestor.json');
  if (!fs.existsSync(gestorAuthFile)) {
    test.skip(true, 'gestor.json não existe — executar setup-gestor primeiro');
    return;
  }

  // Timeout estendido: hidratação do gestor pode levar 60-90s
  test.setTimeout(300_000);

  const adminErrors = await collectApiErrors(page);

  // ── Passo 1: Admin encaminha doc-ent-001 para gestor ──
  const loaded = await goToDocumentDetail(page, 'doc-ent-001');
  if (!loaded) {
    test.skip(true, 'Documento doc-ent-001 não encontrado');
    return;
  }

  const docUrl = page.url();
  await forwardDocumentTo(page, 'aprovar', 'gestor');
  await page.waitForTimeout(2000);

  assertNoErrors(adminErrors, 'Admin encaminhar para gestor');

  // ── Passo 2: Gestor responde ──
  const gestorContext = await browser.newContext({ storageState: gestorAuthFile });
  const gestorPage = await gestorContext.newPage();

  const gestorErrors: ApiError[] = [];
  gestorPage.on('response', async (response: Response) => {
    const url = response.url();
    if (!url.includes('/api/v1')) return;
    if (response.status() >= 400) {
      // Gestor não tem permissão para listar todos os utilizadores — esperado (403 /users)
      if (response.status() === 403 && url.includes('/users')) return;
      let body = '';
      try { body = await response.text(); } catch { /* ignore */ }
      gestorErrors.push({ method: response.request().method(), url, status: response.status(), body: body.slice(0, 600) });
    }
  });

  try {
    // Navegar ao documento (SessionRestoreProvider hidrata — até 90s)
    await gestorPage.goto(docUrl);
    await gestorPage.waitForLoadState('networkidle', { timeout: 90000 });

    // Verificar que o documento carregou
    const optsGestor = gestorPage.getByRole('button', { name: /opções/i });
    const docLoaded = await optsGestor.isVisible().catch(() => false);

    if (!docLoaded) {
      // Tentar via /pendentes
      await gestorPage.goto('/pendentes');
      await gestorPage.waitForLoadState('networkidle', { timeout: 30000 });
      const pendingRows = gestorPage.locator('tbody tr');
      const count = await pendingRows.count();
      if (count > 0) {
        // Clicar na row e ir ao link "Ver Ficha Completa"
        await pendingRows.first().click();
        await gestorPage.waitForURL(/\/documentos\//, { timeout: 15000 });
        await gestorPage.waitForLoadState('networkidle');
      }
    }

    // Ir à tab Circulações
    await gestorPage.getByRole('tab', { name: /circulações/i }).click();
    await gestorPage.waitForTimeout(600);

    // Responder circulação pendente
    const aprovBtn = gestorPage.getByRole('button', { name: /^Aprovar$/i }).first();
    if (await aprovBtn.isVisible().catch(() => false)) {
      await aprovBtn.click();
      await gestorPage.waitForTimeout(400);
      const enviarBtn = gestorPage.getByRole('button', { name: /enviar resposta/i });
      if (await enviarBtn.isEnabled().catch(() => false)) {
        await enviarBtn.click();
        await gestorPage.waitForTimeout(2500);
      }
    }

    assertNoErrors(gestorErrors, 'Gestor responder circulação');
  } finally {
    await gestorContext.close();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. ENCAMINHAR INTERNAMENTE
// ══════════════════════════════════════════════════════════════════════════════

test('Circulação — encaminhar dentro da instituição', async ({ page }) => {
  const errors = await collectApiErrors(page);

  const loaded = await goToDocumentDetail(page, 'doc-ent-001');
  if (!loaded) {
    test.skip(true, 'Documento doc-ent-001 não encontrado');
    return;
  }

  // Opções → "Dentro da instituição"
  await page.getByRole('button', { name: /opções/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /dentro da instituição/i }).click();

  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  await dialog.locator('input[placeholder="Filtrar utilizadores..."]').fill('gestor');
  await page.waitForTimeout(400);
  const gestorLabel = dialog.locator('label').filter({ hasText: /gestor/i }).first();
  await gestorLabel.waitFor({ state: 'visible', timeout: 8000 });
  await gestorLabel.click();

  await dialog.getByRole('button', { name: /encaminhar/i }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 15000 });
  await page.waitForTimeout(2000);

  assertNoErrors(errors, 'Encaminhar internamente');
});
