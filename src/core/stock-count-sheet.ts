/**
 * Template import/export stok opname sisa bahan (ADR 020). Format tabel sama
 * untuk CSV dan Excel: Kode | Nama Bahan | Section | Satuan | Qty Sisa |
 * Harga/Satuan | Nilai Sisa. Import hanya membaca Kode & Qty Sisa; dua kolom
 * terakhir informasi (di Excel berupa rumus sehingga ikut terisi saat qty diketik).
 */
import { mulDivRound } from "./stock";
import { compareBySection, sectionOf, valueAtBasis, type CountRow, type QtyValue } from "./stock-count";
import type { Item, Menu } from "./types";

export const COUNT_SHEET_HEADER = ["Kode", "Nama Bahan", "Section", "Satuan", "Qty Sisa", "Harga/Satuan (Rp)", "Nilai Sisa (Rp)"] as const;

export interface CountSheetLine {
  cells: (string | number)[];
  /** Dasar harga (nilai ÷ qty) untuk rumus Excel; null bila belum ada harga. */
  basis: QtyValue | null;
}

/** Baris template per bahan (urut section) dari baris stok opname & qty yang sudah diisi. */
export function countSheetLines(rows: readonly Pick<CountRow, "item" | "basis">[], quantities: ReadonlyMap<string, number> = new Map()): CountSheetLine[] {
  return [...rows]
    .sort((a, b) => compareBySection(a.item, b.item))
    .map(({ item, basis }) => {
      const qty = quantities.get(item.id);
      const value = qty === undefined ? null : valueAtBasis(qty, basis);
      return {
        cells: [item.code, item.name, sectionOf(item), item.unit, qty ?? "", basis ? mulDivRound(basis.value, 1, basis.qty) : "", value ?? ""],
        basis,
      };
    });
}

/** Tabel CSV (header + baris); harga satuan dibulatkan ke rupiah. */
export function countSheetRows(rows: readonly Pick<CountRow, "item" | "basis">[], quantities: ReadonlyMap<string, number> = new Map()): (string | number)[][] {
  return [[...COUNT_SHEET_HEADER], ...countSheetLines(rows, quantities).map((l) => l.cells)];
}

/** Parser CSV RFC 4180 (koma atau titik koma, sesuai baris header). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(value);
      value = "";
    } else if (ch === "\r") continue;
    else if (ch === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += ch;
  }
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ParsedCount {
  quantities: Map<string, number>;
  /** Kode yang tidak ada di daftar barang. */
  unknownCodes: string[];
  /** Baris dengan qty tidak valid (bukan bilangan bulat ≥ 0). */
  invalid: { code: string; value: string }[];
}

/** "1.250" / "1250" / "1,250" → 1250 (pemisah ribuan diabaikan); "" → null. */
function parseQty(raw: string): number | null | "invalid" {
  const text = raw.trim().replace(/[.,\s](?=\d{3}(\D|$))/g, "");
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return "invalid";
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : "invalid";
}

/**
 * Tabel CSV/Excel → angka per entri (dicocokkan lewat kode, tanpa beda huruf
 * besar/kecil; header opsional). Kolom kode = header "kode…", kolom angka =
 * header yang lolos `isValueHeader`; tanpa header dipakai kolom 0 & `defaultCol`.
 */
function parseCodeSheet(
  table: readonly (readonly unknown[])[],
  entries: readonly { id: string; code: string }[],
  isValueHeader: (header: string) => boolean,
  defaultCol: number,
): ParsedCount {
  const byCode = new Map(entries.map((e) => [e.code.trim().toLowerCase(), e]));
  const header = table[0]?.map((c) => String(c ?? "").trim().toLowerCase()) ?? [];
  const hasHeader = header.some((h) => h.startsWith("kode"));
  const codeCol = hasHeader ? header.findIndex((h) => h.startsWith("kode")) : 0;
  const valueCol = hasHeader ? Math.max(header.findIndex(isValueHeader), 0) : defaultCol;
  const result: ParsedCount = { quantities: new Map(), unknownCodes: [], invalid: [] };
  for (const row of hasHeader ? table.slice(1) : table) {
    const code = String(row[codeCol] ?? "").trim();
    if (code === "" || code.toLowerCase() === "total") continue;
    const entry = byCode.get(code.toLowerCase());
    const raw = String(row[valueCol] ?? "");
    if (!entry) {
      result.unknownCodes.push(code);
      continue;
    }
    const qty = parseQty(raw);
    if (qty === "invalid") result.invalid.push({ code, value: raw });
    else if (qty !== null) result.quantities.set(entry.id, qty);
  }
  return result;
}

/** Tabel hasil baca CSV/Excel → qty sisa per barang. */
export function parseCountSheet(table: readonly (readonly unknown[])[], items: readonly Item[]): ParsedCount {
  return parseCodeSheet(table, items.filter((i) => i.deletedAt === null), (h) => h.startsWith("qty"), 4);
}

// ---------- Rekap porsi (ADR 021) ----------

export const PORTION_SHEET_HEADER = ["Kode Menu", "Nama Menu", "Kategori", "Porsi"] as const;

/** Template rekap porsi: menu aktif urut kategori lalu kode. */
export function portionSheetRows(menus: readonly Menu[], portions: ReadonlyMap<string, number> = new Map()): (string | number)[][] {
  const sorted = [...menus].sort((a, b) => compareBySection(a, b));
  return [[...PORTION_SHEET_HEADER], ...sorted.map((m) => [m.code, m.name, m.category ?? "", portions.get(m.id) ?? ""])];
}

/** Tabel hasil baca CSV/Excel → porsi per menu. */
export function parsePortionSheet(table: readonly (readonly unknown[])[], menus: readonly Menu[]): ParsedCount {
  return parseCodeSheet(table, menus.filter((m) => m.deletedAt === null), (h) => h.startsWith("porsi"), 3);
}
