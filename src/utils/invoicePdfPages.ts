import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { GST_INVOICE_STYLES, type GstInvoiceLineItem } from './gstInvoiceTemplate';

/** Usable A4 height in mm (leave a small bottom margin so rows are not clipped). */
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const PAGE_CONTENT_HEIGHT_MM = 270;

export type InvoicePdfPagePlan = {
  items: GstInvoiceLineItem[];
  includeFooter: boolean;
  isFirst: boolean;
  pageIndex: number;
  pageCount: number;
};

function wrapInvoiceHtml(inner: string, title: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>${GST_INVOICE_STYLES}
  .invoice-box { box-sizing: border-box; }
  .cont-banner td { font-size: 11px; vertical-align: middle; }
</style>
</head>
<body>
<div class="invoice-box">
${inner}
</div>
</body>
</html>`;
}

function createMeasureHost(): HTMLDivElement {
  const host = document.createElement('div');
  host.style.width = '210mm';
  host.style.padding = '0';
  host.style.margin = '0';
  host.style.position = 'absolute';
  host.style.left = '-9999px';
  host.style.top = '0';
  host.style.background = '#fff';
  document.body.appendChild(host);
  return host;
}

function setHostHtml(host: HTMLDivElement, html: string): HTMLElement {
  host.innerHTML = html;
  const box = host.querySelector('.invoice-box') as HTMLElement | null;
  return box || host;
}

function maxContentHeightPx(contentWidthPx: number): number {
  return (contentWidthPx * PAGE_CONTENT_HEIGHT_MM) / PAGE_WIDTH_MM;
}

export type InvoiceSectionHeights = {
  firstHeader: number;
  contHeader: number;
  thead: number;
  rows: number[];
  footer: number;
  contentWidth: number;
};

/**
 * Measure header / item rows / footer heights in the same CSS layout used for PDF capture.
 */
export function measureInvoiceSections(parts: {
  title: string;
  firstHeaderHtml: string;
  contHeaderHtml: string;
  itemTableHtml: string;
  footerHtml: string;
  itemCount: number;
}): InvoiceSectionHeights {
  const host = createMeasureHost();
  try {
    const firstBox = setHostHtml(
      host,
      wrapInvoiceHtml(
        `<div data-invoice-section="header">${parts.firstHeaderHtml}</div>${parts.itemTableHtml}`,
        parts.title
      )
    );
    const contentWidth = firstBox.scrollWidth || host.scrollWidth || 794;
    const firstHeaderEl = firstBox.querySelector('[data-invoice-section="header"]') as HTMLElement | null;
    const table = firstBox.querySelector('table.items-table') as HTMLTableElement | null;
    const thead = table?.tHead || null;
    const bodyRows = table?.tBodies?.[0] ? Array.from(table.tBodies[0].rows) : [];

    const firstHeader = firstHeaderEl?.offsetHeight || 0;
    const theadH = thead?.offsetHeight || 0;
    const rows =
      bodyRows.length === parts.itemCount
        ? bodyRows.map((r) => r.offsetHeight || 18)
        : Array.from({ length: parts.itemCount }, () => 18);

    setHostHtml(
      host,
      wrapInvoiceHtml(`${parts.contHeaderHtml}${parts.itemTableHtml}`, parts.title)
    );
    const contHeaderEl = host.querySelector('[data-invoice-section="header"]') as HTMLElement | null;
    const contHeader = contHeaderEl?.offsetHeight || Math.max(40, Math.round(firstHeader * 0.35));

    setHostHtml(
      host,
      wrapInvoiceHtml(`<div data-invoice-section="footer">${parts.footerHtml}</div>`, parts.title)
    );
    const footerEl = host.querySelector('[data-invoice-section="footer"]') as HTMLElement | null;
    const footer = footerEl?.offsetHeight || 160;

    return { firstHeader, contHeader, thead: theadH, rows, footer, contentWidth };
  } finally {
    document.body.removeChild(host);
  }
}

function sumHeights(heights: number[], start: number, count: number): number {
  let total = 0;
  for (let i = start; i < start + count && i < heights.length; i += 1) {
    total += heights[i];
  }
  return total;
}

/**
 * Pack full item rows into pages so no row is split across a page boundary.
 * Continuation pages get a compact header; totals/footer only on the last page.
 */
export function planInvoicePages(
  items: GstInvoiceLineItem[],
  heights: InvoiceSectionHeights
): InvoicePdfPagePlan[] {
  const maxH = maxContentHeightPx(heights.contentWidth);
  const boxPad = 20; // invoice-box padding + borders fudge
  const pages: Array<Omit<InvoicePdfPagePlan, 'pageCount'>> = [];

  if (items.length === 0) {
    return [{ items: [], includeFooter: true, isFirst: true, pageIndex: 0, pageCount: 1 }];
  }

  let index = 0;
  let pageIndex = 0;

  while (index < items.length) {
    const isFirst = pageIndex === 0;
    const headerH = isFirst ? heights.firstHeader : heights.contHeader;
    const baseChrome = headerH + heights.thead + boxPad;

    let take = 0;
    while (index + take < items.length) {
      const nextCount = take + 1;
      const rowsH = sumHeights(heights.rows, index, nextCount);
      const remainingAfter = items.length - (index + nextCount);
      const needsFooter = remainingAfter === 0;
      const limit = maxH - baseChrome - (needsFooter ? heights.footer : 0);
      if (rowsH > limit) break;
      take = nextCount;
    }

    if (take === 0) {
      // Extremely tall row: force one row; footer may move to following page.
      take = 1;
    }

    // If this chunk ends the items list but footer does not fit, shed rows until it does
    // (or leave at least one row and put footer on a following page).
    let includeFooter = index + take >= items.length;
    if (includeFooter) {
      while (
        take > 0 &&
        baseChrome + sumHeights(heights.rows, index, take) + heights.footer > maxH
      ) {
        take -= 1;
      }
      if (take === 0) {
        take = 1;
        includeFooter = false;
      } else {
        includeFooter = index + take >= items.length;
      }
    }

    pages.push({
      items: items.slice(index, index + take),
      includeFooter,
      isFirst,
      pageIndex,
    });
    index += take;
    pageIndex += 1;
  }

  if (pages.length === 0 || !pages[pages.length - 1].includeFooter) {
    pages.push({
      items: [],
      includeFooter: true,
      isFirst: pages.length === 0,
      pageIndex: pages.length,
    });
  }

  const pageCount = pages.length;
  return pages.map((p) => ({ ...p, pageCount }));
}

export function buildContinuationHeaderHtml(opts: {
  title: string;
  invoiceNo: string;
  date: string;
  pageIndex: number;
  pageCount: number;
  partyName?: string;
}): string {
  const pageLabel = `Page ${opts.pageIndex + 1} of ${opts.pageCount}`;
  return `
<div data-invoice-section="header">
<table class="cont-banner">
  <tr>
    <td width="55%">
      <b>${opts.title} (Continued)</b><br>
      Invoice No: ${opts.invoiceNo}
      ${opts.partyName ? `<br>Party: ${opts.partyName}` : ''}
    </td>
    <td width="45%" class="right">
      Date: ${opts.date}<br>
      ${pageLabel}
    </td>
  </tr>
</table>
</div>`;
}

async function renderHtmlToImage(
  html: string,
  opts?: { scale?: number; jpegQuality?: number }
): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
  const host = createMeasureHost();
  try {
    host.innerHTML = html;
    const target = (host.querySelector('.invoice-box') as HTMLElement) || host;
    const scale = opts?.scale ?? 1.5;
    const canvas = await html2canvas(target, {
      scale,
      useCORS: true,
      logging: false,
      width: target.scrollWidth,
      height: target.scrollHeight,
      backgroundColor: '#ffffff',
    });
    const dataUrl = canvas.toDataURL('image/jpeg', opts?.jpegQuality ?? 0.82);
    return { dataUrl, widthPx: canvas.width, heightPx: canvas.height };
  } finally {
    document.body.removeChild(host);
  }
}

/**
 * Build a multi-page A4 PDF where each page is a complete HTML render (no mid-row image slicing).
 */
export async function buildPaginatedInvoicePdf(opts: {
  title: string;
  items: GstInvoiceLineItem[];
  firstHeaderHtml: string;
  buildContHeaderHtml: (page: InvoicePdfPagePlan) => string;
  buildItemsHtml: (pageItems: GstInvoiceLineItem[]) => string;
  footerHtml: string;
  fileName?: string;
  download?: boolean;
  scale?: number;
}): Promise<jsPDF> {
  const itemTableForMeasure = opts.buildItemsHtml(opts.items);
  const heights = measureInvoiceSections({
    title: opts.title,
    firstHeaderHtml: opts.firstHeaderHtml,
    contHeaderHtml: opts.buildContHeaderHtml({
      items: opts.items.slice(0, 1),
      includeFooter: false,
      isFirst: false,
      pageIndex: 1,
      pageCount: 2,
    }),
    itemTableHtml: itemTableForMeasure,
    footerHtml: opts.footerHtml,
    itemCount: opts.items.length,
  });

  const pages = planInvoicePages(opts.items, heights);
  const pdf = new jsPDF('p', 'mm', 'a4');

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const headerHtml = page.isFirst
      ? `<div data-invoice-section="header">${opts.firstHeaderHtml}</div>`
      : opts.buildContHeaderHtml(page);
    const itemsHtml = page.items.length > 0 ? opts.buildItemsHtml(page.items) : '';
    const footerHtml = page.includeFooter
      ? `<div data-invoice-section="footer">${opts.footerHtml}</div>`
      : '';
    const html = wrapInvoiceHtml(`${headerHtml}${itemsHtml}${footerHtml}`, opts.title);
    const { dataUrl, widthPx, heightPx } = await renderHtmlToImage(html, { scale: opts.scale });
    const imgWidth = PAGE_WIDTH_MM;
    const imgHeight = (heightPx * imgWidth) / widthPx;

    if (i > 0) pdf.addPage();
    // Fit within A4 if measurement fudge left the page slightly tall (never crop mid-row).
    const scale = imgHeight > PAGE_HEIGHT_MM ? PAGE_HEIGHT_MM / imgHeight : 1;
    pdf.addImage(dataUrl, 'JPEG', 0, 0, imgWidth * scale, imgHeight * scale);
  }

  if (opts.download && opts.fileName) {
    pdf.save(opts.fileName);
  }
  return pdf;
}
