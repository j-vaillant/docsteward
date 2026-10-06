import { describe, expect, it } from 'vitest';
import { redactLogValue } from '../../apps/server/src/logger';

describe('log redaction', () => {
  it('masque les tokens et les chemins utilisateur', () => {
    const result = redactLogValue('Bearer secret-token /Users/alice/Documents/notes.md');
    expect(result).not.toContain('secret-token');
    expect(result).not.toContain('/Users/alice');
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('[PATH]');
  });
});
