import { mkdir, open, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_LOG_BYTES = 1_000_000;

export function redactLogValue(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/([A-Za-z]:\\|\/Users\/|\/home\/)[^\s"']+/g, '[PATH]');
}

export type SafeLogger = {
  info(event: string, fields?: Record<string, string | number | boolean>): Promise<void>;
  error(event: string, fields?: Record<string, string | number | boolean>): Promise<void>;
};

export async function createSafeLogger(logDirectory: string, name: string): Promise<SafeLogger> {
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const logPath = join(logDirectory, `${name}.log`);

  async function write(
    level: 'info' | 'error',
    event: string,
    fields: Record<string, string | number | boolean> = {},
  ): Promise<void> {
    try {
      const current = await stat(logPath).catch(() => undefined);
      if (current && current.size >= MAX_LOG_BYTES) {
        await rename(logPath, `${logPath}.1`).catch(() => undefined);
      }
      const safeFields = Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          typeof value === 'string' ? redactLogValue(value) : value,
        ]),
      );
      const handle = await open(logPath, 'a', 0o600);
      await handle.appendFile(
        `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safeFields })}\n`,
      );
      await handle.close();
    } catch {
      // Logging must never crash the local server.
    }
  }

  return {
    info: (event, fields) => write('info', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
