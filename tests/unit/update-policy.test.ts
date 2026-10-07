import { describe, expect, it } from 'vitest';
import { compareVersions, selectAvailableUpdate } from '../../apps/desktop/src/main/update-policy';

function build(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.2.0',
    os: 'mac',
    type: 'package',
    fileName: 'DocSteward-darwin-arm64-1.2.0.zip',
    downloadUrl: 'https://example.test/DocSteward-darwin-arm64-1.2.0.zip',
    size: 1234,
    uploadedAt: '2026-10-07T08:00:00.000Z',
    ...overrides,
  };
}

describe('update policy', () => {
  it('compare les versions stables et préversions', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0-beta.2', '1.2.0-beta.1')).toBeGreaterThan(0);
  });

  it('sélectionne uniquement le package plus récent de la plateforme', () => {
    const selected = selectAvailableUpdate(
      {
        data: [
          build({ version: '1.1.0' }),
          build({ type: 'installer', version: '2.0.0', fileName: 'DocSteward.dmg' }),
          build({ os: 'windows', version: '3.0.0', fileName: 'docsteward-3.0.0-full.nupkg' }),
          build({ version: '1.3.0', fileName: 'DocSteward-darwin-arm64-1.3.0.zip' }),
        ],
      },
      'mac',
      '1.2.0',
    );
    expect(selected?.version).toBe('1.3.0');
  });

  it('ignore une version courante, un protocole non sûr et un mauvais format', () => {
    expect(selectAvailableUpdate({ data: [build()] }, 'mac', '1.2.0')).toBeNull();
    expect(
      selectAvailableUpdate(
        { data: [build({ downloadUrl: 'http://example.test/update.zip' })] },
        'mac',
        '1.0.0',
      ),
    ).toBeNull();
    expect(
      selectAvailableUpdate({ data: [build({ fileName: 'DocSteward.dmg' })] }, 'mac', '1.0.0'),
    ).toBeNull();
  });

  it('accepte le package Squirrel Windows au format nupkg', () => {
    const selected = selectAvailableUpdate(
      {
        data: [
          build({
            version: '1.2.1',
            os: 'windows',
            fileName: 'docsteward-1.2.1-full.nupkg',
            downloadUrl: 'https://example.test/docsteward-1.2.1-full.nupkg',
          }),
        ],
      },
      'windows',
      '1.2.0',
    );
    expect(selected?.fileName).toBe('docsteward-1.2.1-full.nupkg');
  });
});
