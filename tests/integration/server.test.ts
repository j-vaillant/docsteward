import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { createServer } from '../../apps/server/src/app';
import type { SafeLogger } from '../../apps/server/src/logger';
import type { RagProvider, RagService } from '../../apps/server/src/rag';
import type { SorterProvider } from '../../apps/server/src/sorter';
import type { FileEntry, RagAnswer, VirtualTree } from '@docsteward/contracts';

const logger: SafeLogger = {
  info: () => Promise.resolve(),
  error: () => Promise.resolve(),
};
const secret = 'a'.repeat(43);
const auth = { authorization: `Bearer ${secret}` };
let app: FastifyInstance;
let rag: RagService;
let root: string;
let dataPath: string;

const deterministicAnswer: RagAnswer = {
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
      documentPath: 'notes.md',
      documentName: 'notes.md',
      excerpt: 'Chiffre d’affaires : 22 000 €',
    },
  ],
};
const ragProvider: RagProvider = {
  build: async (_documents, persistDir, progress) => {
    await mkdir(persistDir, { recursive: true });
    progress(1, 1);
  },
  update: (_documents, _removedDocumentIds, _persistDir, progress) => {
    progress(1, 1);
    return Promise.resolve();
  },
  query: () => Promise.resolve(deterministicAnswer),
  verify: () => Promise.resolve(),
};
const sorterProvider: SorterProvider = {
  classify: (_instruction, documents) =>
    Promise.resolve({
      rules: [
        {
          id: 'topic',
          order: 0,
          title: 'Par sujet',
          description: 'Regroupe les documents par sujet.',
          targetPattern: 'documents',
          fallback: false,
        },
      ],
      assignments: documents.map((document) => ({
        documentId: document.documentId,
        virtualPath: `Classement/${document.name}`,
        ruleId: 'topic',
        reason: 'Document classé par la règle de test.',
      })),
    }),
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docsteward-server-'));
  dataPath = await mkdtemp(join(tmpdir(), 'docsteward-data-'));
  await writeFile(join(root, 'notes.md'), 'Bonjour');
  const server = createServer({
    secret,
    rendererPath: root,
    appVersion: '0.1.0-test',
    workspaces: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        displayName: 'Test',
        rootPath: root,
        access: 'read-only',
      },
    ],
    logger,
    dataPath,
    ragProvider,
    sorterProvider,
  });
  app = server.app;
  rag = server.rag;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('local server', () => {
  it('garde les fichiers hors limites visibles et prévisualisables avec un avertissement et une exclusion dans le rapport', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    await writeFile(join(root, 'grand.txt'), 'a'.repeat(2 * 1024 * 1024 + 1));
    const preview = await app.inject({
      method: 'POST',
      url: '/api/fs/preview',
      headers: auth,
      payload: { workspaceId, path: 'grand.txt' },
    });
    expect(preview.statusCode).toBe(200);
    const data = preview.json<{
      data: { kind: string; content: string; indexingWarning: string };
    }>().data;
    expect(data).toMatchObject({
      kind: 'text',
      indexingWarning: expect.stringContaining('2 Mio') as unknown,
    });
    expect(data.content).toHaveLength(2 * 1024 * 1024 + 1);
    await rag.setEnabled(workspaceId, true);
    await rag.build({ id: workspaceId, rootPath: root, displayName: 'Test', access: 'read-only' });
    expect((await rag.report(workspaceId))?.notIndexed).toContainEqual(
      expect.objectContaining({ path: 'grand.txt', code: 'FILE_TOO_LARGE' }),
    );
    const listing = await app.inject({
      method: 'GET',
      url: `/api/fs/list?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(listing.json<{ data: FileEntry[] }>().data).toContainEqual(
      expect.objectContaining({ path: 'grand.txt' }),
    );
    await writeFile(join(root, 'immense.txt'), 'a'.repeat(5 * 1024 * 1024 + 1));
    const unavailable = await app.inject({
      method: 'POST',
      url: '/api/fs/preview',
      headers: auth,
      payload: { workspaceId, path: 'immense.txt' },
    });
    expect(unavailable.statusCode).toBe(200);
    expect(unavailable.json<{ data: unknown }>().data).toMatchObject({
      kind: 'unavailable',
      indexingWarning: expect.stringContaining('2 Mio') as unknown,
    });
  });

  it('charge la navigation sans lire les documents ni inventorier les sous-dossiers', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const nested = join(root, 'écrits');
    await mkdir(nested);
    await Promise.all(
      Array.from({ length: 1_001 }, (_, index) =>
        writeFile(join(nested, `${index}.pdf`), 'PDF volontairement invalide'),
      ),
    );
    const active = await app.inject({
      method: 'GET',
      url: `/api/virtual-tree/active?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(active.json()).toEqual({ ok: true, data: null });
    const rootListing = await app.inject({
      method: 'GET',
      url: `/api/fs/list?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(rootListing.json<{ data: FileEntry[] }>().data).toHaveLength(2);
    expect(rootListing.json<{ data: FileEntry[] }>().data[0]).toMatchObject({
      name: 'écrits',
      type: 'directory',
    });
    const nestedListing = await app.inject({
      method: 'GET',
      url: `/api/fs/list?${new URLSearchParams({ workspaceId, path: 'écrits' })}`,
      headers: auth,
    });
    expect(nestedListing.statusCode).toBe(200);
    expect(nestedListing.json<{ data: FileEntry[] }>().data).toHaveLength(1_001);
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/virtual-tree/active?workspaceId=00000000-0000-4000-8000-000000000099',
      headers: auth,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('ne donne accès aux données locales qu’après authentification utilisateur', async () => {
    const locked = createServer({
      secret,
      rendererPath: root,
      appVersion: '0.1.0-test',
      workspaces: [],
      logger,
      dataPath,
      authenticated: false,
      ragProvider,
      sorterProvider,
    }).app;
    const health = await locked.inject({ method: 'GET', url: '/api/health', headers: auth });
    const workspaces = await locked.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: auth,
    });
    await locked.close();

    expect(health.statusCode).toBe(200);
    expect(workspaces.statusCode).toBe(401);
    expect(workspaces.json()).toMatchObject({
      ok: false,
      error: { code: 'USER_AUTH_REQUIRED' },
    });
  });

  it('démarre sur un port éphémère et répond avec authentification', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    expect(address).not.toBeNull();
    expect(typeof address).not.toBe('string');
    const port = typeof address === 'object' && address ? address.port : 0;
    const denied = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(denied.status).toBe(401);
    const ready = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ ok: true, data: { status: 'ready' } });
  });

  it('refuse les tokens absents ou incorrects', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/health',
          headers: { authorization: 'Bearer wrong' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('liste et prévisualise en lecture seule', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const listed = await app.inject({
      method: 'GET',
      url: `/api/fs/list?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ ok: true, data: [{ name: 'notes.md' }] });

    const read = await app.inject({
      method: 'POST',
      url: '/api/fs/preview',
      headers: auth,
      payload: { workspaceId, path: 'notes.md' },
    });
    expect(read.json()).toMatchObject({ ok: true, data: { kind: 'text', content: 'Bonjour' } });
    const formerWriteRoute = await app.inject({
      method: 'POST',
      url: '/api/fs/write-text',
      headers: auth,
      payload: { workspaceId, path: 'notes.md', content: 'interdit' },
    });
    expect(formerWriteRoute.statusCode).toBe(404);
  });

  it('prévisualise un classeur Excel et sert les PDF', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Projet', 'Statut'],
        ['DocSteward', 'Prêt'],
      ]),
      'Suivi',
    );
    const workbookBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    await writeFile(join(root, 'suivi.xlsx'), new Uint8Array(workbookBytes));
    await writeFile(join(root, 'rapport.pdf'), '%PDF-1.4\n% local');
    const spreadsheet = await app.inject({
      method: 'POST',
      url: '/api/fs/preview',
      headers: auth,
      payload: { workspaceId, path: 'suivi.xlsx' },
    });
    expect(spreadsheet.json()).toMatchObject({
      ok: true,
      data: {
        kind: 'spreadsheet',
        sheets: [
          {
            name: 'Suivi',
            rows: [
              ['Projet', 'Statut'],
              ['DocSteward', 'Prêt'],
            ],
          },
        ],
      },
    });
    const pdf = await app.inject({
      method: 'GET',
      url: `/api/fs/raw?workspaceId=${workspaceId}&path=rapport.pdf`,
      headers: auth,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-security-policy']).toContain("frame-ancestors 'self'");
  });

  it('sert les images pour leur aperçu et masque les fichiers temporaires, y compris en accès direct', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA7sAAAAASUVORK5CYII=',
      'base64',
    );
    await writeFile(join(root, 'image.png'), bytes);
    await writeFile(join(root, '~$contrat.docx'), 'temporaire');
    const listed = await app.inject({
      method: 'GET',
      url: `/api/fs/list?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(listed.json<{ data: FileEntry[] }>().data.map((item) => item.name)).toEqual([
      'image.png',
      'notes.md',
    ]);
    const preview = await app.inject({
      method: 'POST',
      url: '/api/fs/preview',
      headers: auth,
      payload: { workspaceId, path: 'image.png' },
    });
    expect(preview.json()).toMatchObject({ ok: true, data: { kind: 'image' } });
    const raw = await app.inject({
      method: 'GET',
      url: `/api/fs/raw?workspaceId=${workspaceId}&path=image.png`,
      headers: auth,
    });
    expect(raw.headers['content-type']).toBe('image/png');
    expect(raw.rawPayload).toEqual(bytes);
    const temporary = await app.inject({
      method: 'POST',
      url: '/api/fs/preview',
      headers: auth,
      payload: { workspaceId, path: '~$contrat.docx' },
    });
    expect(temporary.json()).toMatchObject({ ok: false, error: { code: 'FILE_TYPE_NOT_ALLOWED' } });
  });

  it('prévisualise les textes Windows-1252 et UTF-16 avec BOM sans modifier leurs octets', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    for (const bytes of [
      Buffer.from([0x63, 0x61, 0x66, 0xe9]),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('café', 'utf16le')]),
    ]) {
      await writeFile(join(root, 'ancien.txt'), bytes);
      const preview = await app.inject({
        method: 'POST',
        url: '/api/fs/preview',
        headers: auth,
        payload: { workspaceId, path: 'ancien.txt' },
      });
      expect(preview.json()).toMatchObject({ ok: true, data: { kind: 'text', content: 'café' } });
      expect(await readFile(join(root, 'ancien.txt'))).toEqual(bytes);
    }
  });

  it('refuse la sortie du workspace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/fs/preview',
      headers: auth,
      payload: { workspaceId: '00000000-0000-4000-8000-000000000001', path: '../secret.md' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
  });

  it('marque l’index comme périmé quand le modèle d’embeddings change', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    await app.inject({
      method: 'POST',
      url: '/api/rag/consent',
      headers: auth,
      payload: { workspaceId, enabled: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/rag/index',
      headers: auth,
      payload: { workspaceId },
    });

    rag.setConfiguration({
      generationModel: 'gpt-5-mini',
      embeddingModel: 'text-embedding-3-large',
      similarityTopK: 5,
    });

    const status = await app.inject({
      method: 'GET',
      url: `/api/rag/status?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(status.json()).toMatchObject({ ok: true, data: { status: 'stale' } });
  });

  it('protège le rapport d’indexation et le restitue avec les exclusions', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    await writeFile(join(root, 'vide.txt'), '');
    await rag.setEnabled(workspaceId, true);
    await app.inject({
      method: 'POST',
      url: '/api/rag/index',
      headers: auth,
      payload: { workspaceId },
    });
    const report = await app.inject({
      method: 'GET',
      url: `/api/rag/report?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(report.json()).toMatchObject({
      ok: true,
      data: {
        totalFiles: 2,
        indexedFiles: ['notes.md'],
        notIndexed: [{ path: 'vide.txt', code: 'NO_TEXT' }],
      },
    });
    const download = await app.inject({
      method: 'GET',
      url: `/api/rag/report/download?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(download.headers['content-disposition']).toContain('rapport-indexation.txt');
    expect(download.body).toContain('vide.txt — Aucun texte exploitable');
    expect(
      (await app.inject({ method: 'GET', url: `/api/rag/report?workspaceId=${workspaceId}` }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/rag/report?workspaceId=00000000-0000-4000-8000-000000000099',
          headers: auth,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('applique les ajouts, modifications et suppressions sans reconstruire tout l’index', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const build = vi.spyOn(ragProvider, 'build');
    const update = vi.spyOn(ragProvider, 'update');
    await app.inject({
      method: 'POST',
      url: '/api/rag/consent',
      headers: auth,
      payload: { workspaceId, enabled: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/rag/index',
      headers: auth,
      payload: { workspaceId },
    });

    await app.inject({
      method: 'POST',
      url: '/api/rag/query',
      headers: auth,
      payload: { workspaceId, question: 'Que contient ce dossier ?' },
    });
    expect(build).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();

    const addedPath = join(root, 'ajout.md');
    await writeFile(addedPath, 'Nouveau document');
    const staleAfterAddition = await app.inject({
      method: 'GET',
      url: `/api/rag/status?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(staleAfterAddition.json()).toMatchObject({ ok: true, data: { status: 'stale' } });
    await app.inject({
      method: 'POST',
      url: '/api/rag/query',
      headers: auth,
      payload: { workspaceId, question: 'Que contient ce dossier ?' },
    });
    expect(build).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toHaveLength(1);
    expect(update.mock.calls[0]?.[1]).toHaveLength(0);

    await unlink(addedPath);
    await app.inject({
      method: 'POST',
      url: '/api/rag/query',
      headers: auth,
      payload: { workspaceId, question: 'Que contient ce dossier ?' },
    });
    expect(build).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]?.[0]).toHaveLength(0);
    expect(update.mock.calls[1]?.[1]).toHaveLength(1);

    await writeFile(join(root, 'notes.md'), 'Bonjour, contenu modifié');
    await app.inject({
      method: 'POST',
      url: '/api/rag/query',
      headers: auth,
      payload: { workspaceId, question: 'Que contient ce dossier ?' },
    });
    expect(build).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(4);
    // Removal and insertion are prepared in the unpublished generation.
    expect(update.mock.calls[2]?.[0]).toHaveLength(0);
    expect(update.mock.calls[2]?.[1]).toHaveLength(1);
    expect(update.mock.calls[3]?.[0]).toHaveLength(1);
    expect(update.mock.calls[3]?.[1]).toHaveLength(0);
  });

  it('indexe, interroge et persiste un indicateur avec un fournisseur déterministe', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    await app.inject({
      method: 'POST',
      url: '/api/rag/consent',
      headers: auth,
      payload: { workspaceId, enabled: true },
    });
    const indexed = await app.inject({
      method: 'POST',
      url: '/api/rag/index',
      headers: auth,
      payload: { workspaceId },
    });
    expect(indexed.json()).toMatchObject({
      ok: true,
      data: { status: 'ready', indexedDocuments: 1 },
    });
    const queried = await app.inject({
      method: 'POST',
      url: '/api/rag/query',
      headers: auth,
      payload: { workspaceId, question: 'Quel est mon chiffre d’affaires ?' },
    });
    expect(queried.json()).toMatchObject({
      ok: true,
      data: { fields: [{ key: 'revenue', value: 22000 }] },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/indicators',
      headers: auth,
      payload: {
        workspaceId,
        title: 'CA total',
        query: 'Quel est mon chiffre d’affaires ?',
        selectedFieldKey: 'revenue',
        expectedType: 'currency',
        initialAnswer: deterministicAnswer,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      ok: true,
      data: { title: 'CA total', latestValue: 22000 },
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/api/indicators?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(listed.json()).toMatchObject({ ok: true, data: [{ title: 'CA total' }] });
  });

  it('recalcule un indicateur avec les sources restantes après la suppression d’un document', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const removedPath = join(root, 'facture-supprimee.md');
    await writeFile(join(root, 'notes.md'), 'Montant : 12 000 €');
    await writeFile(removedPath, 'Montant : 10 000 €');
    await app.inject({
      method: 'POST',
      url: '/api/rag/consent',
      headers: auth,
      payload: { workspaceId, enabled: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/rag/index',
      headers: auth,
      payload: { workspaceId },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/indicators',
      headers: auth,
      payload: {
        workspaceId,
        title: 'CA total',
        query: 'Quel est mon chiffre d’affaires cumulé ?',
        selectedFieldKey: 'revenue',
        expectedType: 'currency',
        initialAnswer: {
          answer: 'Le chiffre d’affaires cumulé est de 22 000 €.',
          fields: [
            {
              key: 'revenue',
              label: 'Chiffre d’affaires cumulé',
              type: 'currency',
              value: 22000,
              unit: 'EUR',
              citationIds: ['source-1', 'source-2'],
            },
          ],
          citations: [
            {
              id: 'source-1',
              documentPath: 'notes.md',
              documentName: 'notes.md',
              excerpt: 'Montant : 12 000 €',
            },
            {
              id: 'source-2',
              documentPath: 'facture-supprimee.md',
              documentName: 'facture-supprimee.md',
              excerpt: 'Montant : 10 000 €',
            },
          ],
        },
      },
    });
    const indicatorId = created.json<{ data: { id: string } }>().data.id;
    await unlink(removedPath);

    const query = vi.spyOn(ragProvider, 'query').mockImplementation((_path, _question, target) => {
      expect(target).toEqual({
        key: 'revenue',
        type: 'currency',
        label: 'Chiffre d’affaires cumulé',
      });
      return Promise.resolve({
        answer: 'Le chiffre d’affaires cumulé est désormais de 12 000 €.',
        fields: [
          {
            key: 'revenue',
            label: 'Chiffre d’affaires cumulé',
            type: 'currency',
            value: 12000,
            unit: 'EUR',
            citationIds: ['source-1'],
          },
        ],
        citations: [
          {
            id: 'source-1',
            documentPath: 'notes.md',
            documentName: 'notes.md',
            excerpt: 'Montant : 12 000 €',
          },
        ],
      });
    });

    const refreshed = await app.inject({
      method: 'POST',
      url: `/api/indicators/${indicatorId}/refresh`,
      headers: auth,
      payload: { workspaceId },
    });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toMatchObject({
      ok: true,
      data: {
        id: indicatorId,
        latestValue: 12000,
        status: 'ready',
        latestCitations: [{ documentPath: 'notes.md' }],
      },
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it('prévisualise, active et oublie une organisation virtuelle sans écrire dans le dossier', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const before = await readFile(join(root, 'notes.md'), 'utf8');
    const identity = await app.inject({
      method: 'GET',
      url: `/api/virtual-tree?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(identity.json()).toMatchObject({
      ok: true,
      data: { status: 'identity', entries: [{ virtualPath: 'notes.md' }] },
    });

    const denied = await app.inject({
      method: 'POST',
      url: '/api/virtual-tree/preview',
      headers: auth,
      payload: { workspaceId, instruction: 'Classe les documents par sujet.' },
    });
    expect(denied.json()).toMatchObject({
      ok: false,
      error: { code: 'VIRTUAL_TREE_CONSENT_REQUIRED' },
    });

    await app.inject({
      method: 'POST',
      url: '/api/rag/consent',
      headers: auth,
      payload: { workspaceId, enabled: true },
    });
    const previewed = await app.inject({
      method: 'POST',
      url: '/api/virtual-tree/preview',
      headers: auth,
      payload: { workspaceId, instruction: 'Classe les documents par sujet.' },
    });
    expect(previewed.json()).toMatchObject({
      ok: true,
      data: { status: 'preview', entries: [{ virtualPath: 'Classement/notes.md' }] },
    });
    const fingerprint = previewed.json<{ data: { inventoryFingerprint: string } }>().data
      .inventoryFingerprint;
    const activated = await app.inject({
      method: 'POST',
      url: '/api/virtual-tree/activate',
      headers: auth,
      payload: { workspaceId, inventoryFingerprint: fingerprint },
    });
    expect(activated.json()).toMatchObject({ ok: true, data: { status: 'active' } });
    expect(await readFile(join(root, 'notes.md'), 'utf8')).toBe(before);

    const reset = await app.inject({
      method: 'DELETE',
      url: `/api/virtual-tree?workspaceId=${workspaceId}`,
      headers: auth,
    });
    expect(reset.json()).toMatchObject({ ok: true, data: { status: 'identity' } });
    expect(await readFile(join(root, 'notes.md'), 'utf8')).toBe(before);
  });

  it('restaure une organisation virtuelle active après le redémarrage du serveur', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const workspace = {
      id: workspaceId,
      displayName: 'Test',
      rootPath: root,
      access: 'read-only' as const,
    };
    await app.inject({
      method: 'POST',
      url: '/api/rag/consent',
      headers: auth,
      payload: { workspaceId, enabled: true },
    });
    const previewed = await app.inject({
      method: 'POST',
      url: '/api/virtual-tree/preview',
      headers: auth,
      payload: { workspaceId, instruction: 'Classe les documents par sujet.' },
    });
    const fingerprint = previewed.json<{ data: { inventoryFingerprint: string } }>().data
      .inventoryFingerprint;
    await app.inject({
      method: 'POST',
      url: '/api/virtual-tree/activate',
      headers: auth,
      payload: { workspaceId, inventoryFingerprint: fingerprint },
    });

    // Simulate an organization saved before temporary files were filtered.
    const path = join(dataPath, 'sorter', 'organizations.json');
    const stored = JSON.parse(await readFile(path, 'utf8')) as { organizations: VirtualTree[] };
    const organization = stored.organizations[0]!;
    organization.entries.push({
      ...organization.entries[0]!,
      documentId: 'temporary-document',
      physicalRelativePath: '~$contrat.docx',
      virtualPath: 'Classement/temporaire.docx',
    });
    await writeFile(path, JSON.stringify(stored));

    const restarted = createServer({
      secret,
      rendererPath: root,
      appVersion: '0.1.0-test',
      workspaces: [workspace],
      logger,
      dataPath,
      ragProvider,
      sorterProvider,
    });
    try {
      const restored = await restarted.app.inject({
        method: 'GET',
        url: `/api/virtual-tree/active?workspaceId=${workspaceId}`,
        headers: auth,
      });
      expect(restored.json()).toMatchObject({
        ok: true,
        data: {
          status: 'active',
          instruction: 'Classe les documents par sujet.',
          entries: [{ virtualPath: 'Classement/notes.md' }],
          summary: { documents: 1 },
        },
      });
    } finally {
      await restarted.app.close();
    }
  });

  it('retourne une erreur Sorter explicite lorsque la réponse du modèle est mal formée', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    await app.inject({
      method: 'POST',
      url: '/api/rag/consent',
      headers: auth,
      payload: { workspaceId, enabled: true },
    });
    vi.spyOn(sorterProvider, 'classify').mockResolvedValueOnce({
      rules: [
        {
          id: '',
          order: -1,
          title: '',
          description: '',
          targetPattern: '',
          fallback: false,
        },
      ],
      assignments: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/virtual-tree/preview',
      headers: auth,
      payload: { workspaceId, instruction: 'Classe les documents par sujet.' },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: 'VIRTUAL_TREE_RESPONSE_INVALID',
      },
    });
    expect(body.error.message).toContain('Recalculez');
  });
});
