/**
 * Adapter Supabase untuk port di src/core/ports (ADR 003 & 013).
 * Baca: SELECT langsung (dibatasi RLS). Tulis: hanya lewat RPC.
 */
import type { PeriodRange } from "@/core/periods";
import type { WorkspaceBackup } from "@/core/backup";
import { defaultProfile } from "@/core/invoice";
import type {
  AccountPatch,
  AuditLogFilter,
  ICateringRepository,
  IAccountRepository,
  IAuditLogRepository,
  IInvoiceRepository,
  IItemRepository,
  IMenuRepository,
  MenuPatch,
  IStockCountRepository,
  IJournalRepository,
  InventorySettings,
  ItemPatch,
  IPeriodRepository,
  IWorkspaceRepository,
  JournalFilter,
  NewWorkspace,
} from "@/core/ports";
import type { WorkspaceTaxSettings } from "@/core/sales-tax";
import type {
  Account,
  AccountSeed,
  AuditLog,
  Item,
  ItemInput,
  BusinessProfile,
  BusinessProfileInput,
  CateringSettings,
  CateringOrder,
  CateringOrderInput,
  CateringPackage,
  CateringPackageInput,
  Subscription,
  SubscriptionInput,
  OrderBill,
  OrderBillInput,
  Contact,
  ContactInput,
  ContactSnapshot,
  Invoice,
  InvoiceInput,
  InvoiceKind,
  Menu,
  MenuInput,
  MenuSale,
  MenuSaleLine,
  PortionSummary,
  PortionSummaryInput,
  Recipe,
  RecipeInput,
  IsoDate,
  StockCount,
  StockCountInput,
  JournalEntry,
  JournalEntryInput,
  Period,
  PeriodStatus,
  Workspace,
} from "@/core/types";
import {
  fetchAll,
  JOURNAL_SELECT,
  toAccount,
  toAuditLog,
  toCateringOrder,
  toCateringPackage,
  toSubscription,
  toOrderBill,
  toContact,
  toInvoice,
  toItem,
  toMenu,
  toProfile,
  toMenuSaleLine,
  toPortionSummary,
  toRecipe,
  toStockCount,
  toJournal,
  toPeriod,
  toWorkspace,
  unwrap,
  unwrapRows,
  type Client,
} from "./shared";

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} tidak ditemukan setelah disimpan`);
  return value;
}

export class SupabaseWorkspaceRepository implements IWorkspaceRepository {
  constructor(private readonly client: Client) {}

  async listByOwner(ownerId: string): Promise<Workspace[]> {
    const rows = await unwrapRows(
      this.client.from("workspaces").select("*").eq("owner_id", ownerId).is("deleted_at", null).order("name"),
    );
    return rows.map(toWorkspace);
  }

  async getById(id: string): Promise<Workspace | null> {
    const row = await unwrap(
      this.client.from("workspaces").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    );
    return row ? toWorkspace(row) : null;
  }

  /** Pemilik selalu user yang login (auth.uid()); `ownerId` dari domain diabaikan. */
  async createWithSeed(input: NewWorkspace, accounts: AccountSeed[], periods: PeriodRange[]): Promise<Workspace> {
    const id = await unwrap(
      this.client.rpc("create_workspace", {
        p_name: input.name,
        p_template_type: input.templateType,
        p_books_start_date: input.booksStartDate,
        p_accounts: accounts,
        p_periods: periods,
        p_sales_tax: input.salesTax,
      }),
    );
    return required(await this.getById(id as string), "Workspace");
  }

  async rename(id: string, name: string): Promise<Workspace> {
    await unwrap(this.client.rpc("rename_workspace", { p_id: id, p_name: name }));
    return required(await this.getById(id), "Workspace");
  }

  async updateSalesTaxSettings(id: string, settings: WorkspaceTaxSettings): Promise<Workspace> {
    await unwrap(
      this.client.rpc("update_workspace_tax_settings", { p_id: id, p_settings: settings }),
    );
    return required(await this.getById(id), "Workspace");
  }

  async updateCateringSettings(id: string, settings: CateringSettings): Promise<Workspace> {
    await unwrap(this.client.rpc("update_catering_settings", { p_id: id, p_settings: settings }));
    return required(await this.getById(id), "Workspace");
  }

  async updateInventorySettings(id: string, settings: InventorySettings): Promise<Workspace> {
    await unwrap(this.client.rpc("update_workspace_inventory_settings", { p_id: id, p_settings: settings }));
    return required(await this.getById(id), "Workspace");
  }

  async softDelete(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_workspace", { p_id: id }));
  }

  async restoreFromBackup(_ownerId: string, name: string, backup: WorkspaceBackup): Promise<Workspace> {
    // Pemilik = user yang login (auth.uid() di RPC), ADR 023.
    const id = (await unwrap(this.client.rpc("restore_workspace", { p_backup: backup, p_name: name }))) as string;
    return required(await this.getById(id), "Workspace pulihan");
  }
}

export class SupabaseAccountRepository implements IAccountRepository {
  constructor(private readonly client: Client) {}

  async listByWorkspace(workspaceId: string): Promise<Account[]> {
    const rows = await unwrapRows(
      this.client.from("accounts").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("code"),
    );
    return rows.map(toAccount);
  }

  async getById(id: string): Promise<Account | null> {
    const row = await unwrap(
      this.client.from("accounts").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    );
    return row ? toAccount(row) : null;
  }

  async create(workspaceId: string, seed: AccountSeed): Promise<Account> {
    const id = await unwrap(this.client.rpc("create_account", { p_workspace_id: workspaceId, p_account: seed }));
    return required(await this.getById(id as string), "Akun");
  }

  async update(id: string, patch: AccountPatch): Promise<Account> {
    await unwrap(this.client.rpc("update_account", { p_id: id, p_patch: patch }));
    return required(await this.getById(id), "Akun");
  }

  async softDelete(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_account", { p_id: id }));
  }

  /** Dipakai baris jurnal draft maupun posted yang belum dihapus (ADR 009). */
  async hasJournalLines(id: string): Promise<boolean> {
    const rows = await unwrapRows(
      this.client
        .from("journal_lines")
        .select("id, journal_entries!inner(deleted_at)")
        .eq("account_id", id)
        .is("journal_entries.deleted_at", null)
        .limit(1),
    );
    return rows.length > 0;
  }
}

export class SupabasePeriodRepository implements IPeriodRepository {
  constructor(private readonly client: Client) {}

  async listByWorkspace(workspaceId: string): Promise<Period[]> {
    const rows = await unwrapRows(
      this.client.from("periods").select("*").eq("workspace_id", workspaceId).order("start_date"),
    );
    return rows.map(toPeriod);
  }

  async createMany(workspaceId: string, periods: PeriodRange[]): Promise<Period[]> {
    const ids = (await unwrap(
      this.client.rpc("create_periods", { p_workspace_id: workspaceId, p_ranges: periods }),
    )) as string[];
    if (ids.length === 0) return [];
    const rows = await unwrapRows(this.client.from("periods").select("*").in("id", ids).order("start_date"));
    return rows.map(toPeriod);
  }

  async setStatus(id: string, status: PeriodStatus, reason?: string): Promise<Period> {
    await unwrap(this.client.rpc("set_period_status", { p_id: id, p_status: status, p_reason: reason ?? null }));
    const row = await unwrap(this.client.from("periods").select("*").eq("id", id).maybeSingle());
    return toPeriod(required(row, "Periode"));
  }
}

export class SupabaseJournalRepository implements IJournalRepository {
  constructor(private readonly client: Client) {}

  async listByWorkspace(workspaceId: string, filter: JournalFilter = {}): Promise<JournalEntry[]> {
    const rows = await fetchAll((from, to) => {
      let query = this.client
        .from("journal_entries")
        .select(JOURNAL_SELECT)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      if (filter.status) query = query.eq("status", filter.status);
      if (filter.fromDate) query = query.gte("entry_date", filter.fromDate);
      if (filter.toDate) query = query.lte("entry_date", filter.toDate);
      return query.order("entry_date").order("created_at").order("id").range(from, to);
    });
    return rows.map(toJournal);
  }

  async getById(id: string): Promise<JournalEntry | null> {
    const row = await unwrap(
      this.client.from("journal_entries").select(JOURNAL_SELECT).eq("id", id).is("deleted_at", null).maybeSingle(),
    );
    return row ? toJournal(row) : null;
  }

  async findReversalOf(id: string): Promise<JournalEntry | null> {
    const row = await unwrap(
      this.client
        .from("journal_entries")
        .select(JOURNAL_SELECT)
        .eq("reversal_of", id)
        .eq("status", "posted")
        .is("deleted_at", null)
        .maybeSingle(),
    );
    return row ? toJournal(row) : null;
  }

  async listActiveSettlementsOf(id: string): Promise<JournalEntry[]> {
    return this.activeLinked("settlement_of", id);
  }

  async listActiveReturnsOf(id: string): Promise<JournalEntry[]> {
    return this.activeLinked("return_of", id);
  }

  /** Jurnal posted yang merujuk `id` lewat kolom tautan dan belum di-void. */
  private async activeLinked(column: "settlement_of" | "return_of", id: string): Promise<JournalEntry[]> {
    const settlements = (
      await unwrapRows(
        this.client
          .from("journal_entries")
          .select(JOURNAL_SELECT)
          .eq(column, id)
          .eq("status", "posted")
          .is("deleted_at", null)
          .order("entry_date")
          .order("created_at"),
      )
    ).map(toJournal);
    if (settlements.length === 0) return [];
    const reversed = await unwrapRows(
      this.client
        .from("journal_entries")
        .select("reversal_of")
        .in("reversal_of", settlements.map((s) => s.id))
        .eq("status", "posted")
        .is("deleted_at", null),
    );
    const reversedIds = new Set(reversed.map((r) => r.reversal_of as string));
    return settlements.filter((s) => !reversedIds.has(s.id));
  }

  async saveDraft(entry: JournalEntryInput, draftId?: string): Promise<JournalEntry> {
    const id = await unwrap(this.client.rpc("save_journal_draft", { p_input: entry, p_draft_id: draftId ?? null }));
    return required(await this.getById(id as string), "Jurnal");
  }

  async deleteDraft(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_journal_draft", { p_id: id }));
  }

  async postJournal(entry: JournalEntryInput, draftId?: string): Promise<JournalEntry> {
    const id = await unwrap(this.client.rpc("post_journal", { p_input: entry, p_draft_id: draftId ?? null }));
    return required(await this.getById(id as string), "Jurnal");
  }

  async closeFiscalYear(workspaceId: string, year: number, entries: JournalEntryInput[]): Promise<JournalEntry[]> {
    const ids = (await unwrap(
      this.client.rpc("close_fiscal_year", { p_workspace_id: workspaceId, p_year: year, p_entries: entries }),
    )) as string[];
    return this.getMany(ids);
  }

  async cancelFiscalYearClosing(workspaceId: string, year: number): Promise<JournalEntry[]> {
    const ids = (await unwrap(
      this.client.rpc("cancel_fiscal_year_closing", { p_workspace_id: workspaceId, p_year: year }),
    )) as string[];
    return this.getMany(ids);
  }

  /** Jurnal berdasarkan id, dengan urutan sesuai `ids`. */
  private async getMany(ids: string[]): Promise<JournalEntry[]> {
    if (ids.length === 0) return [];
    const rows = (
      await unwrapRows(this.client.from("journal_entries").select(JOURNAL_SELECT).in("id", ids))
    ).map(toJournal);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => required(byId.get(id) ?? null, "Jurnal"));
  }
}

export class SupabaseItemRepository implements IItemRepository {
  constructor(private readonly client: Client) {}

  async listByWorkspace(workspaceId: string): Promise<Item[]> {
    const rows = await unwrapRows(
      this.client.from("items").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("code"),
    );
    return rows.map(toItem);
  }

  async getById(id: string): Promise<Item | null> {
    const row = await unwrap(this.client.from("items").select("*").eq("id", id).is("deleted_at", null).maybeSingle());
    return row ? toItem(row) : null;
  }

  async create(workspaceId: string, input: ItemInput): Promise<Item> {
    const id = await unwrap(this.client.rpc("create_item", { p_workspace_id: workspaceId, p_item: input }));
    return required(await this.getById(id as string), "Barang");
  }

  async update(id: string, patch: ItemPatch): Promise<Item> {
    await unwrap(this.client.rpc("update_item", { p_id: id, p_patch: patch }));
    return required(await this.getById(id), "Barang");
  }

  async softDelete(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_item", { p_id: id }));
  }

  async hasJournalLines(id: string): Promise<boolean> {
    const rows = await unwrapRows(
      this.client
        .from("journal_lines")
        .select("id, journal_entries!inner(deleted_at)")
        .eq("item_id", id)
        .is("journal_entries.deleted_at", null)
        .limit(1),
    );
    return rows.length > 0;
  }
}

export class SupabaseStockCountRepository implements IStockCountRepository {
  constructor(private readonly client: Client) {}

  async listByWorkspace(workspaceId: string): Promise<StockCount[]> {
    const rows = await unwrapRows(
      this.client.from("stock_counts").select("*, stock_count_lines(*)").eq("workspace_id", workspaceId).is("deleted_at", null).order("count_date"),
    );
    const journalIds = rows.map((r) => r.journal_entry_id as string | null).filter((id): id is string => Boolean(id));
    const reversed = new Set<string>();
    if (journalIds.length > 0) {
      const reversals = await unwrapRows(
        this.client.from("journal_entries").select("reversal_of").in("reversal_of", journalIds).eq("status", "posted").is("deleted_at", null),
      );
      for (const r of reversals) reversed.add(r.reversal_of as string);
    }
    // Aktif = belum dibatalkan dan jurnalnya belum di-void (ADR 020).
    return rows.filter((r) => !(r.journal_entry_id && reversed.has(r.journal_entry_id))).map(toStockCount);
  }

  async post(input: StockCountInput, journal: JournalEntryInput | null): Promise<StockCount> {
    const id = (await unwrap(this.client.rpc("post_stock_count", { p_count: input, p_journal: journal }))) as string;
    const row = await unwrap(this.client.from("stock_counts").select("*, stock_count_lines(*)").eq("id", id).maybeSingle());
    return toStockCount(required(row, "Stok opname"));
  }

  async cancel(id: string, reversalDate: IsoDate): Promise<void> {
    await unwrap(this.client.rpc("cancel_stock_count", { p_id: id, p_reversal_date: reversalDate }));
  }
}

/** Profil usaha, kontak, faktur (ADR 022): baca SELECT, tulis RPC. */
export class SupabaseInvoiceRepository implements IInvoiceRepository {
  constructor(private readonly client: Client) {}

  async getProfile(workspaceId: string): Promise<BusinessProfile> {
    const row = await unwrap(this.client.from("workspace_profiles").select("*").eq("workspace_id", workspaceId).maybeSingle());
    return row ? toProfile(row) : { ...defaultProfile(), workspaceId, updatedAt: null };
  }

  async saveProfile(workspaceId: string, input: BusinessProfileInput): Promise<BusinessProfile> {
    await unwrap(this.client.rpc("save_business_profile", { p_workspace_id: workspaceId, p_profile: input }));
    return this.getProfile(workspaceId);
  }

  async listContacts(workspaceId: string): Promise<Contact[]> {
    const rows = await unwrapRows(this.client.from("contacts").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("name"));
    return rows.map(toContact);
  }

  private async getContact(id: string): Promise<Contact | null> {
    const row = await unwrap(this.client.from("contacts").select("*").eq("id", id).is("deleted_at", null).maybeSingle());
    return row ? toContact(row) : null;
  }

  async createContact(workspaceId: string, input: ContactInput): Promise<Contact> {
    const id = await unwrap(this.client.rpc("create_contact", { p_workspace_id: workspaceId, p_contact: input }));
    return required(await this.getContact(id as string), "Kontak");
  }

  async updateContact(id: string, input: ContactInput): Promise<Contact> {
    await unwrap(this.client.rpc("update_contact", { p_id: id, p_contact: input }));
    return required(await this.getContact(id), "Kontak");
  }

  async deleteContact(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_contact", { p_id: id }));
  }

  async listInvoices(workspaceId: string, kind?: InvoiceKind): Promise<Invoice[]> {
    let query = this.client.from("invoices").select("*, invoice_lines(*)").eq("workspace_id", workspaceId).is("deleted_at", null);
    if (kind) query = query.eq("kind", kind);
    const rows = await unwrapRows(query.order("invoice_date", { ascending: false }).order("created_at", { ascending: false }));
    return rows.map(toInvoice);
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const row = await unwrap(this.client.from("invoices").select("*, invoice_lines(*)").eq("id", id).is("deleted_at", null).maybeSingle());
    return row ? toInvoice(row) : null;
  }

  async saveDraft(input: InvoiceInput, id?: string): Promise<Invoice> {
    const saved = (await unwrap(this.client.rpc("save_invoice_draft", { p_invoice: input, p_id: id ?? null }))) as string;
    return required(await this.getInvoice(saved), "Faktur");
  }

  async deleteDraft(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_invoice_draft", { p_id: id }));
  }

  async issue(id: string, journal: JournalEntryInput, contact: ContactSnapshot, prefix: string): Promise<Invoice> {
    await unwrap(this.client.rpc("issue_invoice", { p_id: id, p_journal: journal, p_contact: contact, p_prefix: prefix }));
    return required(await this.getInvoice(id), "Faktur");
  }
}

/** Pesanan katering & invoice DP (ADR 024): baca SELECT, tulis RPC. */
export class SupabaseCateringRepository implements ICateringRepository {
  constructor(private readonly client: Client) {}

  async listOrders(workspaceId: string): Promise<CateringOrder[]> {
    const rows = await unwrapRows(
      this.client.from("catering_orders").select("*").eq("workspace_id", workspaceId).is("deleted_at", null)
        .order("event_date", { ascending: false }).order("created_at", { ascending: false }),
    );
    return rows.map(toCateringOrder);
  }

  async getOrder(id: string): Promise<CateringOrder | null> {
    const row = await unwrap(this.client.from("catering_orders").select("*").eq("id", id).is("deleted_at", null).maybeSingle());
    return row ? toCateringOrder(row) : null;
  }

  async saveOrder(input: CateringOrderInput, prefix: string, id?: string): Promise<CateringOrder> {
    const saved = (await unwrap(this.client.rpc("save_catering_order", { p_order: input, p_prefix: prefix, p_id: id ?? null }))) as string;
    return required(await this.getOrder(saved), "Pesanan");
  }

  async confirmOrder(id: string): Promise<CateringOrder> {
    await unwrap(this.client.rpc("confirm_catering_order", { p_id: id }));
    return required(await this.getOrder(id), "Pesanan");
  }

  async deleteOrder(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_catering_order", { p_id: id }));
  }

  async listBills(workspaceId: string): Promise<OrderBill[]> {
    const rows = await unwrapRows(
      this.client.from("catering_order_bills").select("*").eq("workspace_id", workspaceId).is("deleted_at", null)
        .order("bill_date", { ascending: false }).order("created_at", { ascending: false }),
    );
    return rows.map(toOrderBill);
  }

  async createBill(input: OrderBillInput, prefix: string): Promise<OrderBill> {
    const id = (await unwrap(this.client.rpc("create_order_bill", { p_bill: input, p_prefix: prefix }))) as string;
    const row = await unwrap(this.client.from("catering_order_bills").select("*").eq("id", id).maybeSingle());
    return toOrderBill(required(row, "Invoice DP"));
  }

  async deleteBill(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_order_bill", { p_id: id }));
  }

  async completeOrder(id: string, invoice: InvoiceInput, journal: JournalEntryInput, contact: ContactSnapshot, invoicePrefix: string): Promise<CateringOrder> {
    await unwrap(this.client.rpc("complete_catering_order", { p_id: id, p_invoice: invoice, p_journal: journal, p_contact: contact, p_prefix: invoicePrefix }));
    return required(await this.getOrder(id), "Pesanan");
  }

  async cancelOrder(id: string, journal: JournalEntryInput | null, reason: string): Promise<CateringOrder> {
    await unwrap(this.client.rpc("cancel_catering_order", { p_id: id, p_journal: journal, p_reason: reason }));
    return required(await this.getOrder(id), "Pesanan");
  }

  async listPackages(workspaceId: string): Promise<CateringPackage[]> {
    const rows = await unwrapRows(this.client.from("catering_packages").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("code"));
    return rows.map(toCateringPackage);
  }

  private async getPackage(id: string): Promise<CateringPackage> {
    const row = await unwrap(this.client.from("catering_packages").select("*").eq("id", id).maybeSingle());
    return toCateringPackage(required(row, "Paket"));
  }

  async savePackage(workspaceId: string, input: CateringPackageInput, id?: string): Promise<CateringPackage> {
    const saved = (await unwrap(this.client.rpc("save_catering_package", { p_workspace_id: workspaceId, p_package: input, p_id: id ?? null }))) as string;
    return this.getPackage(saved);
  }

  async setPackageActive(id: string, isActive: boolean): Promise<CateringPackage> {
    await unwrap(this.client.rpc("set_catering_package_active", { p_id: id, p_active: isActive }));
    return this.getPackage(id);
  }

  async deletePackage(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_catering_package", { p_id: id }));
  }

  async listSubscriptions(workspaceId: string): Promise<Subscription[]> {
    const rows = await unwrapRows(this.client.from("catering_subscriptions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("name"));
    return rows.map(toSubscription);
  }

  private async getSubscription(id: string): Promise<Subscription> {
    const row = await unwrap(this.client.from("catering_subscriptions").select("*").eq("id", id).maybeSingle());
    return toSubscription(required(row, "Langganan"));
  }

  async saveSubscription(workspaceId: string, input: SubscriptionInput, id?: string): Promise<Subscription> {
    const saved = (await unwrap(this.client.rpc("save_subscription", { p_workspace_id: workspaceId, p_subscription: input, p_id: id ?? null }))) as string;
    return this.getSubscription(saved);
  }

  async setSubscriptionDays(id: string, changes: Record<IsoDate, number | null>): Promise<Subscription> {
    await unwrap(this.client.rpc("set_subscription_days", { p_id: id, p_changes: changes }));
    return this.getSubscription(id);
  }

  async deleteSubscription(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_subscription", { p_id: id }));
  }

  async createSubscriptionInvoice(id: string, month: string, invoice: InvoiceInput): Promise<Invoice> {
    const invoiceId = (await unwrap(this.client.rpc("create_subscription_invoice", { p_id: id, p_month: month, p_invoice: invoice }))) as string;
    const row = await unwrap(this.client.from("invoices").select("*, invoice_lines(*)").eq("id", invoiceId).maybeSingle());
    return toInvoice(required(row, "Faktur"));
  }
}

type SaleLineRow = { journal_entry_id: string; journal_entries: { entry_date: string } } & Record<string, unknown>;

/** Menu, resep, rekap porsi, penjualan menu (ADR 021): baca SELECT, tulis RPC. */
export class SupabaseMenuRepository implements IMenuRepository {
  constructor(
    private readonly client: Client,
    private readonly journals: SupabaseJournalRepository,
  ) {}

  async listMenus(workspaceId: string): Promise<Menu[]> {
    const rows = await unwrapRows(this.client.from("menus").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("code"));
    return rows.map(toMenu);
  }

  async getMenu(id: string): Promise<Menu | null> {
    const row = await unwrap(this.client.from("menus").select("*").eq("id", id).is("deleted_at", null).maybeSingle());
    return row ? toMenu(row) : null;
  }

  async createMenu(workspaceId: string, input: MenuInput): Promise<Menu> {
    const id = await unwrap(this.client.rpc("create_menu", { p_workspace_id: workspaceId, p_menu: input }));
    return required(await this.getMenu(id as string), "Menu");
  }

  async updateMenu(id: string, patch: MenuPatch): Promise<Menu> {
    await unwrap(this.client.rpc("update_menu", { p_id: id, p_patch: patch }));
    return required(await this.getMenu(id), "Menu");
  }

  async deleteMenu(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_menu", { p_id: id }));
  }

  async listRecipes(workspaceId: string): Promise<Recipe[]> {
    const rows = await unwrapRows(
      this.client.from("recipes").select("*, recipe_lines(*)").eq("workspace_id", workspaceId).is("deleted_at", null).order("menu_id").order("effective_from"),
    );
    return rows.map(toRecipe);
  }

  async saveRecipe(input: RecipeInput): Promise<Recipe> {
    const id = (await unwrap(this.client.rpc("save_recipe", { p_recipe: input }))) as string;
    const row = await unwrap(this.client.from("recipes").select("*, recipe_lines(*)").eq("id", id).maybeSingle());
    return toRecipe(required(row, "Resep"));
  }

  async deleteRecipe(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_recipe", { p_id: id }));
  }

  async listPortionSummaries(workspaceId: string): Promise<PortionSummary[]> {
    const rows = await unwrapRows(
      this.client.from("portion_summaries").select("*, portion_summary_lines(*)").eq("workspace_id", workspaceId).is("deleted_at", null).order("date_from"),
    );
    return rows.map(toPortionSummary);
  }

  async createPortionSummary(input: PortionSummaryInput): Promise<PortionSummary> {
    const id = (await unwrap(this.client.rpc("create_portion_summary", { p_summary: input }))) as string;
    const row = await unwrap(this.client.from("portion_summaries").select("*, portion_summary_lines(*)").eq("id", id).maybeSingle());
    return toPortionSummary(required(row, "Rekap porsi"));
  }

  async deletePortionSummary(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_portion_summary", { p_id: id }));
  }

  async listMenuSales(workspaceId: string): Promise<MenuSale[]> {
    const rows = await fetchAll((from, to) =>
      this.client
        .from("menu_sale_lines")
        .select("*, journal_entries!inner(entry_date, deleted_at)")
        .eq("workspace_id", workspaceId)
        .is("journal_entries.deleted_at", null)
        .order("journal_entry_id")
        .order("line_no")
        .range(from, to),
    );
    const lines = rows as unknown as SaleLineRow[];
    const journalIds = [...new Set(lines.map((r) => r.journal_entry_id))];
    const reversed = new Set<string>();
    for (let i = 0; i < journalIds.length; i += 200) {
      const reversals = await unwrapRows(
        this.client.from("journal_entries").select("reversal_of").in("reversal_of", journalIds.slice(i, i + 200)).eq("status", "posted").is("deleted_at", null),
      );
      for (const r of reversals) reversed.add(r.reversal_of as string);
    }
    const sales = new Map<string, MenuSale>();
    for (const row of lines) {
      if (reversed.has(row.journal_entry_id)) continue;
      let sale = sales.get(row.journal_entry_id);
      if (!sale) {
        sale = { journalEntryId: row.journal_entry_id, workspaceId, entryDate: row.journal_entries.entry_date, lines: [] };
        sales.set(row.journal_entry_id, sale);
      }
      const { lineNo: _lineNo, ...line } = toMenuSaleLine(row); // eslint-disable-line @typescript-eslint/no-unused-vars
      sale.lines.push(line);
    }
    return [...sales.values()].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  }

  async postMenuSale(journal: JournalEntryInput, lines: MenuSaleLine[]): Promise<JournalEntry> {
    const id = (await unwrap(this.client.rpc("post_menu_sale", { p_journal: journal, p_lines: lines }))) as string;
    return required(await this.journals.getById(id), "Jurnal penjualan menu");
  }
}

export class SupabaseAuditLogRepository implements IAuditLogRepository {
  constructor(private readonly client: Client) {}

  async listByWorkspace(workspaceId: string, filter: AuditLogFilter = {}): Promise<AuditLog[]> {
    let query = this.client.from("audit_logs").select("*").eq("workspace_id", workspaceId);
    if (filter.entityType) query = query.eq("entity_type", filter.entityType);
    if (filter.entityId) query = query.eq("entity_id", filter.entityId);
    const rows = await unwrapRows(query.order("seq", { ascending: false }).limit(1000));
    return rows.map(toAuditLog);
  }
}

export function createSupabaseRepositories(client: Client) {
  const journals = new SupabaseJournalRepository(client);
  return {
    workspaces: new SupabaseWorkspaceRepository(client),
    accounts: new SupabaseAccountRepository(client),
    periods: new SupabasePeriodRepository(client),
    journals,
    menus: new SupabaseMenuRepository(client, journals),
    invoices: new SupabaseInvoiceRepository(client),
    catering: new SupabaseCateringRepository(client),
    items: new SupabaseItemRepository(client),
    stockCounts: new SupabaseStockCountRepository(client),
    auditLogs: new SupabaseAuditLogRepository(client),
  };
}
