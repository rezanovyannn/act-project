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
  itemPrices,
  materialsEstimate,
  orderProfits,
  shoppingList,
  summarizeBills,
  summarizeClients,
  summarizeOrders,
  tagOrder,
  validateBill,
  validateCateringSettings,
  validatePackage,
  validateOrderInput,
  type BillSummary,
  type CancellationInput,
  type CancellationPlan,
  type ClientSummary,
  type ItemPrice,
  type MaterialsEstimate,
  type ShoppingList,
  type OrderCostInput,
  type OrderProfit,
  type OrderSummary,
  type PaymentInput,
} from "../catering";
import { fail } from "../errors";
import { billingOf, dueBillings, subscriptionInvoiceInput, validateDayChanges, validateSubscription, type DueBilling } from "../subscription";
import { buildSaleInvoice, contactSnapshot, summarizeInvoices, withDiscountAccount, type InvoicePlan } from "../invoice";
import type { IAccountRepository, ICateringRepository, IInvoiceRepository, IItemRepository, IJournalRepository, IWorkspaceRepository } from "../ports";
import type {
  Account,
  BusinessProfile,
  CateringSettings,
  CateringOrder,
  CateringOrderInput,
  CateringPackage,
  CateringPackageInput,
  Item,
  OrderLine,
  Subscription,
  SubscriptionInput,
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
  /** Bahan & paket menu untuk estimasi dan daftar belanja (Fase 10C). */
  items: Item[];
  packages: CateringPackage[];
  /** Katering langganan (Fase 10D). */
  subscriptions: Subscription[];
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
      items: IItemRepository;
      catering: ICateringRepository;
      journalService: JournalService;
    },
  ) {}

  async data(workspaceId: string): Promise<CateringData> {
    const [workspace, profile, accounts, contacts, journals, invoices, orders, bills, items, packages, subscriptions] = await Promise.all([
      this.deps.workspaces.getById(workspaceId),
      this.deps.invoices.getProfile(workspaceId),
      this.deps.accounts.listByWorkspace(workspaceId),
      this.deps.invoices.listContacts(workspaceId),
      this.deps.journals.listByWorkspace(workspaceId),
      this.deps.invoices.listInvoices(workspaceId, "sale"),
      this.deps.catering.listOrders(workspaceId),
      this.deps.catering.listBills(workspaceId),
      this.deps.items.listByWorkspace(workspaceId),
      this.deps.catering.listPackages(workspaceId),
      this.deps.catering.listSubscriptions(workspaceId),
    ]);
    if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
    return { workspace, profile, accounts, contacts, journals, invoices, orders, bills, items, packages, subscriptions };
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

  // ---------- Paket menu, estimasi & daftar belanja (Fase 10C) ----------

  async savePackage(workspaceId: string, input: CateringPackageInput, id?: string): Promise<CateringPackage> {
    const [packages, items] = await Promise.all([this.deps.catering.listPackages(workspaceId), this.deps.items.listByWorkspace(workspaceId)]);
    return this.deps.catering.savePackage(workspaceId, validatePackage(input, packages, items, id), id);
  }

  setPackageActive(id: string, isActive: boolean): Promise<CateringPackage> {
    return this.deps.catering.setPackageActive(id, isActive);
  }

  deletePackage(id: string): Promise<void> {
    return this.deps.catering.deletePackage(id);
  }

  /** Harga bahan per tanggal: pembelian terakhir, lalu harga perkiraan (Catatan Keputusan 91). */
  prices(data: CateringData, date: IsoDate): Map<string, ItemPrice | null> {
    return itemPrices(data.items, data.journals, data.accounts, date);
  }

  /** Estimasi biaya bahan baris pesanan ber-paket. */
  materials(data: CateringData, lines: readonly OrderLine[], date: IsoDate): MaterialsEstimate {
    return materialsEstimate(lines, data.packages, this.prices(data, date));
  }

  /** Daftar belanja pesanan dikonfirmasi bertanggal acara [from, to]; harga per tanggal `to`. */
  shopping(data: CateringData, from: IsoDate, to: IsoDate): ShoppingList {
    return shoppingList(data.orders, data.packages, data.items, this.prices(data, to), from, to);
  }

  // ---------- Katering langganan (Fase 10D) ----------

  private invoiceSummaries(data: CateringData, today: IsoDate) {
    return new Map(summarizeInvoices(data.invoices, data.journals, data.accounts, today).map((s) => [s.invoice.id, s]));
  }

  billing(data: CateringData, sub: Subscription, month: string, today: IsoDate) {
    return billingOf(sub, month, data.invoices, this.invoiceSummaries(data, today));
  }

  dueBillings(data: CateringData, today: IsoDate): DueBilling[] {
    return dueBillings(data.subscriptions, data.invoices, this.invoiceSummaries(data, today), today);
  }

  async saveSubscription(workspaceId: string, input: SubscriptionInput, id?: string): Promise<Subscription> {
    const data = await this.data(workspaceId);
    return this.deps.catering.saveSubscription(workspaceId, validateSubscription(input, data.contacts, data.accounts), id);
  }

  /** Ubah porsi harian; bulan yang sudah punya tagihan aktif dikunci. */
  async setSubscriptionDays(sub: Subscription, changes: Record<IsoDate, number | null>, today: IsoDate): Promise<Subscription> {
    validateDayChanges(sub, changes);
    const data = await this.data(sub.workspaceId);
    for (const month of new Set(Object.keys(changes).map((d) => d.slice(0, 7)))) {
      if (this.billing(data, sub, month, today).state !== "none") fail("INVALID_INVOICE", `Porsi ${month} sudah ditagih; hapus draft atau batalkan fakturnya dulu`);
    }
    return this.deps.catering.setSubscriptionDays(sub.id, changes);
  }

  deleteSubscription(id: string): Promise<void> {
    return this.deps.catering.deleteSubscription(id);
  }

  /** 1 klik: draft faktur penjualan langganan bulan itu (Catatan Keputusan 96). */
  async createSubscriptionInvoice(sub: Subscription, month: string, today: IsoDate): Promise<Invoice> {
    const data = await this.data(sub.workspaceId);
    if (this.billing(data, sub, month, today).state !== "none") fail("INVALID_INVOICE", "Bulan ini sudah punya tagihan langganan");
    const contact = data.contacts.find((c) => c.id === sub.contactId);
    if (!contact) fail("CONTACT_NOT_FOUND", "Klien langganan tidak ditemukan");
    return this.deps.catering.createSubscriptionInvoice(sub.id, month, subscriptionInvoiceInput(sub, month, contact));
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
