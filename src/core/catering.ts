/**
 * Pesanan katering, uang muka (DP), invoice DP, dan jurnal otomatisnya
 * (ADR 024). Fungsi murni: DP dicatat sebagai Uang Muka Pelanggan (utang)
 * dengan baris jurnal bertag pesanan; pendapatan diakui lewat faktur penjualan
 * saat pesanan selesai, lalu saldo DP melunasi faktur tersebut.
 */
import { validatePolicy } from "./cancellation-policy";
import { isValidIsoDate } from "./dates";
import { fail } from "./errors";
import { discountAmount, lineAmount, summarizeInvoices, validateDiscount, type InvoiceSummary } from "./invoice";
import { computeSalesTax, effectiveTaxSettings } from "./sales-tax";
import { mulDivRound } from "./stock";
import { accountByRole, buildExpense, type Payment } from "./transactions";
import type {
  Account,
  CancellationPolicy,
  CateringOrder,
  CateringOrderInput,
  CateringServiceType,
  Contact,
  Invoice,
  InvoiceInput,
  IsoDate,
  JournalEntry,
  JournalEntryInput,
  OrderBill,
  OrderBillInput,
  CateringCostMode,
  CateringSettings,
  CostCategory,
  CostEstimates,
  Workspace,
} from "./types";
import { workspaceTaxSettings } from "./vat";

const trimOrNull = (value: string | null | undefined) => value?.trim() || null;

export const SERVICE_TYPE_LABELS: Record<CateringServiceType, string> = {
  event: "Acara",
  box: "Nasi box / kantor",
  subscription: "Langganan",
};

export { DEFAULT_CANCELLATION_POLICY, policyLabel, validatePolicy } from "./cancellation-policy";

// ---------- Pesanan ----------

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validasi bentuk pesanan yang disimpan (penawaran boleh baris belum lengkap). */
export function validateOrderInput(input: CateringOrderInput): CateringOrderInput {
  if (!input.contactId) fail("CONTACT_NOT_FOUND", "Pilih klien dari daftar kontak");
  if (!(input.serviceType in SERVICE_TYPE_LABELS)) fail("INVALID_ORDER", "Jenis pesanan tidak dikenal");
  for (const date of [input.eventDate, input.quoteDate, input.validUntil]) {
    if (!isValidIsoDate(date)) fail("INVALID_DATE", "Tanggal acara/penawaran tidak valid");
  }
  if (input.validUntil < input.quoteDate) fail("INVALID_DATE", "Masa berlaku penawaran tidak boleh sebelum tanggal penawaran");
  const eventTime = trimOrNull(input.eventTime);
  if (eventTime && !TIME_PATTERN.test(eventTime)) fail("INVALID_ORDER", "Jam acara harus berformat JJ:MM, mis. 11:30");
  if (!Number.isSafeInteger(input.pax) || input.pax < 1 || input.pax > 1_000_000) fail("INVALID_ORDER", "Jumlah pax harus bilangan bulat ≥ 1");
  if (input.lines.length > 200) fail("INVALID_ORDER", "Pesanan maksimal 200 baris");
  const lines = input.lines.map((line, i) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0) {
      fail("INVALID_QUANTITY", `Baris ${i + 1}: qty dan harga harus bilangan bulat ≥ 0`);
    }
    lineAmount(line);
    return { description: line.description.trim(), quantity: line.quantity, unit: trimOrNull(line.unit), unitPrice: line.unitPrice, accountId: line.accountId, itemId: null };
  });
  return {
    ...input,
    eventTime,
    location: trimOrNull(input.location),
    notes: trimOrNull(input.notes),
    discount: validateDiscount(input.discount ?? null),
    cancellationPolicy: validatePolicy(input.cancellationPolicy),
    costEstimates: validateCostEstimates(input.costEstimates ?? {}),
    lines,
  };
}

/** Syarat pesanan siap dikonfirmasi/diselesaikan: klien pelanggan, baris lengkap, akun pendapatan. */
export function assertOrderComplete(order: CateringOrderInput, accounts: readonly Account[], contacts: readonly Contact[]): Contact {
  const contact = contacts.find((c) => c.id === order.contactId && c.deletedAt === null);
  if (!contact) fail("CONTACT_NOT_FOUND", "Pilih klien dari daftar kontak");
  if (!contact.isCustomer) fail("INVALID_ORDER", `${contact.name} bukan pelanggan; aktifkan peran pelanggan di Kontak`);
  if (order.lines.length === 0) fail("INVALID_ORDER", "Pesanan minimal berisi satu baris");
  order.lines.forEach((line, i) => {
    const n = i + 1;
    if (line.description.trim() === "") fail("INVALID_ORDER", `Baris ${n}: keterangan wajib diisi`);
    if (line.quantity <= 0) fail("INVALID_QUANTITY", `Baris ${n}: qty harus lebih dari 0`);
    if (line.unitPrice <= 0) fail("INVALID_AMOUNT", `Baris ${n}: harga harus lebih dari 0`);
    const account = accounts.find((a) => a.id === line.accountId && a.deletedAt === null);
    if (!account || account.accountType !== "revenue") fail("INVALID_ACCOUNT", `Baris ${n}: pilih akun pendapatan`);
  });
  return contact;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  /** Pendapatan setelah diskon, tanpa pajak. */
  base: number;
  tax: number;
  total: number;
}

/** Total pesanan dengan aturan yang sama seperti faktur penjualan (diskon lalu pajak, ADR 012 & Fase 8B). */
export function orderTotals(order: Pick<CateringOrderInput, "lines" | "discount" | "applyTax">, workspace: Workspace): OrderTotals {
  const subtotal = order.lines.reduce((t, l) => t + (Number.isSafeInteger(l.quantity * l.unitPrice) ? l.quantity * l.unitPrice : 0), 0);
  const discount = Math.min(discountAmount(subtotal, order.discount), subtotal);
  const net = subtotal - discount;
  const settings = workspaceTaxSettings(workspace);
  if (!order.applyTax || settings.rateBps === 0 || net === 0) return { subtotal, discount, base: net, tax: 0, total: net };
  const result = computeSalesTax(net, effectiveTaxSettings(settings));
  return { subtotal, discount, base: result.total - result.tax, tax: result.tax, total: result.total };
}

/** Faktur penjualan pelunasan dari pesanan (ADR 024). */
export function orderInvoiceInput(order: CateringOrder, invoiceDate: IsoDate, dueDate: IsoDate): InvoiceInput {
  return {
    workspaceId: order.workspaceId,
    kind: "sale",
    contactId: order.contactId,
    invoiceDate,
    dueDate,
    reference: order.number,
    notes: order.notes,
    applyTax: order.applyTax,
    taxOverride: null,
    discount: order.discount,
    lines: order.lines.map((l) => ({ ...l, itemId: null })),
  };
}

/** Tag semua baris jurnal dengan pesanan. */
export function tagOrder(entry: JournalEntryInput, orderId: string): JournalEntryInput {
  return { ...entry, lines: entry.lines.map((l) => ({ ...l, orderId })) };
}

// ---------- Uang muka per pesanan ----------

export interface DepositFlow {
  /** DP diterima (kredit Uang Muka dari jurnal uang muka). */
  received: number;
  /** DP dipakai melunasi faktur pesanan. */
  applied: number;
  /** DP dikembalikan ke klien. */
  refunded: number;
  /** DP hangus karena pembatalan. */
  forfeited: number;
  /** Saldo Uang Muka Pelanggan pesanan ini. */
  balance: number;
}

const emptyFlow = (): DepositFlow => ({ received: 0, applied: 0, refunded: 0, forfeited: 0, balance: 0 });

/** Jurnal posted yang masih berlaku (bukan pembalik dan belum di-void). */
export function activeJournals(entries: readonly JournalEntry[]): JournalEntry[] {
  const posted = entries.filter((e) => e.status === "posted" && e.deletedAt === null);
  const reversed = new Set(posted.filter((e) => e.reversalOf).map((e) => e.reversalOf!));
  return posted.filter((e) => e.source !== "reversal" && !reversed.has(e.id));
}

/** Mutasi Uang Muka Pelanggan per pesanan dari jurnal berlaku (ADR 024). */
export function depositFlows(entries: readonly JournalEntry[], accounts: readonly Account[]): Map<string, DepositFlow> {
  const deposits = new Set(accounts.filter((a) => a.systemRole === "customer_deposits").map((a) => a.id));
  const revenue = new Set(accounts.filter((a) => a.accountType === "revenue").map((a) => a.id));
  const flows = new Map<string, DepositFlow>();
  for (const entry of activeJournals(entries)) {
    const forfeitEntry = entry.lines.some((l) => revenue.has(l.accountId) && l.credit > 0);
    for (const line of entry.lines) {
      if (!line.orderId || !deposits.has(line.accountId)) continue;
      const flow = flows.get(line.orderId) ?? emptyFlow();
      flow.balance += line.credit - line.debit;
      if (line.credit > 0) flow.received += line.credit;
      if (line.debit > 0) {
        if (entry.source === "settlement") flow.applied += line.debit;
        else if (forfeitEntry) {
          // Pembatalan: bagian hangus = kredit akun pendapatan; sisanya dikembalikan.
          const forfeit = entry.lines.filter((l) => revenue.has(l.accountId)).reduce((t, l) => t + l.credit, 0);
          flow.forfeited += Math.min(forfeit, line.debit);
          flow.refunded += line.debit - Math.min(forfeit, line.debit);
        } else flow.refunded += line.debit;
      }
      flows.set(line.orderId, flow);
    }
  }
  return flows;
}

// ---------- Ringkasan & tagihan ----------

export type OrderStatus = "quotation" | "expired" | "confirmed" | "completed" | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  quotation: "Penawaran",
  expired: "Penawaran kedaluwarsa",
  confirmed: "Dikonfirmasi",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export type PaymentStatus = "none" | "unpaid" | "partial" | "paid" | "overdue";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  none: "—",
  unpaid: "Belum dibayar",
  partial: "Dibayar sebagian",
  paid: "Lunas",
  overdue: "Lewat jatuh tempo",
};

export interface OrderSummary {
  order: CateringOrder;
  status: OrderStatus;
  totals: OrderTotals;
  deposit: DepositFlow;
  /** Faktur pelunasan (pesanan selesai). */
  invoice: InvoiceSummary | null;
  /** Sudah dibayar klien: DP + pelunasan faktur di luar pemakaian DP. */
  paid: number;
  /** Sisa yang belum dibayar klien (0 untuk penawaran/dibatalkan). */
  outstanding: number;
  /** DP melebihi total faktur dan belum dikembalikan. */
  excessDeposit: number;
  paymentStatus: PaymentStatus;
}

export function summarizeOrders(
  orders: readonly CateringOrder[],
  ctx: { workspace: Workspace; accounts: readonly Account[]; journals: readonly JournalEntry[]; invoices: readonly Invoice[] },
  today: IsoDate,
): OrderSummary[] {
  const flows = depositFlows(ctx.journals, ctx.accounts);
  const invoiceSummaries = new Map(summarizeInvoices(ctx.invoices, ctx.journals, ctx.accounts, today).map((s) => [s.invoice.id, s]));
  return orders.map((order) => {
    const totals = orderTotals(order, ctx.workspace);
    const deposit = flows.get(order.id) ?? emptyFlow();
    const invoice = order.invoiceId ? (invoiceSummaries.get(order.invoiceId) ?? null) : null;
    let status: OrderStatus = order.state;
    if (order.state === "quotation" && order.validUntil < today) status = "expired";
    let paid = deposit.received - deposit.refunded - deposit.forfeited;
    let outstanding = 0;
    let excessDeposit = 0;
    let paymentStatus: PaymentStatus = "none";
    if (order.state === "completed" && invoice) {
      paid = invoice.paid + deposit.balance;
      outstanding = invoice.outstanding;
      excessDeposit = deposit.balance;
      paymentStatus = invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue" : invoice.paid > 0 ? "partial" : "unpaid";
    } else if (order.state === "confirmed") {
      outstanding = Math.max(totals.total - deposit.balance, 0);
      excessDeposit = Math.max(deposit.balance - totals.total, 0);
      paymentStatus = outstanding === 0 ? "paid" : deposit.balance > 0 ? "partial" : "unpaid";
    } else if (order.state === "quotation" && deposit.balance > 0) {
      outstanding = Math.max(totals.total - deposit.balance, 0);
      paymentStatus = "partial";
    }
    return { order, status, totals, deposit, invoice, paid, outstanding, excessDeposit, paymentStatus };
  });
}

export interface BillSummary {
  bill: OrderBill;
  /** Bagian DP yang dialokasikan ke invoice DP ini (FIFO). */
  paid: number;
  outstanding: number;
  status: PaymentStatus;
}

/** Status invoice DP: DP diterima dialokasikan berurutan ke invoice DP pesanan yang sama. */
export function summarizeBills(bills: readonly OrderBill[], flows: ReadonlyMap<string, DepositFlow>, today: IsoDate): BillSummary[] {
  const remaining = new Map<string, number>();
  const ordered = [...bills].sort((a, b) => a.billDate.localeCompare(b.billDate) || a.createdAt.localeCompare(b.createdAt));
  const result = new Map<string, BillSummary>();
  for (const bill of ordered) {
    const pool = remaining.get(bill.orderId) ?? flows.get(bill.orderId)?.received ?? 0;
    const paid = Math.min(pool, bill.amount);
    remaining.set(bill.orderId, pool - paid);
    const outstanding = bill.amount - paid;
    const status: PaymentStatus = outstanding === 0 ? "paid" : bill.dueDate < today ? "overdue" : paid > 0 ? "partial" : "unpaid";
    result.set(bill.id, { bill, paid, outstanding, status });
  }
  return bills.map((b) => result.get(b.id)!);
}

export interface ClientSummary {
  contactId: string;
  name: string;
  orders: number;
  /** Total pesanan aktif (dikonfirmasi & selesai). */
  total: number;
  /** Saldo DP yang dipegang (= bagian saldo Uang Muka Pelanggan). */
  depositHeld: number;
  /** Sisa yang belum dibayar. */
  outstanding: number;
  /** Bagian sisa yang sudah ditagih lewat faktur (= bagian Piutang Usaha). */
  receivable: number;
  nextEventDate: IsoDate | null;
}

/** Ringkasan DP & sisa tagihan per klien (ROADMAP Catatan Keputusan 75). */
export function summarizeClients(summaries: readonly OrderSummary[], contacts: readonly Contact[], today: IsoDate): ClientSummary[] {
  const byClient = new Map<string, ClientSummary>();
  for (const s of summaries) {
    if (s.order.state === "cancelled" || (s.order.state === "quotation" && s.deposit.balance === 0)) continue;
    const name = contacts.find((c) => c.id === s.order.contactId)?.name ?? "—";
    const c = byClient.get(s.order.contactId) ?? { contactId: s.order.contactId, name, orders: 0, total: 0, depositHeld: 0, outstanding: 0, receivable: 0, nextEventDate: null };
    c.orders += 1;
    c.total += s.order.state === "completed" ? (s.invoice?.total ?? s.totals.total) : s.totals.total;
    c.depositHeld += s.deposit.balance;
    c.outstanding += s.outstanding;
    if (s.order.state === "completed") c.receivable += s.outstanding;
    if (s.order.state !== "completed" && s.order.eventDate >= today && (!c.nextEventDate || s.order.eventDate < c.nextEventDate)) {
      c.nextEventDate = s.order.eventDate;
    }
    byClient.set(s.order.contactId, c);
  }
  return [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name, "id"));
}

// ---------- Nomor ----------

/** Urutan berikutnya per tahun dari nomor `PREFIX/yyyy/mm/urut` (termasuk yang dihapus agar tidak dipakai ulang). */
export function nextNumberSeq(numbers: readonly string[], date: IsoDate): number {
  const year = date.slice(0, 4);
  let max = 0;
  for (const number of numbers) {
    const parts = number.split("/");
    if (parts.length >= 4 && parts[parts.length - 3] === year) max = Math.max(max, Number(parts[parts.length - 1]) || 0);
  }
  return max + 1;
}

/** Prefix invoice DP: prefix faktur penjualan + "-DP" (ADR 024). */
export const billPrefix = (invoicePrefix: string) => `${invoicePrefix}-DP`;

// ---------- Invoice DP ----------

export function validateBill(input: OrderBillInput, order: CateringOrder, existing: readonly OrderBill[], workspace: Workspace): OrderBillInput {
  if (order.state === "completed" || order.state === "cancelled") fail("INVALID_ORDER", "Invoice DP hanya untuk pesanan yang belum selesai/dibatalkan");
  if (!isValidIsoDate(input.billDate) || !isValidIsoDate(input.dueDate)) fail("INVALID_DATE", "Tanggal invoice DP tidak valid");
  if (input.dueDate < input.billDate) fail("INVALID_DATE", "Jatuh tempo tidak boleh sebelum tanggal invoice");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) fail("INVALID_AMOUNT", "Nominal DP harus lebih dari 0");
  const total = orderTotals(order, workspace).total;
  const billed = existing.filter((b) => b.orderId === order.id).reduce((t, b) => t + b.amount, 0);
  if (billed + input.amount > total) fail("INVALID_AMOUNT", "Total invoice DP melebihi total pesanan");
  return { ...input, note: trimOrNull(input.note) };
}

// ---------- Jurnal otomatis ----------

function requireCash(accounts: readonly Account[], id: string): Account {
  const account = accounts.find((a) => a.id === id && a.deletedAt === null);
  if (!account || !account.isCash) fail("INVALID_ACCOUNT", "Pilih rekening kas/bank");
  if (!account.isActive) fail("ACCOUNT_INACTIVE", `Rekening ${account.name} sudah nonaktif`);
  return account;
}

function requireAmount(amount: number, label: string) {
  if (!Number.isSafeInteger(amount) || amount <= 0) fail("INVALID_AMOUNT", `${label} harus lebih dari 0`);
}

export interface PaymentInput {
  date: IsoDate;
  amount: number;
  /** Rekening kas/bank, dipilih setiap kali (Catatan Keputusan 85). */
  cashAccountId: string;
}

/** Terima DP: Dr Kas/Bank / Cr Uang Muka Pelanggan, bertag pesanan. */
export function buildDepositReceipt(order: CateringOrder, clientName: string, payment: PaymentInput, accounts: readonly Account[]): JournalEntryInput {
  if (order.state === "completed" || order.state === "cancelled") fail("INVALID_DEPOSIT", "DP hanya untuk pesanan yang belum selesai/dibatalkan");
  requireAmount(payment.amount, "Nominal DP");
  const cash = requireCash(accounts, payment.cashAccountId);
  const deposits = accountByRole(accounts, "customer_deposits");
  return {
    workspaceId: order.workspaceId,
    entryDate: payment.date,
    description: `DP pesanan ${order.number} · ${clientName}`,
    source: "deposit",
    counterparty: clientName,
    lines: [
      { accountId: cash.id, debit: payment.amount, credit: 0, orderId: order.id },
      { accountId: deposits.id, description: "Uang muka pesanan", debit: 0, credit: payment.amount, orderId: order.id },
    ],
  };
}

/** Kembalikan DP (mis. kelebihan bayar): Dr Uang Muka Pelanggan / Cr Kas/Bank. */
export function buildDepositRefund(order: CateringOrder, clientName: string, payment: PaymentInput, balance: number, accounts: readonly Account[]): JournalEntryInput {
  requireAmount(payment.amount, "Nominal pengembalian");
  if (payment.amount > balance) fail("INVALID_DEPOSIT", "Pengembalian melebihi saldo DP pesanan");
  const cash = requireCash(accounts, payment.cashAccountId);
  const deposits = accountByRole(accounts, "customer_deposits");
  return {
    workspaceId: order.workspaceId,
    entryDate: payment.date,
    description: `Pengembalian DP ${order.number} · ${clientName}`,
    source: "deposit",
    counterparty: clientName,
    lines: [
      { accountId: deposits.id, description: "Pengembalian uang muka", debit: payment.amount, credit: 0, orderId: order.id },
      { accountId: cash.id, debit: 0, credit: payment.amount, orderId: order.id },
    ],
  };
}

/** Pelunasan faktur pesanan selesai: Dr Kas/Bank / Cr Piutang (ADR 012). */
export function buildOrderSettlement(
  order: CateringOrder,
  clientName: string,
  invoiceJournal: JournalEntry,
  payment: PaymentInput,
  accounts: readonly Account[],
  /** PPh 23 yang dipotong pelanggan (Fase 10B); 0 = tidak dipotong. */
  withholding = 0,
): JournalEntryInput {
  requireAmount(payment.amount, "Nominal pembayaran");
  const cash = requireCash(accounts, payment.cashAccountId);
  if (!Number.isSafeInteger(withholding) || withholding < 0) fail("INVALID_AMOUNT", "PPh 23 harus bilangan bulat ≥ 0");
  if (withholding > 0) {
    const prepaid = accounts.find((a) => a.systemRole === "pph23_prepaid" && a.deletedAt === null);
    if (!prepaid) fail("ACCOUNT_NOT_FOUND", "Akun PPh 23 Dibayar Dimuka belum ada");
    return {
      workspaceId: order.workspaceId,
      entryDate: payment.date,
      description: `Pelunasan pesanan ${order.number} · ${clientName} (dipotong PPh 23)`,
      source: "settlement",
      counterparty: clientName,
      settlementOf: invoiceJournal.id,
      lines: [
        { accountId: cash.id, debit: payment.amount, credit: 0, orderId: order.id },
        { accountId: prepaid.id, description: "PPh 23 dipotong pelanggan", debit: withholding, credit: 0, orderId: order.id },
        { accountId: accountByRole(accounts, "accounts_receivable").id, debit: 0, credit: payment.amount + withholding, orderId: order.id },
      ],
    };
  }
  return {
    workspaceId: order.workspaceId,
    entryDate: payment.date,
    description: `Pelunasan pesanan ${order.number} · ${clientName}`,
    source: "settlement",
    counterparty: clientName,
    settlementOf: invoiceJournal.id,
    lines: [
      { accountId: cash.id, debit: payment.amount, credit: 0, orderId: order.id },
      { accountId: accountByRole(accounts, "accounts_receivable").id, debit: 0, credit: payment.amount, orderId: order.id },
    ],
  };
}

/** Saldo DP dipakai melunasi faktur pesanan: Dr Uang Muka Pelanggan / Cr Piutang. */
export function buildDepositApplication(order: CateringOrder, clientName: string, invoiceJournalId: string, date: IsoDate, amount: number, accounts: readonly Account[]): JournalEntryInput {
  requireAmount(amount, "Pemakaian DP");
  return {
    workspaceId: order.workspaceId,
    entryDate: date,
    description: `DP dipakai untuk faktur pesanan ${order.number} · ${clientName}`,
    source: "settlement",
    counterparty: clientName,
    settlementOf: invoiceJournalId,
    lines: [
      { accountId: accountByRole(accounts, "customer_deposits").id, description: "Pemakaian uang muka", debit: amount, credit: 0, orderId: order.id },
      { accountId: accountByRole(accounts, "accounts_receivable").id, debit: 0, credit: amount, orderId: order.id },
    ],
  };
}

export interface CancellationInput {
  date: IsoDate;
  reason: string;
  /** Kebijakan yang dipakai (default kebijakan pesanan). */
  policy: CancellationPolicy;
  /** Rekening pengembalian DP (wajib bila ada bagian dikembalikan). */
  cashAccountId: string | null;
  /** Akun pendapatan untuk DP hangus (wajib bila ada bagian hangus). */
  forfeitAccountId: string | null;
}

export interface CancellationPlan {
  entry: JournalEntryInput | null;
  refund: number;
  forfeit: number;
}

/** Bagian DP hangus menurut kebijakan. */
export function forfeitAmount(balance: number, policy: CancellationPolicy): number {
  if (policy.kind === "forfeit_all") return balance;
  if (policy.kind === "forfeit_percent") return mulDivRound(balance, policy.forfeitBps, 10_000);
  return 0;
}

/** Pembatalan: seluruh saldo DP keluar dari Uang Muka → dikembalikan dan/atau hangus. */
export function buildCancellation(order: CateringOrder, clientName: string, input: CancellationInput, balance: number, accounts: readonly Account[]): CancellationPlan {
  if (order.state === "completed" || order.state === "cancelled") fail("INVALID_ORDER", "Pesanan selesai/dibatalkan tidak dapat dibatalkan lagi");
  if (input.reason.trim() === "") fail("EMPTY_REASON", "Alasan pembatalan wajib diisi");
  if (!isValidIsoDate(input.date)) fail("INVALID_DATE", "Tanggal pembatalan tidak valid");
  const policy = validatePolicy(input.policy);
  if (balance <= 0) return { entry: null, refund: 0, forfeit: 0 };
  const forfeit = forfeitAmount(balance, policy);
  const refund = balance - forfeit;
  const deposits = accountByRole(accounts, "customer_deposits");
  const lines: JournalEntryInput["lines"] = [{ accountId: deposits.id, description: "Pembatalan pesanan", debit: balance, credit: 0, orderId: order.id }];
  if (refund > 0) {
    const cash = requireCash(accounts, input.cashAccountId ?? "");
    lines.push({ accountId: cash.id, description: "DP dikembalikan", debit: 0, credit: refund, orderId: order.id });
  }
  if (forfeit > 0) {
    const account = accounts.find((a) => a.id === input.forfeitAccountId && a.deletedAt === null);
    if (!account || account.accountType !== "revenue") fail("INVALID_ACCOUNT", "Pilih akun pendapatan untuk DP hangus");
    lines.push({ accountId: account.id, description: "DP hangus", debit: 0, credit: forfeit, orderId: order.id });
  }
  return {
    refund,
    forfeit,
    entry: {
      workspaceId: order.workspaceId,
      entryDate: input.date,
      description: `Pembatalan pesanan ${order.number} · ${clientName}: ${input.reason.trim()}`,
      source: "deposit",
      counterparty: clientName,
      lines,
    },
  };
}

/** Jam & tanggal acara untuk kalender: pesanan per tanggal di bulan tertentu. */
export function ordersByDate(orders: readonly CateringOrder[], month: string): Map<IsoDate, CateringOrder[]> {
  const map = new Map<IsoDate, CateringOrder[]>();
  for (const order of orders) {
    if (order.state === "cancelled" || order.eventDate.slice(0, 7) !== month) continue;
    map.set(order.eventDate, [...(map.get(order.eventDate) ?? []), order]);
  }
  for (const list of map.values()) list.sort((a, b) => (a.eventTime ?? "99").localeCompare(b.eventTime ?? "99"));
  return map;
}

// ---------- Biaya & laba per pesanan (Fase 10B) ----------

export const COST_CATEGORIES: readonly CostCategory[] = ["materials", "labor", "equipment", "transport", "packaging", "other"];

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  materials: "Bahan baku",
  labor: "Tenaga lepas",
  equipment: "Sewa alat",
  transport: "Transport & pengiriman",
  packaging: "Kemasan",
  other: "Lain-lain",
};

/** Kode akun template katering per kategori beban (ADR 024); akun beban lain = lain-lain. */
const CATEGORY_CODES: Partial<Record<string, CostCategory>> = {
  "6-1100": "labor",
  "6-1200": "equipment",
  "6-1300": "transport",
  "6-1400": "packaging",
};

/** Kategori biaya sebuah akun: HPP = bahan baku; beban menurut kode; selain itu bukan biaya. */
export function costCategoryOf(account: Pick<Account, "accountType" | "code">): CostCategory | null {
  if (account.accountType === "cogs") return "materials";
  if (account.accountType === "expense") return CATEGORY_CODES[account.code] ?? "other";
  return null;
}

/** Kategori yang dipakai sesuai mode biaya (Catatan Keputusan 78). */
export const costCategoriesFor = (mode: CateringCostMode): readonly CostCategory[] => (mode === "materials" ? ["materials"] : COST_CATEGORIES);

/** Akun default untuk mencatat biaya kategori tertentu. */
export function defaultCostAccount(accounts: readonly Account[], category: CostCategory): Account | null {
  const usable = accounts.filter((a) => a.deletedAt === null && a.isActive);
  if (category === "materials") return usable.find((a) => a.systemRole === "cogs") ?? usable.find((a) => a.accountType === "cogs") ?? null;
  const code = Object.entries(CATEGORY_CODES).find(([, c]) => c === category)?.[0];
  const byCode = code ? usable.find((a) => a.code === code && a.accountType === "expense") : undefined;
  if (byCode) return byCode;
  return category === "other" ? (usable.find((a) => a.accountType === "expense" && a.code === "6-9000") ?? null) : null;
}

export function validateCostEstimates(estimates: CostEstimates): CostEstimates {
  const clean: CostEstimates = {};
  for (const [key, value] of Object.entries(estimates)) {
    if (!COST_CATEGORIES.includes(key as CostCategory)) fail("INVALID_ORDER", "Kategori estimasi biaya tidak dikenal");
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("INVALID_AMOUNT", "Estimasi biaya harus bilangan bulat ≥ 0");
    if (value > 0) clean[key as CostCategory] = value;
  }
  return clean;
}

export interface OrderProfit {
  /** Pendapatan bersih bertag pesanan (setelah diskon, tanpa pajak; termasuk DP hangus). */
  revenue: number;
  costs: Record<CostCategory, number>;
  totalCost: number;
  /** Laba kotor = pendapatan − biaya. */
  profit: number;
  /** Margin laba kotor dalam basis poin (null bila pendapatan 0). */
  marginBps: number | null;
  /** Laba kotor per pax (dibulatkan). */
  profitPerPax: number;
  estimates: Record<CostCategory, number>;
  estimateTotal: number;
}

/**
 * Laba kotor per pesanan dari baris jurnal bertag pesanan (posted; pembalik ikut
 * menetralkan). Mode bahan baku saja: hanya biaya HPP yang dihitung.
 */
export function orderProfits(
  orders: readonly CateringOrder[],
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  mode: CateringCostMode,
): Map<string, OrderProfit> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const categories = costCategoriesFor(mode);
  const zero = () => Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>;
  const raw = new Map<string, { revenue: number; costs: Record<CostCategory, number> }>();
  for (const entry of entries) {
    if (entry.status !== "posted" || entry.deletedAt !== null) continue;
    for (const line of entry.lines) {
      if (!line.orderId) continue;
      const account = byId.get(line.accountId);
      if (!account) continue;
      const r = raw.get(line.orderId) ?? { revenue: 0, costs: zero() };
      if (account.accountType === "revenue") r.revenue += line.credit - line.debit;
      const category = costCategoryOf(account);
      if (category && categories.includes(category)) r.costs[category] += line.debit - line.credit;
      raw.set(line.orderId, r);
    }
  }
  const result = new Map<string, OrderProfit>();
  for (const order of orders) {
    const r = raw.get(order.id) ?? { revenue: 0, costs: zero() };
    const totalCost = COST_CATEGORIES.reduce((t, c) => t + r.costs[c], 0);
    const profit = r.revenue - totalCost;
    const estimates = zero();
    for (const c of categories) estimates[c] = order.costEstimates[c] ?? 0;
    result.set(order.id, {
      revenue: r.revenue,
      costs: r.costs,
      totalCost,
      profit,
      marginBps: r.revenue > 0 ? mulDivRound(profit, 10_000, r.revenue) : null,
      profitPerPax: Math.round(profit / order.pax),
      estimates,
      estimateTotal: categories.reduce((t, c) => t + estimates[c], 0),
    });
  }
  return result;
}

export interface OrderCostInput {
  date: IsoDate;
  category: CostCategory;
  /** Akun HPP/beban; bahan baku langsung ke HPP (Catatan Keputusan 86). */
  accountId: string;
  amount: number;
  description: string;
  /** Tunai dari rekening (dipilih) atau kredit ke pemasok. */
  payment: Payment;
}

/** Catat biaya pesanan: Dr HPP/Beban (bertag pesanan) / Cr Kas/Bank atau Utang Usaha. */
export function buildOrderCost(order: CateringOrder, input: OrderCostInput, accounts: readonly Account[], mode: CateringCostMode): JournalEntryInput {
  if (!costCategoriesFor(mode).includes(input.category)) fail("INVALID_ACCOUNT", "Mode biaya bahan baku saja: catat kategori bahan baku");
  if (!isValidIsoDate(input.date)) fail("INVALID_DATE", "Tanggal biaya tidak valid");
  requireAmount(input.amount, "Nominal biaya");
  const account = accounts.find((a) => a.id === input.accountId && a.deletedAt === null);
  if (!account || costCategoryOf(account) === null) fail("INVALID_ACCOUNT", "Pilih akun HPP atau beban");
  if (input.category === "materials" && account.accountType !== "cogs") fail("INVALID_ACCOUNT", "Bahan baku pesanan dicatat langsung ke akun HPP");
  if (input.payment.kind === "cash") requireCash(accounts, input.payment.accountId);
  const label = input.description.trim() || COST_CATEGORY_LABELS[input.category];
  const entry = buildExpense(
    {
      workspaceId: order.workspaceId,
      entryDate: input.date,
      description: `${label} · pesanan ${order.number}`,
      payment: input.payment,
      items: [{ accountId: account.id, amount: input.amount, description: label }],
    },
    accounts,
  );
  // Hanya baris biaya yang bertag pesanan.
  return { ...entry, lines: entry.lines.map((l) => (l.accountId === account.id && l.debit > 0 ? { ...l, orderId: order.id } : l)) };
}

/** PPh 23 default saat pelunasan: tarif × dasar (total faktur tanpa pajak penjualan), maks. sisa tagihan. */
export function defaultWithholding(invoiceBase: number, rateBps: number, outstanding: number): number {
  if (invoiceBase <= 0 || rateBps <= 0) return 0;
  return Math.min(mulDivRound(invoiceBase, rateBps, 10_000), outstanding);
}

export function validateCateringSettings(settings: CateringSettings): CateringSettings {
  if (settings.costMode !== "detail" && settings.costMode !== "materials") fail("INVALID_ORDER", "Mode biaya tidak dikenal");
  if (!Number.isSafeInteger(settings.pph23RateBps) || settings.pph23RateBps < 1 || settings.pph23RateBps > 10_000) {
    fail("INVALID_AMOUNT", "Tarif PPh 23 harus lebih dari 0% dan maksimal 100%");
  }
  return { costMode: settings.costMode, pph23Enabled: Boolean(settings.pph23Enabled), pph23RateBps: settings.pph23RateBps };
}
