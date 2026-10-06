import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import {
  ALLOWED_PREVIEW_EXTENSIONS,
  MAX_PREVIEW_BYTES,
  MAX_TEXT_BYTES,
  type FileEntry,
} from '@docsteward/contracts';

export type FsErrorCode =
  | 'INVALID_REQUEST'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'SYMLINK_NOT_ALLOWED'
  | 'FILE_NOT_FOUND'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'FILE_TOO_LARGE'
  | 'INVALID_UTF8'
  | 'FS_PERMISSION_DENIED'
  | 'FS_IO_ERROR';

export class FsPolicyError extends Error {
  constructor(
    public readonly code: FsErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'FsPolicyError';
  }
}

const allowedExtensions = new Set<string>(ALLOWED_PREVIEW_EXTENSIONS);

function invalidPath(message: string): never {
  throw new FsPolicyError('PATH_OUTSIDE_WORKSPACE', message, 400);
}

export function normalizeRelativePath(input: string, allowRoot = false): string {
  if (input.includes('\0')) invalidPath('Le chemin contient un caractère interdit.');
  if (input === '' && allowRoot) return '';
  if (input.trim() === '') invalidPath('Le chemin relatif est requis.');
  if (isAbsolute(input) || win32.isAbsolute(input) || /^[a-zA-Z]:/.test(input)) {
    invalidPath('Les chemins absolus ne sont pas autorisés.');
  }
  if (input.startsWith('\\\\') || input.startsWith('//') || input.includes('\\')) {
    invalidPath('Le format de chemin n’est pas autorisé.');
  }
  const parts = input.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    invalidPath('Le chemin contient un segment interdit.');
  }
  return parts.join('/');
}

export function resolveWithinRoot(rootPath: string, input: string, allowRoot = false): string {
  const safeRelative = normalizeRelativePath(input, allowRoot);
  const root = resolve(rootPath);
  const target = resolve(root, safeRelative);
  const fromRoot = relative(root, target);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    invalidPath('Le chemin sort de l’espace de travail.');
  }
  return target;
}

async function assertNoSymlink(rootPath: string, relativePath: string): Promise<void> {
  const safeRelative = normalizeRelativePath(relativePath, true);
  let cursor = resolve(rootPath);
  if (safeRelative === '') return;
  for (const part of safeRelative.split('/')) {
    cursor = join(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        throw new FsPolicyError(
          'SYMLINK_NOT_ALLOWED',
          'Les liens symboliques ne sont pas autorisés.',
          403,
        );
      }
    } catch (error) {
      if (error instanceof FsPolicyError) throw error;
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw mapSystemError(error);
    }
  }
}

function assertPreviewExtension(relativePath: string): void {
  if (!allowedExtensions.has(extname(relativePath).toLowerCase())) {
    throw new FsPolicyError(
      'FILE_TYPE_NOT_ALLOWED',
      'Ce type de fichier ne peut pas être prévisualisé.',
      415,
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function mapSystemError(error: unknown): FsPolicyError {
  if (error instanceof FsPolicyError) return error;
  if (isNodeError(error) && error.code === 'ENOENT') {
    return new FsPolicyError('FILE_NOT_FOUND', 'Le fichier demandé est introuvable.', 404);
  }
  if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
    return new FsPolicyError('FS_PERMISSION_DENIED', 'Le système a refusé l’accès.', 403);
  }
  return new FsPolicyError('FS_IO_ERROR', 'Une erreur de lecture ou d’écriture est survenue.', 500);
}

export function sha256(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function listDirectory(rootPath: string, path = ''): Promise<FileEntry[]> {
  const target = resolveWithinRoot(rootPath, path, true);
  await assertNoSymlink(rootPath, path);
  try {
    const entries = await readdir(target, { withFileTypes: true });
    const result = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map(async (entry): Promise<FileEntry> => {
          const childRelative = path ? `${path}/${entry.name}` : entry.name;
          const childPath = resolveWithinRoot(rootPath, childRelative);
          const info = await lstat(childPath);
          if (info.isSymbolicLink()) {
            return {
              name: entry.name,
              path: childRelative,
              type: 'file',
              size: info.size,
              modifiedAt: info.mtime.toISOString(),
            };
          }
          return {
            name: entry.name,
            path: childRelative,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
          };
        }),
    );
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
  } catch (error) {
    throw mapSystemError(error);
  }
}

export type PreviewFile = {
  bytes: Buffer;
  sha256: string;
  size: number;
  modifiedAt: string;
};

export async function readPreviewFile(
  rootPath: string,
  relativePath: string,
): Promise<PreviewFile> {
  assertPreviewExtension(relativePath);
  const target = resolveWithinRoot(rootPath, relativePath);
  await assertNoSymlink(rootPath, relativePath);
  try {
    const info = await stat(target);
    if (!info.isFile()) {
      throw new FsPolicyError('FILE_NOT_FOUND', 'Le fichier demandé est introuvable.', 404);
    }
    const limit = allowedTextExtensions.has(extname(relativePath).toLowerCase())
      ? MAX_TEXT_BYTES
      : MAX_PREVIEW_BYTES;
    if (info.size > limit) {
      throw new FsPolicyError(
        'FILE_TOO_LARGE',
        `Le fichier dépasse la limite de ${limit / (1024 * 1024)} Mio.`,
        413,
      );
    }
    const bytes = await readFile(target);
    return {
      bytes,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      modifiedAt: info.mtime.toISOString(),
    };
  } catch (error) {
    throw mapSystemError(error);
  }
}

const allowedTextExtensions = new Set<string>([
  '.txt',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.html',
]);
