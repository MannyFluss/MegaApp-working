export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export async function validatePDF(blob) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_PDF_BYTES)
    throw new Error("Choose a PDF smaller than 25 MB.");
  const head = new TextDecoder().decode(await blob.slice(0, 1024).arrayBuffer());
  if (!head.includes("%PDF-")) throw new Error("This file does not have a PDF header.");
  return blob;
}
export async function pdfHash(blob) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
}
