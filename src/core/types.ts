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
  | "non_creditable_vat";

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
  | "closing";

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

export type AuditEntity = "workspace" | "account" | "period" | "journal";

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
