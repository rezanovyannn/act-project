import { fail } from "../errors";
import {
  buildInvoicePlan,
  contactSnapshot,
  summarizeInvoices,
  validateContact,
  validateDraft,
  validateProfile,
  withDiscountAccount,
  type InvoiceContext,
  type InvoicePlan,
  type InvoiceSummary,
} from "../invoice";
import type { IAccountRepository, IInvoiceRepository, IItemRepository, IJournalRepository, IWorkspaceRepository } from "../ports";
import type {
  Account,
  BusinessProfile,
  BusinessProfileInput,
  Contact,
  ContactInput,
  Invoice,
  InvoiceInput,
  InvoiceKind,
  IsoDate,
  Item,
  JournalEntry,
  Workspace,
} from "../types";
import { buildSnapshot, ensureSalesReturnsAccount } from "./inventory-service";
import type { JournalService } from "./journal-service";

export interface InvoiceData {
  workspace: Workspace;
  profile: BusinessProfile;
  accounts: Account[];
  items: Item[];
  contacts: Contact[];
  journals: JournalEntry[];
  invoices: Invoice[];
}

/** Profil usaha, kontak, dan faktur (ADR 022). */
export class InvoiceService {
  constructor(
    private readonly deps: {
      workspaces: IWorkspaceRepository;
      accounts: IAccountRepository;
      items: IItemRepository;
      journals: IJournalRepository;
      invoices: IInvoiceRepository;
      journalService: JournalService;
    },
  ) {}

  async data(workspaceId: string, kind?: InvoiceKind): Promise<InvoiceData> {
    const [workspace, profile, accounts, items, contacts, journals, invoices] = await Promise.all([
      this.deps.workspaces.getById(workspaceId),
      this.deps.invoices.getProfile(workspaceId),
      this.deps.accounts.listByWorkspace(workspaceId),
      this.deps.items.listByWorkspace(workspaceId),
      this.deps.invoices.listContacts(workspaceId),
      this.deps.journals.listByWorkspace(workspaceId),
      this.deps.invoices.listInvoices(workspaceId, kind),
    ]);
    if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
    return { workspace, profile, accounts, items, contacts, journals, invoices };
  }

  summaries(data: InvoiceData, today: IsoDate): InvoiceSummary[] {
    return summarizeInvoices(data.invoices, data.journals, data.accounts, today);
  }

  // ---------- Profil & kontak ----------

  getProfile(workspaceId: string): Promise<BusinessProfile> {
    return this.deps.invoices.getProfile(workspaceId);
  }

  async saveProfile(workspaceId: string, input: BusinessProfileInput): Promise<BusinessProfile> {
    return this.deps.invoices.saveProfile(workspaceId, validateProfile(input));
  }

  async createContact(workspaceId: string, input: ContactInput): Promise<Contact> {
    const existing = await this.deps.invoices.listContacts(workspaceId);
    return this.deps.invoices.createContact(workspaceId, validateContact(input, existing));
  }

  async updateContact(contact: Contact, input: ContactInput): Promise<Contact> {
    const existing = await this.deps.invoices.listContacts(contact.workspaceId);
    return this.deps.invoices.updateContact(contact.id, validateContact(input, existing, contact.id));
  }

  deleteContact(id: string): Promise<void> {
    return this.deps.invoices.deleteContact(id);
  }

  // ---------- Faktur ----------

  async saveDraft(input: InvoiceInput, id?: string): Promise<Invoice> {
    return this.deps.invoices.saveDraft(validateDraft(input), id);
  }

  deleteDraft(id: string): Promise<void> {
    return this.deps.invoices.deleteDraft(id);
  }

  /** Konteks pembentuk jurnal faktur (stok per barang pada tanggal faktur bila perpetual). */
  context(data: InvoiceData, date: IsoDate): InvoiceContext {
    const perpetual =
      data.workspace.inventoryMethod === "perpetual"
        ? buildSnapshot(data.workspace, data.accounts, data.items, data.journals, date).context
        : null;
    return { workspace: data.workspace, accounts: data.accounts, items: data.items, contacts: data.contacts, perpetual };
  }

  /**
   * Pratinjau jurnal terbit (dipakai form). Bila akun Retur & Potongan Penjualan
   * belum ada, diskon penjualan memakai akun sementara (dibuat saat terbit).
   */
  plan(input: InvoiceInput, data: InvoiceData): InvoicePlan {
    const ctx = this.context(data, input.invoiceDate);
    return buildInvoicePlan(input, input.kind === "sale" ? { ...ctx, accounts: withDiscountAccount(ctx.accounts) } : ctx);
  }

  /** Simpan draft terakhir lalu terbitkan: nomor, jurnal kredit, salinan kontak (atomik di repository). */
  async issue(input: InvoiceInput, id?: string): Promise<Invoice> {
    const draft = await this.saveDraft(input, id);
    let data = await this.data(draft.workspaceId);
    this.plan(draft, data);
    if (draft.kind === "sale" && draft.discount && !data.accounts.some((a) => a.systemRole === "sales_returns" && a.deletedAt === null)) {
      await ensureSalesReturnsAccount(this.deps.accounts, draft.workspaceId);
      data = await this.data(draft.workspaceId);
    }
    const plan = buildInvoicePlan(draft, this.context(data, draft.invoiceDate));
    await this.deps.journalService.validateForPosting(plan.entry);
    const prefix = draft.kind === "sale" ? data.profile.invoicePrefix : data.profile.purchasePrefix;
    return this.deps.invoices.issue(draft.id, plan.entry, contactSnapshot(plan.contact), prefix);
  }

  /** Batalkan faktur terbit = void jurnalnya (jurnal pembalik pada `reversalDate`). */
  async cancel(invoice: Invoice, reversalDate: IsoDate, reason: string): Promise<void> {
    if (invoice.status !== "issued" || !invoice.journalEntryId) fail("INVALID_INVOICE", "Hanya faktur terbit yang dapat dibatalkan");
    await this.deps.journalService.voidJournal(invoice.journalEntryId, reversalDate, `Pembatalan faktur ${invoice.number}: ${reason}`);
  }

  /** Salin faktur (terbit/dibatalkan) menjadi draft baru. */
  duplicate(invoice: Invoice, invoiceDate: IsoDate, dueDate: IsoDate): Promise<Invoice> {
    const { workspaceId, kind, contactId, reference, notes, applyTax, taxOverride, discount, lines } = invoice;
    return this.saveDraft({ workspaceId, kind, contactId, invoiceDate, dueDate, reference, notes, applyTax, taxOverride, discount, lines: lines.map((l) => ({ ...l })) });
  }
}
