import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  GST_INVOICE_STYLES,
  summarizeGstInvoicePageItems,
  type GstInvoiceLineItem,
} from './gstInvoiceTemplate';

/** A4 portrait; each invoice block is at most half a sheet (two halves per page). */
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const HALF_PAGE_HEIGHT_MM = PAGE_HEIGHT_MM / 2;
const PAGE_MARGIN_TOP_MM = 6;
const PAGE_MARGIN_SIDE_MM = 5;
const PAGE_MARGIN_BOTTOM_MM = 4;
const PAGE_CONTENT_HEIGHT_MM =
  HALF_PAGE_HEIGHT_MM - PAGE_MARGIN_TOP_MM - PAGE_MARGIN_BOTTOM_MM;

export type InvoicePdfPagePlan = {
  items: GstInvoiceLineItem[];
  includeFooter: boolean;
  isFirst: boolean;
  isLast: boolean;
  pageIndex: number;
  pageCount: number;
  pageTotal: number;
  carriedForward: number;
};

export type InvoiceFooterBuildCtx = {
  isLast: boolean;
  pageTotal: number;
  carriedForward: number;
};

function wrapInvoiceHtml(inner: string, title: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>${GST_INVOICE_STYLES}
  .invoice-box {
    box-sizing: border-box;
    height: ${PAGE_CONTENT_HEIGHT_MM}mm;
    min-height: ${PAGE_CONTENT_HEIGHT_MM}mm;
    max-height: ${PAGE_CONTENT_HEIGHT_MM}mm;
    display: flex;
    flex-direction: column;
  }
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
 * Pack full item rows into half-A4 blocks so no row is split across a half.
 * Every half includes page totals, terms, and QR; last half shows Grand Total.
 */
export function planInvoicePages(
  items: GstInvoiceLineItem[],
  heights: InvoiceSectionHeights
): InvoicePdfPagePlan[] {
  const maxH = maxContentHeightPx(heights.contentWidth);
  const boxPad = 20; // invoice-box padding + borders fudge
  const drafts: Array<{ items: GstInvoiceLineItem[]; isFirst: boolean; pageIndex: number }> = [];

  if (items.length === 0) {
    return [
      {
        items: [],
        includeFooter: true,
        isFirst: true,
        isLast: true,
        pageIndex: 0,
        pageCount: 1,
        pageTotal: 0,
        carriedForward: 0,
      },
    ];
  }

  let index = 0;
  let pageIndex = 0;

  while (index < items.length) {
    const isFirst = pageIndex === 0;
    const headerH = heights.firstHeader;
    const limit = maxH - headerH - heights.thead - heights.footer - boxPad;

    let take = 0;
    while (index + take < items.length) {
      const nextCount = take + 1;
      const rowsH = sumHeights(heights.rows, index, nextCount);
      if (rowsH > limit) break;
      take = nextCount;
    }

    if (take === 0) {
      take = 1;
    }

    drafts.push({
      items: items.slice(index, index + take),
      isFirst,
      pageIndex,
    });
    index += take;
    pageIndex += 1;
  }

  const pageCount = drafts.length;
  let running = 0;
  return drafts.map((p, i) => {
    const pageTotal = summarizeGstInvoicePageItems(p.items).pageTotal;
    running += pageTotal;
    return {
      items: p.items,
      includeFooter: true,
      isFirst: p.isFirst,
      isLast: i === pageCount - 1,
      pageIndex: p.pageIndex,
      pageCount,
      pageTotal,
      carriedForward: running,
    };
  });
}

export function formatInvoicePageLabel(pageIndex: number, pageCount: number): string {
  return `Page ${pageIndex + 1} of ${Math.max(1, pageCount)}`;
}

export function buildContinuationHeaderHtml(opts: {
  title: string;
  invoiceNo: string;
  date: string;
  pageIndex: number;
  pageCount: number;
  partyName?: string;
}): string {
  const pageLabel = formatInvoicePageLabel(opts.pageIndex, opts.pageCount);
  return `
<div data-invoice-section="header" class="invoice-header">
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
      width: target.offsetWidth,
      height: target.offsetHeight,
      backgroundColor: '#ffffff',
    });
    const dataUrl = canvas.toDataURL('image/jpeg', opts?.jpegQuality ?? 0.82);
    return { dataUrl, widthPx: canvas.width, heightPx: canvas.height };
  } finally {
    document.body.removeChild(host);
  }
}

function drawHalfPageCutGuide(pdf: jsPDF) {
  pdf.setDrawColor(170);
  pdf.setLineDashPattern([1.2, 1.2], 0);
  pdf.line(PAGE_MARGIN_SIDE_MM, HALF_PAGE_HEIGHT_MM, PAGE_WIDTH_MM - PAGE_MARGIN_SIDE_MM, HALF_PAGE_HEIGHT_MM);
  pdf.setLineDashPattern([], 0);
  pdf.setDrawColor(0);
}

/**
 * Build an A4 PDF of half-page invoice blocks (two per sheet). Extra products
 * overflow to the next half, then the next page. No mid-row image slicing.
 */
function resolveFirstHeaderHtml(
  firstHeaderHtml: string | ((page: InvoicePdfPagePlan) => string),
  page: InvoicePdfPagePlan
): string {
  return typeof firstHeaderHtml === 'function' ? firstHeaderHtml(page) : firstHeaderHtml;
}

export async function buildPaginatedInvoicePdf(opts: {
  title: string;
  items: GstInvoiceLineItem[];
  firstHeaderHtml: string | ((page: InvoicePdfPagePlan) => string);
  buildContHeaderHtml: (page: InvoicePdfPagePlan) => string;
  buildItemsHtml: (pageItems: GstInvoiceLineItem[]) => string;
  footerHtml: string;
  buildFooterHtml?: (page: InvoicePdfPagePlan, ctx: InvoiceFooterBuildCtx) => string;
  fileName?: string;
  download?: boolean;
  scale?: number;
}): Promise<jsPDF> {
  const measurePage: InvoicePdfPagePlan = {
    items: opts.items.slice(0, 1),
    includeFooter: true,
    isFirst: true,
    isLast: false,
    pageIndex: 0,
    pageCount: 2,
    pageTotal: 0,
    carriedForward: 0,
  };
  const itemTableForMeasure = opts.buildItemsHtml(opts.items);
  const heights = measureInvoiceSections({
    title: opts.title,
    firstHeaderHtml: resolveFirstHeaderHtml(opts.firstHeaderHtml, measurePage),
    contHeaderHtml: opts.buildContHeaderHtml({
      items: opts.items.slice(0, 1),
      includeFooter: true,
      isFirst: false,
      isLast: false,
      pageIndex: 1,
      pageCount: 2,
      pageTotal: 0,
      carriedForward: 0,
    }),
    itemTableHtml: itemTableForMeasure,
    footerHtml: opts.footerHtml,
    itemCount: opts.items.length,
  });

  const pages = planInvoicePages(opts.items, heights);
  const pdf = new jsPDF('p', 'mm', 'a4');

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const ctx: InvoiceFooterBuildCtx = {
      isLast: page.isLast,
      pageTotal: page.pageTotal,
      carriedForward: page.carriedForward,
    };
    const headerHtml = `<div data-invoice-section="header" class="invoice-header">${resolveFirstHeaderHtml(opts.firstHeaderHtml, page)}</div>`;
    const itemsHtml = `<div class="invoice-items">${
      page.items.length > 0 ? opts.buildItemsHtml(page.items) : ''
    }</div>`;
    const footerInner = opts.buildFooterHtml?.(page, ctx) ?? opts.footerHtml;
    const footerHtml = `<div data-invoice-section="footer" class="invoice-footer">${footerInner}</div>`;
    const html = wrapInvoiceHtml(
      `${headerHtml}${itemsHtml}<div class="invoice-spacer"></div>${footerHtml}`,
      opts.title
    );
    const { dataUrl, widthPx, heightPx } = await renderHtmlToImage(html, { scale: opts.scale });
    const imgWidth = PAGE_WIDTH_MM - PAGE_MARGIN_SIDE_MM * 2;
    const imgHeight = (heightPx * imgWidth) / widthPx;

    const halfIndex = i % 2;
    if (i > 0 && halfIndex === 0) pdf.addPage();
    if (halfIndex === 0) drawHalfPageCutGuide(pdf);

    const maxH = PAGE_CONTENT_HEIGHT_MM;
    const scale = imgHeight > maxH ? maxH / imgHeight : 1;
    pdf.addImage(
      dataUrl,
      'JPEG',
      PAGE_MARGIN_SIDE_MM,
      halfIndex * HALF_PAGE_HEIGHT_MM + PAGE_MARGIN_TOP_MM,
      imgWidth * scale,
      Math.min(imgHeight * scale, maxH)
    );
  }

  if (opts.download && opts.fileName) {
    pdf.save(opts.fileName);
  }
  return pdf;
}
