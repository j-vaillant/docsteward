import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SorterError,
  buildSorterInventory,
  identityTree,
  normalizeVirtualPath,
  proposalTree,
  summarize,
  type SorterInventory,
} from '../../apps/server/src/sorter';

function createTextPdf(text: string): Buffer {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

const workspaceId = '00000000-0000-4000-8000-000000000001';
const inventory: SorterInventory = {
  fingerprint: 'f'.repeat(64),
  documents: [
    {
      documentId: 'doc-1',
      relativePath: 'Factures/facture-acme.pdf',
      name: 'facture-acme.pdf',
      extension: '.pdf',
      size: 120,
      modifiedAt: '2026-10-06T08:00:00.000Z',
      sha256: 'a'.repeat(64),
    },
    {
      documentId: 'doc-2',
      relativePath: 'notes.md',
      name: 'notes.md',
      extension: '.md',
      size: 20,
      modifiedAt: '2026-10-06T08:00:00.000Z',
      sha256: 'b'.repeat(64),
      excerpt: 'Notes',
    },
  ],
};

describe('virtual tree', () => {
  it('transmet au classement le texte extrait des factures PDF', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'docsteward-sorter-'));
    await writeFile(join(rootPath, 'facture.pdf'), createTextPdf('Date de facture : 15/09/2026'));

    const result = await buildSorterInventory({
      id: workspaceId,
      displayName: 'Démo',
      rootPath,
      access: 'read-only',
    });

    expect(result.documents[0]?.excerpt).toContain('Date de facture : 15/09/2026');
  });

  it('génère un mapping identitaire exhaustif', () => {
    const tree = identityTree(workspaceId, inventory);
    expect(tree.status).toBe('identity');
    expect(tree.entries).toHaveLength(2);
    expect(tree.entries.every((entry) => entry.virtualPath === entry.physicalRelativePath)).toBe(
      true,
    );
    expect(tree.summary).toEqual({
      documents: 2,
      groups: 1,
      mapped: 0,
      identity: 2,
      unclassified: 0,
    });
  });

  it('normalise en NFC et refuse les chemins non portables', () => {
    expect(normalizeVirtualPath('Clients/Cafe\u0301/contrat.pdf')).toBe('Clients/Café/contrat.pdf');
    for (const path of ['/secret.pdf', '../secret.pdf', 'Clients\\secret.pdf', 'CON/file.pdf']) {
      expect(() => normalizeVirtualPath(path)).toThrowError(SorterError);
    }
  });

  it('applique le repli à classer sans faire disparaître un document', () => {
    const tree = proposalTree(workspaceId, 'Classe les factures par fournisseur.', inventory, {
      rules: [
        {
          id: 'invoice',
          order: 0,
          title: 'Factures par fournisseur',
          description: 'Regroupe les factures sous le fournisseur reconnu.',
          targetPattern: 'factures',
          fallback: false,
        },
      ],
      assignments: [
        {
          documentId: 'doc-1',
          virtualPath: 'Factures/Acme/facture-acme.pdf',
          ruleId: 'invoice',
          reason: 'Le fournisseur Acme figure dans le nom.',
        },
      ],
    });
    expect(tree.entries).toHaveLength(2);
    expect(tree.entries.find((entry) => entry.documentId === 'doc-2')).toMatchObject({
      virtualPath: 'notes.md',
      status: 'unclassified',
    });
    expect(summarize(tree.entries)).toMatchObject({ mapped: 1, unclassified: 1 });
  });

  it('bloque les collisions sans tenir compte de la casse', () => {
    expect(() =>
      proposalTree(workspaceId, 'Regroupe tous les documents ensemble.', inventory, {
        rules: [
          {
            id: 'all',
            order: 0,
            title: 'Tous ensemble',
            description: 'Regroupe les documents.',
            targetPattern: 'tous',
            fallback: false,
          },
        ],
        assignments: [
          {
            documentId: 'doc-1',
            virtualPath: 'Groupe/DOCUMENT.pdf',
            ruleId: 'all',
            reason: 'Règle commune.',
          },
          {
            documentId: 'doc-2',
            virtualPath: 'groupe/document.pdf',
            ruleId: 'all',
            reason: 'Règle commune.',
          },
        ],
      }),
    ).toThrowError(/même chemin virtuel/i);
  });

  it('rejette les identifiants inventés par le fournisseur', () => {
    expect(() =>
      proposalTree(workspaceId, 'Classe les documents selon leur sujet.', inventory, {
        rules: [],
        assignments: [
          {
            documentId: 'unknown',
            virtualPath: 'Divers/inconnu.pdf',
            ruleId: null,
            reason: 'Inconnu.',
          },
        ],
      }),
    ).toThrowError(/inconnu ou dupliqué/i);
  });
});
