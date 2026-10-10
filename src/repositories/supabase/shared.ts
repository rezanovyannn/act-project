import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { AccountingError, type ValidationCode } from "@/core/errors";
import type {
  Account,
  AuditLog,
  BusinessProfile,
  CateringOrder,
  Contact,
  Invoice,
  Item,
  StockCount,
  JournalEntry,
  Menu,
  MenuSaleLine,
  OrderBill,
  Period,
  PortionSummary,
  Recipe,
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
  salesTaxMode: r.sales_tax_mode,
  vatDppNumerator: r.vat_dpp_numerator,
  vatDppDenominator: r.vat_dpp_denominator,
  inventoryMethod: r.inventory_method,
  costMethodHistory: r.cost_method_history ?? [],
  stockValuation: r.stock_valuation ?? "average",
  cateringSettings: {
    costMode: r.catering_cost_mode ?? "detail",
    pph23Enabled: r.pph23_enabled ?? false,
    pph23RateBps: r.pph23_rate_bps ?? 200,
  },
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

export const toItem = (r: any): Item => ({
  id: r.id,
  workspaceId: r.workspace_id,
  code: r.code,
  name: r.name,
  unit: r.unit,
  revenueAccountId: r.revenue_account_id,
  category: r.category ?? null,
  isActive: r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

const byLineNo = (a: any, b: any) => a.line_no - b.line_no;

export const toProfile = (r: any): Omit<BusinessProfile, "workspaceId"> & { workspaceId: string } => ({
  workspaceId: r.workspace_id,
  displayName: r.display_name ?? null,
  address: r.address ?? null,
  phone: r.phone ?? null,
  email: r.email ?? null,
  npwp: r.npwp ?? null,
  bankInfo: r.bank_info ?? null,
  invoiceNotes: r.invoice_notes ?? null,
  invoicePrefix: r.invoice_prefix,
  purchasePrefix: r.purchase_prefix,
  quotationPrefix: r.quotation_prefix ?? "QUO",
  logoDataUrl: r.logo_data_url ?? null,
  updatedAt: r.updated_at,
});

export const toContact = (r: any): Contact => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  isCustomer: r.is_customer,
  isSupplier: r.is_supplier,
  address: r.address ?? null,
  phone: r.phone ?? null,
  email: r.email ?? null,
  npwp: r.npwp ?? null,
  paymentTermDays: r.payment_term_days,
  notes: r.notes ?? null,
  cancellationPolicy: r.cancellation_policy ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export const toInvoice = (r: any): Invoice => ({
  id: r.id,
  workspaceId: r.workspace_id,
  kind: r.kind,
  contactId: r.contact_id,
  invoiceDate: r.invoice_date,
  dueDate: r.due_date,
  reference: r.reference ?? null,
  notes: r.notes ?? null,
  applyTax: r.apply_tax,
  taxOverride: r.tax_override === null || r.tax_override === undefined ? null : toAmount(r.tax_override),
  discount: r.discount_kind ? { kind: r.discount_kind, value: toAmount(r.discount_value) } : null,
  status: r.status,
  number: r.number,
  journalEntryId: r.journal_entry_id,
  contactSnapshot: r.contact_snapshot ?? null,
  issuedAt: r.issued_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lines: [...(r.invoice_lines ?? [])].sort((a: any, b: any) => a.line_no - b.line_no).map((l: any) => ({
    description: l.description,
    quantity: toAmount(l.quantity),
    unit: l.unit ?? null,
    unitPrice: toAmount(l.unit_price),
    accountId: l.account_id ?? "",
    itemId: l.item_id ?? null,
  })),
});

export const toCateringOrder = (r: any): CateringOrder => ({
  id: r.id,
  workspaceId: r.workspace_id,
  number: r.number,
  contactId: r.contact_id,
  serviceType: r.service_type,
  eventDate: r.event_date,
  eventTime: r.event_time ?? null,
  location: r.location ?? null,
  pax: r.pax,
  quoteDate: r.quote_date,
  validUntil: r.valid_until,
  applyTax: r.apply_tax,
  discount: r.discount_kind ? { kind: r.discount_kind, value: toAmount(r.discount_value) } : null,
  notes: r.notes ?? null,
  cancellationPolicy: { kind: r.cancellation_policy.kind, forfeitBps: Number(r.cancellation_policy.forfeitBps ?? 0) },
  costEstimates: Object.fromEntries(Object.entries(r.cost_estimates ?? {}).map(([k, v]) => [k, toAmount(v)])),
  lines: (r.lines ?? []).map((l: any) => ({
    description: l.description ?? "",
    quantity: toAmount(l.quantity),
    unit: l.unit ?? null,
    unitPrice: toAmount(l.unitPrice),
    accountId: l.accountId ?? "",
    itemId: null,
  })),
  state: r.state,
  invoiceId: r.invoice_id ?? null,
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: r.cancel_reason ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toOrderBill = (r: any): OrderBill => ({
  id: r.id,
  workspaceId: r.workspace_id,
  orderId: r.order_id,
  number: r.number,
  billDate: r.bill_date,
  dueDate: r.due_date,
  amount: toAmount(r.amount),
  note: r.note ?? null,
  createdAt: r.created_at,
});

export const toMenu = (r: any): Menu => ({
  id: r.id,
  workspaceId: r.workspace_id,
  code: r.code,
  name: r.name,
  category: r.category ?? null,
  price: toAmount(r.price),
  revenueAccountId: r.revenue_account_id,
  isActive: r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export const toRecipe = (r: any): Recipe => ({
  id: r.id,
  workspaceId: r.workspace_id,
  menuId: r.menu_id,
  effectiveFrom: r.effective_from,
  yieldPortions: r.yield_portions,
  createdAt: r.created_at,
  lines: [...(r.recipe_lines ?? [])].sort(byLineNo).map((l: any) => ({ itemId: l.item_id, quantity: toAmount(l.quantity) })),
});

export const toPortionSummary = (r: any): PortionSummary => ({
  id: r.id,
  workspaceId: r.workspace_id,
  dateFrom: r.date_from,
  dateTo: r.date_to,
  note: r.note ?? null,
  createdAt: r.created_at,
  lines: [...(r.portion_summary_lines ?? [])].sort(byLineNo).map((l: any) => ({ menuId: l.menu_id, portions: toAmount(l.portions) })),
});

export const toMenuSaleLine = (l: any): MenuSaleLine & { lineNo: number } => ({
  menuId: l.menu_id,
  portions: toAmount(l.portions),
  amount: toAmount(l.amount),
  lineNo: l.line_no,
});

export const toStockCount = (r: any): StockCount => ({
  id: r.id,
  workspaceId: r.workspace_id,
  countDate: r.count_date,
  valuation: r.valuation,
  journalEntryId: r.journal_entry_id,
  createdAt: r.created_at,
  lines: (r.stock_count_lines ?? []).map((l: any) => ({ itemId: l.item_id, quantity: toAmount(l.quantity), value: toAmount(l.value) })),
});

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
  returnOf: r.return_of,
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
      itemId: l.item_id ?? null,
      quantity: l.quantity === null || l.quantity === undefined ? null : toAmount(l.quantity),
      orderId: l.order_id ?? null,
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
