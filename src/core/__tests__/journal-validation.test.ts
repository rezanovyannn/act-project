import { describe, expect, it } from "vitest";
import {
  validateBalancedLines,
  validateForPosting,
  validateLineAmounts,
} from "@/core/journal-validation";
import { validateTemplate } from "@/core/templates";
import type { Account, Period } from "@/core/types";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { entry, line } from "./helpers";

const WS = "ws-1";
const TS = "2026-01-01T00:00:00.000Z";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    workspaceId: WS,
    code: id,
    name: `Akun ${id}`,
    accountType: "asset",
    normalBalance: "debit",
    cashFlowCategory: "none",
    isCash: false,
    systemRole: null,
    isActive: true,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function period(startDate: string, endDate: string, status: Period["status"]): Period {
  return { id: startDate, workspaceId: WS, startDate, endDate, status, createdAt: TS, updatedAt: TS };
}

const context = {
  accounts: [
    account("kas"),
    account("jual", { accountType: "revenue", normalBalance: "credit" }),
    account("lama", { isActive: false }),
    account("hapus", { deletedAt: TS }),
    account("lain", { workspaceId: "ws-2" }),
  ],
  periods: [
    period("2026-01-01", "2026-01-31", "closed"),
    period("2026-02-01", "2026-02-28", "open"),
  ],
};

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("validateBalancedLines", () => {
  it("menerima jurnal seimbang", () => {
    expect(validateBalancedLines([line("a", 1000, 0), line("b", 0, 1000)])).toEqual([]);
    expect(
      validateBalancedLines([line("a", 700, 0), line("b", 300, 0), line("c", 0, 1000)]),
    ).toEqual([]);
  });

  it("menolak jurnal tidak seimbang dengan pesan Rupiah", () => {
    const issues = validateBalancedLines([line("a", 1000, 0), line("b", 0, 999)]);
    expect(codes(issues)).toEqual(["UNBALANCED"]);
    expect(issues[0].message).toContain("Rp 1.000");
    expect(issues[0].message).toContain("Rp 999");
  });

  it("menolak kurang dari 2 baris", () => {
    expect(codes(validateBalancedLines([line("a", 0, 0)]))).toContain("TOO_FEW_LINES");
    expect(codes(validateBalancedLines([]))).toContain("TOO_FEW_LINES");
  });

  it("menolak baris dengan debit dan kredit sekaligus, atau keduanya nol", () => {
    const both = validateBalancedLines([line("a", 500, 500), line("b", 0, 0)]);
    expect(codes(both)).toEqual(expect.arrayContaining(["LINE_BOTH_SIDES", "LINE_ZERO"]));
    expect(both.find((i) => i.code === "LINE_ZERO")?.lineIndex).toBe(1);
  });

  it("menolak nominal pecahan, negatif, dan di luar integer aman", () => {
    expect(codes(validateBalancedLines([line("a", 100.5, 0), line("b", 0, 100.5)]))).toContain("INVALID_AMOUNT");
    expect(codes(validateBalancedLines([line("a", -100, 0), line("b", 0, -100)]))).toContain("INVALID_AMOUNT");
    expect(
      codes(validateBalancedLines([line("a", Number.MAX_SAFE_INTEGER + 2, 0), line("b", 0, 1)])),
    ).toContain("INVALID_AMOUNT");
  });

  it("menolak total yang melewati batas integer aman", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const issues = validateBalancedLines([
      line("a", max, 0),
      line("b", max, 0),
      line("c", 0, max),
      line("d", 0, max),
    ]);
    expect(codes(issues)).toEqual(["AMOUNT_OVERFLOW"]);
  });
});

describe("validateLineAmounts (draft)", () => {
  it("draft boleh belum seimbang tetapi nominal tetap harus integer", () => {
    expect(validateLineAmounts([line("a", 1000, 0)])).toEqual([]);
    expect(codes(validateLineAmounts([line("a", 0.5, 0)]))).toEqual(["INVALID_AMOUNT"]);
  });
});

describe("validateForPosting", () => {
  const good = [line("kas", 50_000, 0), line("jual", 0, 50_000)];

  it("menerima jurnal valid di periode open", () => {
    expect(validateForPosting(entry(WS, good, { entryDate: "2026-02-10" }), context)).toEqual([]);
  });

  it("menolak periode closed dan tanggal tanpa periode", () => {
    expect(codes(validateForPosting(entry(WS, good, { entryDate: "2026-01-15" }), context))).toEqual(["PERIOD_CLOSED"]);
    expect(codes(validateForPosting(entry(WS, good, { entryDate: "2026-03-01" }), context))).toEqual(["PERIOD_NOT_FOUND"]);
  });

  it("menolak tanggal tidak valid dan keterangan kosong", () => {
    const issues = validateForPosting(
      entry(WS, good, { entryDate: "2026-02-30", description: "   " }),
      context,
    );
    expect(codes(issues)).toEqual(["INVALID_DATE", "EMPTY_DESCRIPTION"]);
  });

  it("menolak akun tidak ada, terhapus, dan milik workspace lain", () => {
    const issues = validateForPosting(
      entry(WS, [line("tidak-ada", 100, 0), line("hapus", 100, 0), line("lain", 0, 200)], {
        entryDate: "2026-02-10",
      }),
      context,
    );
    expect(codes(issues)).toEqual(["ACCOUNT_NOT_FOUND", "ACCOUNT_NOT_FOUND", "ACCOUNT_OTHER_WORKSPACE"]);
  });

  it("menolak akun nonaktif, kecuali untuk jurnal pembalik", () => {
    const lines = [line("lama", 100, 0), line("kas", 0, 100)];
    expect(
      codes(validateForPosting(entry(WS, lines, { entryDate: "2026-02-10" }), context)),
    ).toEqual(["ACCOUNT_INACTIVE"]);
    expect(
      validateForPosting(
        entry(WS, lines, { entryDate: "2026-02-10", source: "reversal", reversalOf: "x" }),
        context,
      ),
    ).toEqual([]);
  });
});

describe("validateTemplate", () => {
  it("template F&B valid dan memuat akun Prive", () => {
    expect(validateTemplate(FNB_TEMPLATE)).toEqual([]);
    const prive = FNB_TEMPLATE.accounts.find((a) => a.systemRole === "drawings");
    expect(prive).toMatchObject({ name: "Prive", accountType: "equity", normalBalance: "debit" });
  });

  it("menolak kode duplikat, peran ganda, dan peran wajib yang hilang", () => {
    const [kas, bank] = FNB_TEMPLATE.accounts;
    const issues = validateTemplate({
      type: "fnb",
      label: "Rusak",
      accounts: [kas, { ...bank, code: kas.code }, { ...bank, code: "x", systemRole: "cogs" }, { ...bank, code: "y", systemRole: "cogs" }],
    });
    expect(codes(issues)).toEqual(
      expect.arrayContaining(["DUPLICATE_ACCOUNT_CODE", "INVALID_TEMPLATE"]),
    );
    expect(issues.filter((i) => i.message.includes("tidak memiliki akun dengan peran"))).toHaveLength(4);
  });
});
