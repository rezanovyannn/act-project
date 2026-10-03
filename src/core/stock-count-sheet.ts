/**
 * Template import/export stok opname sisa bahan (ADR 020). Format tabel sama
 * untuk CSV dan Excel: Kode | Nama Bahan | Section | Satuan | Qty Sisa.
 */
import { sectionOf, compareBySection } from "./stock-count";
import type { Item } from "./types";

export const COUNT_SHEET_HEADER = ["Kode", "Nama Bahan", "Section", "Satuan", "Qty Sisa"] as const;

/** Baris template (header + satu baris per bahan, urut section). */
export function countSheetRows(items: readonly Item[], quantities: ReadonlyMap<string, number> = new Map()): (string | number)[][] {
  return [
    [...COUNT_SHEET_HEADER],
    ...[...items].sort(compareBySection).map((i) => [i.code, i.name, sectionOf(i), i.unit, quantities.get(i.id) ?? ""]),
  ];
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

/** Tabel hasil baca CSV/Excel → qty per barang (dicocokkan lewat kode; header opsional). */
export function parseCountSheet(table: readonly (readonly unknown[])[], items: readonly Item[]): ParsedCount {
  const byCode = new Map(items.filter((i) => i.deletedAt === null).map((i) => [i.code.trim().toLowerCase(), i]));
  const header = table[0]?.map((c) => String(c ?? "").trim().toLowerCase()) ?? [];
  const hasHeader = header.includes("kode");
  const codeCol = hasHeader ? header.indexOf("kode") : 0;
  const qtyCol = hasHeader ? Math.max(header.findIndex((h) => h.startsWith("qty")), 0) : 4;
  const result: ParsedCount = { quantities: new Map(), unknownCodes: [], invalid: [] };
  for (const row of hasHeader ? table.slice(1) : table) {
    const code = String(row[codeCol] ?? "").trim();
    if (code === "") continue;
    const item = byCode.get(code.toLowerCase());
    const raw = String(row[qtyCol] ?? "");
    if (!item) {
      result.unknownCodes.push(code);
      continue;
    }
    const qty = parseQty(raw);
    if (qty === "invalid") result.invalid.push({ code, value: raw });
    else if (qty !== null) result.quantities.set(item.id, qty);
  }
  return result;
}
