import { describe, expect, it } from 'vitest';
import { parseChangelog } from '../../apps/renderer/src/changelog';

describe('changelog', () => {
  it('extrait les versions de la plus récente à la plus ancienne et ignore les commentaires', () => {
    expect(
      parseChangelog(`# Changelog

## 1.2.0 - 2026-10-06

<!-- consigne interne -->
- Nouvelle recherche
- Navigation améliorée

## 1.1.0 - 2026-09-01

Première version publique
`),
    ).toEqual([
      {
        version: '1.2.0',
        date: '2026-10-06',
        notes: ['Nouvelle recherche', 'Navigation améliorée'],
      },
      {
        version: '1.1.0',
        date: '2026-09-01',
        notes: ['Première version publique'],
      },
    ]);
  });
});
