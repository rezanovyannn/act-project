/**
 * Adapter Supabase untuk port di src/core/ports (ADR 003 & 013).
 * Baca: SELECT langsung (dibatasi RLS). Tulis: hanya lewat RPC.
 */
import type { PeriodRange } from "@/core/periods";
import type {
  AccountPatch,
  AuditLogFilter,
  IAccountRepository,
  IAuditLogRepository,
  IJournalRepository,
  IPeriodRepository,
  IWorkspaceRepository,
  JournalFilter,
  NewWorkspace,
} from "@/core/ports";
import type { SalesTaxSettings } from "@/core/sales-tax";
import type {
  Account,
  AccountSeed,
  AuditLog,
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
      }),
    );
    return required(await this.getById(id as string), "Workspace");
  }

  async rename(id: string, name: string): Promise<Workspace> {
    await unwrap(this.client.rpc("rename_workspace", { p_id: id, p_name: name }));
    return required(await this.getById(id), "Workspace");
  }

  async updateSalesTaxSettings(id: string, settings: SalesTaxSettings): Promise<Workspace> {
    await unwrap(
      this.client.rpc("update_workspace_tax_settings", {
        p_id: id,
        p_rate_bps: settings.rateBps,
        p_inclusive: settings.inclusive,
      }),
    );
    return required(await this.getById(id), "Workspace");
  }

  async softDelete(id: string): Promise<void> {
    await unwrap(this.client.rpc("delete_workspace", { p_id: id }));
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
    const settlements = (
      await unwrapRows(
        this.client
          .from("journal_entries")
          .select(JOURNAL_SELECT)
          .eq("settlement_of", id)
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
  return {
    workspaces: new SupabaseWorkspaceRepository(client),
    accounts: new SupabaseAccountRepository(client),
    periods: new SupabasePeriodRepository(client),
    journals: new SupabaseJournalRepository(client),
    auditLogs: new SupabaseAuditLogRepository(client),
  };
}
