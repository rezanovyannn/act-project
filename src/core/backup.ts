/**
 * Backup data workspace (ROADMAP Fase 3): JSON lengkap dan CSV baris jurnal.
 * Nominal tetap integer Rupiah (tanpa pemisah ribuan) agar mudah diolah ulang.
 */
import { reversedEntryIds } from "./reversal";
import type {
  Account,
  AuditLog,
  IsoTimestamp,
  Item,
  JournalEntry,
  Menu,
  MenuSale,
  Period,
  PortionSummary,
  Recipe,
  StockCount,
  Workspace,
} from "./types";

export const BACKUP_FORMAT = "act-project/workspace-backup";
export const BACKUP_VERSION = 1;

export interface WorkspaceBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: IsoTimestamp;
  workspace: Workspace;
  accounts: Account[];
  periods: Period[];
  journals: JournalEntry[];
  /** Master barang (ADR 017). */
  items: Item[];
  /** Stok opname sisa bahan (ADR 020). */
  stockCounts: StockCount[];
  /** Menu, resep, rekap porsi, penjualan menu (ADR 021). */
  menus: Menu[];
  recipes: Recipe[];
  portionSummaries: PortionSummary[];
  menuSales: MenuSale[];
  auditLogs: AuditLog[];
  summary: { accounts: number; periods: number; journals: number; journalLines: number; items: number; auditLogs: number };
}

export function buildBackup(
  parts: Pick<WorkspaceBackup, "workspace" | "accounts" | "periods" | "journals" | "items" | "auditLogs"> &
    Partial<Pick<WorkspaceBackup, "stockCounts" | "menus" | "recipes" | "portionSummaries" | "menuSales">>,
  exportedAt: IsoTimestamp,
): WorkspaceBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    stockCounts: [],
    menus: [],
    recipes: [],
    portionSummaries: [],
    menuSales: [],
    ...parts,
    summary: {
      accounts: parts.accounts.length,
      periods: parts.periods.length,
      journals: parts.journals.length,
      journalLines: parts.journals.reduce((sum, j) => sum + j.lines.length, 0),
      items: parts.items.length,
      auditLogs: parts.auditLogs.length,
    },
  };
}

/** Satu sel CSV (RFC 4180): dikutip bila mengandung koma, kutip, atau baris baru. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV dengan BOM UTF-8 (agar Excel membaca huruf non-ASCII dengan benar). */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const JOURNAL_CSV_HEADER = [
  "Tanggal",
  "Nomor",
  "Status",
  "Sumber",
  "Keterangan",
  "Pihak",
  "Baris",
  "Kode Akun",
  "Nama Akun",
  "Keterangan Baris",
  "Debit",
  "Kredit",
  "Kode Barang",
  "Qty",
  "Di-void",
  "Membalik Nomor",
] as const;

/** Satu baris CSV per baris jurnal (draft & posted yang belum dihapus). */
export function journalLinesCsv(accounts: readonly Account[], journals: readonly JournalEntry[], items: readonly Item[] = []): string {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const active = journals.filter((j) => j.deletedAt === null);
  const numbers = new Map(active.map((j) => [j.id, j.entryNumber]));
  const voided = reversedEntryIds(active);
  const rows = [...active]
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? "~").localeCompare(b.entryNumber ?? "~"))
    .flatMap((entry) =>
      entry.lines.map((line) => {
        const account = accountsById.get(line.accountId);
        return [
          entry.entryDate,
          entry.entryNumber ?? "",
          entry.status === "posted" ? "Posted" : "Draft",
          entry.source,
          entry.description,
          entry.counterparty ?? "",
          line.lineNo,
          account?.code ?? "",
          account?.name ?? "",
          line.description ?? "",
          line.debit,
          line.credit,
          line.itemId ? itemsById.get(line.itemId)?.code ?? "" : "",
          line.quantity ?? "",
          voided.has(entry.id) ? "Ya" : "Tidak",
          entry.reversalOf ? numbers.get(entry.reversalOf) ?? "" : "",
        ];
      }),
    );
  return toCsv([[...JOURNAL_CSV_HEADER], ...rows]);
}

/** Nama file aman: `backup-kedai-senja-2026-09-29.json`. */
export function backupFileName(workspaceName: string, date: string, extension: "json" | "csv", kind = "backup"): string {
  const slug = workspaceName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";
  return `${kind}-${slug}-${date}.${extension}`;
}
