import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FsPolicyError,
  normalizeRelativePath,
  readPreviewFile,
  resolveWithinRoot,
  sha256,
  listDirectory,
  decodeDocumentText,
} from '@docsteward/filesystem-policy';

describe('filesystem policy', () => {
  it.each(['../secret.md', '/etc/passwd', 'C:\\secret.txt', '\\\\server\\share.txt', 'a\0b.md'])(
    'refuse le chemin %s',
    (path) => {
      expect(() => normalizeRelativePath(path)).toThrow(FsPolicyError);
    },
  );

  it('conserve les chemins relatifs sûrs dans la racine', () => {
    const root = join(tmpdir(), 'workspace');
    expect(normalizeRelativePath('docs/notes.md')).toBe('docs/notes.md');
    expect(resolveWithinRoot(root, 'docs/notes.md')).toBe(join(root, 'docs/notes.md'));
  });

  it('calcule un SHA-256 stable', () => {
    expect(sha256('docsteward')).toBe(
      '145f9fcf39a1b5597a134a8a9f320ddfc698cf8b80fb59a39a8551ff016e24e2',
    );
  });

  it('refuse les extensions non autorisées et les liens symboliques', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docsteward-policy-'));
    await writeFile(join(root, 'archive.epub'), 'not supported');
    await expect(readPreviewFile(root, 'archive.epub')).rejects.toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
    });
    const outside = await mkdtemp(join(tmpdir(), 'docsteward-outside-'));
    await writeFile(join(outside, 'outside.pdf'), '%PDF-1.4');
    await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readPreviewFile(root, 'link/outside.pdf')).rejects.toMatchObject({
      code: 'SYMLINK_NOT_ALLOWED',
    });
  });

  it('ignore les fichiers temporaires dans le listing et refuse leur lecture directe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docsteward-temporary-'));
    for (const name of [
      '~$contrat.docx',
      '~WRL0005.tmp',
      'copie.TXT.bak',
      'recuperation.asd',
      'contrat.txt',
    ])
      await writeFile(join(root, name), 'Bonjour');
    expect((await listDirectory(root)).map((entry) => entry.name)).toEqual(['contrat.txt']);
    await expect(readPreviewFile(root, '~$contrat.docx')).rejects.toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
    });
  });

  it('décode les textes Windows sans modifier leur contenu et refuse les données binaires', () => {
    expect(decodeDocumentText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]))).toBe('café €');
    expect(
      decodeDocumentText(
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Contrat été', 'utf16le')]),
      ),
    ).toBe('Contrat été');
    expect(decodeDocumentText(Buffer.from([0xfe, 0xff, 0x00, 0xe9]))).toBe('é');
    expect(decodeDocumentText(Buffer.from('Été', 'utf8'))).toBe('Été');
    expect(() => decodeDocumentText(Buffer.from([0x00, 0xff]))).toThrow(FsPolicyError);
  });

  it('lit les formats de prévisualisation sans modifier le fichier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docsteward-preview-'));
    await writeFile(join(root, 'rapport.pdf'), '%PDF-1.4\naperçu');
    const preview = await readPreviewFile(root, 'rapport.pdf');
    expect(preview.bytes.toString('utf8')).toContain('%PDF-1.4');
    expect(preview.sha256).toBe(sha256(preview.bytes));
  });
});
