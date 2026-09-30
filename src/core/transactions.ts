/**
 * Pembentuk jurnal dari form transaksi (Input Cepat, ADR 012). Fungsi murni:
 * hasilnya diposting lewat JournalService sehingga tetap melewati validasi
 * double-entry, periode, dan pelunasan.
 */
import { fail } from "./errors";
import {
  allocateProportionally,
  computeSalesTax,
  type SalesTaxResult,
  type SalesTaxSettings,
} from "./sales-tax";
import type {
  Account,
  IsoDate,
  JournalEntry,
  JournalEntryInput,
  JournalLineInput,
  SystemRole,
} from "./types";

export type Payment =
  | { kind: "cash"; accountId: string }
  | { kind: "credit"; counterparty: string };

export interface AmountItem {
  accountId: string;
  amount: number;
  description?: string;
}

/** Akun aktif berdasarkan `system_role`; error ramah bila belum diatur. */
export function accountByRole(accounts: readonly Account[], role: SystemRole): Account {
  const account = accounts.find((a) => a.systemRole === role && a.deletedAt === null);
  if (!account) {
    fail("ACCOUNT_NOT_FOUND", `Akun sistem "${role}" belum ada di daftar akun workspace`);
  }
  return account;
}

function requireCounterparty(payment: Payment): string | null {
  if (payment.kind === "cash") return null;
  const name = payment.counterparty.trim();
  if (name === "") {
    fail("EMPTY_NAME", "Nama pelanggan/pemasok wajib diisi untuk transaksi kredit");
  }
  return name;
}

function requireItems(items: readonly AmountItem[]): AmountItem[] {
  const filled = items.filter((i) => i.accountId !== "" || i.amount !== 0);
  if (filled.length === 0 || filled.some((i) => i.accountId === "" || i.amount <= 0)) {
    fail("LINE_ZERO", "Setiap rincian wajib memiliki akun dan nominal lebih dari 0");
  }
  return filled;
}

const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0);

export interface SaleInput {
  workspaceId: string;
  entryDate: IsoDate;
  description: string;
  payment: Payment;
  /** Nominal per akun pendapatan: harga menu (sebelum/termasuk PB1 sesuai pengaturan). */
  items: AmountItem[];
  applyTax: boolean;
  tax: SalesTaxSettings;
  /** Nama pajak untuk keterangan baris, mis. "PB1" atau "PPN" (default PB1). */
  taxLabel?: string;
}

export interface SalePreview extends SalesTaxResult {
  entry: JournalEntryInput;
}

/**
 * Penjualan: Dr Kas/Bank/Piutang (total), Cr Pendapatan (dasar), Cr Utang PB1/PPN.
 * Pada mode harga termasuk pajak, pajak dibagi ke tiap rincian secara
 * proporsional agar jumlahnya tepat.
 */
export function buildSale(input: SaleInput, accounts: readonly Account[]): SalePreview {
  const items = requireItems(input.items);
  const counterparty = requireCounterparty(input.payment);
  const gross = sum(items.map((i) => i.amount));
  const taxResult = input.applyTax
    ? computeSalesTax(gross, input.tax)
    : { base: gross, tax: 0, total: gross };

  let itemBases = items.map((item) => item.amount);
  if (input.applyTax && input.tax.inclusive) {
    const taxShares = allocateProportionally(taxResult.tax, itemBases);
    itemBases = itemBases.map((amount, i) => amount - taxShares[i]);
  }

  const debitAccountId =
    input.payment.kind === "cash"
      ? input.payment.accountId
      : accountByRole(accounts, "accounts_receivable").id;

  const lines: JournalLineInput[] = [
    { accountId: debitAccountId, debit: taxResult.total, credit: 0 },
    ...items.map((item, i) => ({
      accountId: item.accountId,
      description: item.description ?? null,
      debit: 0,
      credit: itemBases[i],
    })),
  ];
  if (taxResult.tax > 0) {
    lines.push({
      accountId: accountByRole(accounts, "sales_tax_payable").id,
      description: input.taxLabel ?? "PB1",
      debit: 0,
      credit: taxResult.tax,
    });
  }

  return {
    ...taxResult,
    entry: {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description,
      source: "revenue",
      counterparty,
      lines,
    },
  };
}

export interface ExpenseInput {
  workspaceId: string;
  entryDate: IsoDate;
  description: string;
  payment: Payment;
  items: AmountItem[];
  /** `expense` (default) atau `purchase` (mis. pembelian bahan baku). */
  source?: "expense" | "purchase";
  /** PPN Masukan sesuai faktur (mode PPN lengkap, ADR 016); 0/kosong = tanpa PPN. */
  inputVat?: number;
}

/**
 * Beban/pembelian: Dr akun rincian (harga sebelum PPN), Dr PPN Masukan
 * (bila ada), Cr Kas/Bank atau Utang Usaha sebesar total.
 */
export function buildExpense(input: ExpenseInput, accounts: readonly Account[]): JournalEntryInput {
  const items = requireItems(input.items);
  const counterparty = requireCounterparty(input.payment);
  const inputVat = input.inputVat ?? 0;
  if (!Number.isSafeInteger(inputVat) || inputVat < 0) {
    fail("INVALID_AMOUNT", "PPN Masukan harus bilangan bulat Rupiah tidak negatif");
  }
  const creditAccountId =
    input.payment.kind === "cash"
      ? input.payment.accountId
      : accountByRole(accounts, "accounts_payable").id;
  const vatLines: JournalLineInput[] =
    inputVat > 0 ? [{ accountId: accountByRole(accounts, "input_vat").id, description: "PPN Masukan", debit: inputVat, credit: 0 }] : [];
  return {
    workspaceId: input.workspaceId,
    entryDate: input.entryDate,
    description: input.description,
    source: input.source ?? "expense",
    counterparty,
    lines: [
      ...items.map((item) => ({
        accountId: item.accountId,
        description: item.description ?? null,
        debit: item.amount,
        credit: 0,
      })),
      ...vatLines,
      { accountId: creditAccountId, debit: 0, credit: sum(items.map((i) => i.amount)) + inputVat },
    ],
  };
}

export interface SettlementInput {
  target: JournalEntry;
  entryDate: IsoDate;
  amount: number;
  cashAccountId: string;
  description?: string;
}

/**
 * Pelunasan transaksi kredit: penerimaan piutang (Dr Kas, Cr Piutang) atau
 * pembayaran utang (Dr Utang, Cr Kas), memakai akun piutang/utang jurnal asal.
 */
export function buildSettlement(
  input: SettlementInput,
  accounts: readonly Account[],
): JournalEntryInput {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    fail("INVALID_AMOUNT", "Nominal pelunasan harus lebih dari 0");
  }
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const claimLine = input.target.lines.find((l) => {
    const role = byId.get(l.accountId)?.systemRole;
    return role === "accounts_receivable" || role === "accounts_payable";
  });
  if (!claimLine) {
    fail("INVALID_SETTLEMENT", "Transaksi ini bukan transaksi kredit");
  }
  const isReceivable = byId.get(claimLine.accountId)!.systemRole === "accounts_receivable";
  const who = input.target.counterparty ? ` ${input.target.counterparty}` : "";
  return {
    workspaceId: input.target.workspaceId,
    entryDate: input.entryDate,
    description:
      input.description?.trim() ||
      `${isReceivable ? "Penerimaan piutang" : "Pembayaran utang"}${who} (${input.target.entryNumber ?? "draft"})`,
    source: "settlement",
    counterparty: input.target.counterparty,
    settlementOf: input.target.id,
    lines: isReceivable
      ? [
          { accountId: input.cashAccountId, debit: input.amount, credit: 0 },
          { accountId: claimLine.accountId, debit: 0, credit: input.amount },
        ]
      : [
          { accountId: claimLine.accountId, debit: input.amount, credit: 0 },
          { accountId: input.cashAccountId, debit: 0, credit: input.amount },
        ],
  };
}

export interface TaxPaymentInput {
  workspaceId: string;
  entryDate: IsoDate;
  amount: number;
  cashAccountId: string;
  description?: string;
  /** Nama pajak untuk keterangan default, mis. "PB1" atau "PPN" (default PB1). */
  taxLabel?: string;
}

/** Setoran pajak penjualan (PB1/PPN): Dr Utang pajak, Cr Kas/Bank. */
export function buildTaxPayment(
  input: TaxPaymentInput,
  accounts: readonly Account[],
): JournalEntryInput {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    fail("INVALID_AMOUNT", "Nominal setoran harus lebih dari 0");
  }
  return {
    workspaceId: input.workspaceId,
    entryDate: input.entryDate,
    description: input.description?.trim() || `Setoran ${input.taxLabel ?? "PB1"}`,
    source: "tax_payment",
    lines: [
      { accountId: accountByRole(accounts, "sales_tax_payable").id, debit: input.amount, credit: 0 },
      { accountId: input.cashAccountId, debit: 0, credit: input.amount },
    ],
  };
}
