import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  hasReleaseNotes,
  mergeReleaseNotes,
  parseReleaseType,
  prepareRelease,
  publishRelease,
  VERSION_NOTES_TEMPLATE,
} from '../../scripts/release.mts';

describe('release helpers', () => {
  it.each([
    ['patch', '1.2.4'],
    ['minor', '1.3.0'],
    ['major', '2.0.0'],
  ] as const)('calcule une version %s', (releaseType, expected) => {
    expect(bumpVersion('1.2.3', releaseType)).toBe(expected);
  });

  it('refuse les versions non stables', () => {
    expect(() => bumpVersion('1.2.3-beta.1', 'patch')).toThrow('semver stable');
  });

  it('valide le type de release fourni par cross-env', () => {
    expect(parseReleaseType(' MINOR ')).toBe('minor');
    expect(parseReleaseType(undefined)).toBeUndefined();
    expect(() => parseReleaseType('feature')).toThrow('patch, minor ou major');
  });

  it('ne considère pas le modèle vide comme une note de release', () => {
    expect(hasReleaseNotes(VERSION_NOTES_TEMPLATE)).toBe(false);
    expect(hasReleaseNotes(`${VERSION_NOTES_TEMPLATE}\n- Correction importante`)).toBe(true);
  });

  it('place la nouvelle version en tête du changelog', () => {
    expect(
      mergeReleaseNotes(
        '# Changelog\n\n## 1.0.0 - 2026-01-01\n\n- Initiale\n',
        '- Correctif',
        '1.0.1',
        '2026-10-06',
      ),
    ).toBe(
      '# Changelog\n\n## 1.0.1 - 2026-10-06\n\n- Correctif\n\n## 1.0.0 - 2026-01-01\n\n- Initiale\n',
    );
  });

  it('crée et pousse atomiquement le commit et le tag de release', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'docsteward-release-'));
    const repository = join(fixtureRoot, 'repository');
    const remote = join(fixtureRoot, 'origin.git');
    const previousDirectory = process.cwd();

    try {
      execFileSync('git', ['init', '--bare', remote]);
      execFileSync('git', ['init', '--initial-branch=main', repository]);
      execFileSync('git', ['config', 'user.email', 'release-test@example.com'], {
        cwd: repository,
      });
      execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: repository });
      execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repository });

      writeFileSync(
        join(repository, 'package.json'),
        `${JSON.stringify({ name: 'release-fixture', version: '1.2.3', private: true }, null, 2)}\n`,
      );
      writeFileSync(
        join(repository, 'package-lock.json'),
        `${JSON.stringify(
          {
            name: 'release-fixture',
            version: '1.2.3',
            lockfileVersion: 3,
            requires: true,
            packages: { '': { name: 'release-fixture', version: '1.2.3' } },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(join(repository, 'version.md'), VERSION_NOTES_TEMPLATE);
      writeFileSync(join(repository, 'changelog.md'), '# Changelog\n');
      execFileSync('git', ['add', '.'], { cwd: repository });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: repository });
      execFileSync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: repository });

      writeFileSync(join(repository, 'version.md'), '- Corrige la prévisualisation Windows.\n');
      process.chdir(repository);

      const release = prepareRelease('patch');
      expect(release).toMatchObject({ branch: 'main', tag: 'v1.2.4', version: '1.2.4' });
      publishRelease(release);

      const releasedPackage = JSON.parse(readFileSync('package.json', 'utf8')) as {
        version: string;
      };
      expect(releasedPackage.version).toBe('1.2.4');
      expect(readFileSync('changelog.md', 'utf8')).toContain('## 1.2.4 -');
      expect(readFileSync('version.md', 'utf8')).toBe(VERSION_NOTES_TEMPLATE);
      expect(execFileSync('git', ['tag', '--list', 'v1.2.4'], { encoding: 'utf8' }).trim()).toBe(
        'v1.2.4',
      );
      expect(
        execFileSync('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v1.2.4'], {
          encoding: 'utf8',
        }),
      ).toContain('refs/tags/v1.2.4');
    } finally {
      process.chdir(previousDirectory);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
