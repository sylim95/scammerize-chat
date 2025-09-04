declare module "pdf-parse/lib/pdf-parse.js" {
    export interface PdfParseResult {
      text?: string;
      numpages?: number;
      info?: Record<string, unknown>;
      metadata?: unknown;
      version?: string;
    }
    export default function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  }