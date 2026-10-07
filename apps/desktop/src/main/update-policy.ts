export const MAX_UPDATE_PACKAGE_SIZE = 1024 * 1024 * 1024;

export type UpdatePlatform = 'windows' | 'mac';

export type UpdatePackage = {
  version: string;
  platform: UpdatePlatform;
  fileName: string;
  downloadUrl: string;
  size: number;
  uploadedAt: string;
};

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parsedVersion(value: string) {
  const match = SEMVER_PATTERN.exec(value);
  if (!match) return null;
  return {
    main: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parsedVersion(left);
  const b = parsedVersion(right);
  if (!a || !b) return left.localeCompare(right);

  for (let index = 0; index < 3; index += 1) {
    const difference = a.main[index]! - b.main[index]!;
    if (difference !== 0) return difference;
  }

  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return Number(leftIdentifier) - Number(rightIdentifier);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier.localeCompare(rightIdentifier);
  }
  return 0;
}

function isSafePackageFileName(value: string, platform: UpdatePlatform): boolean {
  if (!/^[0-9A-Za-z._-]{1,140}$/.test(value)) return false;
  return platform === 'mac'
    ? value.toLowerCase().endsWith('.zip')
    : value.toLowerCase().endsWith('.nupkg');
}

function parsePackage(value: unknown, platform: UpdatePlatform): UpdatePackage | null {
  if (!value || typeof value !== 'object') return null;
  const build = value as Record<string, unknown>;
  if (
    build.type !== 'package' ||
    build.os !== platform ||
    typeof build.version !== 'string' ||
    !SEMVER_PATTERN.test(build.version) ||
    typeof build.fileName !== 'string' ||
    !isSafePackageFileName(build.fileName, platform) ||
    typeof build.downloadUrl !== 'string' ||
    typeof build.size !== 'number' ||
    !Number.isSafeInteger(build.size) ||
    build.size <= 0 ||
    build.size > MAX_UPDATE_PACKAGE_SIZE ||
    typeof build.uploadedAt !== 'string' ||
    Number.isNaN(Date.parse(build.uploadedAt))
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(build.downloadUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  return {
    version: build.version,
    platform,
    fileName: build.fileName,
    downloadUrl: url.toString(),
    size: build.size,
    uploadedAt: build.uploadedAt,
  };
}

export function selectAvailableUpdate(
  payload: unknown,
  platform: UpdatePlatform,
  currentVersion: string,
): UpdatePackage | null {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;

  const packages = data
    .map((value) => parsePackage(value, platform))
    .filter((value): value is UpdatePackage => value !== null)
    .sort(
      (left, right) =>
        compareVersions(right.version, left.version) ||
        Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt),
    );

  const latest = packages[0];
  return latest && compareVersions(latest.version, currentVersion) > 0 ? latest : null;
}
