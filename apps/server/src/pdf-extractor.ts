import { LiteParse } from '@llamaindex/liteparse';

const pdfParser = new LiteParse({
  outputFormat: 'markdown',
  imageMode: 'off',
  extractLinks: false,
  ocrEnabled: true,
  ocrLanguage: 'fra+eng',
  continueOnPageError: true,
  ocrFailureFatal: false,
  maxPages: 500,
  numWorkers: 1,
  quiet: true,
});

export async function parsePdfPages(
  bytes: Uint8Array,
): Promise<Array<{ page: number; text: string }>> {
  const result = await pdfParser.parse(bytes);
  return result.pages.flatMap((page) => {
    const text = (page.markdown || page.text).trim();
    return text ? [{ page: page.pageNum, text: text.slice(0, 500_000) }] : [];
  });
}
