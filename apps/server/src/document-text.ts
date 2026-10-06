import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';

export type ExtractedTextPart = {
  part: string;
  text: string;
  page?: number;
  sheet?: string;
};

export async function extractPdfPages(
  bytes: Uint8Array,
): Promise<Array<{ page: number; text: string }>> {
  // Load the native parser only when a PDF actually needs extraction. If its
  // platform binary cannot load, callers can skip that document gracefully.
  const { parsePdfPages } = await import('./pdf-extractor');
  return parsePdfPages(bytes);
}

export async function extractTextParts(
  bytes: Uint8Array,
  extension: string,
): Promise<ExtractedTextPart[]> {
  if (extension === '.doc' || extension === '.docx') {
    const extracted = await new WordExtractor().extract(Buffer.from(bytes));
    return [{ part: 'document', text: extracted.getBody() }];
  }

  if (extension === '.xls' || extension === '.xlsx') {
    const workbook = XLSX.read(bytes, {
      type: 'buffer',
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
    });
    return workbook.SheetNames.slice(0, 20).flatMap((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return sheet
        ? [
            {
              part: `sheet:${sheetName}`,
              text: XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).slice(0, 500_000),
              sheet: sheetName,
            },
          ]
        : [];
    });
  }

  if (extension === '.pdf') {
    return (await extractPdfPages(bytes)).map((page) => ({
      part: `page:${page.page}`,
      text: page.text,
      page: page.page,
    }));
  }

  return [
    {
      part: 'document',
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    },
  ];
}
