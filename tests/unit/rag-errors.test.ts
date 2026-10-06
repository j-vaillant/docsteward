import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseEmbedding } from '@llamaindex/core/embeddings';
import { describe, expect, it } from 'vitest';
import { LlamaIndexOpenAIProvider, publicMessage } from '../../apps/server/src/rag';

class DeterministicEmbedding extends BaseEmbedding {
  constructor() {
    super();
  }

  getTextEmbedding(): Promise<number[]> {
    return Promise.resolve([1, 0, 0]);
  }
}

describe('RAG public errors', () => {
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
