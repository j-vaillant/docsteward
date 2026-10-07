import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath = require('electron') as string;

test('conserve la connexion après relancement et l’efface à la déconnexion', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'docsteward-persisted-login-'));
  const accessToken = `header.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.signature`;
  let loginCount = 0;
  const server = createServer((request, response) => {
    if (request.url !== '/docsteward/auth/login' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    loginCount += 1;
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        data: {
          accessToken,
          account: {
            id: '00000000-0000-4000-8000-000000000099',
            email: 'persistent@example.test',
            activationDate: new Date(0).toISOString(),
            apiAvailable: false,
          },
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  const launch = () =>
    electron.launch({
      executablePath: electronPath,
      args: [resolve('.')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DOCSTEWARD_E2E_REQUIRE_LOGIN: '1',
        DOCSTEWARD_E2E_USER_DATA: userData,
        DOCSTEWARD_API_URL: `http://127.0.0.1:${address.port}/docsteward`,
      },
    });
  let application: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    application = await launch();
    let page = await application.firstWindow();
    await page.getByLabel('Adresse e-mail').fill('persistent@example.test');
    await page.getByLabel('Mot de passe').fill('test-password');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(
      page.getByRole('button', { name: 'Compte de persistent@example.test' }),
    ).toBeVisible();
    const encrypted = await readFile(join(userData, 'auth-session.enc'));
    expect(encrypted.includes(accessToken)).toBe(false);
    expect(encrypted.includes('test-password')).toBe(false);
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(
      page.getByRole('button', { name: 'Compte de persistent@example.test' }),
    ).toBeVisible();
    expect(loginCount).toBe(1);
    await page.getByRole('button', { name: 'Compte de persistent@example.test' }).click();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    expect(loginCount).toBe(1);
  } finally {
    await application?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
