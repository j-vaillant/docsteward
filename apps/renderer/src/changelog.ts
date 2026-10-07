export type ChangelogRelease = {
  version: string;
  date: string;
  notes: string[];
};

const RELEASE_HEADING = /^##\s+(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/;

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | undefined;

  for (const rawLine of withoutComments.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      current = { version: heading[1] ?? '', date: heading[2] ?? '', notes: [] };
      releases.push(current);
      continue;
    }
    if (!current || !line || line.startsWith('#')) continue;
    current.notes.push(line.replace(/^[-*]\s+/, ''));
  }

  return releases;
}
