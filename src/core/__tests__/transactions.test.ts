import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { generalLedger } from "@/core/general-ledger";
import { validateBalancedLines } from "@/core/journal-validation";
import { accountTotals, normalBalance } from "@/core/ledger";
import {
  allocateProportionally,
  computeSalesTax,
  formatTaxRate,
  parseTaxRatePercent,
} from "@/core/sales-tax";
import { listCreditTransactions } from "@/core/settlement";
import {
  buildExpense,
  buildSale,
  buildSettlement,
  buildTaxPayment,
} from "@/core/transactions";
import { buildFnbMockState } from "@/mocks/fnb/dataset";
import {
  buildRawMaterialPurchase,
  buildStockOpname,
  inventoryBookBalance,
} from "@/modules/fnb/transactions";
import { createFnbWorkspace, createTestEnv } from "./helpers";

function expectCode(fn: () => unknown, code: ValidationCode) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AccountingError);
    expect((e as AccountingError).hasCode(code)).toBe(true);
    return;
  }
  throw new Error(`Diharapkan error ${code}`);
}

async function expectAsyncCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect((error as AccountingError).hasCode(code)).toBe(true);
}

const lineTuples = (lines: { accountId: string; debit: number; credit: number }[]) =>
  lines.map((l) => [l.accountId, l.debit, l.credit]);

describe("PB1 (computeSalesTax)", () => {
  const exclusive = { rateBps: 1000, inclusive: false };
  const inclusive = { rateBps: 1000, inclusive: true };

  it("harga belum termasuk PB1: pajak ditambahkan, dibulatkan setengah ke atas", () => {
    expect(computeSalesTax(36_000_000, exclusive)).toEqual({ base: 36_000_000, tax: 3_600_000, total: 39_600_000 });
    expect(computeSalesTax(12_345, exclusive)).toEqual({ base: 12_345, tax: 1_235, total: 13_580 });
    expect(computeSalesTax(12_344, exclusive)).toEqual({ base: 12_344, tax: 1_234, total: 13_578 });
    expect(computeSalesTax(1_000, { rateBps: 1050, inclusive: false }).tax).toBe(105);
  });

  it("harga sudah termasuk PB1: dasar dihitung mundur, total tetap", () => {
    expect(computeSalesTax(39_600_000, inclusive)).toEqual({ base: 36_000_000, tax: 3_600_000, total: 39_600_000 });
    // 10.001 × 10.000 / 11.000 = 9.091,9 → 9.092
    expect(computeSalesTax(10_001, inclusive)).toEqual({ base: 9_092, tax: 909, total: 10_001 });
    expect(computeSalesTax(11, inclusive)).toEqual({ base: 10, tax: 1, total: 11 });
  });

  it("tarif 0 tanpa pajak; tarif dan nominal tidak valid ditolak", () => {
    expect(computeSalesTax(50_000, { rateBps: 0, inclusive: false }).tax).toBe(0);
    expectCode(() => computeSalesTax(1000, { rateBps: 10_001, inclusive: false }), "INVALID_AMOUNT");
    expectCode(() => computeSalesTax(1000, { rateBps: 5.5, inclusive: false }), "INVALID_AMOUNT");
    expectCode(() => computeSalesTax(10.5, exclusive), "INVALID_AMOUNT");
    expectCode(() => computeSalesTax(Number.MAX_SAFE_INTEGER, exclusive), "AMOUNT_OVERFLOW");
  });

  it("format & parsing tarif persen tanpa float", () => {
    expect(formatTaxRate(1000)).toBe("10%");
    expect(formatTaxRate(1050)).toBe("10,5%");
    expect(parseTaxRatePercent("10")).toBe(1000);
    expect(parseTaxRatePercent("10,5")).toBe(1050);
    expect(parseTaxRatePercent("0.25")).toBe(25);
    expect(parseTaxRatePercent(" 11 % ")).toBe(1100);
    expect(parseTaxRatePercent("100")).toBe(10_000);
    expect(parseTaxRatePercent("100,01")).toBeNull();
    expect(parseTaxRatePercent("10,555")).toBeNull();
    expect(parseTaxRatePercent("-5")).toBeNull();
    expect(parseTaxRatePercent("")).toBeNull();
  });

  it("alokasi proporsional selalu berjumlah tepat", () => {
    expect(allocateProportionally(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateProportionally(10_000, [66_000, 44_000])).toEqual([6_000, 4_000]);
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(7, [0, 0])).toEqual([0, 0]);
    const shares = allocateProportionally(909, [7_001, 3_000, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(909);
  });
});

describe("pembentuk jurnal transaksi (diposting lewat JournalService)", () => {
  let env: ReturnType<typeof createTestEnv>;
  let ws: Awaited<ReturnType<typeof createFnbWorkspace>>;
  let id: (code: string) => string;
  const base = { entryDate: "2026-03-10", description: "Test" };

  beforeEach(async () => {
    env = createTestEnv();
    ws = await createFnbWorkspace(env);
    id = (code) => ws.byCode(code).id;
  });

  const post = (entry: Parameters<typeof env.journalService.postJournal>[0]) =>
    env.journalService.postJournal(entry);

  it("penjualan tunai dengan PB1 (harga belum termasuk)", async () => {
    const sale = buildSale(
      {
        ...base,
        workspaceId: ws.workspace.id,
        payment: { kind: "cash", accountId: id("1-1100") },
        items: [
          { accountId: id("4-1000"), amount: 100_000 },
          { accountId: id("4-2000"), amount: 50_000 },
        ],
        applyTax: true,
        tax: { rateBps: 1000, inclusive: false },
      },
      ws.accounts,
    );
    expect(sale).toMatchObject({ base: 150_000, tax: 15_000, total: 165_000 });
    expect(lineTuples(sale.entry.lines)).toEqual([
      [id("1-1100"), 165_000, 0],
      [id("4-1000"), 0, 100_000],
      [id("4-2000"), 0, 50_000],
      [id("2-1200"), 0, 15_000],
    ]);
    const posted = await post(sale.entry);
    expect(posted).toMatchObject({ source: "revenue", counterparty: null });
  });

  it("penjualan kredit, harga termasuk PB1: pajak dibagi proporsional ke rincian", async () => {
    const sale = buildSale(
      {
        ...base,
        workspaceId: ws.workspace.id,
        payment: { kind: "credit", counterparty: "  PT Maju  " },
        items: [
          { accountId: id("4-1000"), amount: 66_000 },
          { accountId: id("4-2000"), amount: 44_000 },
        ],
        applyTax: true,
        tax: { rateBps: 1000, inclusive: true },
      },
      ws.accounts,
    );
    expect(lineTuples(sale.entry.lines)).toEqual([
      [id("1-1400"), 110_000, 0],
      [id("4-1000"), 0, 60_000],
      [id("4-2000"), 0, 40_000],
      [id("2-1200"), 0, 10_000],
    ]);
    expect(sale.entry.counterparty).toBe("PT Maju");
    await expect(post(sale.entry)).resolves.toMatchObject({ counterparty: "PT Maju" });
  });

  it("penjualan tanpa PB1, dan validasi input", () => {
    const input = {
      ...base,
      workspaceId: ws.workspace.id,
      payment: { kind: "cash" as const, accountId: id("1-1200") },
      items: [{ accountId: id("4-1000"), amount: 20_000 }],
      applyTax: false,
      tax: { rateBps: 1000, inclusive: false },
    };
    expect(buildSale(input, ws.accounts).entry.lines).toHaveLength(2);
    expectCode(() => buildSale({ ...input, payment: { kind: "credit", counterparty: " " } }, ws.accounts), "EMPTY_NAME");
    expectCode(() => buildSale({ ...input, items: [{ accountId: "", amount: 5 }] }, ws.accounts), "LINE_ZERO");
    expectCode(() => buildSale({ ...input, items: [] }, ws.accounts), "LINE_ZERO");
  });

  it("beban kredit, lalu pembayaran sebagian dan penolakan pembayaran berlebih", async () => {
    const expense = await post(
      buildExpense(
        {
          ...base,
          workspaceId: ws.workspace.id,
          payment: { kind: "credit", counterparty: "PLN" },
          items: [{ accountId: id("6-3000"), amount: 1_200_000 }],
        },
        ws.accounts,
      ),
    );
    expect(lineTuples(expense.lines)).toEqual([
      [id("6-3000"), 1_200_000, 0],
      [id("2-1100"), 0, 1_200_000],
    ]);

    const payment = buildSettlement(
      { target: expense, entryDate: "2026-03-20", amount: 700_000, cashAccountId: id("1-1200") },
      ws.accounts,
    );
    expect(lineTuples(payment.lines)).toEqual([
      [id("2-1100"), 700_000, 0],
      [id("1-1200"), 0, 700_000],
    ]);
    expect(payment.description).toContain("Pembayaran utang PLN");
    await post(payment);

    await expectAsyncCode(
      post(buildSettlement({ target: expense, entryDate: "2026-03-21", amount: 600_000, cashAccountId: id("1-1200") }, ws.accounts)),
      "INVALID_SETTLEMENT",
    );
    const [credit] = listCreditTransactions(
      await env.repos.journals.listByWorkspace(ws.workspace.id),
      ws.accounts,
    );
    expect(credit).toMatchObject({ kind: "payable", original: 1_200_000, paid: 700_000, outstanding: 500_000 });
  });

  it("penerimaan piutang memakai akun piutang jurnal asal", async () => {
    const sale = await post(
      buildSale(
        {
          ...base,
          workspaceId: ws.workspace.id,
          payment: { kind: "credit", counterparty: "PT Maju" },
          items: [{ accountId: id("4-1000"), amount: 500_000 }],
          applyTax: false,
          tax: { rateBps: 1000, inclusive: false },
        },
        ws.accounts,
      ).entry,
    );
    const receipt = buildSettlement(
      { target: sale, entryDate: "2026-03-25", amount: 500_000, cashAccountId: id("1-1100") },
      ws.accounts,
    );
    expect(lineTuples(receipt.lines)).toEqual([
      [id("1-1100"), 500_000, 0],
      [id("1-1400"), 0, 500_000],
    ]);
    await expect(post(receipt)).resolves.toMatchObject({ settlementOf: sale.id, counterparty: "PT Maju" });
  });

  it("pelunasan atas transaksi tunai ditolak saat membentuk jurnal", async () => {
    const cash = await post(
      buildExpense(
        { ...base, workspaceId: ws.workspace.id, payment: { kind: "cash", accountId: id("1-1100") }, items: [{ accountId: id("6-9000"), amount: 1000 }] },
        ws.accounts,
      ),
    );
    expectCode(
      () => buildSettlement({ target: cash, entryDate: "2026-03-11", amount: 1000, cashAccountId: id("1-1100") }, ws.accounts),
      "INVALID_SETTLEMENT",
    );
  });

  it("setoran PB1 mengurangi Utang PB1", async () => {
    const entry = buildTaxPayment(
      { workspaceId: ws.workspace.id, entryDate: "2026-03-10", amount: 3_600_000, cashAccountId: id("1-1200") },
      ws.accounts,
    );
    expect(lineTuples(entry.lines)).toEqual([
      [id("2-1200"), 3_600_000, 0],
      [id("1-1200"), 0, 3_600_000],
    ]);
    await expect(post(entry)).resolves.toMatchObject({ source: "tax_payment" });
    expectCode(() => buildTaxPayment({ ...entry, amount: 0, cashAccountId: id("1-1200") }, ws.accounts), "INVALID_AMOUNT");
  });

  it("F&B: pembelian bahan baku tunai/kredit dan stok opname dua arah", async () => {
    const purchase = buildRawMaterialPurchase(
      { ...base, workspaceId: ws.workspace.id, payment: { kind: "credit", counterparty: "CV Sumber" }, amount: 2_000_000 },
      ws.accounts,
    );
    expect(purchase.source).toBe("purchase");
    expect(lineTuples(purchase.lines)).toEqual([
      [id("1-1300"), 2_000_000, 0],
      [id("2-1100"), 0, 2_000_000],
    ]);
    await post(purchase);

    const entries = await env.repos.journals.listByWorkspace(ws.workspace.id);
    const book = inventoryBookBalance(entries, ws.accounts, "2026-03-31");
    expect(book).toBe(2_000_000);

    const used = buildStockOpname(
      { workspaceId: ws.workspace.id, entryDate: "2026-03-31", bookBalance: book, physicalValue: 600_000 },
      ws.accounts,
    );
    expect(used.difference).toBe(1_400_000);
    expect(lineTuples(used.entry!.lines)).toEqual([
      [id("5-1000"), 1_400_000, 0],
      [id("1-1300"), 0, 1_400_000],
    ]);
    await post(used.entry!);

    const surplus = buildStockOpname(
      { workspaceId: ws.workspace.id, entryDate: "2026-03-31", bookBalance: 600_000, physicalValue: 750_000 },
      ws.accounts,
    );
    expect(lineTuples(surplus.entry!.lines)).toEqual([
      [id("1-1300"), 150_000, 0],
      [id("5-1000"), 0, 150_000],
    ]);
    await post(surplus.entry!);

    expect(
      buildStockOpname({ workspaceId: ws.workspace.id, entryDate: "2026-03-31", bookBalance: 5, physicalValue: 5 }, ws.accounts).entry,
    ).toBeNull();
    expectCode(
      () => buildStockOpname({ workspaceId: ws.workspace.id, entryDate: "2026-03-31", bookBalance: 5, physicalValue: -1 }, ws.accounts),
      "INVALID_AMOUNT",
    );

    const totals = accountTotals(await env.repos.journals.listByWorkspace(ws.workspace.id));
    expect(normalBalance(ws.byCode("1-1300"), totals.get(id("1-1300")))).toBe(750_000);
    expect(normalBalance(ws.byCode("5-1000"), totals.get(id("5-1000")))).toBe(1_250_000);
  });

  it("semua jurnal hasil pembentuk seimbang", () => {
    const entry = buildExpense(
      {
        ...base,
        workspaceId: ws.workspace.id,
        payment: { kind: "cash", accountId: id("1-1100") },
        items: [
          { accountId: id("6-1000"), amount: 7 },
          { accountId: id("6-2000"), amount: 3 },
        ],
      },
      ws.accounts,
    );
    expect(validateBalancedLines(entry.lines)).toEqual([]);
  });
});

describe("dataset: Buku Besar, daftar kredit, persediaan (hitung manual)", () => {
  const state = buildFnbMockState();
  const account = (code: string) => state.accounts.find((a) => a.code === code)!;

  it("Buku Besar Kas Agustus 2026: saldo awal, saldo berjalan, saldo akhir", () => {
    const ledger = generalLedger(state.journals, account("1-1100"), {
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });
    // Saldo 31 Jul = 16,3 jt + 7 × (9,9 − 1,2 − 7,9) jt = 21,9 jt.
    expect(ledger.openingBalance).toBe(21_900_000);
    expect(ledger.rows.map((r) => [r.entryDate, r.debit, r.credit, r.balance])).toEqual([
      ["2026-08-20", 0, 1_200_000, 20_700_000],
      ["2026-08-28", 9_900_000, 0, 30_600_000],
      ["2026-08-28", 0, 7_900_000, 22_700_000],
    ]);
    expect(ledger).toMatchObject({ totalDebit: 9_900_000, totalCredit: 9_100_000, closingBalance: 22_700_000 });
  });

  it("Buku Besar Utang PB1 (saldo normal kredit) Agustus 2026", () => {
    const ledger = generalLedger(state.journals, account("2-1200"), {
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });
    // Dipungut Jan–Jul 7 × 3,6 jt + 0,5 jt = 25,7 jt; disetor Feb–Jul 5 × 3,6 jt + 4,1 jt = 22,1 jt.
    expect(ledger.openingBalance).toBe(3_600_000);
    expect(ledger.rows.map((r) => r.balance)).toEqual([0, 3_600_000]);
    expect(ledger.closingBalance).toBe(3_600_000);
  });

  it("Buku Besar tanpa rentang = seluruh mutasi; draft tidak ikut", () => {
    const ledger = generalLedger(state.journals, account("6-9000"));
    expect(ledger.openingBalance).toBe(0);
    expect(ledger.closingBalance).toBe(700_000);
    expect(ledger.rows.some((r) => r.description.includes("belum diposting"))).toBe(false);
  });

  it("daftar transaksi kredit dan sisa tagihannya", () => {
    const credits = listCreditTransactions(state.journals, state.accounts);
    expect(
      credits.map((c) => [c.entry.id, c.kind, c.counterparty, c.original, c.paid, c.outstanding, c.settlements.length]),
    ).toEqual([
      ["je-catering-2026-06", "receivable", "PT Maju Bersama", 5_500_000, 5_500_000, 0, 2],
      ["je-supplier-2026-07", "payable", "CV Sumber Pangan", 1_500_000, 1_500_000, 0, 1],
      ["je-supplier-2026-08", "payable", "CV Sumber Pangan", 2_000_000, 0, 2_000_000, 0],
    ]);
  });

  it("stok opname Agustus 2026 dari saldo buku menghasilkan HPP dataset", () => {
    // Saldo buku 30 Agu = 3,5 jt + 13 jt + 2 jt = 18,5 jt; fisik 4,2 jt → HPP 14,3 jt.
    const book = inventoryBookBalance(state.journals, state.accounts, "2026-08-30");
    expect(book).toBe(18_500_000);
    const result = buildStockOpname(
      { workspaceId: "ws-kedai-senja", entryDate: "2026-08-31", bookBalance: book, physicalValue: 4_200_000 },
      state.accounts,
    );
    expect(result.difference).toBe(14_300_000);
    const opname = state.journals.find((e) => e.id === "je-opname-2026-08")!;
    expect(lineTuples(result.entry!.lines)).toEqual(lineTuples(opname.lines));
  });
});
