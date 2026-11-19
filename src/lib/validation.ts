import { jsPDF } from 'jspdf';
import type { BusinessSettings, Invoice, Subscription, SubscriptionStatus } from '../types/domain';

// Field boundary constants synced verbatim with firebase-blueprint.json
export const FIELD_LIMITS = {
  businessNameMax: 160,
  contactNameMax: 120,
  phoneMax: 40,
  emailMax: 160,
  categoryMax: 80,
  locationMax: 120,
  domainMax: 160,
  urlMax: 300,
  notesMax: 4000,
  invoiceDescMax: 1000,
  paymentNotesMax: 2000,
  txRefMax: 120,
  maxAmount: 10000000,
} as const;

export const NAIROBI_TIMEZONE = 'Africa/Nairobi';

export function isValidIsoDate(value?: string | null): value is string {
  if (!value || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function getNairobiDateIso(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: NAIROBI_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

export function todayIso(): string {
  return getNairobiDateIso(new Date());
}

export function addDaysIso(dateIso: string, days: number): string {
  if (!isValidIsoDate(dateIso)) return todayIso();
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsIso(dateIso: string, months: number): string {
  if (!isValidIsoDate(dateIso)) return todayIso();
  const [y, m, d] = dateIso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDayOfTargetMonth));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso)) return 0;
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export function formatKES(amount: number, currency = 'KES'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const prefix = currency === 'KES' ? 'KSh' : currency;
  return `${prefix} ${safe.toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDisplayDate(dateIso?: string | null): string {
  if (!dateIso) return '—';
  if (!isValidIsoDate(dateIso)) return dateIso;
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString('en-KE', {
    timeZone: NAIROBI_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function generateRecordCode(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${ts}${rand}`;
}

export function normalizeTransactionRef(raw: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 120);
}

export function clampString(value: string | undefined | null, maxLen: number): string {
  if (!value) return '';
  return value.trim().slice(0, maxLen);
}

export function isValidUrlOrEmpty(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Evaluates effective subscription status against today's date without auto-suspending websites.
 * Only Active or Pending subscriptions past nextPaymentDate are flagged Overdue for admin review.
 */
export function getEffectiveSubscriptionStatus(
  sub: Pick<Subscription, 'status' | 'nextPaymentDate'>,
  today = todayIso()
): SubscriptionStatus {
  if (sub.status === 'Cancelled' || sub.status === 'Suspended') {
    return sub.status;
  }
  if ((sub.status === 'Active' || sub.status === 'Pending') && sub.nextPaymentDate < today) {
    return 'Overdue';
  }
  return sub.status;
}

export function isWithinGracePeriod(
  sub: Pick<Subscription, 'nextPaymentDate' | 'gracePeriodEndDate' | 'status'>,
  today = todayIso()
): boolean {
  const effective = getEffectiveSubscriptionStatus(sub, today);
  return effective === 'Overdue' && today <= sub.gracePeriodEndDate;
}

export function isPastGracePeriod(
  sub: Pick<Subscription, 'nextPaymentDate' | 'gracePeriodEndDate' | 'status'>,
  today = todayIso()
): boolean {
  const effective = getEffectiveSubscriptionStatus(sub, today);
  return effective === 'Overdue' && today > sub.gracePeriodEndDate;
}

export function exportToCsv(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  const escapeCell = (cell: string | number) => {
    const str = String(cell ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function generateInvoicePdf(invoice: Invoice, settings: BusinessSettings): void {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 48;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const rightX = pageWidth - marginX;

  // Header band
  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, pageWidth, 108, 'F');

  pdf.setTextColor(248, 250, 252);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(settings.businessName || 'EMG WEB SOLUTIONS', marginX, 46);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(148, 163, 184);
  const contactLine = [
    settings.businessEmail,
    settings.businessPhone,
    settings.businessAddress,
  ]
    .filter(Boolean)
    .join('  |  ');
  if (contactLine) {
    pdf.text(contactLine, marginX, 66);
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(96, 165, 250);
  pdf.text('INVOICE', rightX, 44, { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(226, 232, 240);
  pdf.text(invoice.invoiceNumber, rightX, 64, { align: 'right' });

  // Client & Invoice Metadata
  let y = 148;
  pdf.setTextColor(100, 116, 139);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('BILL TO', marginX, y);
  pdf.text('INVOICE DETAILS', 340, y);

  y += 18;
  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(invoice.clientName, marginX, y);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  let leftY = y + 16;
  if (invoice.clientPhone) {
    pdf.text(invoice.clientPhone, marginX, leftY);
    leftY += 15;
  }
  if (invoice.clientEmail) {
    pdf.text(invoice.clientEmail, marginX, leftY);
    leftY += 15;
  }
  if (invoice.clientLocation) {
    pdf.text(invoice.clientLocation, marginX, leftY);
    leftY += 15;
  }

  let rightY = y;
  const metaRows: Array<[string, string]> = [
    ['Issue Date:', formatDisplayDate(invoice.issueDate)],
    ['Due Date:', formatDisplayDate(invoice.dueDate)],
    ['Status:', invoice.status],
  ];
  for (const [label, value] of metaRows) {
    pdf.setTextColor(100, 116, 139);
    pdf.text(label, 340, rightY);
    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.text(value, rightX, rightY, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    rightY += 18;
  }

  // Table header
  y = Math.max(leftY, rightY) + 32;
  pdf.setFillColor(241, 245, 249);
  pdf.rect(marginX, y, pageWidth - marginX * 2, 28, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(51, 65, 85);
  pdf.text('DESCRIPTION', marginX + 12, y + 18);
  pdf.text('AMOUNT', rightX - 12, y + 18, { align: 'right' });

  // Line item
  y += 46;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  pdf.setTextColor(15, 23, 42);
  const descLines = pdf.splitTextToSize(invoice.description, 350);
  pdf.text(descLines, marginX + 12, y);

  const formattedAmount = formatKES(invoice.amount, settings.currency || 'KES');
  pdf.setFont('helvetica', 'bold');
  pdf.text(formattedAmount, rightX - 12, y, { align: 'right' });

  y += Math.max(descLines.length * 15, 24) + 20;
  pdf.setDrawColor(226, 232, 240);
  pdf.line(marginX, y, rightX, y);

  // Total
  y += 24;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('TOTAL DUE', 340, y);
  pdf.setFontSize(14);
  pdf.text(formattedAmount, rightX - 12, y, { align: 'right' });

  // Payment instructions
  const instructions = invoice.paymentInstructions || settings.paymentInstructions || '';
  if (instructions) {
    y += 48;
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    const instrLines = pdf.splitTextToSize(instructions, pageWidth - marginX * 2 - 24);
    const boxHeight = 36 + instrLines.length * 14;
    pdf.roundedRect(marginX, y, pageWidth - marginX * 2, boxHeight, 4, 4, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(51, 65, 85);
    pdf.text('PAYMENT INSTRUCTIONS', marginX + 12, y + 20);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9.5);
    pdf.setTextColor(71, 85, 105);
    pdf.text(instrLines, marginX + 12, y + 36);
  }

  if (invoice.notes) {
    y += 110;
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 116, 139);
    const noteLines = pdf.splitTextToSize(`Notes: ${invoice.notes}`, pageWidth - marginX * 2);
    pdf.text(noteLines, marginX, y);
  }

  pdf.save(`${invoice.invoiceNumber}.pdf`);
}
