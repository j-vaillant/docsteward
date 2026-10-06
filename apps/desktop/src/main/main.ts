import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  utilityProcess,
  type Session,
  type UtilityProcess,
} from 'electron';
import {
  PROTOCOL_VERSION,
  RagModelsSchema,
  ServerToMainMessageSchema,
  SettingsSchema,
  type AuthAccount,
  type AuthState,
  type MainToServerMessage,
  type RagConfiguration,
  type RagModels,
  type Settings,
  type WorkspaceRecord,
  type WorkspaceSummary,
} from '@docsteward/contracts';

declare const __DOCSTEWARD_API_URL__: string;

const SERVER_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

let mainWindow: BrowserWindow | undefined;
let serverProcess: UtilityProcess | undefined;
let appSession: Session | undefined;
let serverOrigin: string | undefined;
let sessionSecret = '';
let stopping = false;
let restartCount = 0;
let settings: Settings = { schemaVersion: 1, workspaces: [] };
let authenticatedAccount: AuthAccount | undefined;
let accessToken: string | undefined;

const DEFAULT_RAG_MODELS: RagModels = {
  generationModel: 'gpt-5-mini',
  embeddingModel: 'text-embedding-3-small',
};

function loadDevelopmentEnvironment(): void {
  if (app.isPackaged) return;
  try {
    loadEnvFile(join(app.getAppPath(), '.env.local'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

loadDevelopmentEnvironment();

function environmentRagModels(): RagModels {
  const parsed = RagModelsSchema.safeParse({
    generationModel:
      process.env.OPENAI_GENERATION_MODEL?.trim() || DEFAULT_RAG_MODELS.generationModel,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_RAG_MODELS.embeddingModel,
  });
  return parsed.success ? parsed.data : DEFAULT_RAG_MODELS;
}

function ragConfiguration(): RagConfiguration {
  const { generationModel, embeddingModel } = environmentRagModels();
  return { generationModel, embeddingModel, similarityTopK: 5 };
}

if (!app.isPackaged && process.env.NODE_ENV === 'test' && process.env.DOCSTEWARD_E2E_USER_DATA) {
  app.setPath('userData', process.env.DOCSTEWARD_E2E_USER_DATA);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function accountDataPath(accountId?: string): string {
  return accountId
    ? join(app.getPath('userData'), 'accounts', accountId)
    : join(app.getPath('userData'), 'unauthenticated');
}

function settingsPath(accountId: string): string {
  return join(accountDataPath(accountId), 'settings.json');
}

function authState(): AuthState {
  return authenticatedAccount
    ? { authenticated: true, account: authenticatedAccount }
    : { authenticated: false };
}

function docStewardApiUrl(): string {
  const configured = (process.env.DOCSTEWARD_API_URL || __DOCSTEWARD_API_URL__)
    .trim()
    .replace(/\/$/, '');
  if (configured) return configured;
  if (!app.isPackaged) return 'http://localhost:3000/docsteward';
  throw new Error('Le service de connexion DocSteward n’est pas configuré.');
}

function openAIProxyUrl(): string | undefined {
  if (!accessToken || !authenticatedAccount?.apiAvailable) return undefined;
  return `${docStewardApiUrl()}/openai/v1`;
}

function openAIAccessToken(): string | undefined {
  return authenticatedAccount?.apiAvailable ? accessToken : undefined;
}

type LoginResponse = {
  data?: {
    accessToken: string;
    account: AuthAccount;
  };
  error?: { code?: string; message?: string };
};

async function authenticateRemotely(email: string, password: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${docStewardApiUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Le service de connexion DocSteward est indisponible.');
  }
  const payload = (await response.json().catch(() => ({}))) as LoginResponse;
  if (!response.ok || !payload.data) {
    if (payload.error?.code === 'ACCOUNT_NOT_ACTIVE') {
      throw new Error('Ce compte DocSteward n’est pas encore activé.');
    }
    if (response.status === 401) throw new Error('Adresse e-mail ou mot de passe incorrect.');
    throw new Error(payload.error?.message ?? 'La connexion a échoué.');
  }
  accessToken = payload.data.accessToken;
  authenticatedAccount = payload.data.account;
  settings = await loadSettings(payload.data.account.id);
}

function runtimeServerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'server', 'server.cjs')
    : join(__dirname, '..', '..', 'build', 'server', 'server.cjs');
}

function runtimeRendererPath(): string {
  return app.isPackaged
    ? join(app.getAppPath(), '.vite', 'renderer', 'main_window')
    : join(__dirname, '..', 'renderer', 'main_window');
}

async function loadSettings(accountId: string): Promise<Settings> {
  const target = settingsPath(accountId);
  try {
    const parsed = SettingsSchema.parse(JSON.parse(await readFile(target, 'utf8')));
    return { ...parsed, workspaces: parsed.workspaces.map((workspace) => ({ ...workspace })) };
  } catch {
    try {
      const legacyPath = join(app.getPath('userData'), 'settings.json');
      const legacy = SettingsSchema.parse(JSON.parse(await readFile(legacyPath, 'utf8')));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rename(legacyPath, target);
      await chmod(target, 0o600).catch(() => undefined);
      return { ...legacy, workspaces: legacy.workspaces.map((workspace) => ({ ...workspace })) };
    } catch {
      return { schemaVersion: 1, workspaces: [] };
    }
  }
}

async function persistSettings(next: Settings): Promise<void> {
  if (!authenticatedAccount) throw new Error('Connexion requise.');
  const target = settingsPath(authenticatedAccount.id);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  await chmod(target, 0o600).catch(() => undefined);
}

function sendToServer(message: MainToServerMessage): void {
  serverProcess?.postMessage(message);
}

function isTrustedFrame(event: Electron.IpcMainInvokeEvent, allowLocalError = false): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  if (serverOrigin && url.startsWith(`${serverOrigin}/`)) return true;
  return allowLocalError && url.startsWith('data:text/html');
}

async function selectWorkspace(
  event: Electron.IpcMainInvokeEvent,
): Promise<WorkspaceSummary | null> {
  if (!isTrustedFrame(event)) throw new Error('Origine IPC non autorisée');
  if (!authenticatedAccount) throw new Error('Connexion requise.');
  const dialogOptions: Electron.OpenDialogOptions = {
    title: 'Choisir un dossier pour DocSteward',
    properties: ['openDirectory'],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return null;
  const rootPath = await realpath(selected);
  const previous = settings.workspaces.find((workspace) => workspace.rootPath === rootPath);
  const workspace: WorkspaceRecord = previous ?? {
    id: randomUUID(),
    displayName: basename(rootPath),
    rootPath,
    access: 'read-only',
  };
  settings = {
    ...settings,
    workspaces: [workspace, ...settings.workspaces.filter((item) => item.id !== workspace.id)],
  };
  await persistSettings(settings);
  sendToServer({
    protocolVersion: PROTOCOL_VERSION,
    type: 'workspace.replaceAll',
    payload: { workspaces: settings.workspaces },
  });
  return { id: workspace.id, displayName: workspace.displayName, access: workspace.access };
}

function registerIpc(): void {
  ipcMain.handle('docsteward:get-auth-state', (event) => {
    if (!isTrustedFrame(event)) throw new Error('Origine IPC non autorisée');
    return authState();
  });
  ipcMain.handle('docsteward:login', async (event, value: unknown) => {
    if (!isTrustedFrame(event)) throw new Error('Origine IPC non autorisée');
    if (
      typeof value !== 'object' ||
      value === null ||
      !('email' in value) ||
      !('password' in value) ||
      typeof value.email !== 'string' ||
      typeof value.password !== 'string'
    ) {
      throw new Error('Identifiants invalides.');
    }
    await authenticateRemotely(value.email, value.password);
    restartCount = 0;
    await startServer();
    return authState();
  });
  ipcMain.handle('docsteward:logout', async (event) => {
    if (!isTrustedFrame(event)) throw new Error('Origine IPC non autorisée');
    authenticatedAccount = undefined;
    accessToken = undefined;
    settings = { schemaVersion: 1, workspaces: [] };
    restartCount = 0;
    await startServer();
    return authState();
  });
  ipcMain.handle('docsteward:select-workspace', selectWorkspace);
  ipcMain.handle('docsteward:remove-workspace', async (event, workspaceId: unknown) => {
    if (!isTrustedFrame(event)) throw new Error('Origine IPC non autorisée');
    if (typeof workspaceId !== 'string') throw new Error('Dossier invalide.');
    const exists = settings.workspaces.some((workspace) => workspace.id === workspaceId);
    if (!exists) return { removed: false };
    settings = {
      ...settings,
      workspaces: settings.workspaces.filter((workspace) => workspace.id !== workspaceId),
    };
    await persistSettings(settings);
    sendToServer({
      protocolVersion: PROTOCOL_VERSION,
      type: 'workspace.replaceAll',
      payload: { workspaces: settings.workspaces },
    });
    return { removed: true };
  });
  ipcMain.handle('docsteward:get-app-info', (event) => {
    if (!isTrustedFrame(event, true)) throw new Error('Origine IPC non autorisée');
    return { version: app.getVersion(), platform: process.platform };
  });
  ipcMain.handle('docsteward:open-logs', async (event) => {
    if (!isTrustedFrame(event, true)) throw new Error('Origine IPC non autorisée');
    await shell.openPath(join(accountDataPath(authenticatedAccount?.id), 'logs'));
  });
  ipcMain.handle('docsteward:retry-server', async (event) => {
    if (!isTrustedFrame(event, true)) throw new Error('Origine IPC non autorisée');
    restartCount = 0;
    await startServer();
  });
}

function createWindow(): BrowserWindow {
  if (!appSession) throw new Error('La session Electron n’est pas initialisée.');
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'DocSteward',
    backgroundColor: '#f3efe6',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, 'preload.js'),
      session: appSession,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!serverOrigin || !url.startsWith(`${serverOrigin}/`)) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  return window;
}

function installSessionPolicy(localSession: Session, origin: string, secret: string): void {
  localSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  localSession.setPermissionCheckHandler(() => false);
  localSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({
      requestHeaders: { ...details.requestHeaders, Authorization: `Bearer ${secret}` },
    });
  });
}

async function showServerError(message: string, correlationId?: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  const safeMessage = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const safeId = correlationId?.replace(/[^a-zA-Z0-9-]/g, '') ?? '';
  const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>DocSteward indisponible</title><style>body{font:16px system-ui;margin:0;background:#f3efe6;color:#1d211f;display:grid;place-items:center;min-height:100vh}.box{max-width:560px;padding:44px;background:#fff;border:1px solid #d8d1c3;border-radius:14px}h1{font:600 30px Georgia,serif;margin:0 0 12px}p{line-height:1.6;color:#5b5f59}.actions{display:flex;gap:10px;margin-top:24px}button{min-height:42px;padding:0 16px;border:1px solid #c9c1b4;border-radius:9px;background:#fff;font:600 14px system-ui;color:#1d211f}.primary{border-color:#1d4ed8;background:#1d4ed8;color:#fff}</style><body><main class="box"><h1>Le serveur local est indisponible</h1><p>${safeMessage}</p>${safeId ? `<p>Référence : ${safeId}</p>` : ''}<p>Vous pouvez relancer le serveur local ou consulter les journaux.</p><div class="actions"><button class="primary" id="retry">Réessayer</button><button id="logs">Ouvrir les journaux</button></div></main><script>document.querySelector('#retry').addEventListener('click',()=>window.docSteward.retryServer());document.querySelector('#logs').addEventListener('click',()=>window.docSteward.openLogsDirectory());</script></body></html>`;
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function startServer(): Promise<void> {
  serverProcess?.kill();
  sessionSecret = randomBytes(32).toString('base64url');
  serverOrigin = undefined;

  await new Promise<void>((resolveReady, rejectReady) => {
    const child = utilityProcess.fork(runtimeServerPath(), [], {
      serviceName: 'DocSteward Local Server',
      stdio: 'pipe',
    });
    serverProcess = child;
    if (!app.isPackaged) {
      child.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(`[docsteward-server] ${chunk.toString('utf8')}`);
      });
    }
    const timeout = setTimeout(() => {
      child.kill();
      rejectReady(new Error('Le serveur local n’a pas répondu à temps.'));
    }, SERVER_TIMEOUT_MS);

    child.on('message', (message) => {
      const parsed = ServerToMainMessageSchema.safeParse(message);
      if (!parsed.success) return;
      if (parsed.data.type === 'server.ready') {
        clearTimeout(timeout);
        const origin = `http://127.0.0.1:${parsed.data.payload.port}`;
        serverOrigin = origin;
        installSessionPolicy(appSession!, origin, sessionSecret);
        resolveReady();
      } else if (parsed.data.type === 'server.error') {
        clearTimeout(timeout);
        rejectReady(Object.assign(new Error(parsed.data.payload.message), parsed.data.payload));
      }
    });

    child.once('exit', () => {
      if (stopping || child !== serverProcess) return;
      if (restartCount < 1) {
        restartCount += 1;
        void startServer().catch((error: unknown) =>
          showServerError(error instanceof Error ? error.message : 'Erreur serveur.'),
        );
      } else {
        void showServerError('Le serveur local s’est arrêté deux fois pendant cette session.');
      }
    });

    sendToServer({
      protocolVersion: PROTOCOL_VERSION,
      type: 'server.configure',
      payload: {
        secret: sessionSecret,
        rendererPath: runtimeRendererPath(),
        dataPath: accountDataPath(authenticatedAccount?.id),
        appVersion: app.getVersion(),
        workspaces: settings.workspaces,
        authenticated: Boolean(authenticatedAccount && accessToken),
        ...(openAIAccessToken() ? { apiKey: openAIAccessToken() } : {}),
        ...(openAIProxyUrl() ? { apiBaseUrl: openAIProxyUrl() } : {}),
        ragConfiguration: ragConfiguration(),
      },
    });
  });

  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  await mainWindow.loadURL(`${serverOrigin}/`);
}

async function stopServer(): Promise<void> {
  stopping = true;
  const child = serverProcess;
  if (!child) return;
  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolveStop();
    }, SHUTDOWN_TIMEOUT_MS);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.postMessage({
      protocolVersion: PROTOCOL_VERSION,
      type: 'server.shutdown',
      payload: {},
    } satisfies MainToServerMessage);
  });
}

if (hasLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app
    .whenReady()
    .then(async () => {
      settings = { schemaVersion: 1, workspaces: [] };
      if (
        !app.isPackaged &&
        process.env.NODE_ENV === 'test' &&
        !process.env.DOCSTEWARD_E2E_REQUIRE_LOGIN
      ) {
        authenticatedAccount = {
          id: '00000000-0000-4000-8000-000000000099',
          email: 'e2e@docsteward.local',
          activationDate: new Date(0).toISOString(),
          apiAvailable: true,
        };
        accessToken = 'docsteward-e2e-deterministic-token';
        settings = await loadSettings(authenticatedAccount.id);
        const injected = process.env.DOCSTEWARD_E2E_WORKSPACE;
        if (injected) {
          const rootPath = await realpath(injected);
          settings = {
            schemaVersion: 1,
            workspaces: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                displayName: basename(rootPath),
                rootPath,
                access: 'read-only',
              },
            ],
          };
        }
      }
      appSession = session.fromPartition(`docsteward-${randomUUID()}`, { cache: false });
      registerIpc();
      await startServer().catch(async (error: unknown) => {
        const typed = error as Error & { correlationId?: string };
        await showServerError(typed.message, typed.correlationId);
      });
    })
    .catch(async (error: unknown) => {
      await showServerError(error instanceof Error ? error.message : 'Le démarrage a échoué.');
    });

  app.on('before-quit', (event) => {
    if (stopping) return;
    event.preventDefault();
    void stopServer().finally(() => app.quit());
  });
}
