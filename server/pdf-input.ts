import { PDFParse } from "pdf-parse";
import { HttpError } from "./auth";

export async function pdfPageCount(bytes: Buffer) {
  const pdf = new PDFParse({ data: bytes, isEvalSupported: false });
  try {
    const count = (await pdf.getInfo()).total;
    if (!count) throw new Error("Empty PDF");
    return count;
  } catch {
    throw new HttpError(400, "This PDF could not be opened. Check whether it is damaged or password protected.");
  } finally { await pdf.destroy(); }
}

export async function pdfPageImage(bytes: Buffer, page: number) {
  const pdf = new PDFParse({ data: bytes, isEvalSupported: false });
  try {
    const screenshot = (await pdf.getScreenshot({ partial: [page], desiredWidth: 1500, imageDataUrl: false })).pages[0];
    if (!screenshot?.data?.length) throw new Error("Empty page image");
    return { mime: "image/png", bytes: Buffer.from(screenshot.data) };
  } catch {
    throw new HttpError(422, `Could not render page ${page} of this PDF.`);
  } finally { await pdf.destroy(); }
}
