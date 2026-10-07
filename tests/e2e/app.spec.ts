import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// Electron exposes its executable path through CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath = require('electron') as string;

test('ouvre le premier grand dossier sans lancer le classement et charge les enfants à la demande', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'docsteward-large-e2e-'));
  const workspace = join(temporary, 'écrits');
  const nested = join(workspace, 'archives');
  await mkdir(nested, { recursive: true });
  await writeFile(join(workspace, 'bonjour.md'), '# Bonjour');
  await writeFile(
    join(workspace, 'grand.txt'),
    'Document hors limite IA.\n' + 'a'.repeat(2 * 1024 * 1024),
  );
  await Promise.all(
    Array.from({ length: 1_001 }, (_, index) =>
      writeFile(join(nested, `document-${index}.txt`), `Document ${index}`),
    ),
  );
  const userData = await mkdtemp(join(tmpdir(), 'docsteward-large-profile-'));
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [resolve('.')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DOCSTEWARD_E2E_USER_DATA: userData,
      DOCSTEWARD_E2E_WORKSPACE: '',
    },
  });
  try {
    await electronApp.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [selected] });
    }, workspace);
    const page = await electronApp.firstWindow();
    const listings: string[] = [];
    const inventories: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/fs/list') listings.push(url.searchParams.get('path') ?? '');
      if (url.pathname === '/api/virtual-tree') inventories.push(url.href);
    });
    const selectedAt = Date.now();
    await page.getByRole('button', { name: 'Choisir un dossier', exact: true }).click();
    const tree = page.getByRole('tree', { name: 'Documents du dossier' });
    await expect(tree.getByRole('button', { name: /bonjour.md/ })).toBeVisible();
    console.log(`Premier listing visible en ${Date.now() - selectedAt} ms.`);
    expect(listings).toEqual(['']);
    expect(inventories).toEqual([]);
    let failOnce = true;
    await page.route('**/api/fs/list?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('path') === 'archives' && failOnce) {
        failOnce = false;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: { code: 'FS_IO_ERROR', message: 'Dossier temporairement indisponible.' },
          }),
        });
      } else await route.continue();
    });
    await tree.getByRole('button', { name: 'archives', exact: true }).click();
    await expect(tree.getByRole('alert')).toContainText('Dossier temporairement indisponible.');
    await expect(tree.getByRole('status')).toHaveCount(0);
    await tree.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(tree.locator('button.tree-item')).toHaveCount(1_004);
    expect(listings).toEqual(['', 'archives', 'archives']);
    await tree.getByRole('button', { name: /bonjour.md/ }).click();
    await expect(page.locator('.text-preview')).toBeVisible();
    await expect(page.locator('.text-preview')).toContainText('# Bonjour');
    await tree.getByRole('button', { name: /grand.txt/ }).click();
    await expect(page.locator('.indexing-warning')).toContainText('2 Mio');
    await expect(page.locator('.text-preview')).toContainText('Document hors limite IA.');
    const helpLabels = await electronApp.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === 'Ai&de')
        ?.submenu?.items.map((item) => item.label),
    );
    expect(helpLabels).toContain('Limites du produit');
  } finally {
    await electronApp.close();
  }
});

test('exige une connexion avant d’afficher la bibliothèque', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'docsteward-login-e2e-profile-'));
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [resolve('.')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DOCSTEWARD_E2E_REQUIRE_LOGIN: '1',
      DOCSTEWARD_E2E_USER_DATA: userData,
    },
  });
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByRole('heading', { name: 'Retrouvez votre bibliothèque' })).toBeVisible();
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajouter un dossier' })).toHaveCount(0);
  } finally {
    await electronApp.close();
  }
});

test('prévisualise un document local sans permettre sa modification', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'docsteward-e2e-'));
  await mkdir(join(workspace, '01-projets'));
  const file = join(workspace, '01-projets', 'bonjour.md');
  await writeFile(
    file,
    `# Bonjour\n\nUne bibliothèque locale pour les documents importants.\n\n## Formats\n\n- PDF et fichiers Word\n- Classeurs Excel et fichiers texte\n\n## Principe\n\nConsulter sans jamais modifier.\n\n${Array.from({ length: 80 }, (_, index) => `Ligne de contrôle ${index + 1}`).join('\n')}\n`,
  );
  await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      writeFile(
        join(workspace, '01-projets', `document-${String(index + 1).padStart(2, '0')}.txt`),
        `Document ${index + 1}\n`,
      ),
    ),
  );
  await writeFile(join(workspace, 'lisez-moi.md'), '# Bienvenue\n');
  await writeFile(join(workspace, 'journal.txt'), 'Entrée locale\n');
  const userData = await mkdtemp(join(tmpdir(), 'docsteward-e2e-profile-'));
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [resolve('.')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DOCSTEWARD_E2E_WORKSPACE: workspace,
      DOCSTEWARD_E2E_USER_DATA: userData,
    },
  });
  electronApp.process().stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByText('Serveur prêt')).toBeVisible();
    await page.getByRole('button', { name: /Voir l’historique des versions/ }).click();
    await expect(page.getByRole('dialog', { name: 'Historique des versions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Version 1.0.0' })).toBeVisible();
    await expect(page.getByText("version MVP de l'application")).toBeVisible();
    const releaseWindow = await electronApp.browserWindow(page);
    await releaseWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(1360, 860),
    );
    await page.screenshot({ path: '.impeccable/review/version-history-desktop.png' });
    await releaseWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(940, 700),
    );
    await page.screenshot({ path: '.impeccable/review/version-history-compact.png' });
    await releaseWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(1360, 860),
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Historique des versions' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Compte de e2e@docsteward.local' }).click();
    await expect(page.getByText('e2e@docsteward.local')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
    await page.screenshot({ path: '.impeccable/review/profile-menu.png' });
    await page.getByRole('button', { name: 'Compte de e2e@docsteward.local' }).click();
    await expect(page.getByRole('button', { name: 'Ajouter un dossier' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choisir un autre dossier' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Documents', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: `Tableau de bord : ${basename(workspace)}` }),
    ).toBeVisible();
    await expect(page.getByRole('status', { name: /Index documentaire/ })).toBeVisible();
    await page.getByRole('button', { name: '01-projets' }).click();
    await page.getByRole('button', { name: 'bonjour.md' }).click();
    const preview = page.locator('.text-preview');
    await expect(preview).toContainText('Une bibliothèque locale');
    await expect(page.getByRole('button', { name: /Enregistrer/ })).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByText('Lecture seule', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.inspector')).toBeVisible();
    await page.getByRole('button', { name: 'Replier le volet d’informations' }).click();
    await expect(page.locator('.inspector')).toHaveCount(0);
    await page.getByRole('button', { name: 'Informations' }).click();
    await expect(page.locator('.inspector')).toBeVisible();
    await page.getByRole('tab', { name: 'Recherche' }).click();
    await expect(page.locator('.inspector')).toHaveCount(0);
    await page.getByRole('tab', { name: 'bonjour.md' }).click();
    await page.getByRole('button', { name: 'document-01.txt' }).click();
    await page.getByRole('button', { name: 'document-02.txt' }).click();
    await page.getByRole('button', { name: 'document-03.txt' }).click();
    await expect(page.locator('.preview-tab')).toHaveCount(3);
    await page.locator('.preview-overflow summary').click();
    await page.locator('.preview-overflow-select', { hasText: 'document-03.txt' }).click();
    await expect(page.getByText('Document 3', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'bonjour.md' }).click();
    const browserWindow = await electronApp.browserWindow(page);
    await browserWindow.evaluate((window: { setSize(width: number, height: number): void }) => {
      window.setSize(1360, 860);
    });
    await page.screenshot({ path: '.impeccable/review/desktop.png' });
    await browserWindow.evaluate((window: { setSize(width: number, height: number): void }) => {
      window.setSize(940, 700);
    });
    const tree = page.locator('.tree');
    await expect
      .poll(() => tree.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await tree.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => tree.evaluate((element) => element.scrollTop > 0)).toBe(true);
    await expect
      .poll(() => preview.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await preview.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => preview.evaluate((element) => element.scrollTop > 0)).toBe(true);
    await page.screenshot({ path: '.impeccable/review/mobile.png' });
    await page.getByRole('button', { name: 'Compte de e2e@docsteward.local' }).click();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page.getByRole('heading', { name: 'Retrouvez votre bibliothèque' })).toBeVisible();
  } finally {
    await electronApp.close();
  }
});

test('active le RAG, épingle et actualise un indicateur persistant', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'docsteward-rag-e2e-'));
  await writeFile(join(workspace, 'chiffre-affaires.txt'), 'Chiffre d’affaires total : 22 000 €\n');
  await writeFile(join(workspace, 'vide.txt'), '');
  await writeFile(join(workspace, 'archive.epub'), 'image');
  await writeFile(join(workspace, '~$document.docx'), 'temporaire');
  await writeFile(
    join(workspace, 'image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA7sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const userData = await mkdtemp(join(tmpdir(), 'docsteward-rag-e2e-profile-'));
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [resolve('.')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DOCSTEWARD_E2E_RAG: '1',
      DOCSTEWARD_E2E_WORKSPACE: workspace,
      DOCSTEWARD_E2E_USER_DATA: userData,
    },
  });
  electronApp.process().stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  try {
    const page = await electronApp.firstWindow();
    const settingsWindow = await electronApp.browserWindow(page);
    await page.getByRole('button', { name: /^image\.png/ }).click();
    await expect(page.locator('.tree')).not.toContainText('~$document.docx');
    await expect(page.locator('.image-preview img')).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.image-preview img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(1);
    await expect(page.getByRole('button', { name: 'Configuration IA' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Configuration' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Activer pour ce dossier' }).click();
    await page.getByRole('button', { name: 'Indexer les documents' }).click();
    await expect(page.getByRole('heading', { name: 'Rapport d’indexation' })).toBeVisible();
    await expect(page.getByText('4 fichiers recensés · 2 indexés · 2 non indexés')).toBeVisible();
    await page.getByText('Fichiers non indexés et raisons', { exact: true }).click();
    await expect(page.locator('.index-report')).toContainText('Format non pris en charge');
    await expect(page.locator('.index-report')).toContainText('Aucun texte exploitable');
    const reportPath = join(userData, 'rapport-indexation.txt');
    await electronApp.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0]!.webContents.session.once(
        'will-download',
        (_event, item) => {
          item.setSavePath(filePath);
        },
      );
    }, reportPath);
    await page.getByRole('link', { name: 'Télécharger le rapport détaillé' }).click();
    await expect
      .poll(() => readFile(reportPath, 'utf8').catch(() => ''))
      .toContain('vide.txt — Aucun texte exploitable');
    await page.screenshot({ path: 'out/indexation-report.png' });
    await writeFile(join(workspace, 'nouveau-document.txt'), 'Nouveau document\n');
    await page.getByRole('button', { name: 'Mettre à jour l’index' }).click();
    await expect(page.getByRole('button', { name: 'nouveau-document.txt' })).toBeVisible();
    await expect(page.locator('.index-state')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Recherche' }).click();
    await expect(page.locator('.index-state')).toHaveCount(0);
    await page.getByLabel('Que voulez vous savoir ?').fill('Quel est mon chiffre d’affaires ?');
    await page.getByRole('button', { name: 'chiffre-affaires.txt' }).click();
    await expect(page.getByText('Chiffre d’affaires total : 22 000 €')).toBeVisible();
    await page.getByRole('tab', { name: 'Recherche' }).click();
    await expect(page.getByLabel('Que voulez vous savoir ?')).toHaveValue(
      'Quel est mon chiffre d’affaires ?',
    );
    await page.getByRole('button', { name: 'Poser la question' }).click();
    await expect(page.getByText('Le chiffre d’affaires total est de 22 000 €.')).toBeVisible();
    await page.getByRole('tab', { name: 'chiffre-affaires.txt' }).click();
    await page.getByRole('tab', { name: 'Recherche' }).click();
    await expect(page.getByText('Le chiffre d’affaires total est de 22 000 €.')).toBeVisible();
    await page.getByRole('button', { name: 'Épingler comme indicateur' }).click();
    await expect(page.getByRole('dialog', { name: 'Créer un indicateur' })).toBeVisible();
    await expect(page.getByLabel('Titre')).toHaveValue('Chiffre d’affaires total');
    await settingsWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(1360, 860),
    );
    await page.screenshot({ path: '.impeccable/review/pin-dialog-desktop.png' });
    await settingsWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(940, 700),
    );
    await page.screenshot({ path: '.impeccable/review/pin-dialog-compact.png' });
    await page.getByRole('button', { name: 'Ajouter aux indicateurs' }).click();
    await expect(page.getByRole('dialog', { name: 'Créer un indicateur' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Tableau de bord' }).click();
    await expect(page.locator('.index-state').getByText('Index prêt')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chiffre d’affaires total' })).toBeVisible();
    const browserWindow = await electronApp.browserWindow(page);
    await browserWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(1360, 860),
    );
    await page.screenshot({ path: '.impeccable/review/desktop.png' });
    await browserWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(940, 700),
    );
    await page.screenshot({ path: '.impeccable/review/mobile.png' });
    await page.getByRole('button', { name: 'Actualiser' }).click();
    await expect(page.getByText(/Actualisé/)).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Tableau de bord' }).click();
    await expect(page.getByRole('heading', { name: 'Chiffre d’affaires total' })).toBeVisible();
    await page.getByRole('tab', { name: 'Configuration' }).click();
    await page.screenshot({ path: '.impeccable/review/folder-configuration-mobile.png' });
    await browserWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(1360, 860),
    );
    await page.screenshot({ path: '.impeccable/review/folder-configuration-desktop.png' });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Retirer ce dossier de la bibliothèque' }).click();
    await expect(page.getByRole('button', { name: 'Choisir un dossier' })).toBeVisible();
  } finally {
    await electronApp.close();
  }
});

test('prépare et active une organisation virtuelle sans modifier le disque', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'docsteward-sorter-e2e-'));
  const file = join(workspace, 'facture-acme.txt');
  const original = 'Facture Acme 2026\n';
  await writeFile(file, original);
  const userData = await mkdtemp(join(tmpdir(), 'docsteward-sorter-profile-'));
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [resolve('.')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DOCSTEWARD_E2E_RAG: '1',
      DOCSTEWARD_E2E_WORKSPACE: workspace,
      DOCSTEWARD_E2E_USER_DATA: userData,
    },
  });
  try {
    const page = await electronApp.firstWindow();
    await page.getByRole('tab', { name: 'Configuration' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Activer pour ce dossier' }).click();
    await page.getByRole('tab', { name: 'Organisation' }).click();
    await page
      .getByLabel('Comment souhaitez-vous organiser vos documents ?')
      .fill('Classe les factures par année et fournisseur.');
    await page.getByRole('button', { name: 'Préparer l’organisation' }).click();
    await expect(page.getByRole('heading', { name: 'Organisation proposée' })).toBeVisible();
    await expect(page.getByText('Organisation/facture-acme.txt')).toBeVisible();
    const sorterWindow = await electronApp.browserWindow(page);
    await sorterWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(1360, 860),
    );
    await page.screenshot({ path: '.impeccable/review/sorter-preview-desktop.png' });
    await sorterWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(940, 700),
    );
    await page.screenshot({ path: '.impeccable/review/sorter-preview-compact.png' });
    await sorterWindow.evaluate((window: { setSize(width: number, height: number): void }) =>
      window.setSize(1360, 860),
    );
    await page.getByRole('button', { name: 'Utiliser cette organisation' }).click();
    await expect(page.getByText(/Cette organisation remplacera/)).toBeVisible();
    await page.getByRole('button', { name: 'Utiliser cette organisation' }).click();
    await expect(
      page.locator('.app-notice', { hasText: 'Organisation activée — aucun fichier déplacé' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Organisation', exact: true }).click();
    await expect(page.getByRole('button', { name: /facture-acme.txt/ })).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe(original);
    await page
      .locator('.sorter-active-actions')
      .getByRole('button', { name: 'Revenir à l’origine' })
      .click();
    await expect(page.getByText(/affichera de nouveau l’organisation réelle/)).toBeVisible();
    await page
      .locator('.sorter-confirmation')
      .getByRole('button', { name: 'Revenir à l’origine' })
      .click();
    await expect(
      page.locator('.app-notice', {
        hasText: 'Organisation d’origine restaurée — aucun fichier modifié',
      }),
    ).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe(original);
  } finally {
    await electronApp.close();
  }
});
