import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAuthSessionStore,
  type SavedAuthSession,
} from '../../apps/desktop/src/main/auth-session';

const temporaryDirectories: string[] = [];
const key = randomBytes(32);
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString(value: string) {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final()]);
  },
  decryptString(value: Buffer) {
    const decipher = createDecipheriv('aes-256-cbc', key, value.subarray(0, 16));
    return Buffer.concat([decipher.update(value.subarray(16)), decipher.final()]).toString('utf8');
  },
};
const saved: SavedAuthSession = {
  schemaVersion: 1,
  apiUrl: 'https://example.test/docsteward',
  accessToken: 'opaque-access-token',
  account: {
    id: '00000000-0000-4000-8000-000000000099',
    email: 'account@example.test',
    activationDate: new Date(0).toISOString(),
    apiAvailable: true,
  },
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'docsteward-auth-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'auth-session.enc');
  return { path, store: createAuthSessionStore(path, encryption) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('session persistée', () => {
  it('restaure la session depuis une nouvelle instance sans stocker le jeton en clair', async () => {
    const { path, store } = await fixture();
    expect(await store.load(saved.apiUrl)).toBeUndefined();
    expect(await store.save(saved)).toBe(true);
    const bytes = await readFile(path);
    expect(bytes.includes(saved.accessToken)).toBe(false);
    expect(bytes.includes(saved.account.email)).toBe(false);
    expect(await createAuthSessionStore(path, encryption).load(saved.apiUrl)).toEqual(saved);
    await store.save({ ...saved, accessToken: 'replacement-token' });
    expect((await store.load(saved.apiUrl))?.accessToken).toBe('replacement-token');
  });

  it('supprime la session à la déconnexion', async () => {
    const { path, store } = await fixture();
    await store.save(saved);
    await store.clear();
    await store.clear();
    expect(await createAuthSessionStore(path, encryption).load(saved.apiUrl)).toBeUndefined();
  });

  it('refuse une session provenant d’un autre service', async () => {
    const { path, store } = await fixture();
    await store.save(saved);
    expect(await store.load('https://other.test')).toBeUndefined();
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restaure un JWT valide et supprime un JWT expiré', async () => {
    const { path, store } = await fixture();
    const token = (exp: number) =>
      `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
    await store.save({ ...saved, accessToken: token(Date.now() / 1000 + 3600) });
    expect(await store.load(saved.apiUrl)).toBeDefined();
    await store.save({ ...saved, accessToken: token(Date.now() / 1000 - 1) });
    expect(await store.load(saved.apiUrl)).toBeUndefined();
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('revient à la connexion si le fichier est corrompu ou indéchiffrable', async () => {
    const { path, store } = await fixture();
    await writeFile(path, 'broken');
    expect(await store.load(saved.apiUrl)).toBeUndefined();
    await writeFile(path, encryption.encryptString('{"schemaVersion":99}'));
    expect(await store.load(saved.apiUrl)).toBeUndefined();
  });

  it('ne sauvegarde aucun secret sans chiffrement système', async () => {
    const { path, store } = await fixture();
    await store.save(saved);
    const unavailable = createAuthSessionStore(path, {
      ...encryption,
      isEncryptionAvailable: () => false,
    });
    expect(await unavailable.load(saved.apiUrl)).toBeUndefined();
    expect(await unavailable.save(saved)).toBe(false);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
