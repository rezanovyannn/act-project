import { isValidIsoDate } from "@/core/dates";
import { fail } from "@/core/errors";
import { defaultProfile, formatInvoiceNumber, LOGO_MAX_LENGTH, LOGO_PATTERN, nextInvoiceSeq, PREFIX_PATTERN } from "@/core/invoice";
import type { IInvoiceRepository } from "@/core/ports";
import type {
  BusinessProfile,
  BusinessProfileInput,
  Contact,
  ContactInput,
  ContactSnapshot,
  Invoice,
  InvoiceInput,
  InvoiceKind,
  JournalEntryInput,
} from "@/core/types";
import type { MockJournalRepository } from "./journal-repository";
import type { MockDatabase, MockState } from "./mock-database";

type StoredInvoice = Invoice & { deletedAt: string | null };
const strip = ({ deletedAt: _deleted, ...invoice }: StoredInvoice): Invoice => invoice; // eslint-disable-line @typescript-eslint/no-unused-vars

function requireContact(state: MockState, id: string): Contact {
  const contact = state.contacts.find((c) => c.id === id && c.deletedAt === null);
  if (!contact) fail("CONTACT_NOT_FOUND", "Kontak tidak ditemukan");
  return contact;
}

function assertUniqueName(state: MockState, workspaceId: string, name: string, exceptId?: string) {
  const taken = state.contacts.find(
    (c) => c.workspaceId === workspaceId && c.deletedAt === null && c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) fail("DUPLICATE_CONTACT", `Kontak ${taken.name} sudah ada`);
}

const JOURNAL_SOURCE: Record<InvoiceKind, string> = { sale: "revenue", purchase: "purchase" };

/** Profil usaha, kontak, faktur di localStorage; meniru RPC ADR 022. */
export class MockInvoiceRepository implements IInvoiceRepository {
  constructor(
    private readonly db: MockDatabase,
    private readonly journals: MockJournalRepository,
  ) {}

  async getProfile(workspaceId: string): Promise<BusinessProfile> {
    const stored = this.db.read().profiles.find((p) => p.workspaceId === workspaceId);
    return stored ? { ...stored } : { ...defaultProfile(), workspaceId, updatedAt: null };
  }

  async saveProfile(workspaceId: string, input: BusinessProfileInput): Promise<BusinessProfile> {
    return this.db.write((state) => {
      if (!state.workspaces.some((w) => w.id === workspaceId && w.deletedAt === null)) fail("NOT_FOUND", "Workspace tidak ditemukan");
      // Meniru constraint tabel workspace_profiles.
      const logoOk = !input.logoDataUrl || (input.logoDataUrl.length <= LOGO_MAX_LENGTH && LOGO_PATTERN.test(input.logoDataUrl));
      if (!PREFIX_PATTERN.test(input.invoicePrefix) || !PREFIX_PATTERN.test(input.purchasePrefix) || !logoOk) fail("INVALID_PROFILE", "Prefix nomor faktur atau logo tidak valid");
      const profile: BusinessProfile = { ...input, workspaceId, updatedAt: this.db.now() };
      state.profiles = [...state.profiles.filter((p) => p.workspaceId !== workspaceId), profile];
      return { ...profile };
    });
  }

  async listContacts(workspaceId: string): Promise<Contact[]> {
    return this.db
      .read()
      .contacts.filter((c) => c.workspaceId === workspaceId && c.deletedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name, "id"));
  }

  async createContact(workspaceId: string, input: ContactInput): Promise<Contact> {
    return this.db.write((state) => {
      assertUniqueName(state, workspaceId, input.name);
      const now = this.db.now();
      const contact: Contact = { ...input, id: this.db.generateId(), workspaceId, createdAt: now, updatedAt: now, deletedAt: null };
      state.contacts.push(contact);
      this.db.audit(state, { workspaceId, entityType: "contact", entityId: contact.id, action: "create", before: null, after: contact });
      return { ...contact };
    });
  }

  async updateContact(id: string, input: ContactInput): Promise<Contact> {
    return this.db.write((state) => {
      const contact = requireContact(state, id);
      assertUniqueName(state, contact.workspaceId, input.name, id);
      const before = { ...contact };
      Object.assign(contact, input, { updatedAt: this.db.now() });
      this.db.audit(state, { workspaceId: contact.workspaceId, entityType: "contact", entityId: id, action: "update", before, after: contact });
      return { ...contact };
    });
  }

  async deleteContact(id: string): Promise<void> {
    this.db.write((state) => {
      const contact = requireContact(state, id);
      if (state.invoices.some((i) => i.deletedAt === null && i.contactId === id)) {
        fail("CONTACT_IN_USE", "Kontak sudah dipakai faktur; tidak bisa dihapus");
      }
      contact.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: contact.workspaceId, entityType: "contact", entityId: id, action: "delete", before: contact, after: null });
    });
  }

  async listInvoices(workspaceId: string, kind?: InvoiceKind): Promise<Invoice[]> {
    return this.db
      .read()
      .invoices.filter((i) => i.workspaceId === workspaceId && i.deletedAt === null && (!kind || i.kind === kind))
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.createdAt.localeCompare(a.createdAt))
      .map(strip);
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const invoice = this.db.read().invoices.find((i) => i.id === id && i.deletedAt === null);
    return invoice ? strip(invoice) : null;
  }

  async saveDraft(input: InvoiceInput, id?: string): Promise<Invoice> {
    return this.db.write((state) => {
      // Meniru validasi RPC save_invoice_draft.
      if (input.kind !== "sale" && input.kind !== "purchase") fail("INVALID_INVOICE", "Jenis faktur tidak dikenal");
      if (!isValidIsoDate(input.invoiceDate) || !isValidIsoDate(input.dueDate)) fail("INVALID_DATE", "Tanggal faktur/jatuh tempo tidak valid");
      if (input.lines.length > 200) fail("INVALID_INVOICE", "Baris faktur tidak valid (maks. 200)");
      const override = input.taxOverride ?? null;
      if (override !== null && (!Number.isSafeInteger(override) || override < 0)) fail("INVALID_AMOUNT", "PPN Masukan harus bilangan bulat ≥ 0");
      const discount = input.discount ?? null;
      if (discount && (!["percent", "amount"].includes(discount.kind) || !Number.isSafeInteger(discount.value) || discount.value < 0 || (discount.kind === "percent" && discount.value > 10_000))) {
        fail("INVALID_AMOUNT", "Diskon faktur tidak valid");
      }
      for (const line of input.lines) {
        const ok = (n: number) => Number.isSafeInteger(n) && n >= 0;
        if (!ok(line.quantity) || !ok(line.unitPrice)) fail("INVALID_QUANTITY", "Qty dan harga harus bilangan bulat ≥ 0");
        if (line.accountId && !state.accounts.some((acc) => acc.id === line.accountId && acc.workspaceId === input.workspaceId)) {
          fail("INVALID_ACCOUNT", "Akun atau barang pada baris faktur tidak ditemukan di workspace ini");
        }
        if (line.itemId && !state.items.some((it) => it.id === line.itemId && it.workspaceId === input.workspaceId)) {
          fail("INVALID_ACCOUNT", "Akun atau barang pada baris faktur tidak ditemukan di workspace ini");
        }
      }
      if (input.contactId) {
        const contact = requireContact(state, input.contactId);
        if (contact.workspaceId !== input.workspaceId) fail("CONTACT_NOT_FOUND", "Kontak tidak ditemukan");
      }
      const now = this.db.now();
      if (id) {
        const invoice = state.invoices.find((i) => i.id === id && i.deletedAt === null);
        if (!invoice || invoice.workspaceId !== input.workspaceId) fail("INVOICE_NOT_FOUND", "Faktur tidak ditemukan");
        if (invoice.status !== "draft") fail("INVALID_INVOICE", "Faktur terbit tidak dapat diubah");
        if (invoice.kind !== input.kind) fail("INVALID_INVOICE", "Jenis faktur tidak dapat diubah");
        const before = { ...invoice };
        Object.assign(invoice, { ...input, taxOverride: override, discount, lines: input.lines.map((l) => ({ ...l })), updatedAt: now });
        this.db.audit(state, { workspaceId: invoice.workspaceId, entityType: "invoice", entityId: id, action: "update", before, after: invoice });
        return strip(invoice);
      }
      const invoice: StoredInvoice = {
        ...input,
        taxOverride: override,
        discount,
        lines: input.lines.map((l) => ({ ...l })),
        id: this.db.generateId(),
        status: "draft",
        number: null,
        journalEntryId: null,
        contactSnapshot: null,
        issuedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      state.invoices.push(invoice);
      this.db.audit(state, { workspaceId: input.workspaceId, entityType: "invoice", entityId: invoice.id, action: "create", before: null, after: invoice });
      return strip(invoice);
    });
  }

  async deleteDraft(id: string): Promise<void> {
    this.db.write((state) => {
      const invoice = state.invoices.find((i) => i.id === id && i.deletedAt === null);
      if (!invoice) fail("INVOICE_NOT_FOUND", "Faktur tidak ditemukan");
      if (invoice.status !== "draft") fail("INVALID_INVOICE", "Hanya draft yang dapat dihapus; faktur terbit dibatalkan lewat void");
      invoice.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: invoice.workspaceId, entityType: "invoice", entityId: id, action: "delete", before: invoice, after: null });
    });
  }

  async issue(id: string, journal: JournalEntryInput, contact: ContactSnapshot, prefix: string): Promise<Invoice> {
    return this.db.write((state) => {
      const invoice = state.invoices.find((i) => i.id === id && i.deletedAt === null);
      if (!invoice) fail("INVOICE_NOT_FOUND", "Faktur tidak ditemukan");
      if (invoice.status !== "draft") fail("INVALID_INVOICE", "Faktur sudah terbit");
      if (!invoice.contactId) fail("CONTACT_NOT_FOUND", "Pilih kontak faktur");
      requireContact(state, invoice.contactId);
      if (
        journal.workspaceId !== invoice.workspaceId ||
        journal.entryDate !== invoice.invoiceDate ||
        journal.source !== JOURNAL_SOURCE[invoice.kind]
      ) {
        fail("INVALID_INVOICE", "Jurnal faktur harus bertanggal faktur dan bersumber sesuai jenis faktur");
      }
      if (!/^[A-Z0-9-]{1,12}$/.test(prefix)) fail("INVALID_PROFILE", "Prefix nomor faktur tidak valid");
      const siblings = state.invoices.filter((i) => i.workspaceId === invoice.workspaceId && i.deletedAt === null).map(strip);
      const number = formatInvoiceNumber(prefix, invoice.invoiceDate, nextInvoiceSeq(siblings, invoice.kind, invoice.invoiceDate));
      const entry = this.journals.postInState(state, { ...journal, description: journal.description.replace("(nomor otomatis)", number) });
      const before = { ...invoice };
      Object.assign(invoice, {
        status: "issued",
        number,
        journalEntryId: entry.id,
        contactSnapshot: { ...contact },
        issuedAt: this.db.now(),
        updatedAt: this.db.now(),
      });
      this.db.audit(state, { workspaceId: invoice.workspaceId, entityType: "invoice", entityId: id, action: "issue", before, after: invoice });
      return strip(invoice);
    });
  }
}
