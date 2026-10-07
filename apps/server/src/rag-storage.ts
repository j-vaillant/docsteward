import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SimpleDocumentStore,
  SimpleIndexStore,
  SimpleVectorStore,
  storageContextFromDefaults,
} from 'llamaindex';
import type { BaseEmbedding } from '@llamaindex/core/embeddings';

async function readStore<T>(path: string, empty: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
    // A damaged checkpoint must fail rather than silently erase existing data.
    throw error;
  }
}

async function writeStore(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Load detached stores: mutations stay in memory until the whole batch succeeds. */
export async function batchStorage(persistDir: string, embedding: BaseEmbedding) {
  const docPath = join(persistDir, 'doc_store.json');
  const indexPath = join(persistDir, 'index_store.json');
  const vectorPath = join(persistDir, 'vector_store.json');
  const docStore = SimpleDocumentStore.fromDict(
    await readStore<Parameters<typeof SimpleDocumentStore.fromDict>[0]>(docPath, {}),
  );
  const indexStore = SimpleIndexStore.fromDict(
    await readStore<Parameters<typeof SimpleIndexStore.fromDict>[0]>(indexPath, {}),
  );
  const vectorStore = SimpleVectorStore.fromDict(
    await readStore(vectorPath, new SimpleVectorStore({ embedModel: embedding }).toDict()),
    embedding,
  );
  const storageContext = await storageContextFromDefaults({ docStore, indexStore, vectorStore });
  return {
    storageContext,
    async persist(this: void) {
      // Explicit snapshots avoid LlamaIndex's per-fragment auto-persistence and
      // persist() implementations which don't reliably await their writes.
      // These files belong to an unpublished generation; its pointer is only
      // committed by the caller after every snapshot has been written.
      await writeStore(docPath, docStore.toDict());
      await writeStore(vectorPath, vectorStore.toDict());
      await writeStore(indexPath, indexStore.toDict());
    },
  };
}
