import { describe, expect, it } from 'vitest';
import {
  MainToServerMessageSchema,
  RagAnswerSchema,
  SettingsSchema,
  ServerToMainMessageSchema,
} from '@docsteward/contracts';

describe('IPC contracts', () => {
  it('accepte un message ready versionné', () => {
    expect(
      ServerToMainMessageSchema.safeParse({
        protocolVersion: 1,
        type: 'server.ready',
        payload: { port: 43210 },
      }).success,
    ).toBe(true);
  });

  it('refuse une version, un type ou un payload invalide', () => {
    expect(
      MainToServerMessageSchema.safeParse({
        protocolVersion: 2,
        type: 'server.shutdown',
        payload: {},
      }).success,
    ).toBe(false);
    expect(
      ServerToMainMessageSchema.safeParse({
        protocolVersion: 1,
        type: 'execute.shell',
        payload: { command: 'rm' },
      }).success,
    ).toBe(false);
  });

  it('refuse un champ RAG non sourcé', () => {
    expect(
      RagAnswerSchema.safeParse({
        answer: '22 000 €',
        fields: [{ key: 'ca', label: 'CA', type: 'currency', value: 22000, citationIds: [] }],
        citations: [],
      }).success,
    ).toBe(false);
  });

  it('ignore les anciens modèles RAG persistés', () => {
    expect(SettingsSchema.safeParse({ schemaVersion: 1, workspaces: [] }).success).toBe(true);
    expect(
      SettingsSchema.parse({
        schemaVersion: 1,
        workspaces: [],
        ragModels: {
          generationModel: 'gpt-5-mini',
          embeddingModel: 'text-embedding-3-small',
        },
      }),
    ).toEqual({ schemaVersion: 1, workspaces: [] });
  });
});
