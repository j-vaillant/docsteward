import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';
import {
  API_SCHEMA_VERSION,
  CreateIndicatorRequestSchema,
  ListQuerySchema,
  PreviewRequestSchema,
  RagConsentRequestSchema,
  RagQueryRequestSchema,
  UpdateIndicatorRequestSchema,
  VirtualTreeActivateRequestSchema,
  VirtualTreePreviewRequestSchema,
  VirtualTreeQuerySchema,
  WorkspaceIdSchema,
  type ApiFailure,
  type ApiSuccess,
  type PreviewResult,
  type WorkspaceRecord,
  type RagConfiguration,
} from '@docsteward/contracts';
import { FsPolicyError, listDirectory, readPreviewFile } from '@docsteward/filesystem-policy';
import type { SafeLogger } from './logger';
import { RagError, RagService, type RagProvider } from './rag';
import { OpenAISorterProvider, SorterError, SorterService, type SorterProvider } from './sorter';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

type ServerOptions = {
  secret: string;
  rendererPath: string;
  appVersion: string;
  workspaces: WorkspaceRecord[];
  logger: SafeLogger;
  dataPath?: string;
  authenticated?: boolean;
  apiKey?: string;
  apiBaseUrl?: string;
  ragConfiguration?: RagConfiguration;
  ragProvider?: RagProvider;
  sorterProvider?: SorterProvider;
};

type WorkspaceState = { getAll(): WorkspaceRecord[]; replaceAll(next: WorkspaceRecord[]): void };

function success<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

function failure(code: string, message: string, correlationId?: string): ApiFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(correlationId ? { details: { correlationId } } : {}),
    },
  };
}

function unauthorized(reply: FastifyReply): void {
  void reply.code(401).send(failure('AUTH_REQUIRED', 'Authentification locale requise.'));
}

function validBearer(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function mimeType(pathname: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  return types[extname(pathname)] ?? 'application/octet-stream';
}

function workspaceOrThrow(state: WorkspaceState, id: string): WorkspaceRecord {
  const workspace = state.getAll().find((item) => item.id === id);
  if (!workspace) {
    throw new FsPolicyError('INVALID_REQUEST', 'Espace de travail introuvable.', 404);
  }
  return workspace;
}

const textExtensions = new Set([
  '.txt',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.html',
]);

function commonPreviewFields(file: Awaited<ReturnType<typeof readPreviewFile>>) {
  return { sha256: file.sha256, size: file.size, modifiedAt: file.modifiedAt };
}

function cellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toLocaleDateString('fr-FR');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value) ?? '';
}

async function createPreview(
  path: string,
  file: Awaited<ReturnType<typeof readPreviewFile>>,
): Promise<PreviewResult> {
  const extension = extname(path).toLowerCase();
  const common = commonPreviewFields(file);
  if (extension === '.pdf') return { kind: 'pdf', ...common };
  if (textExtensions.has(extension)) {
    try {
      return {
        kind: 'text',
        content: new TextDecoder('utf-8', { fatal: true }).decode(file.bytes),
        ...common,
      };
    } catch {
      throw new FsPolicyError('INVALID_UTF8', 'Le fichier n’est pas encodé en UTF-8.', 415);
    }
  }
  if (extension === '.doc' || extension === '.docx') {
    const extracted = await new WordExtractor().extract(file.bytes);
    return { kind: 'document', content: extracted.getBody(), ...common };
  }

  const workbook = XLSX.read(file.bytes, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
  });
  const sheets = workbook.SheetNames.slice(0, 10).map((name) => {
    const sheet = workbook.Sheets[name];
    const allRows = sheet
      ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null })
      : [];
    const truncated = allRows.length > 200 || allRows.some((row) => row.length > 50);
    return {
      name,
      rows: allRows.slice(0, 200).map((row) => row.slice(0, 50).map(cellValue)),
      truncated,
    };
  });
  return { kind: 'spreadsheet', sheets, ...common };
}

export function createServer(options: ServerOptions): {
  app: FastifyInstance;
  workspaceState: WorkspaceState;
  rag: RagService;
  sorter: SorterService;
} {
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });
  let workspaces = [...options.workspaces];
  const workspaceState: WorkspaceState = {
    getAll: () => [...workspaces],
    replaceAll: (next) => {
      workspaces = [...next];
    },
  };
  let expectedHost = '';
  const ragConfiguration = options.ragConfiguration ?? {
    generationModel: 'gpt-5-mini',
    embeddingModel: 'text-embedding-3-small',
    similarityTopK: 5,
  };
  const rag = new RagService({
    dataPath: options.dataPath ?? join(options.rendererPath, '..', '.docsteward-data'),
    configuration: ragConfiguration,
    logger: options.logger,
    ...(options.ragProvider ? { provider: options.ragProvider } : {}),
  });
  rag.setApiKey(options.apiKey, options.apiBaseUrl);
  const sorter = new SorterService({
    dataPath: options.dataPath ?? join(options.rendererPath, '..', '.docsteward-data'),
    isEnabled: (workspaceId) => rag.isEnabled(workspaceId),
    ...(options.sorterProvider
      ? { provider: options.sorterProvider }
      : options.apiKey
        ? {
            provider: new OpenAISorterProvider(
              options.apiKey,
              ragConfiguration,
              options.apiBaseUrl,
            ),
          }
        : {}),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');

    const host = request.headers.host ?? '';
    if (expectedHost && host !== expectedHost) {
      await reply.code(400).send(failure('INVALID_REQUEST', 'En-tête Host invalide.'));
      return;
    }
    const origin = request.headers.origin;
    if (origin && expectedHost && origin !== `http://${expectedHost}`) {
      await reply.code(403).send(failure('INVALID_REQUEST', 'Origine non autorisée.'));
      return;
    }
    if (!validBearer(request.headers.authorization, options.secret)) {
      unauthorized(reply);
      return;
    }
    if (
      request.url.startsWith('/api/') &&
      request.url !== '/api/health' &&
      options.authenticated === false
    ) {
      void reply.code(401).send(failure('USER_AUTH_REQUIRED', 'Connexion requise.'));
    }
  });

  app.get('/api/health', () =>
    success({
      status: 'ready' as const,
      version: options.appVersion,
      apiSchemaVersion: API_SCHEMA_VERSION,
    }),
  );

  app.get('/api/workspaces', () =>
    success(
      workspaceState.getAll().map(({ id, displayName, access }) => ({ id, displayName, access })),
    ),
  );

  app.get('/api/rag/status', async (request, reply) => {
    const parsed = WorkspaceIdSchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Espace de travail invalide.'));
    return success(await rag.status(workspaceOrThrow(workspaceState, parsed.data.workspaceId)));
  });

  app.post('/api/rag/consent', async (request, reply) => {
    const parsed = RagConsentRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Choix de confidentialité invalide.'));
    workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    await rag.setEnabled(parsed.data.workspaceId, parsed.data.enabled);
    return success({ enabled: parsed.data.enabled });
  });

  app.post('/api/rag/verify-key', async () => {
    await rag.verify();
    return success({ valid: true });
  });

  app.post('/api/rag/index', async (request, reply) => {
    const parsed = WorkspaceIdSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Espace de travail invalide.'));
    return success(await rag.build(workspaceOrThrow(workspaceState, parsed.data.workspaceId)));
  });

  app.delete('/api/rag/index/:workspaceId', async (request, reply) => {
    const parsed = WorkspaceIdSchema.safeParse(request.params);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Espace de travail invalide.'));
    workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    await rag.deleteIndex(parsed.data.workspaceId);
    return success({ deleted: true });
  });

  app.post('/api/rag/query', async (request, reply) => {
    const parsed = RagQueryRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'La question est invalide.'));
    return success(
      await rag.query(
        workspaceOrThrow(workspaceState, parsed.data.workspaceId),
        parsed.data.question,
      ),
    );
  });

  app.get('/api/indicators', async (request, reply) => {
    const parsed = WorkspaceIdSchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Espace de travail invalide.'));
    workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    return success(await rag.listIndicators(parsed.data.workspaceId));
  });

  app.post('/api/indicators', async (request, reply) => {
    const parsed = CreateIndicatorRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Définition d’indicateur invalide.'));
    workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    return reply.code(201).send(success(await rag.createIndicator(parsed.data)));
  });

  app.patch('/api/indicators/:id', async (request, reply) => {
    const id = (request.params as { id?: string }).id;
    const parsed = UpdateIndicatorRequestSchema.safeParse(request.body);
    if (!id || !parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Modification invalide.'));
    return success(await rag.updateIndicator(id, parsed.data.title));
  });

  app.delete('/api/indicators/:id', async (request, reply) => {
    const id = (request.params as { id?: string }).id;
    if (!id) return reply.code(400).send(failure('INVALID_REQUEST', 'Indicateur invalide.'));
    await rag.deleteIndicator(id);
    return success({ deleted: true });
  });

  app.post('/api/indicators/:id/refresh', async (request, reply) => {
    const id = (request.params as { id?: string }).id;
    const parsed = WorkspaceIdSchema.safeParse(request.body);
    if (!id || !parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Actualisation invalide.'));
    return success(
      await rag.refreshIndicator(id, workspaceOrThrow(workspaceState, parsed.data.workspaceId)),
    );
  });

  app.get('/api/virtual-tree', async (request, reply) => {
    const parsed = VirtualTreeQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Demande d’arbre invalide.'));
    return success(
      await sorter.get(workspaceOrThrow(workspaceState, parsed.data.workspaceId), parsed.data.mode),
    );
  });

  app.post('/api/virtual-tree/preview', async (request, reply) => {
    const parsed = VirtualTreePreviewRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'La consigne est invalide.'));
    return success(
      await sorter.preview(
        workspaceOrThrow(workspaceState, parsed.data.workspaceId),
        parsed.data.instruction,
      ),
    );
  });

  app.get('/api/virtual-tree/preview', async (request, reply) => {
    const parsed = WorkspaceIdSchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Espace de travail invalide.'));
    workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    return success(sorter.getPreview(parsed.data.workspaceId));
  });

  app.delete('/api/virtual-tree/preview', async (request, reply) => {
    const parsed = WorkspaceIdSchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Espace de travail invalide.'));
    workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    sorter.discardPreview(parsed.data.workspaceId);
    return success({ deleted: true });
  });

  app.post('/api/virtual-tree/activate', async (request, reply) => {
    const parsed = VirtualTreeActivateRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Activation invalide.'));
    return success(
      await sorter.activate(
        workspaceOrThrow(workspaceState, parsed.data.workspaceId),
        parsed.data.inventoryFingerprint,
      ),
    );
  });

  app.post('/api/virtual-tree/reindex', async (request, reply) => {
    const parsed = WorkspaceIdSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Réindexation invalide.'));
    return success(await sorter.reindex(workspaceOrThrow(workspaceState, parsed.data.workspaceId)));
  });

  app.delete('/api/virtual-tree', async (request, reply) => {
    const parsed = WorkspaceIdSchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_REQUEST', 'Espace de travail invalide.'));
    return success(await sorter.clear(workspaceOrThrow(workspaceState, parsed.data.workspaceId)));
  });

  app.get('/api/fs/list', async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(failure('INVALID_REQUEST', 'Paramètres de liste invalides.'));
    }
    const workspace = workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    return success(await listDirectory(workspace.rootPath, parsed.data.path));
  });

  app.post('/api/fs/preview', async (request, reply) => {
    const parsed = PreviewRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(failure('INVALID_REQUEST', 'Demande d’aperçu invalide.'));
    }
    const workspace = workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    const file = await readPreviewFile(workspace.rootPath, parsed.data.path);
    return success(await createPreview(parsed.data.path, file));
  });

  app.get('/api/fs/raw', async (request, reply) => {
    const parsed = PreviewRequestSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(failure('INVALID_REQUEST', 'Demande d’aperçu invalide.'));
    }
    const workspace = workspaceOrThrow(workspaceState, parsed.data.workspaceId);
    const file = await readPreviewFile(workspace.rootPath, parsed.data.path);
    if (extname(parsed.data.path).toLowerCase() !== '.pdf') {
      return reply.code(415).send(failure('FILE_TYPE_NOT_ALLOWED', 'Aperçu brut non autorisé.'));
    }
    return reply.type('application/pdf').header('Content-Length', file.size).send(file.bytes);
  });

  app.setErrorHandler(async (error, _request, reply) => {
    const correlationId = crypto.randomUUID();
    if (error instanceof FsPolicyError) {
      const code = error.code === 'INVALID_REQUEST' ? 'WORKSPACE_NOT_FOUND' : error.code;
      await options.logger.error('request.failed', { code, correlationId });
      return reply.code(error.statusCode).send(failure(code, error.message, correlationId));
    }
    if (error instanceof RagError) {
      await options.logger.error('rag.failed', { code: error.code, correlationId });
      return reply.code(error.statusCode).send(failure(error.code, error.message, correlationId));
    }
    if (error instanceof SorterError) {
      await options.logger.error('sorter.failed', { code: error.code, correlationId });
      return reply.code(error.statusCode).send(failure(error.code, error.message, correlationId));
    }
    await options.logger.error('request.failed', { code: 'FS_IO_ERROR', correlationId });
    return reply
      .code(500)
      .send(failure('FS_IO_ERROR', 'Une erreur locale inattendue est survenue.', correlationId));
  });

  app.get('/*', async (request, reply) => {
    const requestPath = request.url.split('?')[0] ?? '/';
    const relativeAsset = requestPath === '/' ? 'index.html' : requestPath.slice(1);
    const normalized = normalize(relativeAsset).replaceAll('\\', '/');
    if (normalized.startsWith('../') || normalized.includes('/../')) {
      return reply.code(404).send(failure('FILE_NOT_FOUND', 'Ressource introuvable.'));
    }
    try {
      const bytes = await readFile(join(options.rendererPath, normalized));
      return reply.type(mimeType(normalized)).send(bytes);
    } catch {
      if (!extname(normalized)) {
        const index = await readFile(join(options.rendererPath, 'index.html'));
        return reply.type('text/html; charset=utf-8').send(index);
      }
      return reply.code(404).send(failure('FILE_NOT_FOUND', 'Ressource introuvable.'));
    }
  });

  app.addHook('onListen', () => {
    const address = app.server.address();
    if (address && typeof address !== 'string') expectedHost = `127.0.0.1:${address.port}`;
  });

  return { app, workspaceState, rag, sorter };
}
