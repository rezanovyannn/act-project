import { buildDepositApplication } from "@/core/catering";
import { validatePolicy } from "@/core/cancellation-policy";
import { formatInvoiceNumber, PREFIX_PATTERN } from "@/core/invoice";
import { nextNumberSeq } from "@/core/catering";
import { isValidIsoDate } from "@/core/dates";
import { fail } from "@/core/errors";
import type { ICateringRepository } from "@/core/ports";
import type {
  CateringOrder,
  CateringOrderInput,
  ContactSnapshot,
  InvoiceInput,
  JournalEntryInput,
  OrderBill,
  OrderBillInput,
} from "@/core/types";
import type { MockInvoiceRepository } from "./invoice-repository";
import type { MockJournalRepository } from "./journal-repository";
import type { MockDatabase, MockState } from "./mock-database";

type StoredOrder = CateringOrder & { deletedAt: string | null };
type StoredBill = OrderBill & { deletedAt: string | null };
const stripOrder = ({ deletedAt: _deleted, ...order }: StoredOrder): CateringOrder => order; // eslint-disable-line @typescript-eslint/no-unused-vars
const stripBill = ({ deletedAt: _deleted, ...bill }: StoredBill): OrderBill => bill; // eslint-disable-line @typescript-eslint/no-unused-vars

function requireOrder(state: MockState, id: string): StoredOrder {
  const order = state.cateringOrders.find((o) => o.id === id && o.deletedAt === null);
  if (!order) fail("ORDER_NOT_FOUND", "Pesanan tidak ditemukan");
  return order;
}

/** Saldo Uang Muka Pelanggan pesanan dari semua jurnal posted (termasuk pembalik). */
function depositBalance(state: MockState, order: CateringOrder): number {
  const deposits = new Set(state.accounts.filter((a) => a.workspaceId === order.workspaceId && a.systemRole === "customer_deposits").map((a) => a.id));
  let balance = 0;
  for (const entry of state.journals) {
    if (entry.status !== "posted" || entry.deletedAt !== null) continue;
    for (const l of entry.lines) if (l.orderId === order.id && deposits.has(l.accountId)) balance += l.credit - l.debit;
  }
  return balance;
}

/** Pesanan katering & invoice DP di localStorage; meniru RPC ADR 024. */
export class MockCateringRepository implements ICateringRepository {
  constructor(
    private readonly db: MockDatabase,
    private readonly journals: MockJournalRepository,
    private readonly invoices: MockInvoiceRepository,
  ) {}

  async listOrders(workspaceId: string): Promise<CateringOrder[]> {
    return this.db
      .read()
      .cateringOrders.filter((o) => o.workspaceId === workspaceId && o.deletedAt === null)
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt))
      .map(stripOrder);
  }

  async getOrder(id: string): Promise<CateringOrder | null> {
    const order = this.db.read().cateringOrders.find((o) => o.id === id && o.deletedAt === null);
    return order ? stripOrder(order) : null;
  }

  async saveOrder(input: CateringOrderInput, prefix: string, id?: string): Promise<CateringOrder> {
    return this.db.write((state) => {
      // Meniru validasi RPC save_catering_order.
      if (!state.workspaces.some((w) => w.id === input.workspaceId && w.deletedAt === null)) fail("NOT_FOUND", "Workspace tidak ditemukan");
      const contact = state.contacts.find((c) => c.id === input.contactId && c.deletedAt === null);
      if (!contact || contact.workspaceId !== input.workspaceId) fail("CONTACT_NOT_FOUND", "Pilih klien dari daftar kontak");
      if (![input.eventDate, input.quoteDate, input.validUntil].every(isValidIsoDate) || input.validUntil < input.quoteDate) fail("INVALID_DATE", "Tanggal pesanan tidak valid");
      if (!Number.isSafeInteger(input.pax) || input.pax < 1) fail("INVALID_ORDER", "Jumlah pax harus bilangan bulat ≥ 1");
      if (input.lines.length > 200) fail("INVALID_ORDER", "Pesanan maksimal 200 baris");
      for (const line of input.lines) {
        const ok = (n: number) => Number.isSafeInteger(n) && n >= 0;
        if (!ok(line.quantity) || !ok(line.unitPrice)) fail("INVALID_QUANTITY", "Qty dan harga harus bilangan bulat ≥ 0");
        if (line.accountId && !state.accounts.some((a) => a.id === line.accountId && a.workspaceId === input.workspaceId)) {
          fail("INVALID_ACCOUNT", "Akun pada baris pesanan tidak ditemukan di workspace ini");
        }
      }
      const policy = validatePolicy(input.cancellationPolicy);
      const now = this.db.now();
      const estimates = input.costEstimates ?? {};
      if (Object.entries(estimates).some(([k, v]) => !["materials", "labor", "equipment", "transport", "packaging", "other"].includes(k) || !Number.isSafeInteger(v) || (v as number) < 0)) {
        fail("INVALID_AMOUNT", "Estimasi biaya tidak valid");
      }
      const fields = { ...input, costEstimates: { ...estimates }, cancellationPolicy: policy, lines: input.lines.map((l) => ({ ...l, itemId: null })) };
      if (id) {
        const order = requireOrder(state, id);
        if (order.workspaceId !== input.workspaceId) fail("ORDER_NOT_FOUND", "Pesanan tidak ditemukan");
        if (order.state === "completed" || order.state === "cancelled") fail("INVALID_ORDER", "Pesanan selesai/dibatalkan tidak dapat diubah");
        const before = { ...order };
        Object.assign(order, fields, { updatedAt: now });
        this.db.audit(state, { workspaceId: order.workspaceId, entityType: "catering_order", entityId: id, action: "update", before, after: order });
        return stripOrder(order);
      }
      if (!PREFIX_PATTERN.test(prefix)) fail("INVALID_PROFILE", "Prefix nomor quotation tidak valid");
      const siblings = state.cateringOrders.filter((o) => o.workspaceId === input.workspaceId).map((o) => o.number);
      const order: StoredOrder = {
        ...fields,
        id: this.db.generateId(),
        number: formatInvoiceNumber(prefix, input.quoteDate, nextNumberSeq(siblings, input.quoteDate)),
        state: "quotation",
        invoiceId: null,
        cancelledAt: null,
        cancelReason: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      state.cateringOrders.push(order);
      this.db.audit(state, { workspaceId: order.workspaceId, entityType: "catering_order", entityId: order.id, action: "create", before: null, after: order });
      return stripOrder(order);
    });
  }

  async confirmOrder(id: string): Promise<CateringOrder> {
    return this.db.write((state) => {
      const order = requireOrder(state, id);
      if (order.state !== "quotation") fail("INVALID_ORDER", "Hanya penawaran yang dapat dikonfirmasi");
      const incomplete = order.lines.some((l) => {
        const account = state.accounts.find((a) => a.id === l.accountId);
        return l.description.trim() === "" || l.quantity <= 0 || l.unitPrice <= 0 || account?.accountType !== "revenue";
      });
      if (order.lines.length === 0 || incomplete) fail("INVALID_ORDER", "Lengkapi baris pesanan (keterangan, qty, harga, akun pendapatan)");
      const before = { ...order };
      Object.assign(order, { state: "confirmed", updatedAt: this.db.now() });
      this.db.audit(state, { workspaceId: order.workspaceId, entityType: "catering_order", entityId: id, action: "confirm", before, after: order });
      return stripOrder(order);
    });
  }

  async deleteOrder(id: string): Promise<void> {
    this.db.write((state) => {
      const order = requireOrder(state, id);
      if (order.state !== "quotation") fail("ORDER_IN_USE", "Hanya penawaran yang dapat dihapus; pesanan lain dibatalkan");
      const used =
        state.orderBills.some((b) => b.orderId === id && b.deletedAt === null) ||
        state.journals.some((e) => e.deletedAt === null && e.lines.some((l) => l.orderId === id));
      if (used) fail("ORDER_IN_USE", "Penawaran sudah punya invoice DP atau jurnal; tidak bisa dihapus");
      order.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: order.workspaceId, entityType: "catering_order", entityId: id, action: "delete", before: order, after: null });
    });
  }

  async listBills(workspaceId: string): Promise<OrderBill[]> {
    return this.db
      .read()
      .orderBills.filter((b) => b.workspaceId === workspaceId && b.deletedAt === null)
      .sort((a, b) => b.billDate.localeCompare(a.billDate) || b.createdAt.localeCompare(a.createdAt))
      .map(stripBill);
  }

  async createBill(input: OrderBillInput, prefix: string): Promise<OrderBill> {
    return this.db.write((state) => {
      const order = requireOrder(state, input.orderId);
      if (order.workspaceId !== input.workspaceId) fail("ORDER_NOT_FOUND", "Pesanan tidak ditemukan");
      if (order.state === "completed" || order.state === "cancelled") fail("INVALID_ORDER", "Invoice DP hanya untuk pesanan yang belum selesai/dibatalkan");
      if (!isValidIsoDate(input.billDate) || !isValidIsoDate(input.dueDate) || input.dueDate < input.billDate) fail("INVALID_DATE", "Tanggal invoice DP tidak valid");
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) fail("INVALID_AMOUNT", "Nominal DP harus lebih dari 0");
      if (!/^[A-Z0-9-]{1,16}$/.test(prefix)) fail("INVALID_PROFILE", "Prefix nomor invoice DP tidak valid");
      const siblings = state.orderBills.filter((b) => b.workspaceId === input.workspaceId).map((b) => b.number);
      const bill: StoredBill = {
        ...input,
        id: this.db.generateId(),
        number: formatInvoiceNumber(prefix, input.billDate, nextNumberSeq(siblings, input.billDate)),
        createdAt: this.db.now(),
        deletedAt: null,
      };
      state.orderBills.push(bill);
      this.db.audit(state, { workspaceId: bill.workspaceId, entityType: "order_bill", entityId: bill.id, action: "create", before: null, after: bill });
      return stripBill(bill);
    });
  }

  async deleteBill(id: string): Promise<void> {
    this.db.write((state) => {
      const bill = state.orderBills.find((b) => b.id === id && b.deletedAt === null);
      if (!bill) fail("NOT_FOUND", "Invoice DP tidak ditemukan");
      const order = requireOrder(state, bill.orderId);
      if (order.state === "completed" || order.state === "cancelled") fail("INVALID_ORDER", "Invoice DP pesanan selesai/dibatalkan tidak dapat dihapus");
      bill.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: bill.workspaceId, entityType: "order_bill", entityId: id, action: "delete", before: bill, after: null });
    });
  }

  async completeOrder(id: string, invoice: InvoiceInput, journal: JournalEntryInput, contact: ContactSnapshot, invoicePrefix: string): Promise<CateringOrder> {
    return this.db.write((state) => {
      const order = requireOrder(state, id);
      if (order.state !== "confirmed") fail("INVALID_ORDER", "Hanya pesanan dikonfirmasi yang dapat diselesaikan");
      if (invoice.workspaceId !== order.workspaceId || invoice.kind !== "sale" || invoice.contactId !== order.contactId) {
        fail("INVALID_ORDER", "Faktur harus faktur penjualan untuk klien pesanan ini");
      }
      if (journal.lines.some((l) => l.orderId !== order.id)) fail("INVALID_ORDER", "Semua baris jurnal faktur harus bertag pesanan ini");
      const draft = this.invoices.saveDraftInState(state, invoice);
      const issued = this.invoices.issueInState(state, draft.id, journal, contact, invoicePrefix);
      // Saldo DP melunasi faktur sebesar min(saldo, piutang faktur).
      const entry = state.journals.find((e) => e.id === issued.journalEntryId)!;
      const receivable = new Set(state.accounts.filter((a) => a.workspaceId === order.workspaceId && a.systemRole === "accounts_receivable").map((a) => a.id));
      const claim = entry.lines.filter((l) => receivable.has(l.accountId)).reduce((t, l) => t + l.debit - l.credit, 0);
      const apply = Math.min(depositBalance(state, order), claim);
      if (apply > 0) {
        const accounts = state.accounts.filter((a) => a.workspaceId === order.workspaceId);
        this.journals.postInState(state, buildDepositApplication(order, contact.name, entry.id, invoice.invoiceDate, apply, accounts));
      }
      const before = { ...order };
      Object.assign(order, { state: "completed", invoiceId: issued.id, updatedAt: this.db.now() });
      this.db.audit(state, { workspaceId: order.workspaceId, entityType: "catering_order", entityId: id, action: "complete", before, after: order });
      return stripOrder(order);
    });
  }

  async cancelOrder(id: string, journal: JournalEntryInput | null, reason: string): Promise<CateringOrder> {
    return this.db.write((state) => {
      const order = requireOrder(state, id);
      if (order.state === "completed" || order.state === "cancelled") fail("INVALID_ORDER", "Pesanan selesai/dibatalkan tidak dapat dibatalkan lagi");
      if (reason.trim() === "") fail("EMPTY_REASON", "Alasan pembatalan wajib diisi");
      if (journal) {
        if (journal.source !== "deposit" || journal.workspaceId !== order.workspaceId) fail("INVALID_DEPOSIT", "Jurnal pembatalan harus jurnal uang muka pesanan ini");
        this.journals.postInState(state, journal);
      }
      if (depositBalance(state, order) !== 0) fail("INVALID_DEPOSIT", "Saldo DP pesanan harus dikembalikan/dihanguskan seluruhnya saat pembatalan");
      const now = this.db.now();
      const before = { ...order };
      Object.assign(order, { state: "cancelled", cancelledAt: now, cancelReason: reason.trim(), updatedAt: now });
      this.db.audit(state, { workspaceId: order.workspaceId, entityType: "catering_order", entityId: id, action: "cancel", before, after: order, reason: reason.trim() });
      return stripOrder(order);
    });
  }
}
