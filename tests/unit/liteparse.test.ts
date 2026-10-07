import { describe, expect, it } from 'vitest';
import { extractPdfPages } from '../../apps/server/src/rag';
import { getPdfPageCount } from '../../apps/server/src/document-text';

function createTextPdf(text: string, pageCount = 1): Buffer {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [3 0 R ${Array.from({ length: pageCount - 1 }, (_, i) => `${i + 6} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let i = 1; i < pageCount; i++) objects.push(objects[2]!);
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

describe('LiteParse local', () => {
  it('compte toutes les pages avant extraction et exclut entièrement un PDF de 101 pages', async () => {
    expect(await getPdfPageCount(createTextPdf('Revenue total: 22000 EUR', 100))).toBe(100);
    await expect(
      extractPdfPages(createTextPdf('Revenue total: 22000 EUR', 101)),
    ).rejects.toMatchObject({
      code: 'PAGE_LIMIT',
      message: expect.stringContaining('101 pages') as unknown,
    });
  });
  it('extrait le texte et le numéro de page sans service distant', async () => {
    const pages = await extractPdfPages(createTextPdf('Revenue total: 22000 EUR'));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 1 });
    expect(pages[0]?.text).toContain('Revenue total: 22000 EUR');
  });
});
