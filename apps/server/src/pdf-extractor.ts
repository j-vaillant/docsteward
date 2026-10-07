import { LiteParse } from '@llamaindex/liteparse';
import { PRODUCT_LIMITS } from '@docsteward/contracts';
import { DocumentLimitError } from './product-limits';

const pdfInspector = new LiteParse({
  ocrEnabled: false,
  maxPages: 1,
  imageMode: 'off',
  quiet: true,
});

export async function getPdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await pdfInspector.parse(bytes)).totalPages;
}

const pdfParser = new LiteParse({
  outputFormat: 'markdown',
  imageMode: 'off',
  extractLinks: false,
  ocrEnabled: true,
  ocrLanguage: 'fra+eng',
  continueOnPageError: true,
  ocrFailureFatal: false,
  maxPages: PRODUCT_LIMITS.pdfPages,
  numWorkers: 1,
  quiet: true,
});

export async function parsePdfPages(
  bytes: Uint8Array,
): Promise<Array<{ page: number; text: string }>> {
  const totalPages = await getPdfPageCount(bytes);
  if (totalPages > PRODUCT_LIMITS.pdfPages)
    throw new DocumentLimitError(
      'PAGE_LIMIT',
      `PDF non indexé : ${totalPages} pages, maximum ${PRODUCT_LIMITS.pdfPages}.`,
    );
  const result = await pdfParser.parse(bytes);
  if (result.totalPages > PRODUCT_LIMITS.pdfPages)
    throw new DocumentLimitError(
      'PAGE_LIMIT',
      `PDF non indexé : ${result.totalPages} pages, maximum ${PRODUCT_LIMITS.pdfPages}.`,
    );
  if (result.pageErrors.length)
    throw new DocumentLimitError(
      'PDF_EXTRACTION_INCOMPLETE',
      `PDF non indexé : extraction impossible pour les pages ${result.pageErrors.map((page) => page.pageNum).join(', ')}.`,
    );
  return result.pages.flatMap((page) => {
    const text = (page.markdown || page.text).trim();
    return text ? [{ page: page.pageNum, text }] : [];
  });
}
