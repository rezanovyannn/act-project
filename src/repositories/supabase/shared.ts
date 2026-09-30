import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { AccountingError, type ValidationCode } from "@/core/errors";
import type {
  Account,
  AuditLog,
  JournalEntry,
  Period,
  Workspace,
} from "@/core/types";

export type Client = SupabaseClient;

/**
 * Error dari RPC (SQLSTATE P0001) membawa kode ValidationCode di `message`
 * dan pesan Indonesia di `details`; dipetakan ke AccountingError agar
 * perilakunya sama dengan mock repository.
 */
export function toError(error: Pick<PostgrestError, "code" | "message" | "details">): Error {
  if (error.code === "P0001") {
    return new AccountingError([
      { code: error.message as ValidationCode, message: error.details || error.message },
    ]);
  }
  return new Error(`Supabase: ${error.message}`);
}

export async function unwrap<T>(
  request: PromiseLike<{ data: T; error: PostgrestError | null }>,
): Promise<T> {
  const { data, error } = await request;
  if (error) throw toError(error);
  return data;
}

/** Mengambil semua baris melewati batas 1.000 baris per permintaan PostgREST. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const batch = (await unwrap(page(from, from + pageSize - 1))) ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

// ---------------------------------------------------------------- pemetaan baris

/* eslint-disable @typescript-eslint/no-explicit-any -- baris mentah dari PostgREST */
export const toWorkspace = (r: any): Workspace => ({
  id: r.id,
  ownerId: r.owner_id,
  name: r.name,
  templateType: r.template_type,
  currency: r.currency,
  booksStartDate: r.books_start_date,
  salesTaxLabel: r.sales_tax_label,
  salesTaxRateBps: r.sales_tax_rate_bps,
  salesTaxInclusive: r.sales_tax_inclusive,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export const toAccount = (r: any): Account => ({
  id: r.id,
  workspaceId: r.workspace_id,
  code: r.code,
  name: r.name,
  accountType: r.account_type,
  normalBalance: r.normal_balance,
  cashFlowCategory: r.cash_flow_category,
  isCash: r.is_cash,
  systemRole: r.system_role,
  isActive: r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export const toPeriod = (r: any): Period => ({
  id: r.id,
  workspaceId: r.workspace_id,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Nominal bigint dikirim PostgREST sebagai number; pastikan integer aman. */
const toAmount = (value: unknown): number => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error(`Nominal di luar batas integer aman: ${value}`);
  return amount;
};

export const JOURNAL_SELECT = "*, journal_lines(*)";

export const toJournal = (r: any): JournalEntry => ({
  id: r.id,
  workspaceId: r.workspace_id,
  entryNumber: r.entry_number,
  entryDate: r.entry_date,
  description: r.description,
  status: r.status,
  source: r.source,
  counterparty: r.counterparty,
  settlementOf: r.settlement_of,
  reversalOf: r.reversal_of,
  correctionOf: r.correction_of,
  postedAt: r.posted_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  lines: [...(r.journal_lines ?? [])]
    .sort((a: any, b: any) => a.line_no - b.line_no)
    .map((l: any) => ({
      id: l.id,
      // Draft boleh tanpa akun; domain memakai string kosong seperti mock.
      accountId: l.account_id ?? "",
      lineNo: l.line_no,
      description: l.description,
      debit: toAmount(l.debit),
      credit: toAmount(l.credit),
    })),
});

export const toAuditLog = (r: any): AuditLog => ({
  id: r.id,
  workspaceId: r.workspace_id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  action: r.action,
  reason: r.reason,
  before: r.before,
  after: r.after,
  actorId: r.actor_id,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Seperti `unwrap`, untuk query daftar: hasil kosong selalu `[]`. */
export async function unwrapRows<T>(
  request: PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  return (await unwrap(request)) ?? [];
}
