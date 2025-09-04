declare module "pptx-parser" {
    export type PptxSlide = { text?: string; notes?: string };
    export function parsePptx(
      input: Buffer | ArrayBuffer | Uint8Array
    ): Promise<PptxSlide[]>;
  }