import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';
import { decodeDocumentText } from '@docsteward/filesystem-policy';
import { PRODUCT_LIMITS } from '@docsteward/contracts';
import { DocumentLimitError } from './product-limits';

export type ExtractedTextPart = {
  part: string;
  text: string;
  page?: number;
  sheet?: string;
};

export async function getPdfPageCount(bytes: Uint8Array): Promise<number> {
  const pdf = await import('./pdf-extractor');
  return pdf.getPdfPageCount(bytes);
}

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
    if (workbook.SheetNames.length > PRODUCT_LIMITS.workbookSheets)
      throw new DocumentLimitError(
        'SHEET_LIMIT',
        `Classeur non indexé : ${workbook.SheetNames.length} feuilles, maximum ${PRODUCT_LIMITS.workbookSheets}.`,
      );
    return workbook.SheetNames.flatMap((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const text = sheet ? XLSX.utils.sheet_to_csv(sheet, { blankrows: false }) : '';
      if (text.length > PRODUCT_LIMITS.sheetCharacters)
        throw new DocumentLimitError(
          'SHEET_TEXT_LIMIT',
          `Classeur non indexé : la feuille « ${sheetName} » dépasse ${PRODUCT_LIMITS.sheetCharacters.toLocaleString('fr-FR')} caractères.`,
        );
      return sheet
        ? [
            {
              part: `sheet:${sheetName}`,
              text,
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
      text: decodeDocumentText(bytes),
    },
  ];
}
