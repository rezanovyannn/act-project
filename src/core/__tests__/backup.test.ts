import { describe, expect, it } from "vitest";
import { backupFileName, buildBackup, journalLinesCsv, JOURNAL_CSV_HEADER, toCsv } from "@/core/backup";
import { buildFnbMockState } from "@/mocks/fnb/dataset";

/** Parser CSV sederhana (RFC 4180) untuk memverifikasi hasil. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
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
  return rows;
}

describe("backup", () => {
  const state = buildFnbMockState();

  it("CSV meng-escape koma, kutip, dan baris baru; diawali BOM", () => {
    const csv = toCsv([
      ["a", 'kutip "ganda"', "koma, di sini", "baris\nbaru", null, 1_250_000],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(parseCsv(csv)).toEqual([["a", 'kutip "ganda"', "koma, di sini", "baris\nbaru", "", "1250000"]]);
  });

  it("CSV jurnal: satu baris per baris jurnal, total debit = kredit, status void", () => {
    const rows = parseCsv(journalLinesCsv(state.accounts, state.journals));
    const [header, ...data] = rows;
    expect(header).toEqual([...JOURNAL_CSV_HEADER]);
    const lineCount = state.journals.reduce((sum, j) => sum + j.lines.length, 0);
    expect(data).toHaveLength(lineCount);

    const col = (name: (typeof JOURNAL_CSV_HEADER)[number]) => JOURNAL_CSV_HEADER.indexOf(name);
    const posted = data.filter((r) => r[col("Status")] === "Posted");
    const sum = (key: "Debit" | "Kredit") => posted.reduce((t, r) => t + Number(r[col(key)]), 0);
    expect(sum("Debit")).toBe(sum("Kredit"));

    const voided = data.find((r) => r[col("Keterangan")] === "Perbaikan kulkas (salah input)");
    expect(voided?.[col("Di-void")]).toBe("Ya");
    const reversal = data.find((r) => r[col("Keterangan")] === "Pembalik jurnal perbaikan kulkas");
    expect(reversal?.[col("Membalik Nomor")]).toBe(voided?.[col("Nomor")]);
    expect(data.some((r) => r[col("Status")] === "Draft" && r[col("Nomor")] === "")).toBe(true);
    // Nominal integer tanpa pemisah ribuan.
    expect(data.every((r) => /^\d+$/.test(r[col("Debit")]) && /^\d+$/.test(r[col("Kredit")]))).toBe(true);
  });

  it("backup JSON memuat semua data dan ringkasan jumlahnya", () => {
    const backup = buildBackup(
      { workspace: state.workspaces[0], accounts: state.accounts, periods: state.periods, journals: state.journals, items: [], auditLogs: [] },
      "2026-09-29T10:00:00.000Z",
    );
    expect(backup).toMatchObject({ format: "act-project/workspace-backup", version: 1, exportedAt: "2026-09-29T10:00:00.000Z" });
    expect(backup.summary).toEqual({
      accounts: state.accounts.length,
      periods: 24,
      journals: state.journals.length,
      journalLines: state.journals.reduce((sum, j) => sum + j.lines.length, 0),
      items: 0,
      auditLogs: 0,
    });
    expect(JSON.parse(JSON.stringify(backup))).toEqual(backup);
  });

  it("nama file aman", () => {
    expect(backupFileName("Kedai Senja", "2026-09-29", "json")).toBe("backup-kedai-senja-2026-09-29.json");
    expect(backupFileName("  Café & Resto #1 ", "2026-09-29", "csv", "jurnal")).toBe("jurnal-cafe-resto-1-2026-09-29.csv");
    expect(backupFileName("!!!", "2026-09-29", "json")).toBe("backup-workspace-2026-09-29.json");
  });
});
