import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app, autoUpdater, BrowserWindow, dialog } from 'electron';
import {
  MAX_UPDATE_PACKAGE_SIZE,
  selectAvailableUpdate,
  type UpdatePackage,
  type UpdatePlatform,
} from './update-policy.js';

const CHECK_TIMEOUT_MS = 10_000;
const FIRST_RUN_DELAY_MS = 10_000;
const STARTUP_DELAY_MS = 1_500;

let updateCheckRunning = false;

type AutoUpdateOptions = {
  apiUrl: () => string;
  getWindow: () => BrowserWindow | undefined;
  beforeInstall: () => Promise<void>;
};

function runtimePlatform(): UpdatePlatform | null {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'windows';
  return null;
}

async function showMessage(options: Electron.MessageBoxOptions, parent?: BrowserWindow) {
  return parent && !parent.isDestroyed()
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options);
}

async function fetchAvailableUpdate(
  apiUrl: string,
  platform: UpdatePlatform,
): Promise<UpdatePackage | null> {
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/builds`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Le service de mise à jour a répondu ${response.status}.`);
  return selectAvailableUpdate(await response.json(), platform, app.getVersion());
}

async function downloadPackage(update: UpdatePackage, directory: string): Promise<string> {
  const fileName = basename(update.fileName);
  if (fileName !== update.fileName)
    throw new Error('Le nom du package de mise à jour est invalide.');
  const target = join(directory, fileName);
  const response = await fetch(update.downloadUrl, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Le téléchargement de la mise à jour a échoué (${response.status}).`);
  }
  if (new URL(response.url).protocol !== 'https:') {
    throw new Error('Le téléchargement de la mise à jour doit utiliser HTTPS.');
  }

  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_UPDATE_PACKAGE_SIZE || received > update.size) {
        callback(new Error('Le package téléchargé dépasse la taille annoncée.'));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(
      response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
    ),
    meter,
    createWriteStream(target, { flags: 'wx', mode: 0o600 }),
  );
  if (received !== update.size) throw new Error('Le package téléchargé est incomplet.');
  return target;
}

async function sha1(path: string): Promise<string> {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Le serveur local de mise à jour n’a pas démarré.'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function removeTemporaryDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

async function createLocalFeed(update: UpdatePackage, packagePath: string) {
  const packageRoute = `/${encodeURIComponent(update.fileName)}`;
  let feed = '';
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (update.platform === 'windows' && pathname === '/RELEASES') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(feed);
      return;
    }
    if (update.platform === 'mac' && pathname === '/feed') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(feed);
      return;
    }
    if (pathname !== packageRoute || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': update.platform === 'mac' ? 'application/zip' : 'application/octet-stream',
      'Content-Length': String(update.size),
      'Cache-Control': 'no-store',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(packagePath)
      .on('error', () => response.destroy())
      .pipe(response);
  });

  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const packageUrl = `${baseUrl}${packageRoute}`;
  feed =
    update.platform === 'windows'
      ? `${await sha1(packagePath)} ${packageUrl} ${update.size}\n`
      : JSON.stringify({
          url: packageUrl,
          name: update.version,
          notes: `Mise à jour DocSteward ${update.version}`,
          pub_date: update.uploadedAt,
        });
  return { server, feedUrl: update.platform === 'windows' ? baseUrl : `${baseUrl}/feed` };
}

async function stageWithNativeUpdater(update: UpdatePackage, packagePath: string): Promise<void> {
  const { server, feedUrl } = await createLocalFeed(update, packagePath);
  try {
    await new Promise<void>((resolve, reject) => {
      const onDownloaded = () => settle(resolve);
      const onUnavailable = () =>
        settle(() =>
          reject(new Error('Le package téléchargé n’a pas été reconnu comme une mise à jour.')),
        );
      const onError = (error: Error) => settle(() => reject(error));
      const settle = (finish: () => void) => {
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        autoUpdater.removeListener('update-not-available', onUnavailable);
        autoUpdater.removeListener('error', onError);
        finish();
      };

      autoUpdater.once('update-downloaded', onDownloaded);
      autoUpdater.once('update-not-available', onUnavailable);
      autoUpdater.once('error', onError);
      try {
        autoUpdater.setFeedURL(
          update.platform === 'mac' ? { url: feedUrl, serverType: 'json' } : { url: feedUrl },
        );
        autoUpdater.checkForUpdates();
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error('Mise à jour impossible.')));
      }
    });
  } finally {
    await closeServer(server);
  }
}

async function runAutoUpdate(options: AutoUpdateOptions): Promise<void> {
  if (updateCheckRunning) return;
  const platform = runtimePlatform();
  if (!app.isPackaged || !platform) return;
  updateCheckRunning = true;
  let accepted = false;
  let temporaryDirectory: string | undefined;

  try {
    const update = await fetchAvailableUpdate(options.apiUrl(), platform);
    if (!update) return;

    const confirmation = await showMessage(
      {
        type: 'question',
        title: 'Mise à jour de DocSteward',
        message: `La version ${update.version} de DocSteward est disponible.`,
        detail:
          'Voulez-vous la télécharger et l’installer maintenant ? Le téléchargement se fera en arrière-plan, puis DocSteward redémarrera automatiquement.',
        buttons: ['Mettre à jour', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      },
      options.getWindow(),
    );
    if (confirmation.response !== 0) return;
    accepted = true;

    temporaryDirectory = await mkdtemp(join(tmpdir(), 'docsteward-update-'));
    const packagePath = await downloadPackage(update, temporaryDirectory);
    await stageWithNativeUpdater(update, packagePath);
    await removeTemporaryDirectory(temporaryDirectory);
    temporaryDirectory = undefined;
    await options.beforeInstall();
    autoUpdater.quitAndInstall();
  } catch (error) {
    if (accepted) {
      await showMessage(
        {
          type: 'error',
          title: 'Mise à jour impossible',
          message: 'DocSteward n’a pas pu installer la mise à jour.',
          detail: error instanceof Error ? error.message : 'Une erreur inattendue est survenue.',
          buttons: ['Fermer'],
        },
        options.getWindow(),
      );
    } else if (!app.isPackaged) {
      console.error(error);
    }
  } finally {
    if (temporaryDirectory) await removeTemporaryDirectory(temporaryDirectory);
    updateCheckRunning = false;
  }
}

export function scheduleAutoUpdateCheck(options: AutoUpdateOptions): void {
  const delay = process.argv.includes('--squirrel-firstrun')
    ? FIRST_RUN_DELAY_MS
    : STARTUP_DELAY_MS;
  const timer = setTimeout(() => void runAutoUpdate(options), delay);
  timer.unref();
}
