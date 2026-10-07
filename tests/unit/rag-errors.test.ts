import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseEmbedding } from '@llamaindex/core/embeddings';
import { describe, expect, it } from 'vitest';
import { LlamaIndexOpenAIProvider, publicMessage } from '../../apps/server/src/rag';
import { MetadataMode, Settings, VectorStoreIndex, storageContextFromDefaults } from 'llamaindex';

class DeterministicEmbedding extends BaseEmbedding {
  constructor() {
    super();
  }

  getTextEmbedding(): Promise<number[]> {
    return Promise.resolve([1, 0, 0]);
  }
}

describe('RAG public errors', () => {
  it('identifie l’erreur réseau même lorsque LlamaIndex la renvoie comme une Error simple', () => {
    expect(publicMessage(new Error('Connection error.'), 'indexing')).toMatchObject({
      code: 'OPENAI_UNAVAILABLE',
      statusCode: 503,
      message: 'Le service IA est inaccessible. Vérifiez votre connexion puis réessayez.',
    });
    expect(publicMessage(new TypeError('fetch failed'), 'indexing').code).toBe(
      'OPENAI_UNAVAILABLE',
    );
  });

  it('distingue une erreur d’indexation d’une erreur de recherche', () => {
    expect(publicMessage(new Error('Unexpected failure'), 'indexing')).toMatchObject({
      code: 'INDEX_BUILD_FAILED',
      message: 'L’indexation des documents a échoué. Réessayez.',
    });
    expect(publicMessage(new Error('Unexpected failure')).code).toBe('RAG_QUERY_FAILED');
  });

  it('reconnaît une erreur d’authentification issue d’une autre copie du SDK OpenAI', () => {
    const error = Object.assign(new Error('Incorrect API key provided'), {
      name: 'AuthenticationError',
      status: 401,
    });

    expect(publicMessage(error)).toMatchObject({
      code: 'OPENAI_AUTH_FAILED',
      statusCode: 401,
      message:
        'La clé OpenAI a été refusée. Si elle vient d’être créée, attendez quelques minutes puis réessayez.',
    });
  });

  it('distingue une clé sans autorisation suffisante', () => {
    expect(publicMessage({ name: 'PermissionDeniedError', status: 403 })).toMatchObject({
      code: 'OPENAI_AUTH_FAILED',
      statusCode: 403,
      message:
        'La clé OpenAI n’a pas les autorisations nécessaires. Vérifiez les droits du projet et de la clé.',
    });
  });

  it('reconnaît les limites et indisponibilités issues d’une autre copie du SDK', () => {
    expect(publicMessage({ name: 'RateLimitError', status: 429 })).toMatchObject({
      code: 'OPENAI_RATE_LIMITED',
      statusCode: 429,
    });
    expect(publicMessage({ name: 'InternalServerError', status: 503 })).toMatchObject({
      code: 'OPENAI_UNAVAILABLE',
      statusCode: 503,
    });
  });
});

describe('LlamaIndex provider', () => {
  it('garde les fragments en mémoire jusqu’à la sauvegarde du lot et recharge leurs sources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'docsteward-rag-batch-'));
    const storageFiles = ['doc_store.json', 'vector_store.json', 'index_store.json'];
    const embedding = new DeterministicEmbedding();
    const provider = new LlamaIndexOpenAIProvider('test-key', {
      generationModel: 'test',
      embeddingModel: 'test',
      similarityTopK: 1,
    });
    (provider as unknown as { embedding: BaseEmbedding }).embedding = embedding;
    const document = (id: string) => ({
      id,
      text: Array.from(
        { length: 20 },
        (_, index) =>
          `Phrase ${index} avec suffisamment de texte pour découper le document en fragments.\n`,
      ).join(''),
      metadata: {
        workspaceId: 'workspace',
        relativePath: `${id}.txt`,
        documentName: `${id}.txt`,
        sha256: id,
        size: 100000,
        modifiedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const phases: string[] = [];
    try {
      await provider.build(
        Array.from({ length: 30 }, (_, index) => document(`premier-${index}`)),
        directory,
        () => {
          // Embeddings may complete over many callbacks: none may write the stores.
          expect(storageFiles.some((file) => existsSync(join(directory, file)))).toBe(false);
        },
        (phase) => {
          phases.push(phase);
          expect(storageFiles.some((file) => existsSync(join(directory, file)))).toBe(false);
        },
      );
      expect(phases).toEqual(['embeddings', 'saving']);
      const snapshots = Object.fromEntries(
        await Promise.all(
          storageFiles.map(
            async (file) => [file, await readFile(join(directory, file), 'utf8')] as const,
          ),
        ),
      );
      const vectors = JSON.parse(snapshots['vector_store.json']!) as {
        embeddingDict: Record<string, number[]>;
      };
      expect(Object.keys(vectors.embeddingDict).length).toBeGreaterThan(20);
      await provider.update(
        Array.from({ length: 30 }, (_, index) => document(`second-${index}`)),
        Array.from({ length: 30 }, (_, index) => `premier-${index}`),
        directory,
        () => undefined,
        (phase) => {
          if (phase !== 'saving') return;
          const staging = readdirSync(directory + '/..').find(
            (name) =>
              name.startsWith(directory.split(/[\\/]/).at(-1)! + '.') && name.endsWith('.tmp'),
          )!;
          for (const file of storageFiles)
            expect(readFileSync(join(directory, '..', staging, file), 'utf8')).toBe(
              snapshots[file],
            );
        },
      );
      const reloaded = await Settings.withEmbedModel(embedding, async () =>
        VectorStoreIndex.init({
          storageContext: await storageContextFromDefaults({ persistDir: directory }),
        }),
      );
      const found = await reloaded.asRetriever({ similarityTopK: 3 }).retrieve('Phrase');
      expect(found).toHaveLength(3);
      expect(
        found.every(({ node }) => String(node.metadata.relativePath).startsWith('second-')),
      ).toBe(true);
      expect(found[0]?.node.getContent(MetadataMode.NONE)).toContain('Phrase');
      const updated = JSON.parse(await readFile(join(directory, 'vector_store.json'), 'utf8')) as {
        textIdToRefDocId: Record<string, string>;
      };
      expect(new Set(Object.values(updated.textIdToRefDocId))).toEqual(
        new Set(Array.from({ length: 30 }, (_, index) => `second-${index}`)),
      );
      const beforeFailure = await Promise.all(
        storageFiles.map((file) => readFile(join(directory, file), 'utf8')),
      );
      await expect(
        provider.update(
          [document('troisième')],
          Array.from({ length: 30 }, (_, index) => `second-${index}`),
          directory,
          () => undefined,
          (phase) => {
            if (phase === 'saving') throw new Error('Interrupted before commit');
          },
        ),
      ).rejects.toThrow('Interrupted before commit');
      expect(
        await Promise.all(storageFiles.map((file) => readFile(join(directory, file), 'utf8'))),
      ).toEqual(beforeFailure);
      expect(
        (await readdir(join(directory, '..'))).filter((name) =>
          name.startsWith(directory.split(/[\\/]/).at(-1)! + '.'),
        ),
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);

  it('crée puis met à jour le stockage vectoriel de façon différentielle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'docsteward-rag-provider-'));
    try {
      const provider = new LlamaIndexOpenAIProvider('test-key', {
        generationModel: 'test-generation',
        embeddingModel: 'test-embedding',
        similarityTopK: 1,
      });
      (provider as unknown as { embedding: BaseEmbedding }).embedding =
        new DeterministicEmbedding();

      await expect(
        provider.build(
          [
            {
              id: 'document-test',
              text: 'Document de test',
              metadata: {
                workspaceId: 'workspace-test',
                relativePath: 'test.txt',
                documentName: 'test.txt',
                sha256: 'abc',
                size: 16,
                modifiedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
          directory,
          () => undefined,
        ),
      ).resolves.toBeUndefined();

      await expect(
        provider.update(
          [
            {
              id: 'document-ajoute',
              text: 'Nouveau document',
              metadata: {
                workspaceId: 'workspace-test',
                relativePath: 'ajout.txt',
                documentName: 'ajout.txt',
                sha256: 'def',
                size: 17,
                modifiedAt: '2026-01-02T00:00:00.000Z',
              },
            },
          ],
          ['document-test'],
          directory,
          () => undefined,
        ),
      ).resolves.toBeUndefined();

      const vectorStore = JSON.parse(
        await readFile(join(directory, 'vector_store.json'), 'utf8'),
      ) as { textIdToRefDocId: Record<string, string> };
      expect(Object.values(vectorStore.textIdToRefDocId)).toContain('document-ajoute');
      expect(Object.values(vectorStore.textIdToRefDocId)).not.toContain('document-test');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
