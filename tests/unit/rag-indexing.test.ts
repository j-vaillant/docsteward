import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IndexReportSchema, type WorkspaceRecord } from '@docsteward/contracts';
import { RagService, type RagProvider } from '../../apps/server/src/rag';
import { buildSorterInventory } from '../../apps/server/src/sorter';
import * as XLSX from 'xlsx';

let temporary: string;
let workspace: WorkspaceRecord;
let dataPath: string;
let failUpdate: boolean;
const embeddedPaths: string[] = [];
const provider: RagProvider = {
  build: async (documents, directory, progress) => {
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'ids.json'),
      JSON.stringify(documents.map((document) => document.id)),
    );
    embeddedPaths.push(...documents.map((document) => document.metadata.relativePath));
    progress(1, 1);
  },
  update: async (documents, removed, directory, progress) => {
    if (failUpdate) throw new Error('Simulated network outage');
    const ids = JSON.parse(await readFile(join(directory, 'ids.json'), 'utf8')) as string[];
    await writeFile(
      join(directory, 'ids.json'),
      JSON.stringify([
        ...ids.filter((id) => !removed.includes(id)),
        ...documents.map((document) => document.id),
      ]),
    );
    embeddedPaths.push(...documents.map((document) => document.metadata.relativePath));
    progress(1, 1);
  },
  verify: () => Promise.resolve(),
  query: () => Promise.resolve({ answer: 'Test', fields: [], citations: [] }),
};
function service() {
  return new RagService({
    dataPath,
    configuration: { embeddingModel: 'test', generationModel: 'test', similarityTopK: 1 },
    provider,
    logger: { info: () => Promise.resolve(), error: () => Promise.resolve() },
  });
}
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'docsteward-indexing-'));
  const rootPath = join(temporary, 'écrits');
  await mkdir(rootPath);
  dataPath = join(temporary, 'data');
  workspace = {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Écrits',
    rootPath,
    access: 'read-only',
  };
  failUpdate = false;
  embeddedPaths.length = 0;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(temporary, { recursive: true, force: true });
});

it('reprend après un redémarrage sans recalculer les lots enregistrés et sans publier un index incomplet', async () => {
  for (let i = 0; i < 12; i++)
    await writeFile(join(workspace.rootPath, `${String(i).padStart(2, '0')}.txt`), `Texte ${i}`);
  const first = service();
  await first.setEnabled(workspace.id, true);
  failUpdate = true;
  await expect(first.build(workspace)).rejects.toMatchObject({
    code: 'INDEX_BUILD_FAILED',
    message: 'L’indexation des documents a échoué. Réessayez.',
  });
  expect(await first.status(workspace)).toMatchObject({
    status: 'error',
    error: 'L’indexation des documents a échoué. Réessayez.',
  });
  expect(embeddedPaths).toHaveLength(10);
  await expect(readFile(join(dataPath, 'rag', workspace.id, 'manifest.json'))).rejects.toThrow();
  const restarted = service();
  expect(await restarted.status(workspace)).toMatchObject({ resumable: true });
  failUpdate = false;
  await restarted.build(workspace);
  expect(embeddedPaths).toHaveLength(12);
  expect(new Set(embeddedPaths).size).toBe(12);
  const manifest = JSON.parse(
    await readFile(join(dataPath, 'rag', workspace.id, 'manifest.json'), 'utf8'),
  ) as { storageName: string };
  const ids = JSON.parse(
    await readFile(join(dataPath, 'rag', workspace.id, manifest.storageName, 'ids.json'), 'utf8'),
  ) as string[];
  expect(new Set(ids).size).toBe(12);
  expect(IndexReportSchema.parse(await restarted.report(workspace.id)).indexedFiles).toHaveLength(
    12,
  );
});

it('conserve l’ancien index si une reconstruction avec un nouveau modèle échoue', async () => {
  await writeFile(join(workspace.rootPath, '00.txt'), 'Version initiale');
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  await rag.build(workspace);
  const path = join(dataPath, 'rag', workspace.id, 'manifest.json');
  const previous = await readFile(path, 'utf8');
  for (let i = 1; i < 12; i++)
    await writeFile(join(workspace.rootPath, `${String(i).padStart(2, '0')}.txt`), `Texte ${i}`);
  rag.setConfiguration({ embeddingModel: 'new-model', generationModel: 'test', similarityTopK: 1 });
  failUpdate = true;
  await expect(rag.build(workspace)).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe(previous);
  const manifest = JSON.parse(previous) as { storageName: string };
  expect(
    JSON.parse(
      await readFile(join(dataPath, 'rag', workspace.id, manifest.storageName, 'ids.json'), 'utf8'),
    ),
  ).toHaveLength(1);
});

it('reconstruit un ancien manifeste sans corpus ni raisons d’exclusion', async () => {
  await writeFile(join(workspace.rootPath, 'document.txt'), 'Bonjour');
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  const directory = join(dataPath, 'rag', workspace.id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, documents: [], indexedAt: new Date().toISOString() }),
  );
  expect(await rag.build(workspace)).toMatchObject({ status: 'ready', indexedDocuments: 1 });
});

it('rapporte tous les fichiers exclus avec une raison et persiste le rapport après redémarrage', async () => {
  await writeFile(join(workspace.rootPath, 'lisible.txt'), 'Bonjour');
  await writeFile(join(workspace.rootPath, 'vide.txt'), '');
  await writeFile(join(workspace.rootPath, 'archive.epub'), 'image');
  await writeFile(join(workspace.rootPath, 'invalide.txt'), Buffer.from([0x00, 0xff]));
  await writeFile(join(workspace.rootPath, 'gros.txt'), Buffer.alloc(5 * 1024 * 1024 + 1));
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  await rag.build(workspace);
  const report = IndexReportSchema.parse(await service().report(workspace.id));
  expect(report.totalFiles).toBe(5);
  expect(report.indexedFiles).toEqual(['lisible.txt']);
  expect(report.notIndexed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'vide.txt', code: 'NO_TEXT' }),
      expect.objectContaining({ path: 'archive.epub', code: 'UNSUPPORTED_FORMAT' }),
      expect.objectContaining({ path: 'gros.txt', code: 'FILE_TOO_LARGE' }),
      expect.objectContaining({ path: 'invalide.txt', code: 'INVALID_UTF8' }),
    ]),
  );
});

it('ignore complètement les fichiers temporaires et indexe uniquement les métadonnées des images, même volumineuses', async () => {
  await writeFile(join(workspace.rootPath, 'photo.png'), 'CONTENU_VISUEL_CONFIDENTIEL');
  const large = await open(join(workspace.rootPath, 'grande.jpg'), 'w');
  await large.truncate(51 * 1024 * 1024);
  await large.close();
  await writeFile(
    join(workspace.rootPath, 'ancien.txt'),
    Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]),
  );
  await mkdir(join(workspace.rootPath, 'sous-dossier'));
  for (const name of [
    '~$document.docx',
    '~WRL0005.tmp',
    'récupération.asd',
    'copie.TXT.bak',
    'desktop.ini',
  ])
    await writeFile(join(workspace.rootPath, 'sous-dossier', name), 'À ignorer');
  const build = vi.spyOn(provider, 'build');
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  await rag.build(workspace);
  const documents = build.mock.calls.flatMap(([documents]) => documents);
  expect(documents.find((item) => item.metadata.relativePath === 'ancien.txt')?.text).toBe(
    'café €',
  );
  for (const name of ['photo.png', 'grande.jpg']) {
    const image = documents.find((item) => item.metadata.relativePath === name)!;
    expect(image.text).toContain('Nom : ' + name);
    expect(image.text).toContain('métadonnées uniquement');
    expect(image.text).not.toContain('CONTENU_VISUEL_CONFIDENTIEL');
  }
  const report = IndexReportSchema.parse(await rag.report(workspace.id));
  expect(report.totalFiles).toBe(3);
  expect(report.indexedFiles).toEqual(['ancien.txt', 'grande.jpg', 'photo.png']);
  expect(report.notIndexed).toEqual([]);
  const inventory = await buildSorterInventory(workspace);
  expect(inventory.documents).toHaveLength(3);
  expect(inventory.documents.find((item) => item.name === 'photo.png')?.excerpt).toBeUndefined();
});

it('reconstruit une ancienne politique pour appliquer les nouveaux plafonds', async () => {
  await writeFile(join(workspace.rootPath, 'lisible.txt'), 'Bonjour');
  await writeFile(join(workspace.rootPath, 'ancien.txt'), Buffer.from([0xe9]));
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  await rag.build(workspace);
  const path = join(dataPath, 'rag', workspace.id, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8')) as {
    policyVersion?: number;
    documents: Array<{ relativePath: string }>;
    exclusions: Array<{ path: string; code: string; reason: string }>;
  };
  delete manifest.policyVersion;
  manifest.documents = manifest.documents.filter(
    (item: { relativePath: string }) => item.relativePath === 'lisible.txt',
  );
  manifest.exclusions = [
    { path: 'ancien.txt', code: 'INVALID_UTF8', reason: 'Ancien encodage refusé' },
  ];
  await writeFile(path, JSON.stringify(manifest));
  embeddedPaths.length = 0;
  await writeFile(join(workspace.rootPath, 'image.png'), 'image');
  const restarted = service();
  expect(await restarted.status(workspace)).toMatchObject({ status: 'stale' });
  await restarted.build(workspace);
  expect(embeddedPaths.sort()).toEqual(['ancien.txt', 'image.png', 'lisible.txt']);
  expect((await restarted.report(workspace.id))?.indexedFiles).toEqual([
    'ancien.txt',
    'image.png',
    'lisible.txt',
  ]);
});

it('affiche la progression pendant un lot et permet son interruption puis sa reprise', async () => {
  await writeFile(join(workspace.rootPath, 'document.txt'), 'Bonjour');
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  let entered!: () => void;
  const entering = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = provider.build.bind(provider);
  vi.spyOn(provider, 'build').mockImplementationOnce(async (...args) => {
    entered();
    await gate;
    await original(...args);
  });
  const building = rag.build(workspace);
  const rejection = expect(building).rejects.toMatchObject({ code: 'INDEX_CANCELLED' });
  await entering;
  expect(await rag.status(workspace)).toMatchObject({
    status: 'indexing',
    phase: 'embeddings',
    totalFiles: 1,
    processedFiles: 1,
  });
  const cancelling = rag.cancel(workspace.id);
  release();
  await cancelling;
  await rejection;
  expect(await rag.status(workspace)).toMatchObject({ resumable: true, status: 'error' });
  await rag.build(workspace);
  expect(await rag.status(workspace)).toMatchObject({ status: 'ready', indexedDocuments: 1 });
});

it('signale le plafond de fichiers et produit un rapport même sans texte indexable', async () => {
  await Promise.all(
    Array.from({ length: 301 }, (_, index) =>
      writeFile(join(workspace.rootPath, `${index}.txt`), ''),
    ),
  );
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  await expect(rag.build(workspace)).rejects.toMatchObject({ code: 'INDEX_BUILD_FAILED' });
  const report = IndexReportSchema.parse(await rag.report(workspace.id));
  expect(report.totalFiles).toBe(301);
  expect(report.indexedFiles).toHaveLength(0);
  expect(report.notIndexed).toHaveLength(301);
  expect(report.notIndexed.filter((entry) => entry.code === 'DOCUMENT_LIMIT')).toHaveLength(1);
});

it('indexe un fichier précédemment exclu par le plafond dès qu’une place se libère', async () => {
  await Promise.all(
    Array.from({ length: 301 }, (_, index) =>
      writeFile(
        join(workspace.rootPath, `${String(index).padStart(4, '0')}.txt`),
        index === 1 || index === 300 ? 'Bonjour' : '',
      ),
    ),
  );
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  await rag.build(workspace);
  expect((await rag.report(workspace.id))?.indexedFiles).toEqual(['0001.txt']);
  await rm(join(workspace.rootPath, '0000.txt'));
  await rag.build(workspace);
  expect((await rag.report(workspace.id))?.indexedFiles).toEqual(['0001.txt', '0300.txt']);
  expect(
    (await rag.report(workspace.id))?.notIndexed.some((entry) => entry.code === 'DOCUMENT_LIMIT'),
  ).toBe(false);
}, 15000);

it('borne le texte cumulé, conserve la limite après redémarrage et réessaie les exclusions quand du volume se libère', async () => {
  await writeFile(join(workspace.rootPath, 'a.txt'), 'a'.repeat(1_500_000));
  await writeFile(join(workspace.rootPath, 'b.txt'), 'b'.repeat(1_500_000));
  await writeFile(join(workspace.rootPath, 'c.txt'), 'Texte supplémentaire');
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  await rag.build(workspace);
  expect((await rag.report(workspace.id))?.indexedFiles).toEqual(['a.txt', 'b.txt']);
  expect((await rag.report(workspace.id))?.notIndexed).toContainEqual(
    expect.objectContaining({ path: 'c.txt', code: 'INDEX_TEXT_LIMIT' }),
  );
  await writeFile(join(workspace.rootPath, 'd.txt'), 'Autre texte');
  const restarted = service();
  await restarted.build(workspace);
  expect((await restarted.report(workspace.id))?.indexedFiles).toEqual(['a.txt', 'b.txt']);
  await rm(join(workspace.rootPath, 'a.txt'));
  await restarted.build(workspace);
  expect((await restarted.report(workspace.id))?.indexedFiles).toEqual(['b.txt', 'c.txt', 'd.txt']);
  expect((await restarted.report(workspace.id))?.notIndexed).toEqual([]);
});

it('exclut entièrement les classeurs dépassant les plafonds de feuilles ou de texte', async () => {
  await writeFile(join(workspace.rootPath, 'notes.txt'), 'Bonjour');
  const sheets = XLSX.utils.book_new();
  for (let i = 0; i < 11; i++)
    XLSX.utils.book_append_sheet(sheets, XLSX.utils.aoa_to_sheet([['Texte']]), `Feuille${i}`);
  await writeFile(
    join(workspace.rootPath, 'feuilles.xlsx'),
    XLSX.write(sheets, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  );
  const content = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    content,
    XLSX.utils.aoa_to_sheet(Array.from({ length: 6 }, () => ['x'.repeat(20_000)])),
    'Longue',
  );
  await writeFile(
    join(workspace.rootPath, 'texte.xlsx'),
    XLSX.write(content, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  );
  const rag = service();
  await rag.setEnabled(workspace.id, true);
  await rag.build(workspace);
  expect((await rag.report(workspace.id))?.indexedFiles).toEqual(['notes.txt']);
  expect((await rag.report(workspace.id))?.notIndexed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'feuilles.xlsx', code: 'SHEET_LIMIT' }),
      expect.objectContaining({
        path: 'texte.xlsx',
        code: 'SHEET_TEXT_LIMIT',
        reason: expect.stringContaining('Longue') as unknown,
      }),
    ]),
  );
});

it('bloque le classement au-delà de 200 fichiers tout en les laissant sur disque', async () => {
  await Promise.all(
    Array.from({ length: 201 }, (_, i) =>
      writeFile(join(workspace.rootPath, `${i}.txt`), 'Bonjour'),
    ),
  );
  await expect(buildSorterInventory(workspace)).rejects.toMatchObject({
    code: 'VIRTUAL_TREE_LIMIT_EXCEEDED',
  });
  expect(await readFile(join(workspace.rootPath, '200.txt'), 'utf8')).toBe('Bonjour');
});
