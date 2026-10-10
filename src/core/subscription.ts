/**
 * Katering langganan pascabayar (ADR 024, ROADMAP Fase 10D): porsi harian dari
 * kontrak (hari kirim × porsi default, dapat diubah per tanggal), ditagih per
 * bulan lewat draft faktur penjualan setelah bulan berakhir.
 */
import { addDays, daysInMonth, endOfMonth, isValidIsoDate, toIsoDate } from "./dates";
import { fail } from "./errors";
import { formatMonth } from "./format";
import { lineAmount, type InvoiceSummary } from "./invoice";
import type { Account, Contact, Invoice, InvoiceInput, IsoDate, Subscription, SubscriptionInput } from "./types";

const trimOrNull = (value: string | null | undefined) => value?.trim() || null;

export const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

/** Hari ISO (1 = Senin … 7 = Minggu) sebuah tanggal. */
export function isoWeekday(date: IsoDate): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function validateSubscription(input: SubscriptionInput, contacts: readonly Contact[], accounts: readonly Account[]): SubscriptionInput {
  const name = input.name.trim();
  if (name === "") fail("EMPTY_NAME", "Nama langganan wajib diisi");
  const contact = contacts.find((c) => c.id === input.contactId && c.deletedAt === null);
  if (!contact) fail("CONTACT_NOT_FOUND", "Pilih klien dari daftar kontak");
  if (!contact.isCustomer) fail("INVALID_ORDER", `${contact.name} bukan pelanggan; aktifkan peran pelanggan di Kontak`);
  if (!isValidIsoDate(input.startDate) || (input.endDate !== null && !isValidIsoDate(input.endDate))) fail("INVALID_DATE", "Tanggal mulai/berakhir tidak valid");
  if (input.endDate !== null && input.endDate < input.startDate) fail("INVALID_DATE", "Tanggal berakhir tidak boleh sebelum tanggal mulai");
  if (!isCount(input.pricePerPortion) || input.pricePerPortion === 0) fail("INVALID_AMOUNT", "Harga per porsi harus lebih dari 0");
  if (!isCount(input.defaultPortions) || input.defaultPortions > 100_000) fail("INVALID_QUANTITY", "Porsi per hari harus bilangan bulat ≥ 0");
  const weekdays = [...new Set(input.weekdays)].sort();
  if (weekdays.length === 0 || weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) fail("INVALID_ORDER", "Pilih minimal satu hari kirim");
  const account = accounts.find((a) => a.id === input.revenueAccountId && a.deletedAt === null);
  if (!account || account.accountType !== "revenue") fail("INVALID_ACCOUNT", "Pilih akun pendapatan");
  return { ...input, name, weekdays, notes: trimOrNull(input.notes) };
}

/** Porsi pada sebuah tanggal: ubahan per tanggal, atau default bila hari kirim dalam masa kontrak. */
export function portionsOn(sub: Pick<Subscription, "startDate" | "endDate" | "weekdays" | "defaultPortions" | "dayOverrides">, date: IsoDate): number {
  if (date < sub.startDate || (sub.endDate !== null && date > sub.endDate)) return 0;
  if (date in sub.dayOverrides) return sub.dayOverrides[date];
  return sub.weekdays.includes(isoWeekday(date)) ? sub.defaultPortions : 0;
}

export interface SubscriptionDay {
  date: IsoDate;
  portions: number;
  /** Diubah dari default. */
  changed: boolean;
  /** Dalam masa kontrak. */
  active: boolean;
}

/** Porsi harian sebulan (`month` = yyyy-mm). */
export function monthDays(sub: Subscription, month: string): { days: SubscriptionDay[]; total: number } {
  const [year, mon] = month.split("-").map(Number);
  const days: SubscriptionDay[] = [];
  for (let d = 1; d <= daysInMonth(year, mon); d++) {
    const date = toIsoDate(year, mon, d);
    const active = date >= sub.startDate && (sub.endDate === null || date <= sub.endDate);
    days.push({ date, portions: portionsOn(sub, date), changed: date in sub.dayOverrides, active });
  }
  return { days, total: days.reduce((t, d) => t + d.portions, 0) };
}

/** Ubahan porsi yang valid: tanggal dalam masa kontrak, bilangan bulat ≥ 0; null = kembali ke default. */
export function validateDayChanges(sub: Subscription, changes: Record<IsoDate, number | null>): Record<IsoDate, number | null> {
  for (const [date, portions] of Object.entries(changes)) {
    if (!isValidIsoDate(date)) fail("INVALID_DATE", "Tanggal porsi tidak valid");
    if (date < sub.startDate || (sub.endDate !== null && date > sub.endDate)) fail("INVALID_DATE", `Tanggal ${date} di luar masa langganan`);
    if (portions !== null && (!isCount(portions) || portions > 100_000)) fail("INVALID_QUANTITY", "Porsi harus bilangan bulat ≥ 0");
  }
  return changes;
}

export type BillingState = "none" | "draft" | "issued";

/**
 * Tagihan aktif bulan itu: faktur ada dan belum dibatalkan. Faktur draft yang
 * dihapus atau faktur yang dibatalkan membuat bulan itu dapat ditagih ulang.
 */
export function billingOf(sub: Subscription, month: string, invoices: readonly Invoice[], summaries: ReadonlyMap<string, InvoiceSummary>): { state: BillingState; invoice: Invoice | null } {
  const invoiceId = sub.billedMonths[month];
  const invoice = invoiceId ? invoices.find((i) => i.id === invoiceId) ?? null : null;
  if (!invoice) return { state: "none", invoice: null };
  if (invoice.status === "draft") return { state: "draft", invoice };
  return summaries.get(invoice.id)?.status === "cancelled" ? { state: "none", invoice: null } : { state: "issued", invoice };
}

export interface DueBilling {
  subscription: Subscription;
  month: string;
  portions: number;
  amount: number;
}

/** Bulan yang sudah berakhir, belum ditagih, dan ada porsinya (Catatan Keputusan 96). */
export function dueBillings(
  subs: readonly Subscription[],
  invoices: readonly Invoice[],
  summaries: ReadonlyMap<string, InvoiceSummary>,
  today: IsoDate,
): DueBilling[] {
  const result: DueBilling[] = [];
  for (const sub of subs) {
    if (sub.deletedAt !== null) continue;
    let month = sub.startDate.slice(0, 7);
    // Bulan berakhir bila hari terakhirnya sebelum hari ini.
    while (endOfMonth(`${month}-01`) < today && (sub.endDate === null || `${month}-01` <= sub.endDate)) {
      if (billingOf(sub, month, invoices, summaries).state === "none") {
        const portions = monthDays(sub, month).total;
        if (portions > 0) result.push({ subscription: sub, month, portions, amount: portions * sub.pricePerPortion });
      }
      month = addDays(endOfMonth(`${month}-01`), 1).slice(0, 7);
    }
  }
  return result.sort((a, b) => a.month.localeCompare(b.month) || a.subscription.name.localeCompare(b.subscription.name, "id"));
}

/** Draft faktur penjualan langganan sebulan: tanggal akhir bulan, jatuh tempo + termin klien. */
export function subscriptionInvoiceInput(sub: Subscription, month: string, contact: Pick<Contact, "paymentTermDays">): InvoiceInput {
  const { total } = monthDays(sub, month);
  if (total <= 0) fail("INVALID_QUANTITY", `Tidak ada porsi di ${formatMonth(`${month}-01`)}`);
  const invoiceDate = endOfMonth(`${month}-01`);
  const line = {
    description: `${sub.name} · ${formatMonth(`${month}-01`)}`,
    quantity: total,
    unit: "porsi",
    unitPrice: sub.pricePerPortion,
    accountId: sub.revenueAccountId,
    itemId: null,
  };
  lineAmount(line);
  return {
    workspaceId: sub.workspaceId,
    kind: "sale",
    contactId: sub.contactId,
    invoiceDate,
    dueDate: addDays(invoiceDate, contact.paymentTermDays),
    reference: `Langganan ${month}`,
    notes: sub.notes,
    applyTax: sub.applyTax,
    taxOverride: null,
    discount: null,
    lines: [line],
  };
}

/** Teks hari kirim, mis. "Sen–Jum" atau "Sen, Rab, Jum". */
export function weekdaysLabel(weekdays: readonly number[]): string {
  const sorted = [...weekdays].sort();
  const contiguous = sorted.length > 2 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length === 7) return "Setiap hari";
  if (contiguous) return `${WEEKDAY_LABELS[sorted[0] - 1]}–${WEEKDAY_LABELS[sorted[sorted.length - 1] - 1]}`;
  return sorted.map((d) => WEEKDAY_LABELS[d - 1]).join(", ");
}
