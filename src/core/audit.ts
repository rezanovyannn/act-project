/**
 * Penyajian jejak audit untuk UI (ROADMAP Fase 3). Snapshot `before`/`after`
 * berbentuk camelCase (mock) atau snake_case (baris DB dari trigger), jadi
 * kuncinya dinormalkan dulu ke camelCase.
 */
import { formatMonth } from "./format";
import type { AuditEntity, AuditLog } from "./types";

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  workspace: "Workspace",
  account: "Akun",
  period: "Periode",
  journal: "Jurnal",
};

const ACTION_LABELS: Record<string, string> = {
  create: "Dibuat",
  update: "Diubah",
  delete: "Dihapus",
  create_draft: "Draft dibuat",
  update_draft: "Draft diubah",
  delete_draft: "Draft dihapus",
  post: "Diposting",
  reverse: "Jurnal pembalik diposting",
  close: "Dikunci",
  reopen: "Dibuka kembali",
  update_tax_settings: "Pengaturan pajak diubah",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** "Anda" untuk pemilik sesi, "Sistem" untuk migrasi; pengguna lain disingkat. */
export function actorLabel(actorId: string | null, ownerId: string): string {
  if (actorId === null) return "Sistem";
  return actorId === ownerId ? "Anda" : `Pengguna ${actorId.slice(0, 8)}`;
}

const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Snapshot sebagai objek camelCase datar (atau `null` bila bukan objek). */
export function normalizeSnapshot(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [toCamel(k), v]));
}

/** Ringkasan objek yang diaudit, mis. "JU-2026-0001 · Penjualan harian" atau "1-1000 Kas". */
export function auditSubject(log: Pick<AuditLog, "entityType" | "entityId" | "before" | "after">): string {
  const s = normalizeSnapshot(log.after) ?? normalizeSnapshot(log.before);
  const text = (key: string) => (typeof s?.[key] === "string" && s[key] !== "" ? (s[key] as string) : null);
  switch (log.entityType) {
    case "account":
      return [text("code"), text("name")].filter(Boolean).join(" ") || log.entityId;
    case "journal":
      return [text("entryNumber") ?? "Draft", text("description")].filter(Boolean).join(" · ");
    case "period":
      return text("startDate") ? formatMonth(text("startDate")!) : log.entityId;
    case "workspace":
      return text("name") ?? log.entityId;
  }
}

const FIELD_LABELS: Record<string, string> = {
  name: "Nama",
  code: "Kode",
  isActive: "Aktif",
  isCash: "Akun kas",
  cashFlowCategory: "Kategori arus kas",
  normalBalance: "Saldo normal",
  status: "Status",
  description: "Keterangan",
  entryDate: "Tanggal",
  counterparty: "Pihak",
  salesTaxLabel: "Jenis pajak",
  systemRole: "Peran sistem",
  salesTaxRateBps: "Tarif pajak (basis poin)",
  salesTaxInclusive: "Harga termasuk pajak",
  deletedAt: "Dihapus",
};

const IGNORED_FIELDS = new Set(["updatedAt", "createdAt", "postedAt", "id", "workspaceId", "ownerId"]);

export interface AuditChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

const STATUS_LABELS: Record<string, string> = {
  open: "Terbuka",
  closed: "Dikunci",
  draft: "Draft",
  posted: "Posted",
};

function display(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "status" && typeof value === "string") return STATUS_LABELS[value] ?? value;
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  return String(value);
}

/** Perubahan nilai skalar antara `before` dan `after` (hanya bila keduanya ada). */
export function auditChanges(before: unknown, after: unknown): AuditChange[] {
  const b = normalizeSnapshot(before);
  const a = normalizeSnapshot(after);
  if (!b || !a) return [];
  const isScalar = (v: unknown) => v === null || v === undefined || typeof v !== "object";
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((key) => !IGNORED_FIELDS.has(key) && isScalar(b[key]) && isScalar(a[key]) && (b[key] ?? null) !== (a[key] ?? null))
    .map((key) => ({ field: key, label: FIELD_LABELS[key] ?? key, before: display(key, b[key]), after: display(key, a[key]) }));
}
