import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const SessionSchema = z.object({
  schemaVersion: z.literal(1),
  apiUrl: z.string().min(1),
  accessToken: z.string().min(1),
  account: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    activationDate: z.string().min(1),
    apiAvailable: z.boolean(),
  }),
});

export type SavedAuthSession = z.infer<typeof SessionSchema>;

type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

function tokenExpired(token: string): boolean {
  const segments = token.split('.');
  if (segments.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8'));
    const claims = z.object({ exp: z.number().finite().optional() }).parse(payload);
    return claims.exp !== undefined && claims.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

// Only the main process can read this file; no passwords are stored.
export function createAuthSessionStore(path: string, encryption: Encryption) {
  const clear = () => rm(path, { force: true });
  return {
    clear,
    async save(session: SavedAuthSession): Promise<boolean> {
      if (!encryption.isEncryptionAvailable()) {
        await clear();
        return false;
      }
      const encrypted = encryption.encryptString(JSON.stringify(SessionSchema.parse(session)));
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encrypted, { mode: 0o600 });
        await rename(temporary, path);
        await chmod(path, 0o600).catch(() => undefined);
      } finally {
        await rm(temporary, { force: true });
      }
      return true;
    },
    async load(apiUrl: string): Promise<SavedAuthSession | undefined> {
      if (!encryption.isEncryptionAvailable()) return undefined;
      let encrypted: Buffer;
      try {
        encrypted = await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      let session: SavedAuthSession;
      try {
        session = SessionSchema.parse(JSON.parse(encryption.decryptString(encrypted)));
      } catch {
        await clear();
        return undefined;
      }
      if (session.apiUrl !== apiUrl || tokenExpired(session.accessToken)) {
        await clear();
        return undefined;
      }
      return session;
    },
  };
}
