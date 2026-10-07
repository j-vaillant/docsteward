import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

export type ReleaseType = 'patch' | 'minor' | 'major';

export const VERSION_NOTES_PATH = 'version.md';
export const CHANGELOG_PATH = 'changelog.md';
export const VERSION_NOTES_TEMPLATE = `<!--
Décrivez ici les changements destinés à la prochaine release.
Ce contenu sera déplacé dans changelog.md par une commande make:prod:patch|minor|major.
-->
`;

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function run(command: string, args: string[], inherit = false): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });

  if (result.error) throw result.error;

  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function runOrThrow(command: string, args: string[], inherit = false): CommandResult {
  const result = run(command, args, inherit);
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout).trim();
    throw new Error(`${command} ${args.join(' ')} a échoué${details ? ` : ${details}` : '.'}`);
  }
  return result;
}

export function parseReleaseType(value: string | undefined): ReleaseType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'patch' || normalized === 'minor' || normalized === 'major') {
    return normalized;
  }
  throw new Error('RELEASE_TYPE doit valoir patch, minor ou major.');
}

export function bumpVersion(version: string, releaseType: ReleaseType): string {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) throw new Error(`La version ${version} n'est pas un semver stable x.y.z.`);

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (releaseType === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (releaseType === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

export function hasReleaseNotes(markdown: string): boolean {
  return markdown.replace(/<!--[\s\S]*?-->/g, '').trim().length > 0;
}

export function mergeReleaseNotes(
  changelog: string | undefined,
  notes: string,
  version: string,
  date: string,
): string {
  const section = `## ${version} - ${date}\n\n${notes.trim()}\n`;
  const current = changelog?.trim();

  if (!current) return `# Changelog\n\n${section}`;
  if (current.startsWith('# Changelog')) {
    const remainder = current.slice('# Changelog'.length).trim();
    return `# Changelog\n\n${section}${remainder ? `\n${remainder}\n` : ''}`;
  }
  return `# Changelog\n\n${section}\n${current}\n`;
}

function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assertReleaseWorkingTree(): void {
  const status = runOrThrow('git', [
    'status',
    '--porcelain',
    '--untracked-files=all',
  ]).stdout.trimEnd();
  const unexpected = status
    .split('\n')
    .filter(Boolean)
    .filter((line) => line.slice(3).replaceAll('\\', '/') !== VERSION_NOTES_PATH);

  if (unexpected.length > 0) {
    throw new Error(
      `Le dépôt doit être propre avant une release, à l'exception de ${VERSION_NOTES_PATH}.\n${unexpected.join('\n')}`,
    );
  }
}

function assertTagIsAvailable(tag: string): void {
  const local = run('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`]);
  if (local.status === 0) throw new Error(`Le tag local ${tag} existe déjà.`);
  if (local.status !== 1)
    throw new Error(local.stderr || `Impossible de vérifier le tag local ${tag}.`);

  const remote = run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remote.status === 0) throw new Error(`Le tag ${tag} existe déjà sur origin.`);
  if (remote.status !== 2) {
    throw new Error(remote.stderr || `Impossible de vérifier le tag ${tag} sur origin.`);
  }
}

export type PreparedRelease = {
  branch: string;
  tag: string;
  version: string;
};

export function prepareRelease(releaseType: ReleaseType): PreparedRelease {
  runOrThrow('git', ['rev-parse', '--is-inside-work-tree']);
  runOrThrow('git', ['remote', 'get-url', 'origin']);
  const branch = runOrThrow('git', ['branch', '--show-current']).stdout.trim();
  if (!branch) throw new Error('Une release ne peut pas être préparée depuis un HEAD détaché.');

  assertReleaseWorkingTree();

  const notes = readFileSync(VERSION_NOTES_PATH, 'utf8');
  if (!hasReleaseNotes(notes)) {
    throw new Error(`${VERSION_NOTES_PATH} ne contient aucune note de release.`);
  }

  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string };
  if (!packageJson.version) throw new Error('package.json ne contient aucune version.');

  const version = bumpVersion(packageJson.version, releaseType);
  const tag = `v${version}`;
  assertTagIsAvailable(tag);

  const npmCli =
    process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  runOrThrow(process.execPath, [npmCli, 'version', version, '--no-git-tag-version'], true);

  let changelog: string | undefined;
  try {
    changelog = readFileSync(CHANGELOG_PATH, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  writeFileSync(CHANGELOG_PATH, mergeReleaseNotes(changelog, notes, version, today()));
  writeFileSync(VERSION_NOTES_PATH, VERSION_NOTES_TEMPLATE);

  return { branch, tag, version };
}

export function publishRelease(release: PreparedRelease): void {
  runOrThrow('git', [
    'add',
    '--',
    'package.json',
    'package-lock.json',
    VERSION_NOTES_PATH,
    CHANGELOG_PATH,
  ]);
  runOrThrow('git', ['commit', '-m', `release: ${release.tag}`], true);
  runOrThrow('git', ['tag', '--annotate', release.tag, '--message', `Release ${release.tag}`]);

  const pushed = run('git', [
    'push',
    '--atomic',
    'origin',
    `HEAD:refs/heads/${release.branch}`,
    `refs/tags/${release.tag}`,
  ]);
  if (pushed.status !== 0) {
    throw new Error(
      `Le commit et le tag ${release.tag} existent localement, mais le push atomique a échoué. ` +
        `Corrigez l'accès à origin puis relancez : git push --atomic origin ` +
        `HEAD:refs/heads/${release.branch} refs/tags/${release.tag}\n${pushed.stderr.trim()}`,
    );
  }
}
