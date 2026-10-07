import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { MainToServerMessageSchema, PROTOCOL_VERSION } from '@docsteward/contracts';
import { createServer } from './app';
import { createSafeLogger, type SafeLogger } from './logger';
import type { RagProvider } from './rag';
import { OpenAISorterProvider, type SorterProvider } from './sorter';

// Use the OS trust store for the HTTPS proxy, as Electron does for login.
// Keep the bundled roots and certificate verification enabled.
setDefaultCACertificates([...getCACertificates('default'), ...getCACertificates('system')]);

const deterministicRagProvider: RagProvider | undefined =
  process.env.NODE_ENV === 'test' && process.env.DOCSTEWARD_E2E_RAG
    ? {
        build: async (_documents, persistDir, progress) => {
          await mkdir(persistDir, { recursive: true });
          progress(1, 1);
        },
        update: (_documents, _removedDocumentIds, _persistDir, progress) => {
          progress(1, 1);
          return Promise.resolve();
        },
        verify: () => Promise.resolve(),
        query: () =>
          Promise.resolve({
            answer: 'Le chiffre d’affaires total est de 22 000 €.',
            fields: [
              {
                key: 'revenue',
                label: 'Chiffre d’affaires total',
                type: 'currency',
                value: 22000,
                unit: 'EUR',
                citationIds: ['source-1'],
              },
            ],
            citations: [
              {
                id: 'source-1',
                documentPath: 'chiffre-affaires.txt',
                documentName: 'chiffre-affaires.txt',
                excerpt: 'Chiffre d’affaires total : 22 000 €',
              },
            ],
          }),
      }
    : undefined;
const deterministicSorterProvider: SorterProvider | undefined =
  process.env.NODE_ENV === 'test' && process.env.DOCSTEWARD_E2E_RAG
    ? {
        classify: (_instruction, documents) =>
          Promise.resolve({
            rules: [
              {
                id: 'documents',
                order: 0,
                title: 'Documents de démonstration',
                description: 'Regroupe les documents dans une vue virtuelle.',
                targetPattern: 'Tous les documents',
                fallback: false,
              },
            ],
            assignments: documents.map((document) => ({
              documentId: document.documentId,
              virtualPath: `Organisation/${document.name}`,
              ruleId: 'documents',
              reason: 'Classement de démonstration déterministe.',
            })),
          }),
      }
    : undefined;

type ParentPort = {
  on(event: 'message', listener: (event: unknown) => void): void;
  postMessage(message: unknown): void;
};

const parentPort = process.parentPort as ParentPort | undefined;
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let logger: SafeLogger | undefined;

function send(
  type: 'server.ready' | 'server.error' | 'server.configuration-applied' | 'server.stopped',
  payload: object,
  requestId?: string,
): void {
  parentPort?.postMessage({
    protocolVersion: PROTOCOL_VERSION,
    type,
    payload,
    ...(requestId ? { requestId } : {}),
  });
}

function dataFromEvent(event: unknown): unknown {
  return typeof event === 'object' && event !== null && 'data' in event
    ? (event as { data?: unknown }).data
    : event;
}

parentPort?.on('message', (event) => {
  void (async () => {
    const parsed = MainToServerMessageSchema.safeParse(dataFromEvent(event));
    if (!parsed.success) {
      await logger?.error('ipc.invalid', { code: 'INVALID_MESSAGE' });
      return;
    }

    if (parsed.data.type === 'server.configure') {
      if (server) return;
      const config = parsed.data.payload;
      logger = await createSafeLogger(join(config.dataPath, 'logs'), 'server');
      server = createServer({
        secret: config.secret,
        rendererPath: config.rendererPath,
        dataPath: config.dataPath,
        appVersion: config.appVersion,
        workspaces: config.workspaces,
        authenticated: config.authenticated,
        logger,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
        ragConfiguration: config.ragConfiguration,
        ...(deterministicRagProvider ? { ragProvider: deterministicRagProvider } : {}),
        ...(deterministicSorterProvider ? { sorterProvider: deterministicSorterProvider } : {}),
      });
      try {
        await server.app.listen({ host: '127.0.0.1', port: 0 });
        const address = server.app.server.address();
        if (!address || typeof address === 'string')
          throw new Error('Adresse serveur indisponible');
        await logger.info('server.ready', { port: address.port });
        send('server.ready', { port: address.port });
      } catch {
        const correlationId = crypto.randomUUID();
        await logger.error('server.start_failed', { correlationId });
        send('server.error', {
          code: 'SERVER_START_FAILED',
          message: 'Le serveur local n’a pas pu démarrer.',
          correlationId,
        });
      }
      return;
    }

    if (parsed.data.type === 'workspace.replaceAll') {
      server?.workspaceState.replaceAll(parsed.data.payload.workspaces);
      return;
    }

    if (parsed.data.type === 'rag.configure') {
      server?.rag.setApiKey(parsed.data.payload.apiKey, parsed.data.payload.apiBaseUrl);
      server?.sorter.setProvider(
        deterministicSorterProvider ??
          (parsed.data.payload.apiKey
            ? new OpenAISorterProvider(
                parsed.data.payload.apiKey,
                {
                  generationModel: 'gpt-5-mini',
                  embeddingModel: 'text-embedding-3-small',
                  similarityTopK: 5,
                },
                parsed.data.payload.apiBaseUrl,
              )
            : undefined),
      );
      send('server.configuration-applied', {}, parsed.data.requestId);
      return;
    }

    if (parsed.data.type === 'rag.models.configure') {
      server?.rag.setConfiguration(
        parsed.data.payload.ragConfiguration,
        parsed.data.payload.apiKey,
        parsed.data.payload.apiBaseUrl,
      );
      server?.sorter.setProvider(
        deterministicSorterProvider ??
          (parsed.data.payload.apiKey
            ? new OpenAISorterProvider(
                parsed.data.payload.apiKey,
                parsed.data.payload.ragConfiguration,
                parsed.data.payload.apiBaseUrl,
              )
            : undefined),
      );
      send('server.configuration-applied', {}, parsed.data.requestId);
      return;
    }

    if (parsed.data.type === 'server.shutdown') {
      await server?.app.close();
      await logger?.info('server.stopped');
      send('server.stopped', {});
      process.exit(0);
    }
  })();
});

process.on('uncaughtException', () => {
  const correlationId = crypto.randomUUID();
  void logger?.error('server.uncaught', { correlationId });
  send('server.error', {
    code: 'SERVER_CRASHED',
    message: 'Le serveur local s’est arrêté de façon inattendue.',
    correlationId,
  });
  process.exit(1);
});
