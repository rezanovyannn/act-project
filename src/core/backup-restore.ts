/**
 * Validasi file backup sebelum dipulihkan ke workspace baru (ADR 023). Semua
 * pemeriksaan murni; bila ada masalah dilempar `INVALID_BACKUP` dengan daftar
 * masalah (maks. 10) sehingga tidak ada data yang ditulis.
 */
import { BACKUP_FORMAT, type WorkspaceBackup } from "./backup";
import { isValidIsoDate } from "./dates";
import { fail } from "./errors";
import type { IsoDate, TemplateType } from "./types";

export interface RestoreSummary {
  workspaceName: string;
  templateType: TemplateType;
  booksStartDate: IsoDate;
  exportedAt: string;
  counts: {
    accounts: number;
    periods: number;
    journals: number;
    postedJournals: number;
    items: number;
    contacts: number;
    invoices: number;
    menus: number;
    orders: number;
    stockCounts: number;
    auditLogs: number;
  };
  /** Tanggal jurnal posted pertama & terakhir. */
  dateRange: { from: IsoDate; to: IsoDate } | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Nama default workspace pulihan. */
export function restoredName(name: string, today: string): string {
  const [y, m, d] = today.split("-");
  return `${name} (pulihan ${d}-${m}-${y})`;
}

/**
 * Baca & validasi isi backup. Bagian yang lebih baru boleh tidak ada (dianggap
 * kosong) agar backup lama tetap bisa dipulihkan.
 */
export function parseBackup(raw: unknown, templates: readonly TemplateType[]): { backup: WorkspaceBackup; summary: RestoreSummary } {
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) fail("INVALID_BACKUP", "Bukan file backup aplikasi ini");
  if (raw.version !== 1) fail("INVALID_BACKUP", `Versi backup ${String(raw.version)} tidak dikenal`);
  const ws = raw.workspace;
  if (!isObject(ws) || typeof ws.id !== "string" || typeof ws.name !== "string") fail("INVALID_BACKUP", "Data workspace di backup rusak");
  const arr = <T>(key: string, required: boolean): T[] => {
    const value = raw[key];
    if (value === undefined && !required) return [];
    if (!Array.isArray(value)) fail("INVALID_BACKUP", `Bagian "${key}" di backup rusak`);
    return value as T[];
  };
  const backup = {
    ...(raw as unknown as WorkspaceBackup),
    accounts: arr("accounts", true),
    periods: arr("periods", true),
    journals: arr("journals", true),
    items: arr("items", false),
    auditLogs: arr("auditLogs", false),
    stockCounts: arr("stockCounts", false),
    menus: arr("menus", false),
    recipes: arr("recipes", false),
    portionSummaries: arr("portionSummaries", false),
    menuSales: arr("menuSales", false),
    contacts: arr("contacts", false),
    invoices: arr("invoices", false),
    cateringOrders: arr("cateringOrders", false),
    orderBills: arr("orderBills", false),
    profile: isObject(raw.profile) ? (raw.profile as unknown as WorkspaceBackup["profile"]) : null,
  } as WorkspaceBackup;

  const issues: string[] = [];
  const issue = (message: string) => {
    if (issues.length < 10) issues.push(message);
  };
  const workspace = backup.workspace;
  if (!templates.includes(workspace.templateType)) issue(`Jenis template "${String(workspace.templateType)}" tidak dikenal`);
  if (!isValidIsoDate(workspace.booksStartDate)) issue("Tanggal mulai pembukuan tidak valid");

  const ids = (label: string, rows: readonly { id?: unknown }[]) => {
    const set = new Set<string>();
    for (const row of rows) {
      if (typeof row?.id !== "string" || set.has(row.id)) issue(`${label}: ID kosong atau ganda`);
      else set.add(row.id);
    }
    return set;
  };
  const accounts = ids("Akun", backup.accounts);
  const items = ids("Barang", backup.items);
  const journals = ids("Jurnal", backup.journals);
  const menus = ids("Menu", backup.menus);
  const contacts = ids("Kontak", backup.contacts);
  const orders = ids("Pesanan", backup.cateringOrders);
  const invoices = ids("Faktur", backup.invoices);
  ids("Periode", backup.periods);

  for (const p of backup.periods) {
    if (!isValidIsoDate(p.startDate) || !isValidIsoDate(p.endDate) || p.startDate > p.endDate || (p.status !== "open" && p.status !== "closed")) {
      issue(`Periode ${String(p.startDate)} rusak`);
    }
  }

  const posted: string[] = [];
  for (const j of backup.journals) {
    const label = `Jurnal ${j.entryNumber ?? j.id}`;
    if (!isValidIsoDate(j.entryDate) || !Array.isArray(j.lines)) {
      issue(`${label}: tanggal/baris rusak`);
      continue;
    }
    for (const ref of [j.settlementOf, j.reversalOf, j.correctionOf, j.returnOf]) {
      if (ref && !journals.has(ref)) issue(`${label}: merujuk jurnal yang tidak ada di backup`);
    }
    for (const l of j.lines) {
      if (l.accountId && !accounts.has(l.accountId)) issue(`${label}: akun tidak ada di backup`);
      if (l.itemId && !items.has(l.itemId)) issue(`${label}: barang tidak ada di backup`);
      if (l.orderId && !orders.has(l.orderId)) issue(`${label}: pesanan tidak ada di backup`);
      if (!isCount(l.debit) || !isCount(l.credit)) issue(`${label}: nominal bukan bilangan bulat ≥ 0`);
    }
    if (j.status === "posted") {
      posted.push(j.entryDate);
      const debit = j.lines.reduce((t, l) => t + (isCount(l.debit) ? l.debit : 0), 0);
      const credit = j.lines.reduce((t, l) => t + (isCount(l.credit) ? l.credit : 0), 0);
      if (!j.entryNumber) issue(`${label}: jurnal posted tanpa nomor`);
      if (j.lines.length < 2) issue(`${label}: kurang dari 2 baris`);
      if (j.lines.some((l) => !l.accountId || (l.debit > 0) === (l.credit > 0))) issue(`${label}: tiap baris wajib berakun dan hanya debit atau kredit`);
      if (debit !== credit) issue(`${label}: tidak seimbang (debit ${debit} ≠ kredit ${credit})`);
    } else if (j.status !== "draft") {
      issue(`${label}: status tidak dikenal`);
    }
  }

  for (const c of backup.stockCounts) {
    if (c.journalEntryId && !journals.has(c.journalEntryId)) issue(`Stok opname ${c.countDate}: jurnal tidak ada di backup`);
    if (c.lines.some((l) => !items.has(l.itemId) || !isCount(l.quantity) || !isCount(l.value))) issue(`Stok opname ${c.countDate}: baris rusak`);
  }
  for (const r of backup.recipes) {
    if (!menus.has(r.menuId) || r.lines.some((l) => !items.has(l.itemId))) issue(`Resep ${r.effectiveFrom}: menu/bahan tidak ada di backup`);
  }
  for (const s of backup.portionSummaries) {
    if (s.lines.some((l) => !menus.has(l.menuId))) issue(`Rekap porsi ${s.dateFrom}: menu tidak ada di backup`);
  }
  for (const s of backup.menuSales) {
    if (!journals.has(s.journalEntryId) || s.lines.some((l) => !menus.has(l.menuId))) issue("Penjualan menu: jurnal/menu tidak ada di backup");
  }
  for (const inv of backup.invoices) {
    const label = `Faktur ${inv.number ?? "draft"}`;
    if (inv.contactId && !contacts.has(inv.contactId)) issue(`${label}: kontak tidak ada di backup`);
    if (inv.journalEntryId && !journals.has(inv.journalEntryId)) issue(`${label}: jurnal tidak ada di backup`);
    if (inv.lines.some((l) => (l.accountId && !accounts.has(l.accountId)) || (l.itemId && !items.has(l.itemId)))) issue(`${label}: akun/barang tidak ada di backup`);
  }
  for (const o of backup.cateringOrders) {
    const label = `Pesanan ${o.number}`;
    if (!contacts.has(o.contactId)) issue(`${label}: klien tidak ada di backup`);
    if (o.invoiceId && !invoices.has(o.invoiceId)) issue(`${label}: faktur tidak ada di backup`);
    if (o.lines.some((l) => l.accountId && !accounts.has(l.accountId))) issue(`${label}: akun tidak ada di backup`);
  }
  for (const b of backup.orderBills) {
    if (!orders.has(b.orderId) || !isCount(b.amount)) issue(`Invoice DP ${b.number}: pesanan tidak ada di backup atau nominal rusak`);
  }
  if (issues.length > 0) fail("INVALID_BACKUP", `Backup tidak dapat dipulihkan: ${issues.join("; ")}`);

  posted.sort();
  return {
    backup,
    summary: {
      workspaceName: workspace.name,
      templateType: workspace.templateType,
      booksStartDate: workspace.booksStartDate,
      exportedAt: backup.exportedAt,
      counts: {
        accounts: backup.accounts.length,
        periods: backup.periods.length,
        journals: backup.journals.length,
        postedJournals: posted.length,
        items: backup.items.length,
        contacts: backup.contacts.length,
        invoices: backup.invoices.length,
        menus: backup.menus.length,
        orders: backup.cateringOrders.length,
        stockCounts: backup.stockCounts.length,
        auditLogs: backup.auditLogs.length,
      },
      dateRange: posted.length ? { from: posted[0], to: posted[posted.length - 1] } : null,
    },
  };
}
