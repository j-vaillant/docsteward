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
} from '@docsteward/filesystem-policy';

describe('filesystem policy', () => {
  it.each(['../secret.md', '/etc/passwd', 'C:\\secret.txt', '\\\\server\\share.txt', 'a\0b.md'])(
    'refuse le chemin %s',
    (path) => {
      expect(() => normalizeRelativePath(path)).toThrow(FsPolicyError);
    },
  );

  it('conserve les chemins relatifs sûrs dans la racine', () => {
    expect(normalizeRelativePath('docs/notes.md')).toBe('docs/notes.md');
    expect(resolveWithinRoot('/tmp/workspace', 'docs/notes.md')).toBe(
      join('/tmp/workspace', 'docs/notes.md'),
    );
  });

  it('calcule un SHA-256 stable', () => {
    expect(sha256('docsteward')).toBe(
      '145f9fcf39a1b5597a134a8a9f320ddfc698cf8b80fb59a39a8551ff016e24e2',
    );
  });

  it('refuse les extensions non autorisées et les liens symboliques', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docsteward-policy-'));
    await writeFile(join(root, 'photo.png'), 'not really a png');
    await expect(readPreviewFile(root, 'photo.png')).rejects.toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
    });
    await writeFile(join(root, 'outside.pdf'), '%PDF-1.4');
    await symlink(join(root, 'outside.pdf'), join(root, 'link.pdf'));
    await expect(readPreviewFile(root, 'link.pdf')).rejects.toMatchObject({
      code: 'SYMLINK_NOT_ALLOWED',
    });
  });

  it('lit les formats de prévisualisation sans modifier le fichier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docsteward-preview-'));
    await writeFile(join(root, 'rapport.pdf'), '%PDF-1.4\naperçu');
    const preview = await readPreviewFile(root, 'rapport.pdf');
    expect(preview.bytes.toString('utf8')).toContain('%PDF-1.4');
    expect(preview.sha256).toBe(sha256(preview.bytes));
  });
});
