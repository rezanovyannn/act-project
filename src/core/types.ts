/**
 * Tipe domain inti (lihat docs/adr/011-journal-and-account-data-model.md).
 * Semua nilai uang adalah integer Rupiah utuh (ADR 005).
 */

/** Tanggal kalender format `YYYY-MM-DD`. */
export type IsoDate = string;
/** Timestamp ISO 8601 lengkap. */
export type IsoTimestamp = string;

export type TemplateType = "fnb";
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
  | "raw_material_inventory"
  | "cogs"
  | "accounts_receivable"
  | "accounts_payable"
  | "sales_tax_payable";

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
}

export type TemplateRegistry = Record<TemplateType, WorkspaceTemplate>;
