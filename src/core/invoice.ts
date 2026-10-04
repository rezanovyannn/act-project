/**
 * Faktur penjualan/pembelian, kontak, dan profil usaha (ADR 022). Fungsi murni:
 * faktur terbit menjadi jurnal kredit (piutang/utang) yang tetap melewati
 * validasi posting; status pembayaran diturunkan dari pelunasan (ADR 012).
 */
import { addDays, isValidIsoDate } from "./dates";
import { fail } from "./errors";
import { outflowLines, purchaseCorrections, type PerpetualContext } from "./perpetual";
import { effectiveTaxSettings, type SalesTaxResult } from "./sales-tax";
import { listCreditTransactions } from "./settlement";
import { buildExpense, buildSale } from "./transactions";
import type {
  Account,
  BusinessProfileInput,
  Contact,
  ContactInput,
  ContactSnapshot,
  Invoice,
  InvoiceInput,
  InvoiceLine,
  IsoDate,
  Item,
  JournalEntry,
  JournalEntryInput,
  JournalLineInput,
  Workspace,
} from "./types";
import { computeInputVat, workspaceTaxSettings } from "./vat";

const trimOrNull = (value: string | null | undefined) => value?.trim() || null;

// ---------- Profil usaha ----------

export const DEFAULT_INVOICE_PREFIX = "INV";
export const DEFAULT_PURCHASE_PREFIX = "PB";
export const LOGO_MAX_LENGTH = 200_000;
export const PREFIX_PATTERN = /^[A-Z0-9-]{1,12}$/;
export const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export function defaultProfile(): BusinessProfileInput {
  return {
    displayName: null,
    address: null,
    phone: null,
    email: null,
    npwp: null,
    bankInfo: null,
    invoiceNotes: null,
    invoicePrefix: DEFAULT_INVOICE_PREFIX,
    purchasePrefix: DEFAULT_PURCHASE_PREFIX,
    logoDataUrl: null,
  };
}

export function validateProfile(input: BusinessProfileInput): BusinessProfileInput {
  const prefix = input.invoicePrefix.trim().toUpperCase();
  const purchasePrefix = (input.purchasePrefix ?? DEFAULT_PURCHASE_PREFIX).trim().toUpperCase();
  if (!PREFIX_PATTERN.test(prefix) || !PREFIX_PATTERN.test(purchasePrefix)) {
    fail("INVALID_PROFILE", "Prefix nomor faktur 1–12 karakter: huruf, angka, atau tanda hubung");
  }
  const logo = input.logoDataUrl || null;
  if (logo && (logo.length > LOGO_MAX_LENGTH || !LOGO_PATTERN.test(logo))) {
    fail("INVALID_PROFILE", "Logo harus gambar PNG/JPEG/WebP berukuran kecil");
  }
  const email = trimOrNull(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("INVALID_PROFILE", "Format email tidak valid");
  return {
    displayName: trimOrNull(input.displayName),
    address: trimOrNull(input.address),
    phone: trimOrNull(input.phone),
    email,
    npwp: trimOrNull(input.npwp),
    bankInfo: trimOrNull(input.bankInfo),
    invoiceNotes: trimOrNull(input.invoiceNotes),
    invoicePrefix: prefix,
    purchasePrefix,
    logoDataUrl: logo,
  };
}

// ---------- Kontak ----------

export function validateContact(input: ContactInput, existing: readonly Contact[], exceptId?: string): ContactInput {
  const name = input.name.trim();
  if (name === "") fail("EMPTY_NAME", "Nama kontak wajib diisi");
  if (!input.isCustomer && !input.isSupplier) fail("INVALID_INVOICE", "Pilih peran kontak: pelanggan dan/atau pemasok");
  if (!Number.isSafeInteger(input.paymentTermDays) || input.paymentTermDays < 0 || input.paymentTermDays > 365) {
    fail("INVALID_INVOICE", "Termin bayar 0–365 hari");
  }
  const taken = existing.find((c) => c.deletedAt === null && c.id !== exceptId && c.name.trim().toLowerCase() === name.toLowerCase());
  if (taken) fail("DUPLICATE_CONTACT", `Kontak ${taken.name} sudah ada`);
  const email = trimOrNull(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("INVALID_INVOICE", "Format email kontak tidak valid");
  return {
    name,
    isCustomer: input.isCustomer,
    isSupplier: input.isSupplier,
    address: trimOrNull(input.address),
    phone: trimOrNull(input.phone),
    email,
    npwp: trimOrNull(input.npwp),
    paymentTermDays: input.paymentTermDays,
    notes: trimOrNull(input.notes),
  };
}

export const contactSnapshot = (c: Contact): ContactSnapshot => ({ name: c.name, address: c.address, phone: c.phone, email: c.email, npwp: c.npwp });

/** Jatuh tempo default = tanggal faktur + termin kontak. */
export const defaultDueDate = (invoiceDate: IsoDate, contact: Pick<Contact, "paymentTermDays"> | null | undefined) =>
  addDays(invoiceDate, contact?.paymentTermDays ?? 0);

// ---------- Draft ----------

/** Nominal baris = qty × harga satuan (integer aman). */
export function lineAmount(line: Pick<InvoiceLine, "quantity" | "unitPrice">): number {
  const amount = line.quantity * line.unitPrice;
  if (!Number.isSafeInteger(amount)) fail("AMOUNT_OVERFLOW", "Nominal baris melewati batas yang didukung");
  return amount;
}

/** Validasi bentuk draft (boleh belum lengkap): tanggal, angka bulat ≥ 0, teks dirapikan. */
export function validateDraft(input: InvoiceInput): InvoiceInput {
  if (input.kind !== "sale" && input.kind !== "purchase") fail("INVALID_INVOICE", "Jenis faktur tidak dikenal");
  if (!isValidIsoDate(input.invoiceDate) || !isValidIsoDate(input.dueDate)) fail("INVALID_DATE", "Tanggal faktur/jatuh tempo tidak valid");
  if (input.lines.length > 200) fail("INVALID_INVOICE", "Faktur maksimal 200 baris");
  const lines = input.lines.map((line, i) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0) {
      fail("INVALID_QUANTITY", `Baris ${i + 1}: qty dan harga harus bilangan bulat ≥ 0`);
    }
    lineAmount(line);
    return { description: line.description.trim(), quantity: line.quantity, unit: trimOrNull(line.unit), unitPrice: line.unitPrice, accountId: line.accountId, itemId: line.itemId || null };
  });
  const taxOverride = input.taxOverride ?? null;
  if (taxOverride !== null && (!Number.isSafeInteger(taxOverride) || taxOverride < 0)) fail("INVALID_AMOUNT", "PPN Masukan harus bilangan bulat ≥ 0");
  return { ...input, contactId: input.contactId || null, reference: trimOrNull(input.reference), notes: trimOrNull(input.notes), taxOverride, lines };
}

// ---------- Terbit ----------

export interface InvoiceContext {
  workspace: Workspace;
  accounts: readonly Account[];
  items: readonly Item[];
  contacts: readonly Contact[];
  /** Stok per barang untuk HPP (metode perpetual). */
  perpetual: PerpetualContext | null;
}

export interface InvoicePlan {
  entry: JournalEntryInput;
  contact: Contact;
  totals: SalesTaxResult;
  /** Harga pokok barang terjual (perpetual). */
  cost: number;
  warnings: string[];
}

/** Syarat terbit faktur penjualan + jurnalnya (Dr Piutang / Cr Pendapatan + pajak [+ HPP perpetual]). */
export function buildSaleInvoice(invoice: InvoiceInput, ctx: InvoiceContext, number = "(nomor otomatis)"): InvoicePlan {
  if (invoice.kind !== "sale") fail("INVALID_INVOICE", "Bukan faktur penjualan");
  const contact = ctx.contacts.find((c) => c.id === invoice.contactId && c.deletedAt === null);
  if (!contact) fail("CONTACT_NOT_FOUND", "Pilih pelanggan dari daftar kontak");
  if (!contact.isCustomer) fail("INVALID_INVOICE", `${contact.name} bukan pelanggan; aktifkan peran pelanggan di Kontak`);
  if (!isValidIsoDate(invoice.invoiceDate) || !isValidIsoDate(invoice.dueDate)) fail("INVALID_DATE", "Tanggal faktur/jatuh tempo tidak valid");
  if (invoice.dueDate < invoice.invoiceDate) fail("INVALID_DATE", "Jatuh tempo tidak boleh sebelum tanggal faktur");
  if (invoice.lines.length === 0) fail("INVALID_INVOICE", "Faktur minimal berisi satu baris");

  const lines = invoice.lines.map((line, i) => {
    const n = i + 1;
    if (line.description.trim() === "") fail("INVALID_INVOICE", `Baris ${n}: keterangan wajib diisi`);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) fail("INVALID_QUANTITY", `Baris ${n}: qty harus bilangan bulat > 0`);
    if (!Number.isSafeInteger(line.unitPrice) || line.unitPrice <= 0) fail("INVALID_AMOUNT", `Baris ${n}: harga harus lebih dari 0`);
    const account = ctx.accounts.find((a) => a.id === line.accountId && a.deletedAt === null);
    if (!account || account.accountType !== "revenue") fail("INVALID_ACCOUNT", `Baris ${n}: pilih akun pendapatan`);
    const item = line.itemId ? ctx.items.find((it) => it.id === line.itemId && it.deletedAt === null) : null;
    if (line.itemId && !item) fail("ITEM_NOT_FOUND", `Baris ${n}: barang tidak ditemukan`);
    return { line, item, amount: lineAmount(line) };
  });

  const settings = workspaceTaxSettings(ctx.workspace);
  const sale = buildSale(
    {
      workspaceId: invoice.workspaceId,
      entryDate: invoice.invoiceDate,
      description: `Faktur ${number} · ${contact.name}`,
      payment: { kind: "credit", counterparty: contact.name },
      items: lines.map(({ line, amount }) => ({ accountId: line.accountId, amount, description: line.description.trim() })),
      applyTax: invoice.applyTax && settings.rateBps > 0,
      tax: effectiveTaxSettings(settings),
      taxLabel: ctx.workspace.salesTaxLabel,
    },
    ctx.accounts,
  );
  // Baris pendapatan (setelah baris piutang) membawa barang & qty sebagai rujukan.
  let entryLines: JournalLineInput[] = sale.entry.lines.map((l, index) => {
    const source = index >= 1 && index <= lines.length ? lines[index - 1] : null;
    return source?.item ? { ...l, itemId: source.item.id, quantity: source.line.quantity } : l;
  });
  let cost = 0;
  const warnings: string[] = [];
  const itemLines = lines.filter((l) => l.item).map((l) => ({ itemId: l.item!.id, quantity: l.line.quantity }));
  if (ctx.workspace.inventoryMethod === "perpetual" && itemLines.length > 0) {
    if (!ctx.perpetual) fail("INVALID_INVOICE", "Data stok barang belum dimuat");
    const out = outflowLines(itemLines, invoice.invoiceDate, ctx.perpetual);
    cost = out.totalCost;
    warnings.push(...out.warnings);
    const cogs = ctx.accounts.find((a) => a.systemRole === "cogs" && a.deletedAt === null);
    if (!cogs) fail("ACCOUNT_NOT_FOUND", "Akun HPP belum ada");
    if (cost > 0) entryLines = [...entryLines, { accountId: cogs.id, description: "HPP barang terjual", debit: cost, credit: 0 }, ...out.credit.filter((l) => l.credit > 0)];
  }
  return {
    entry: { ...sale.entry, lines: entryLines },
    contact,
    totals: { base: sale.base, tax: sale.tax, total: sale.total },
    cost,
    warnings,
  };
}

/** Akun yang boleh di baris faktur pembelian: aset non-kas (persediaan, perlengkapan, aset tetap) atau beban. */
export function isPurchaseAccount(a: Account): boolean {
  if (a.deletedAt !== null) return false;
  if (a.accountType === "expense") return true;
  return a.accountType === "asset" && !a.isCash && a.systemRole !== "accounts_receivable" && a.systemRole !== "input_vat";
}

/**
 * Syarat terbit faktur pembelian + jurnalnya: Dr akun per baris (barang → Persediaan
 * dengan qty) [+ PPN Masukan pada mode PPN lengkap] / Cr Utang Usaha; pada metode
 * perpetual ikut koreksi HPP bila menutup stok minus (ADR 017 & 022).
 */
export function buildPurchaseInvoice(invoice: InvoiceInput, ctx: InvoiceContext, number = "(nomor otomatis)"): InvoicePlan {
  if (invoice.kind !== "purchase") fail("INVALID_INVOICE", "Bukan faktur pembelian");
  const contact = ctx.contacts.find((c) => c.id === invoice.contactId && c.deletedAt === null);
  if (!contact) fail("CONTACT_NOT_FOUND", "Pilih pemasok dari daftar kontak");
  if (!contact.isSupplier) fail("INVALID_INVOICE", `${contact.name} bukan pemasok; aktifkan peran pemasok di Kontak`);
  if (!invoice.reference?.trim()) fail("INVALID_INVOICE", "Isi nomor faktur dari pemasok");
  if (!isValidIsoDate(invoice.invoiceDate) || !isValidIsoDate(invoice.dueDate)) fail("INVALID_DATE", "Tanggal faktur/jatuh tempo tidak valid");
  if (invoice.dueDate < invoice.invoiceDate) fail("INVALID_DATE", "Jatuh tempo tidak boleh sebelum tanggal faktur");
  if (invoice.lines.length === 0) fail("INVALID_INVOICE", "Faktur minimal berisi satu baris");
  const inventory = ctx.accounts.find((a) => a.systemRole === "inventory" && a.deletedAt === null) ?? null;

  const lines = invoice.lines.map((line, i) => {
    const n = i + 1;
    if (line.description.trim() === "") fail("INVALID_INVOICE", `Baris ${n}: keterangan wajib diisi`);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) fail("INVALID_QUANTITY", `Baris ${n}: qty harus bilangan bulat > 0`);
    if (!Number.isSafeInteger(line.unitPrice) || line.unitPrice <= 0) fail("INVALID_AMOUNT", `Baris ${n}: harga harus lebih dari 0`);
    const item = line.itemId ? ctx.items.find((it) => it.id === line.itemId && it.deletedAt === null) : null;
    if (line.itemId && !item) fail("ITEM_NOT_FOUND", `Baris ${n}: barang tidak ditemukan`);
    // Barang selalu masuk akun Persediaan agar tercatat per bahan (COGS/stok).
    if (item && !inventory) fail("ACCOUNT_NOT_FOUND", "Akun persediaan belum ada");
    const accountId = item ? inventory!.id : line.accountId;
    const account = ctx.accounts.find((a) => a.id === accountId);
    if (!account || !isPurchaseAccount(account)) fail("INVALID_ACCOUNT", `Baris ${n}: pilih akun persediaan, aset, atau beban`);
    return { line, item, accountId, amount: lineAmount(line) };
  });

  const settings = workspaceTaxSettings(ctx.workspace);
  const subtotal = lines.reduce((t, l) => t + l.amount, 0);
  const vatApplies = invoice.applyTax && settings.mode === "full_vat" && settings.rateBps > 0;
  const inputVat = vatApplies ? (invoice.taxOverride ?? computeInputVat(subtotal, settings)) : 0;
  const base = buildExpense(
    {
      workspaceId: invoice.workspaceId,
      entryDate: invoice.invoiceDate,
      description: `Faktur pembelian ${number} · ${contact.name} (${invoice.reference!.trim()})`,
      payment: { kind: "credit", counterparty: contact.name },
      source: "purchase",
      inputVat,
      items: lines.map((l) => ({ accountId: l.accountId, amount: l.amount, description: l.line.description.trim() })),
    },
    ctx.accounts,
  );
  const entryLines: JournalLineInput[] = base.lines.map((l, index) => {
    const source = index < lines.length ? lines[index] : null;
    return source?.item ? { ...l, itemId: source.item.id, quantity: source.line.quantity } : l;
  });
  const warnings: string[] = [];
  const itemLines = lines.filter((l) => l.item).map((l) => ({ itemId: l.item!.id, quantity: l.line.quantity, amount: l.amount }));
  if (ctx.workspace.inventoryMethod === "perpetual" && itemLines.length > 0) {
    if (!ctx.perpetual) fail("INVALID_INVOICE", "Data stok barang belum dimuat");
    const corrections = purchaseCorrections(itemLines, invoice.invoiceDate, ctx.perpetual);
    entryLines.push(...corrections.lines);
    warnings.push(...corrections.warnings);
  }
  return {
    entry: { ...base, lines: entryLines },
    contact,
    totals: { base: subtotal, tax: inputVat, total: subtotal + inputVat },
    cost: 0,
    warnings,
  };
}

/** Pembentuk jurnal terbit sesuai jenis faktur. */
export function buildInvoicePlan(invoice: InvoiceInput, ctx: InvoiceContext, number?: string): InvoicePlan {
  return invoice.kind === "sale" ? buildSaleInvoice(invoice, ctx, number) : buildPurchaseInvoice(invoice, ctx, number);
}

// ---------- Nomor ----------

/** `INV/2026/10/0001`: prefix/tahun/bulan/urut 4 digit (urut per tahun). */
export function formatInvoiceNumber(prefix: string, date: IsoDate, seq: number): string {
  return `${prefix}/${date.slice(0, 4)}/${date.slice(5, 7)}/${String(seq).padStart(4, "0")}`;
}

/** Urutan berikutnya untuk tahun tanggal faktur (dari faktur terbit jenis yang sama). */
export function nextInvoiceSeq(invoices: readonly Invoice[], kind: Invoice["kind"], date: IsoDate): number {
  const year = date.slice(0, 4);
  let max = 0;
  for (const inv of invoices) {
    if (inv.kind !== kind || inv.status !== "issued" || !inv.number) continue;
    const parts = inv.number.split("/");
    if (parts.length >= 4 && parts[parts.length - 3] === year) max = Math.max(max, Number(parts[parts.length - 1]) || 0);
  }
  return max + 1;
}

// ---------- Status ----------

export type InvoiceStatus = "draft" | "unpaid" | "partial" | "paid" | "overdue" | "cancelled";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  unpaid: "Belum dibayar",
  partial: "Dibayar sebagian",
  paid: "Lunas",
  overdue: "Lewat jatuh tempo",
  cancelled: "Dibatalkan",
};

export interface InvoiceSummary {
  invoice: Invoice;
  status: InvoiceStatus;
  total: number;
  paid: number;
  outstanding: number;
}

/** Status & sisa tagihan setiap faktur dari jurnal (void → dibatalkan; pelunasan → lunas/sebagian). */
export function summarizeInvoices(
  invoices: readonly Invoice[],
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  today: IsoDate,
): InvoiceSummary[] {
  const credits = new Map(listCreditTransactions(entries, accounts).map((c) => [c.entry.id, c]));
  const byId = new Map(entries.map((e) => [e.id, e]));
  return invoices.map((invoice) => {
    const draftTotal = invoice.lines.reduce((t, l) => t + lineAmount(l), 0);
    if (invoice.status === "draft" || !invoice.journalEntryId) {
      return { invoice, status: "draft", total: draftTotal, paid: 0, outstanding: 0 };
    }
    const credit = credits.get(invoice.journalEntryId);
    if (!credit) {
      const total = byId.get(invoice.journalEntryId)?.lines.reduce((t, l) => t + l.debit, 0) ?? draftTotal;
      return { invoice, status: "cancelled", total, paid: 0, outstanding: 0 };
    }
    const status: InvoiceStatus =
      credit.outstanding === 0 ? "paid" : invoice.dueDate < today ? "overdue" : credit.paid > 0 ? "partial" : "unpaid";
    return { invoice, status, total: credit.original, paid: credit.paid, outstanding: credit.outstanding };
  });
}

// ---------- Terbilang ----------

const ONES = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

function words(n: number): string {
  if (n < 12) return ONES[n];
  if (n < 20) return `${words(n - 10)} belas`;
  if (n < 100) return `${words(Math.floor(n / 10))} puluh ${words(n % 10)}`.trim();
  if (n < 200) return `seratus ${words(n - 100)}`.trim();
  if (n < 1000) return `${words(Math.floor(n / 100))} ratus ${words(n % 100)}`.trim();
  if (n < 2000) return `seribu ${words(n - 1000)}`.trim();
  const scales: [number, string][] = [[1e12, "triliun"], [1e9, "miliar"], [1e6, "juta"], [1e3, "ribu"]];
  for (const [size, name] of scales) {
    if (n >= size) return `${words(Math.floor(n / size))} ${name} ${words(n % size)}`.trim();
  }
  return "";
}

/** `1250000` → "Satu juta dua ratus lima puluh ribu rupiah". */
export function terbilang(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) return "";
  const text = amount === 0 ? "nol" : words(amount).replace(/\s+/g, " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} rupiah`;
}

/** Harga satuan × qty untuk baris draft yang belum lengkap (tampilan). */
export const safeLineAmount = (line: Pick<InvoiceLine, "quantity" | "unitPrice">) =>
  Number.isSafeInteger(line.quantity * line.unitPrice) ? line.quantity * line.unitPrice : 0;

