import jsPDF from 'jspdf';

/** A4 page margins (mm) so multi-page canvas slices are not flush with edges. */
const PAGE_MARGIN_MM = 12;

/**
 * Write a tall canvas image into an A4 PDF with consistent margins on every page.
 * White bands mask overflow into the margin so rows do not sit on the page break.
 */
export function saveCanvasAsPagedPdf(
  canvas: HTMLCanvasElement,
  filename: string,
  imageType: 'PNG' | 'JPEG' = 'PNG'
): void {
  const imgData = canvas.toDataURL(`image/${imageType.toLowerCase()}`);
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = PAGE_MARGIN_MM;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const imgHeight = (canvas.height * contentWidth) / canvas.width;

  let heightLeft = imgHeight;
  let sourceOffset = 0;
  let pageIndex = 0;

  while (heightLeft > 0) {
    if (pageIndex > 0) pdf.addPage();

    const y = margin - sourceOffset;
    pdf.addImage(imgData, imageType, margin, y, contentWidth, imgHeight);

    // Mask bleed into page margins (image continues past the content box).
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageWidth, margin, 'F');
    pdf.rect(0, pageHeight - margin, pageWidth, margin, 'F');
    pdf.rect(0, 0, margin, pageHeight, 'F');
    pdf.rect(pageWidth - margin, 0, margin, pageHeight, 'F');

    heightLeft -= contentHeight;
    sourceOffset += contentHeight;
    pageIndex += 1;
  }

  pdf.save(filename);
}
