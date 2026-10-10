import { addDays } from "../dates";
import {
  assertOrderComplete,
  billPrefix,
  buildCancellation,
  buildDepositReceipt,
  buildDepositRefund,
  buildOrderCost,
  buildOrderSettlement,
  depositFlows,
  orderInvoiceInput,
  orderProfits,
  summarizeBills,
  summarizeClients,
  summarizeOrders,
  tagOrder,
  validateBill,
  validateCateringSettings,
  validateOrderInput,
  type BillSummary,
  type CancellationInput,
  type CancellationPlan,
  type ClientSummary,
  type OrderCostInput,
  type OrderProfit,
  type OrderSummary,
  type PaymentInput,
} from "../catering";
import { fail } from "../errors";
import { buildSaleInvoice, contactSnapshot, withDiscountAccount, type InvoicePlan } from "../invoice";
import type { IAccountRepository, ICateringRepository, IInvoiceRepository, IJournalRepository, IWorkspaceRepository } from "../ports";
import type {
  Account,
  BusinessProfile,
  CateringSettings,
  CateringOrder,
  CateringOrderInput,
  Contact,
  Invoice,
  IsoDate,
  JournalEntry,
  OrderBill,
  OrderBillInput,
  Workspace,
} from "../types";
import { ensureSalesReturnsAccount } from "./inventory-service";
import type { JournalService } from "./journal-service";

export interface CateringData {
  workspace: Workspace;
  profile: BusinessProfile;
  accounts: Account[];
  contacts: Contact[];
  journals: JournalEntry[];
  invoices: Invoice[];
  orders: CateringOrder[];
  bills: OrderBill[];
}

export interface CompletionInput {
  /** Tanggal pengakuan pendapatan (default tanggal acara). */
  date: IsoDate;
  dueDate: IsoDate;
}

/** Pesanan katering, DP, invoice DP, dan jurnal otomatisnya (ADR 024). */
export class CateringService {
  constructor(
    private readonly deps: {
      workspaces: IWorkspaceRepository;
      accounts: IAccountRepository;
      journals: IJournalRepository;
      invoices: IInvoiceRepository;
      catering: ICateringRepository;
      journalService: JournalService;
    },
  ) {}

  async data(workspaceId: string): Promise<CateringData> {
    const [workspace, profile, accounts, contacts, journals, invoices, orders, bills] = await Promise.all([
      this.deps.workspaces.getById(workspaceId),
      this.deps.invoices.getProfile(workspaceId),
      this.deps.accounts.listByWorkspace(workspaceId),
      this.deps.invoices.listContacts(workspaceId),
      this.deps.journals.listByWorkspace(workspaceId),
      this.deps.invoices.listInvoices(workspaceId, "sale"),
      this.deps.catering.listOrders(workspaceId),
      this.deps.catering.listBills(workspaceId),
    ]);
    if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
    return { workspace, profile, accounts, contacts, journals, invoices, orders, bills };
  }

  summaries(data: CateringData, today: IsoDate): OrderSummary[] {
    return summarizeOrders(data.orders, data, today);
  }

  billSummaries(data: CateringData, today: IsoDate): BillSummary[] {
    return summarizeBills(data.bills, depositFlows(data.journals, data.accounts), today);
  }

  clients(data: CateringData, today: IsoDate): ClientSummary[] {
    return summarizeClients(this.summaries(data, today), data.contacts, today);
  }

  /** Laba kotor per pesanan sesuai mode biaya workspace (Fase 10B). */
  profits(data: CateringData): Map<string, OrderProfit> {
    return orderProfits(data.orders, data.journals, data.accounts, data.workspace.cateringSettings.costMode);
  }

  async updateSettings(workspaceId: string, settings: CateringSettings): Promise<Workspace> {
    const clean = validateCateringSettings(settings);
    if (clean.pph23Enabled) await this.ensurePph23Account(workspaceId);
    return this.deps.workspaces.updateCateringSettings(workspaceId, clean);
  }

  /** Akun PPh 23 Dibayar Dimuka (peran pph23_prepaid) dibuat bila belum ada. */
  private async ensurePph23Account(workspaceId: string): Promise<void> {
    const accounts = await this.deps.accounts.listByWorkspace(workspaceId);
    if (accounts.some((a) => a.systemRole === "pph23_prepaid")) return;
    const code = accounts.some((a) => a.code === "1-1500") ? "1-1510" : "1-1500";
    await this.deps.accounts.create(workspaceId, {
      code,
      name: "PPh 23 Dibayar Dimuka",
      accountType: "asset",
      normalBalance: "debit",
      cashFlowCategory: "operating",
      isCash: false,
      systemRole: "pph23_prepaid",
    });
  }

  /** Catat biaya pesanan (bahan langsung HPP, beban lain per kategori). */
  async recordCost(order: CateringOrder, input: OrderCostInput): Promise<JournalEntry> {
    const data = await this.data(order.workspaceId);
    return this.deps.journalService.postJournal(buildOrderCost(order, input, data.accounts, data.workspace.cateringSettings.costMode));
  }

  // ---------- Pesanan ----------

  async saveOrder(input: CateringOrderInput, id?: string): Promise<CateringOrder> {
    const clean = validateOrderInput(input);
    const profile = await this.deps.invoices.getProfile(clean.workspaceId);
    return this.deps.catering.saveOrder(clean, profile.quotationPrefix, id);
  }

  /** Penawaran → dikonfirmasi; baris & klien harus lengkap. */
  async confirm(order: CateringOrder): Promise<CateringOrder> {
    if (order.state !== "quotation") fail("INVALID_ORDER", "Hanya penawaran yang dapat dikonfirmasi");
    const data = await this.data(order.workspaceId);
    assertOrderComplete(order, data.accounts, data.contacts);
    return this.deps.catering.confirmOrder(order.id);
  }

  deleteOrder(id: string): Promise<void> {
    return this.deps.catering.deleteOrder(id);
  }

  // ---------- Invoice DP ----------

  async createBill(input: OrderBillInput): Promise<OrderBill> {
    const data = await this.data(input.workspaceId);
    const order = data.orders.find((o) => o.id === input.orderId);
    if (!order) fail("ORDER_NOT_FOUND", "Pesanan tidak ditemukan");
    const clean = validateBill(input, order, data.bills, data.workspace);
    return this.deps.catering.createBill(clean, billPrefix(data.profile.invoicePrefix));
  }

  deleteBill(id: string): Promise<void> {
    return this.deps.catering.deleteBill(id);
  }

  // ---------- Pembayaran (jurnal otomatis) ----------

  private clientName(data: CateringData, order: CateringOrder): string {
    return data.contacts.find((c) => c.id === order.contactId)?.name ?? "Klien";
  }

  /**
   * Terima pembayaran dari klien: sebelum selesai = DP (Uang Muka Pelanggan;
   * penawaran otomatis dikonfirmasi), sesudah selesai = pelunasan faktur.
   */
  async receivePayment(order: CateringOrder, payment: PaymentInput, withholding = 0): Promise<JournalEntry> {
    const data = await this.data(order.workspaceId);
    const name = this.clientName(data, order);
    if (order.state === "cancelled") fail("INVALID_ORDER", "Pesanan sudah dibatalkan");
    if (order.state === "completed") {
      const invoice = data.invoices.find((i) => i.id === order.invoiceId);
      const journal = data.journals.find((e) => e.id === invoice?.journalEntryId);
      if (!journal) fail("INVOICE_NOT_FOUND", "Faktur pesanan tidak ditemukan");
      if (withholding > 0 && !data.workspace.cateringSettings.pph23Enabled) fail("INVALID_SETTLEMENT", "Aktifkan PPh 23 di Pengaturan → Pajak");
      return this.deps.journalService.postJournal(buildOrderSettlement(order, name, journal, payment, data.accounts, withholding));
    }
    if (withholding > 0) fail("INVALID_DEPOSIT", "PPh 23 dipotong saat pelunasan faktur, bukan saat DP");
    const entry = buildDepositReceipt(order, name, payment, data.accounts);
    await this.deps.journalService.validateForPosting(entry);
    if (order.state === "quotation") await this.confirm(order);
    return this.deps.journalService.postJournal(entry);
  }

  /** Kembalikan sebagian/seluruh saldo DP (mis. kelebihan bayar). */
  async refundDeposit(order: CateringOrder, payment: PaymentInput): Promise<JournalEntry> {
    const data = await this.data(order.workspaceId);
    const balance = depositFlows(data.journals, data.accounts).get(order.id)?.balance ?? 0;
    return this.deps.journalService.postJournal(buildDepositRefund(order, this.clientName(data, order), payment, balance, data.accounts));
  }

  // ---------- Selesai & batal ----------

  /** Pratinjau faktur pelunasan (akun Potongan sementara bila belum ada). */
  completionPlan(order: CateringOrder, data: CateringData, input: CompletionInput): InvoicePlan {
    assertOrderComplete(order, data.accounts, data.contacts);
    const invoice = orderInvoiceInput(order, input.date, input.dueDate);
    const plan = buildSaleInvoice(invoice, { workspace: data.workspace, accounts: withDiscountAccount(data.accounts), items: [], contacts: data.contacts, perpetual: null });
    return { ...plan, entry: tagOrder(plan.entry, order.id) };
  }

  /** Jatuh tempo default faktur pelunasan = tanggal selesai + termin klien. */
  defaultDueDate(order: CateringOrder, data: CateringData, date: IsoDate): IsoDate {
    return addDays(date, data.contacts.find((c) => c.id === order.contactId)?.paymentTermDays ?? 0);
  }

  async complete(order: CateringOrder, input: CompletionInput): Promise<CateringOrder> {
    if (order.state !== "confirmed") fail("INVALID_ORDER", "Hanya pesanan dikonfirmasi yang dapat diselesaikan");
    let data = await this.data(order.workspaceId);
    this.completionPlan(order, data, input);
    if (order.discount && !data.accounts.some((a) => a.systemRole === "sales_returns" && a.deletedAt === null)) {
      await ensureSalesReturnsAccount(this.deps.accounts, order.workspaceId);
      data = await this.data(order.workspaceId);
    }
    const invoice = orderInvoiceInput(order, input.date, input.dueDate);
    const plan = buildSaleInvoice(invoice, { workspace: data.workspace, accounts: data.accounts, items: [], contacts: data.contacts, perpetual: null });
    const entry = tagOrder(plan.entry, order.id);
    await this.deps.journalService.validateForPosting(entry);
    return this.deps.catering.completeOrder(order.id, invoice, entry, contactSnapshot(plan.contact), data.profile.invoicePrefix);
  }

  cancellationPlan(order: CateringOrder, data: CateringData, input: CancellationInput): CancellationPlan {
    const balance = depositFlows(data.journals, data.accounts).get(order.id)?.balance ?? 0;
    return buildCancellation(order, this.clientName(data, order), input, balance, data.accounts);
  }

  async cancel(order: CateringOrder, input: CancellationInput): Promise<CateringOrder> {
    const data = await this.data(order.workspaceId);
    const plan = this.cancellationPlan(order, data, input);
    if (plan.entry) await this.deps.journalService.validateForPosting(plan.entry);
    return this.deps.catering.cancelOrder(order.id, plan.entry, input.reason.trim());
  }
}
