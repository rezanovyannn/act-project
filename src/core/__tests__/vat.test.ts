/**
 * Mode PPN lengkap (ADR 016): DPP pecahan, PPN Masukan, setoran per masa
 * (lebih bayar dikompensasikan), dan transisi mode.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { buildInventoryPurchase } from "@/core/inventory";
import { trialBalance } from "@/core/reports";
import {
  assertValidTaxSettings,
  computeSalesTax,
  effectiveTaxSettings,
  FULL_VAT_DEFAULTS,
  formatTaxSettings,
  type WorkspaceTaxSettings,
} from "@/core/sales-tax";
import { buildExpense, buildSale } from "@/core/transactions";
import type { Account } from "@/core/types";
import { buildVatSettlement, buildVatTransition, computeInputVat, proposeVatSettlement, vatBalances, workspaceTaxSettings } from "@/core/vat";
import { RETAIL_TEMPLATE } from "@/modules/retail/template";
import { createTestEnv } from "./helpers";

const FULL: WorkspaceTaxSettings = { mode: "full_vat", label: "PPN", inclusive: false, ...FULL_VAT_DEFAULTS };

function expectCodeSync(fn: () => unknown, code: ValidationCode) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AccountingError);
    expect((e as AccountingError).issues.map((i) => i.code)).toContain(code);
    return;
  }
  throw new Error(`Diharapkan error ${code}`);
}

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

describe("DPP & tarif (ADR 016)", () => {
  it("DPP 11/12 × 12% = efektif 11%, integer & dibulatkan setengah ke atas", () => {
    const settings = effectiveTaxSettings(FULL);
    expect(computeSalesTax(100_000, settings)).toEqual({ base: 100_000, tax: 11_000, total: 111_000 });
    // 12.345 × 11 × 1200 / (12 × 10.000) = 1.357,95 → 1.358
    expect(computeSalesTax(12_345, settings).tax).toBe(1_358);
    expect(computeSalesTax(111_000, { ...settings, inclusive: true })).toEqual({ base: 100_000, tax: 11_000, total: 111_000 });
    const inclusive = computeSalesTax(10_001, { ...settings, inclusive: true });
    expect(inclusive.base + inclusive.tax).toBe(10_001);
  });

  it("mode sederhana mengabaikan DPP; label & format", () => {
    const simple: WorkspaceTaxSettings = { ...FULL, mode: "simple", rateBps: 1100 };
    expect(effectiveTaxSettings(simple)).toEqual({ rateBps: 1100, inclusive: false });
    expect(computeSalesTax(100_000, effectiveTaxSettings(simple)).tax).toBe(11_000);
    expect(formatTaxSettings(FULL)).toBe("PPN 12% × DPP 11/12");
    expect(formatTaxSettings({ ...FULL, mode: "simple", label: "PB1", rateBps: 1000 })).toBe("PB1 10%");
  });

  it("validasi pengaturan", () => {
    expect(() => assertValidTaxSettings(FULL)).not.toThrow();
    expectCodeSync(() => assertValidTaxSettings({ ...FULL, label: "PB1" }), "INVALID_TAX_LABEL");
    expectCodeSync(() => assertValidTaxSettings({ ...FULL, dppNumerator: 13, dppDenominator: 12 }), "INVALID_AMOUNT");
    expectCodeSync(() => assertValidTaxSettings({ ...FULL, dppDenominator: 0 }), "INVALID_AMOUNT");
    expectCodeSync(() => assertValidTaxSettings({ ...FULL, dppNumerator: 1.5 }), "INVALID_AMOUNT");
    expectCodeSync(() => assertValidTaxSettings({ ...FULL, mode: "other" as never }), "INVALID_TAX_LABEL");
  });
});

describe("PPN lengkap pada workspace", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;
  const byRole = (role: string) => accounts.find((a) => a.systemRole === role)!;

  beforeEach(async () => {
    env = createTestEnv();
    const workspace = await env.workspaceService.createWorkspace({
      ownerId: "owner-a",
      name: "Toko PKP",
      templateType: "retail",
      booksStartDate: "2026-01-01",
    });
    workspaceId = workspace.id;
    const { workspace: updated } = await env.taxService.updateSettings(workspaceId, FULL);
    expect(workspaceTaxSettings(updated)).toEqual(FULL);
    accounts = await env.repos.accounts.listByWorkspace(workspaceId);
  });

  async function post(entry: Parameters<typeof env.journalService.postJournal>[0]) {
    return env.journalService.postJournal(entry);
  }

  it("mode PPN lengkap membuat akun PPN Masukan & beban PPN tidak dapat dikreditkan", () => {
    expect(byRole("input_vat")).toMatchObject({ code: "1-1500", name: "PPN Masukan", accountType: "asset" });
    expect(byRole("non_creditable_vat")).toMatchObject({ code: "6-8500", accountType: "expense" });
  });

  it("beban & pembelian: Dr biaya + Dr PPN Masukan, Cr total", () => {
    expect(computeInputVat(700_000, FULL)).toBe(77_000);
    const expense = buildExpense(
      {
        workspaceId,
        entryDate: "2026-03-05",
        description: "Sewa",
        payment: { kind: "cash", accountId: byCode("1-1200").id },
        items: [{ accountId: byCode("6-2000").id, amount: 1_000_000 }],
        inputVat: 110_000,
      },
      accounts,
    );
    expect(expense.lines).toEqual([
      expect.objectContaining({ accountId: byCode("6-2000").id, debit: 1_000_000 }),
      expect.objectContaining({ accountId: byRole("input_vat").id, debit: 110_000, description: "PPN Masukan" }),
      expect.objectContaining({ accountId: byCode("1-1200").id, credit: 1_110_000 }),
    ]);
    const purchase = buildInventoryPurchase(
      { workspaceId, entryDate: "2026-03-06", description: "Beli barang", payment: { kind: "credit", counterparty: "PT Pemasok" }, amount: 700_000, inputVat: 77_000 },
      accounts,
    );
    expect(purchase.lines.at(-1)).toMatchObject({ accountId: byRole("accounts_payable").id, credit: 777_000 });
    expectCodeSync(
      () =>
        buildExpense(
          { workspaceId, entryDate: "2026-03-05", description: "Sewa", payment: { kind: "cash", accountId: byCode("1-1200").id }, items: [{ accountId: byCode("6-2000").id, amount: 1 }], inputVat: -1 },
          accounts,
        ),
      "INVALID_AMOUNT",
    );
  });

  it("setoran masa: kurang bayar, lalu lebih bayar dikompensasikan", async () => {
    const kas = byCode("1-1100").id;
    const sale = (date: string, amount: number) =>
      buildSale(
        {
          workspaceId,
          entryDate: date,
          description: "Penjualan",
          payment: { kind: "cash", accountId: kas },
          items: [{ accountId: byCode("4-1000").id, amount }],
          applyTax: true,
          tax: effectiveTaxSettings(FULL),
          taxLabel: "PPN",
        },
        accounts,
      ).entry;
    const purchase = (date: string, amount: number, vat: number) =>
      buildInventoryPurchase({ workspaceId, entryDate: date, description: "Beli", payment: { kind: "cash", accountId: kas }, amount, inputVat: vat }, accounts);
    await post({ workspaceId, entryDate: "2026-03-01", description: "Modal", source: "manual", lines: [{ accountId: kas, debit: 50_000_000, credit: 0 }, { accountId: byCode("3-1000").id, debit: 0, credit: 50_000_000 }] });

    // Maret: Keluaran 11.000.000, Masukan 7.700.000 → kurang bayar 3.300.000.
    await post(sale("2026-03-10", 100_000_000 / 1));
    await post(purchase("2026-03-12", 70_000_000, 7_700_000));
    const journals = () => env.repos.journals.listByWorkspace(workspaceId);
    const march = vatBalances(await journals(), accounts, "2026-03-31");
    expect(march).toEqual({ output: 11_000_000, input: 7_700_000 });
    expect(proposeVatSettlement(march)).toEqual({ output: 11_000_000, credited: 7_700_000, payable: 3_300_000, carriedForward: 0 });
    const settlement = buildVatSettlement({ workspaceId, taxPeriod: "2026-03", entryDate: "2026-04-10", output: 11_000_000, credited: 7_700_000, cashAccountId: byCode("1-1200").id }, accounts);
    expect(settlement).toMatchObject({ source: "tax_payment", description: "Setoran PPN masa 2026-03" });
    expect(settlement.lines.map((l) => [l.debit, l.credit])).toEqual([[11_000_000, 0], [0, 7_700_000], [0, 3_300_000]]);
    await post(settlement);

    // April: Keluaran 1.100.000, Masukan 2.200.000 → lebih bayar 1.100.000 dikompensasikan (tanpa kas).
    await post(sale("2026-04-15", 10_000_000));
    await post(purchase("2026-04-16", 20_000_000, 2_200_000));
    const april = vatBalances(await journals(), accounts, "2026-04-30");
    expect(april).toEqual({ output: 1_100_000, input: 2_200_000 });
    const proposal = proposeVatSettlement(april);
    expect(proposal).toEqual({ output: 1_100_000, credited: 1_100_000, payable: 0, carriedForward: 1_100_000 });
    const compensation = buildVatSettlement({ workspaceId, taxPeriod: "2026-04", entryDate: "2026-05-10", output: proposal.output, credited: proposal.credited }, accounts);
    expect(compensation.lines).toHaveLength(2);
    await post(compensation);
    expect(vatBalances(await journals(), accounts, "2026-05-31")).toEqual({ output: 0, input: 1_100_000 });
    expect(trialBalance(accounts, await journals(), "2026-12-31").balanced).toBe(true);
  });

  it("setoran: validasi masa, tanggal, dan batas pengkreditan", () => {
    const base = { workspaceId, taxPeriod: "2026-03", entryDate: "2026-04-10", output: 1_000, credited: 400, cashAccountId: byCode("1-1100").id };
    expectCodeSync(() => buildVatSettlement({ ...base, entryDate: "2026-03-30" }, accounts), "INVALID_DATE");
    expectCodeSync(() => buildVatSettlement({ ...base, taxPeriod: "2026-13" }, accounts), "INVALID_DATE");
    expectCodeSync(() => buildVatSettlement({ ...base, credited: 1_001 }, accounts), "INVALID_AMOUNT");
    expectCodeSync(() => buildVatSettlement({ ...base, output: 0, credited: 0 }, accounts), "INVALID_AMOUNT");
    expectCodeSync(() => buildVatSettlement({ ...base, cashAccountId: undefined }, accounts), "INVALID_ACCOUNT");
  });

  it("keluar dari PPN lengkap: jurnal transisi membebankan saldo PPN Masukan", async () => {
    const kas = byCode("1-1100").id;
    await post(buildExpense({ workspaceId, entryDate: "2026-03-05", description: "Sewa", payment: { kind: "cash", accountId: kas }, items: [{ accountId: byCode("6-2000").id, amount: 1_000_000 }], inputVat: 110_000 }, accounts));
    expect(await env.taxService.inputVatBalance(workspaceId, "2026-03-31")).toBe(110_000);
    expect(buildVatTransition({ workspaceId, entryDate: "2026-03-31", inputVatBalance: 0 }, accounts)).toBeNull();

    const simple: WorkspaceTaxSettings = { ...FULL, mode: "simple", rateBps: 0 };
    const result = await env.taxService.updateSettings(workspaceId, simple, { kind: "expense_input_vat", entryDate: "2026-03-31" });
    expect(result.workspace.salesTaxMode).toBe("simple");
    expect(result.transitionEntry).toMatchObject({ source: "adjustment", status: "posted", entryDate: "2026-03-31" });
    expect(result.transitionEntry!.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [byRole("non_creditable_vat").id, 110_000, 0],
      [byRole("input_vat").id, 0, 110_000],
    ]);
    expect(await env.taxService.inputVatBalance(workspaceId, "2026-03-31")).toBe(0);
  });

  it("keluar dari PPN lengkap 'ke depan saja': tanpa jurnal, saldo tetap", async () => {
    const kas = byCode("1-1100").id;
    await post(buildExpense({ workspaceId, entryDate: "2026-03-05", description: "Sewa", payment: { kind: "cash", accountId: kas }, items: [{ accountId: byCode("6-2000").id, amount: 1_000_000 }], inputVat: 110_000 }, accounts));
    const before = (await env.repos.journals.listByWorkspace(workspaceId)).length;
    const result = await env.taxService.updateSettings(workspaceId, { ...FULL, mode: "simple" });
    expect(result.transitionEntry).toBeNull();
    expect((await env.repos.journals.listByWorkspace(workspaceId)).length).toBe(before);
    expect(await env.taxService.inputVatBalance(workspaceId, "2026-12-31")).toBe(110_000);
  });

  it("jurnal transisi di periode terkunci ditolak dan pengaturan tidak berubah", async () => {
    const kas = byCode("1-1100").id;
    await post(buildExpense({ workspaceId, entryDate: "2026-03-05", description: "Sewa", payment: { kind: "cash", accountId: kas }, items: [{ accountId: byCode("6-2000").id, amount: 1_000_000 }], inputVat: 110_000 }, accounts));
    const march = (await env.repos.periods.listByWorkspace(workspaceId)).find((p) => p.startDate === "2026-03-01")!;
    await env.periodService.closePeriod(workspaceId, march.id);
    await expectCode(env.taxService.updateSettings(workspaceId, { ...FULL, mode: "simple" }, { kind: "expense_input_vat", entryDate: "2026-03-31" }), "PERIOD_CLOSED");
    expect((await env.repos.workspaces.getById(workspaceId))!.salesTaxMode).toBe("full_vat");
  });

  it("kode akun PPN yang sudah dipakai: akun baru memakai kode lain", async () => {
    const other = createTestEnv();
    const ws = await other.repos.workspaces.createWithSeed(
      { ownerId: "owner-a", name: "Toko Lama", templateType: "retail", booksStartDate: "2026-01-01", salesTax: RETAIL_TEMPLATE.salesTaxDefaults },
      [...RETAIL_TEMPLATE.accounts, { ...RETAIL_TEMPLATE.accounts[0], code: "1-1500", name: "Kas Kecil", isCash: true }],
      [],
    );
    const created = await other.taxService.ensureVatAccounts(ws.id);
    expect(created.find((a) => a.systemRole === "input_vat")?.code).toBe("1-1500-1");
    expect((await other.taxService.ensureVatAccounts(ws.id)).filter((a) => a.systemRole === "input_vat")).toHaveLength(1);
  });
});
