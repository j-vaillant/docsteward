import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseEmbedding } from '@llamaindex/core/embeddings';
import OpenAI from 'openai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LlamaIndexOpenAIProvider } from '../../apps/server/src/rag';

class DeterministicEmbedding extends BaseEmbedding {
  constructor() {
    super();
  }
  getTextEmbedding(): Promise<number[]> {
    return Promise.resolve([1, 0, 0]);
  }
}

let directory: string;
let provider: LlamaIndexOpenAIProvider;
const createResponse = vi.fn<() => Promise<{ output_text: string }>>();
const answer = {
  answer: 'Le montant est de 42 euros.',
  fields: [
    {
      key: 'montant',
      label: 'Montant',
      type: 'currency',
      value: 42,
      unit: 'EUR',
      citationIds: ['source-1'],
    },
  ],
  citations: [
    {
      id: 'source-1',
      documentPath: 'facture.txt',
      documentName: 'facture.txt',
      excerpt: 'Montant : 42 euros.',
    },
  ],
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'docsteward-rag-query-'));
  provider = new LlamaIndexOpenAIProvider('test-key', {
    generationModel: 'test',
    embeddingModel: 'test',
    similarityTopK: 1,
  });
  (provider as unknown as { embedding: BaseEmbedding }).embedding = new DeterministicEmbedding();
  const client = (provider as unknown as { client: OpenAI }).client;
  createResponse.mockReset().mockResolvedValue({ output_text: JSON.stringify(answer) });
  vi.spyOn(client.responses, 'create').mockImplementation(
    () => createResponse() as ReturnType<OpenAI['responses']['create']>,
  );
  await provider.build(
    [
      {
        id: 'facture',
        text: 'Montant : 42 euros.',
        metadata: {
          workspaceId: 'test',
          relativePath: 'facture.txt',
          documentName: 'facture.txt',
          sha256: 'test',
          size: 22,
          modifiedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ],
    directory,
    () => undefined,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it('recherche dans un index rechargé puis réutilise les sources en mémoire', async () => {
  await expect(provider.query(directory, 'Quel montant ?')).resolves.toEqual(answer);
  await expect(provider.query(directory, 'Quel montant ?')).resolves.toEqual(answer);
  expect(createResponse).toHaveBeenCalledTimes(2);
});

it('accepte les métadonnées absentes renvoyées comme null par l’IA', async () => {
  createResponse.mockResolvedValue({
    output_text: JSON.stringify({
      ...answer,
      fields: answer.fields.map((field) => ({ ...field, unit: null })),
      citations: answer.citations.map((citation) => ({ ...citation, page: null, sheet: null })),
    }),
  });
  await expect(provider.query(directory, 'Quel montant ?')).resolves.toEqual({
    ...answer,
    fields: answer.fields.map((field) => ({ ...field, unit: undefined })),
  });
});

it('identifie une réponse non JSON sans afficher son contenu', async () => {
  createResponse.mockResolvedValue({ output_text: 'Contenu privé non JSON' });
  await expect(provider.query(directory, 'Quel montant ?')).rejects.toMatchObject({
    code: 'RAG_INVALID_RESPONSE',
    statusCode: 502,
  });
});

it('identifie une réponse qui ne respecte pas le contrat documentaire', async () => {
  createResponse.mockResolvedValue({
    output_text: JSON.stringify({ ...answer, fields: [{ ...answer.fields[0], value: null }] }),
  });
  await expect(provider.query(directory, 'Quel montant ?')).rejects.toMatchObject({
    code: 'RAG_INVALID_RESPONSE',
    statusCode: 502,
  });
});
