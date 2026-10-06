/**
 * Tipe domain inti (lihat docs/adr/011-journal-and-account-data-model.md).
 * Semua nilai uang adalah integer Rupiah utuh (ADR 005).
 */

/** Tanggal kalender format `YYYY-MM-DD`. */
export type IsoDate = string;
/** Timestamp ISO 8601 lengkap. */
export type IsoTimestamp = string;

import type { SalesTaxLabel, SalesTaxMode, WorkspaceTaxSettings } from "./sales-tax";

export type TemplateType = "fnb" | "retail";
export type Currency = "IDR";

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "cogs"
  | "expense";

export type NormalBalance = "debit" | "credit";

export type CashFlowCategory = "operating" | "investing" | "financing" | "none";

export type SystemRole =
  | "opening_balance_equity"
  | "retained_earnings"
  | "owner_capital"
  | "drawings"
  | "inventory"
  | "cogs"
  | "accounts_receivable"
  | "accounts_payable"
  | "sales_tax_payable"
  | "income_summary"
  | "input_vat"
  | "non_creditable_vat"
  | "sales_returns";

export type PeriodStatus = "open" | "closed";

export type JournalStatus = "draft" | "posted";

export type JournalSource =
  | "manual"
  | "revenue"
  | "expense"
  | "purchase"
  | "adjustment"
  | "opening_balance"
  | "settlement"
  | "tax_payment"
  | "reversal"
  | "closing"
  /** Retur tunai barang (ADR 017); retur yang mengurangi tagihan bersumber settlement. */
  | "return";

/** Metode persediaan per workspace (ADR 007, 015 & 017). */
export type InventoryMethod = "periodic" | "perpetual";
/** Metode biaya persediaan perpetual (ADR 017). */
export type CostMethod = "average" | "fifo";
/** Metode biaya yang berlaku mulai tanggal `from` (inklusif). */
/** Dasar nilai stok akhir pada stok opname sisa bahan (ADR 020). */
export type StockValuation = "average" | "last";

export interface CostMethodPeriod {
  method: CostMethod;
  from: IsoDate;
}

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  templateType: TemplateType;
  currency: Currency;
  booksStartDate: IsoDate;
  /** Nama pajak penjualan: PB1 (restoran) atau PPN (ADR 015). */
  salesTaxLabel: SalesTaxLabel;
  /** Tarif pajak penjualan dalam basis poin (1000 = 10%), ADR 012. */
  salesTaxRateBps: number;
  /** `true` bila harga jual sudah termasuk pajak. */
  salesTaxInclusive: boolean;
  /** Mode pajak: sederhana atau PPN lengkap (ADR 016). */
  salesTaxMode: SalesTaxMode;
  /** DPP PPN sebagai pecahan (mis. 11/12), dipakai pada mode PPN lengkap. */
  vatDppNumerator: number;
  vatDppDenominator: number;
  /** Periodik atau perpetual per barang (ADR 017). */
  inventoryMethod: InventoryMethod;
  /** Riwayat metode biaya, terurut; elemen terakhir = metode saat ini. */
  costMethodHistory: CostMethodPeriod[];
  /** Harga satuan untuk menilai sisa bahan: rata-rata atau beli terakhir (ADR 020). */
  stockValuation: StockValuation;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface Account {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  cashFlowCategory: CashFlowCategory;
  isCash: boolean;
  systemRole: SystemRole | null;
  isActive: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface Period {
  id: string;
  workspaceId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  status: PeriodStatus;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface JournalLine {
  id: string;
  accountId: string;
  lineNo: number;
  description: string | null;
  /** Tepat satu dari `debit`/`credit` bernilai > 0 pada jurnal posted. */
  debit: number;
  credit: number;
  /** Barang & kuantitas (satuan dasar, bilangan bulat ≥ 0), ADR 017. */
  itemId: string | null;
  quantity: number | null;
}

export interface JournalEntry {
  id: string;
  workspaceId: string;
  /** Diisi saat posting, mis. `JU-2026-0001`. Draft = null. */
  entryNumber: string | null;
  entryDate: IsoDate;
  description: string;
  status: JournalStatus;
  source: JournalSource;
  /** Nama pelanggan/pemasok (transaksi kredit & pelunasan, ADR 012). */
  counterparty: string | null;
  /** Jurnal transaksi kredit yang dilunasi oleh jurnal ini (ADR 012). */
  settlementOf: string | null;
  reversalOf: string | null;
  correctionOf: string | null;
  /** Transaksi barang yang diretur oleh jurnal ini (ADR 017). */
  returnOf: string | null;
  postedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
  lines: JournalLine[];
}

/** Baris jurnal yang dikirim dari form/service (tanpa id & nomor baris). */
export interface JournalLineInput {
  accountId: string;
  description?: string | null;
  debit: number;
  credit: number;
  itemId?: string | null;
  quantity?: number | null;
}

/** Data jurnal sebelum disimpan (draft) atau diposting. */
export interface JournalEntryInput {
  workspaceId: string;
  entryDate: IsoDate;
  description: string;
  source: JournalSource;
  counterparty?: string | null;
  settlementOf?: string | null;
  reversalOf?: string | null;
  correctionOf?: string | null;
  returnOf?: string | null;
  lines: JournalLineInput[];
}

/** Akun pada template CoA (sebelum dimiliki workspace). */
export interface AccountSeed {
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  cashFlowCategory: CashFlowCategory;
  isCash: boolean;
  systemRole: SystemRole | null;
}

export interface WorkspaceTemplate {
  type: TemplateType;
  label: string;
  accounts: AccountSeed[];
  /** Istilah persediaan di UI, mis. "bahan baku" atau "barang dagang" (ADR 015). */
  inventoryNoun: string;
  /** Pengaturan pajak penjualan awal workspace baru. */
  salesTaxDefaults: WorkspaceTaxSettings;
}

export type TemplateRegistry = Record<TemplateType, WorkspaceTemplate>;

export type AuditEntity = "workspace" | "account" | "period" | "journal" | "item" | "menu" | "recipe" | "portion_summary" | "contact" | "invoice";

/** Master barang untuk persediaan perpetual (ADR 017). */
export interface Item {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  /** Satuan dasar, mis. pcs, gram, ml. */
  unit: string;
  /** Akun pendapatan default saat barang dijual. */
  revenueAccountId: string | null;
  /** Section/kategori bebas, mis. "Protein", "Sayur & Buah" (ADR 020). */
  category: string | null;
  isActive: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface ItemInput {
  code: string;
  name: string;
  unit: string;
  revenueAccountId: string | null;
  category?: string | null;
}

/** Identitas usaha di kop faktur (ADR 022). */
export interface BusinessProfileInput {
  /** Nama di faktur; null = nama workspace. */
  displayName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  npwp: string | null;
  /** Info rekening pembayaran, teks bebas multi-baris. */
  bankInfo: string | null;
  /** Catatan kaki default faktur. */
  invoiceNotes: string | null;
  /** Prefix nomor faktur penjualan, mis. "INV". */
  invoicePrefix: string;
  /** Prefix nomor internal faktur pembelian, mis. "PB". */
  purchasePrefix: string;
  /** Logo kecil sebagai data URL image/png|jpeg|webp. */
  logoDataUrl: string | null;
}

export interface BusinessProfile extends BusinessProfileInput {
  workspaceId: string;
  updatedAt: IsoTimestamp | null;
}

/** Pelanggan/pemasok (ADR 022); nama menjadi counterparty jurnal. */
export interface ContactInput {
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  address: string | null;
  phone: string | null;
  email: string | null;
  npwp: string | null;
  /** Termin bayar default (hari). */
  paymentTermDays: number;
  notes: string | null;
}

export interface Contact extends ContactInput {
  id: string;
  workspaceId: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export type InvoiceKind = "sale" | "purchase";

/** Diskon faktur: persen dalam basis poin (1250 = 12,5%) atau nominal rupiah. */
export interface InvoiceDiscount {
  kind: "percent" | "amount";
  value: number;
}

/** Baris faktur: nominal = qty × harga satuan (rupiah utuh). */
export interface InvoiceLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  /** Akun pendapatan (penjualan) atau persediaan/beban (pembelian); "" = belum dipilih (draft). */
  accountId: string;
  itemId: string | null;
}

export interface InvoiceInput {
  workspaceId: string;
  kind: InvoiceKind;
  contactId: string | null;
  invoiceDate: IsoDate;
  dueDate: IsoDate;
  /** No. PO pelanggan (penjualan) atau no. faktur pemasok (pembelian). */
  reference: string | null;
  notes: string | null;
  applyTax: boolean;
  /** Koreksi PPN Masukan sesuai faktur pemasok (pembelian, mode PPN lengkap); null = dihitung. */
  taxOverride?: number | null;
  /** Diskon per faktur (ROADMAP Fase 8B); null = tanpa diskon. */
  discount?: InvoiceDiscount | null;
  lines: InvoiceLine[];
}

/** Salinan data kontak saat faktur terbit. */
export type ContactSnapshot = Pick<Contact, "name" | "address" | "phone" | "email" | "npwp">;

export interface Invoice extends InvoiceInput {
  id: string;
  status: "draft" | "issued";
  number: string | null;
  journalEntryId: string | null;
  contactSnapshot: ContactSnapshot | null;
  issuedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Menu yang dijual (ADR 021). */
export interface Menu {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  /** Kategori bebas, mis. "Makanan", "Minuman". */
  category: string | null;
  /** Harga jual default per porsi (rupiah utuh, sesuai pengaturan PB1 termasuk/belum). */
  price: number;
  revenueAccountId: string | null;
  isActive: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface MenuInput {
  code: string;
  name: string;
  category?: string | null;
  price: number;
  revenueAccountId: string | null;
}

/** Bahan per resep: qty satuan dasar untuk `yieldPortions` porsi. */
export interface RecipeLine {
  itemId: string;
  quantity: number;
}

/** Versi resep menu yang berlaku mulai `effectiveFrom` (ADR 021). */
export interface RecipeInput {
  workspaceId: string;
  menuId: string;
  effectiveFrom: IsoDate;
  /** Resep untuk N porsi (bilangan bulat ≥ 1); qty per porsi = qty ÷ N. */
  yieldPortions: number;
  lines: RecipeLine[];
}

export interface Recipe extends RecipeInput {
  id: string;
  createdAt: IsoTimestamp;
}

export interface PortionLine {
  menuId: string;
  portions: number;
}

/** Rekap porsi terjual per rentang tanggal (mis. dari laporan POS), ADR 021. */
export interface PortionSummaryInput {
  workspaceId: string;
  dateFrom: IsoDate;
  dateTo: IsoDate;
  note: string | null;
  lines: PortionLine[];
}

export interface PortionSummary extends PortionSummaryInput {
  id: string;
  createdAt: IsoTimestamp;
}

/** Rincian porsi penjualan menu; `amount` = nominal baris seperti diinput. */
export interface MenuSaleLine extends PortionLine {
  amount: number;
}

/** Penjualan menu aktif (jurnalnya belum di-void), ADR 021. */
export interface MenuSale {
  journalEntryId: string;
  workspaceId: string;
  entryDate: IsoDate;
  lines: MenuSaleLine[];
}

/** Baris stok opname sisa bahan: qty sisa & nilai rupiahnya (ADR 020). */
export interface StockCountLine {
  itemId: string;
  quantity: number;
  value: number;
}

export interface StockCountInput {
  workspaceId: string;
  countDate: IsoDate;
  valuation: StockValuation;
  lines: StockCountLine[];
}

export interface StockCount extends StockCountInput {
  id: string;
  /** Jurnal penyesuaian HPP; null bila nilai fisik = saldo buku. */
  journalEntryId: string | null;
  createdAt: IsoTimestamp;
}

/**
 * Jejak audit mutasi (AGENTS.md prinsip 10). Fase 1: ditulis mock repository
 * dalam operasi yang sama; Fase 2: trigger database.
 */
export interface AuditLog {
  id: string;
  workspaceId: string;
  entityType: AuditEntity;
  entityId: string;
  action: string;
  /** Alasan dari pengguna, mis. saat membuka kembali periode. */
  reason: string | null;
  before: unknown;
  after: unknown;
  /** `null` = perubahan oleh sistem (mis. migrasi skema). */
  actorId: string | null;
  createdAt: IsoTimestamp;
}
