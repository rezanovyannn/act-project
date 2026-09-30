/**
 * Persediaan perpetual per barang (ADR 017). Angka harapan dihitung manual
 * di komentar tiap langkah.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { buildInventoryPurchase } from "@/core/inventory";
import {
  buildItemPurchase,
  buildItemSale,
  buildItemStockOpname,
  buildItemUsage,
} from "@/core/perpetual";
import { trialBalance } from "@/core/reports";
import { buildReturn, returnableItems } from "@/core/returns";
import { outstandingAmount } from "@/core/settlement";
import { computeStock, mulDivRound, planOutflow, stockCard, stockMovements, type StockMovement } from "@/core/stock";
import type { Account, Item } from "@/core/types";
import { createTestEnv, entry, line } from "./helpers";

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

function expectCodeSync(fn: () => unknown, code: ValidationCode) {
  let error: unknown = null;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

describe("mesin stok (unit)", () => {
  const move = (quantity: number, value: number, entryDate = "2026-03-01"): StockMovement => ({
    itemId: "A",
    entryId: `e${Math.random()}`,
    entryNumber: null,
    entryDate,
    source: "purchase",
    description: "",
    lineNo: 1,
    quantity,
    value,
  });

  it("mulDivRound setengah menjauhi nol, bertanda", () => {
    expect(mulDivRound(10, 1, 4)).toBe(3); // 2,5 → 3
    expect(mulDivRound(-10, 1, 4)).toBe(-3);
    expect(mulDivRound(220_000, 5, 20)).toBe(55_000);
    expect(mulDivRound(100, 1, 3)).toBe(33);
  });

  it("rata-rata tertimbang bergerak", () => {
    // 10 @ 10.000 + 10 @ 12.000 → rata-rata 11.000; keluar 5 = 55.000.
    const stock = computeStock([move(10, 100_000), move(10, 120_000)], []).get("A")!;
    expect(stock).toMatchObject({ qty: 20, value: 220_000, method: "average" });
    expect(planOutflow(stock, 5)).toEqual({ cost: 55_000, shortage: 0 });
    expect(planOutflow(stock, 20)).toEqual({ cost: 220_000, shortage: 0 });
  });

  it("FIFO mengonsumsi lapisan berurutan", () => {
    const history = [{ method: "fifo" as const, from: "2026-01-01" }];
    const stock = computeStock([move(10, 100_000), move(10, 120_000)], history).get("A")!;
    // 15 keluar = 10 × 10.000 + 5 × 12.000 = 160.000.
    expect(planOutflow(stock, 15).cost).toBe(160_000);
    const after = computeStock([move(10, 100_000), move(10, 120_000), move(-15, -160_000)], history).get("A")!;
    expect(after).toMatchObject({ qty: 5, value: 60_000, layers: [{ qty: 5, value: 60_000 }] });
  });

  it("peralihan rata-rata → FIFO: stok saat itu menjadi satu lapisan", () => {
    const history = [
      { method: "average" as const, from: "2026-01-01" },
      { method: "fifo" as const, from: "2026-04-01" },
    ];
    const stock = computeStock([move(10, 100_000, "2026-03-01"), move(10, 120_000, "2026-03-02"), move(10, 150_000, "2026-04-05")], history).get("A")!;
    // Lapisan 1: 20 @ rata-rata 11.000 (220.000); lapisan 2: 10 @ 15.000.
    expect(stock.layers).toEqual([{ qty: 20, value: 220_000 }, { qty: 10, value: 150_000 }]);
    expect(planOutflow(stock, 25).cost).toBe(220_000 + 75_000);
  });

  it("stok minus memakai harga pokok terakhir; tanpa harga pokok ditolak", () => {
    const stock = computeStock([move(10, 100_000)], []).get("A")!;
    // 12 keluar: 10 dari stok (100.000) + 2 × 10.000.
    expect(planOutflow(stock, 12)).toEqual({ cost: 120_000, shortage: 2 });
    expectCodeSync(() => planOutflow({ itemId: "B", qty: 0, value: 0, method: "average", layers: [], lastUnit: null }, 1), "UNKNOWN_COST");
  });
});

describe("persediaan perpetual pada workspace", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  let a: Item;
  let b: Item;
  const byCode = (code: string) => accounts.find((x) => x.code === code)!;
  const byRole = (role: string) => accounts.find((x) => x.systemRole === role)!;
  const kas = () => byCode("1-1100").id;
  const context = async (date: string) => (await env.inventoryService.snapshot(workspaceId, date)).context;
  const post = (input: Parameters<typeof env.journalService.postJournal>[0]) => env.journalService.postJournal(input);
  const journals = () => env.repos.journals.listByWorkspace(workspaceId);

  beforeEach(async () => {
    env = createTestEnv();
    const workspace = await env.workspaceService.createWorkspace({ ownerId: "owner-a", name: "Toko", templateType: "retail", booksStartDate: "2026-01-01" });
    workspaceId = workspace.id;
    accounts = await env.repos.accounts.listByWorkspace(workspaceId);
    a = await env.itemService.createItem(workspaceId, { code: "A-01", name: "Sabun", unit: "pcs", revenueAccountId: byCode("4-1000").id });
    b = await env.itemService.createItem(workspaceId, { code: "B-01", name: "Sampo", unit: "pcs", revenueAccountId: byCode("4-1000").id });
    await post(entry(workspaceId, [line(kas(), 10_000_000, 0), line(byCode("3-1000").id, 0, 10_000_000)], { entryDate: "2026-01-02" }));
    // Periodik: pembelian 120.000 tanpa rincian barang.
    await post(buildInventoryPurchase({ workspaceId, entryDate: "2026-01-10", description: "Beli", payment: { kind: "cash", accountId: kas() }, amount: 120_000 }, accounts));
  });

  async function toPerpetual() {
    // Stok awal: A 10 @ 10.000 = 100.000; B 5 @ 3.000 = 15.000; total 115.000 vs saldo 120.000 → Dr HPP 5.000.
    return env.inventoryService.changeSettings(workspaceId, {
      kind: "to_perpetual",
      entryDate: "2026-01-31",
      costMethod: "average",
      counts: [
        { itemId: a.id, quantity: 10, value: 100_000 },
        { itemId: b.id, quantity: 5, value: 15_000 },
      ],
    });
  }

  it("peralihan periodik → perpetual: stok awal per barang, selisih ke HPP, rekonsiliasi cocok", async () => {
    const { workspace, transitionEntry } = await toPerpetual();
    expect(workspace).toMatchObject({ inventoryMethod: "perpetual", costMethodHistory: [{ method: "average", from: "2026-01-31" }] });
    expect(transitionEntry!.lines.map((l) => [l.itemId ? "item" : l.accountId === byRole("inventory").id ? "inv" : "hpp", l.quantity, l.debit, l.credit])).toEqual([
      ["item", 10, 100_000, 0],
      ["item", 5, 15_000, 0],
      ["inv", null, 0, 120_000],
      ["hpp", null, 5_000, 0],
    ]);
    const snap = await env.inventoryService.snapshot(workspaceId);
    expect(snap.reconciliation).toEqual({ accountBalance: 115_000, itemizedValue: 115_000, unitemized: 0 });
    expect(snap.accounts.some((x) => x.systemRole === "sales_returns")).toBe(true);
  });

  it("pembelian, penjualan, pemakaian, stok minus & koreksi HPP, stok opname", async () => {
    await toPerpetual();
    // Beli A 10 @ 12.000 → rata-rata (100.000 + 120.000) / 20 = 11.000.
    const purchase = buildItemPurchase(
      { workspaceId, entryDate: "2026-02-01", description: "Beli sabun", payment: { kind: "cash", accountId: kas() }, lines: [{ itemId: a.id, quantity: 10, amount: 120_000 }] },
      await context("2026-02-01"),
    );
    expect(purchase.entry.lines[0]).toMatchObject({ itemId: a.id, quantity: 10, debit: 120_000 });
    await post(purchase.entry);

    // Jual A 5 @ 20.000: pendapatan 100.000; HPP 5 × 11.000 = 55.000.
    const sale = buildItemSale(
      {
        workspaceId,
        entryDate: "2026-02-05",
        description: "Jual",
        payment: { kind: "cash", accountId: kas() },
        lines: [{ itemId: a.id, quantity: 5, amount: 100_000 }],
        applyTax: false,
        tax: { rateBps: 0, inclusive: false },
      },
      await context("2026-02-05"),
    );
    expect(sale.totalCost).toBe(55_000);
    expect(sale.entry.lines).toEqual([
      expect.objectContaining({ accountId: kas(), debit: 100_000 }),
      expect.objectContaining({ accountId: byCode("4-1000").id, credit: 100_000, itemId: a.id, quantity: 5 }),
      expect.objectContaining({ accountId: byRole("cogs").id, debit: 55_000 }),
      expect.objectContaining({ accountId: byRole("inventory").id, credit: 55_000, itemId: a.id, quantity: 5 }),
    ]);
    await post(sale.entry);

    // Pemakaian B 2: 2 × 3.000 = 6.000.
    const usage = buildItemUsage({ workspaceId, entryDate: "2026-02-06", description: "Rusak", lines: [{ itemId: b.id, quantity: 2 }] }, await context("2026-02-06"));
    expect(usage.totalCost).toBe(6_000);
    await post(usage.entry);

    // Jual A 20 padahal stok 15: 165.000 + 5 × 11.000 = 220.000, stok menjadi -5 (peringatan).
    const oversell = buildItemSale(
      { workspaceId, entryDate: "2026-02-10", description: "Jual banyak", payment: { kind: "cash", accountId: kas() }, lines: [{ itemId: a.id, quantity: 20, amount: 400_000 }], applyTax: false, tax: { rateBps: 0, inclusive: false } },
      await context("2026-02-10"),
    );
    expect(oversell.totalCost).toBe(220_000);
    expect(oversell.warnings[0]).toContain("stok menjadi minus");
    await post(oversell.entry);
    expect((await context("2026-02-10")).stocks.get(a.id)).toMatchObject({ qty: -5, value: -55_000 });

    // Beli A 10 @ 13.000 menutup minus 5: harga sebenarnya 65.000 vs sementara 55.000 → koreksi HPP +10.000.
    const cover = buildItemPurchase(
      { workspaceId, entryDate: "2026-02-15", description: "Beli lagi", payment: { kind: "cash", accountId: kas() }, lines: [{ itemId: a.id, quantity: 10, amount: 130_000 }] },
      await context("2026-02-15"),
    );
    expect(cover.entry.lines.slice(-2)).toEqual([
      expect.objectContaining({ accountId: byRole("cogs").id, debit: 10_000 }),
      expect.objectContaining({ accountId: byRole("inventory").id, credit: 10_000, itemId: a.id, quantity: 0 }),
    ]);
    await post(cover.entry);
    expect((await context("2026-02-15")).stocks.get(a.id)).toMatchObject({ qty: 5, value: 65_000 });

    // Stok opname: A fisik 4 (kurang 1 @ 13.000), B fisik 4 (lebih 1 @ 3.000).
    const opname = buildItemStockOpname(
      { workspaceId, entryDate: "2026-02-28", counts: [{ itemId: a.id, physicalQty: 4 }, { itemId: b.id, physicalQty: 4 }] },
      await context("2026-02-28"),
    );
    expect(opname.rows.map((r) => [r.difference, r.value])).toEqual([[-1, -13_000], [1, 3_000]]);
    expect(opname.entry!.lines.at(-1)).toMatchObject({ accountId: byRole("cogs").id, debit: 10_000 });
    await post(opname.entry!);

    const snap = await env.inventoryService.snapshot(workspaceId);
    expect([...snap.context.stocks.values()].map((s) => [s.qty, s.value])).toEqual([[4, 52_000], [4, 12_000]]);
    expect(snap.reconciliation.unitemized).toBe(0);
    expect(snap.reconciliation.accountBalance).toBe(64_000);
    expect(trialBalance(snap.accounts, await journals(), "2026-12-31").balanced).toBe(true);
    const card = stockCard(await journals(), snap.accounts, snap.workspace.costMethodHistory, a.id);
    expect(card.map((r) => r.balanceQty)).toEqual([10, 20, 15, -5, 5, 5, 4]);
  });

  it("void penjualan mengembalikan stok; baris barang ikut dibalik", async () => {
    await toPerpetual();
    const sale = buildItemSale(
      { workspaceId, entryDate: "2026-02-05", description: "Jual", payment: { kind: "cash", accountId: kas() }, lines: [{ itemId: a.id, quantity: 3, amount: 60_000 }], applyTax: false, tax: { rateBps: 0, inclusive: false } },
      await context("2026-02-05"),
    );
    const posted = await post(sale.entry);
    expect((await context("2026-02-05")).stocks.get(a.id)?.qty).toBe(7);
    const reversal = await env.journalService.voidJournal(posted.id, "2026-02-06");
    expect(reversal.lines.find((l) => l.itemId === a.id && l.accountId === byRole("inventory").id)).toMatchObject({ debit: 30_000, quantity: 3 });
    expect((await context("2026-02-06")).stocks.get(a.id)).toMatchObject({ qty: 10, value: 100_000 });
  });

  it("retur penjualan: harga & HPP proporsional, sisa terakhir tanpa selisih, batas qty, blokir void", async () => {
    await toPerpetual();
    // Jual A 3 @ 10.000 + PPN 11% (kredit) → pendapatan 30.000, PPN 3.300, HPP 30.000.
    const sale = buildItemSale(
      { workspaceId, entryDate: "2026-02-05", description: "Jual kredit", payment: { kind: "credit", counterparty: "Bu Ani" }, lines: [{ itemId: a.id, quantity: 3, amount: 30_000 }], applyTax: true, tax: { rateBps: 1100, inclusive: false }, taxLabel: "PPN" },
      await context("2026-02-05"),
    );
    const original = await post(sale.entry);

    // Retur 1 dengan mengurangi piutang: 10.000 + PPN round(3.300 × 10.000 / 30.000) = 1.100.
    const first = buildReturn(
      { workspaceId, entryDate: "2026-02-07", target: original, activeReturns: [], lines: [{ itemId: a.id, quantity: 1 }], refund: { kind: "reduce_claim" } },
      accounts.concat(await env.repos.accounts.listByWorkspace(workspaceId)).filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i),
    );
    expect(first).toMatchObject({ source: "settlement", settlementOf: original.id, returnOf: original.id });
    const current = await env.repos.accounts.listByWorkspace(workspaceId);
    const role = (r: string) => current.find((x) => x.systemRole === r)!.id;
    expect(first.lines.map((l) => [l.accountId, l.debit, l.credit, l.quantity ?? null])).toEqual([
      [role("sales_returns"), 10_000, 0, 1],
      [role("sales_tax_payable"), 1_100, 0, null],
      [role("accounts_receivable"), 0, 11_100, null],
      [role("inventory"), 10_000, 0, 1],
      [role("cogs"), 0, 10_000, null],
    ]);
    const firstPosted = await post(first);
    expect(outstandingAmount(original, [firstPosted], new Map(current.map((x) => [x.id, x])))).toBe(33_300 - 11_100);

    // Retur 2 sisa (tunai): 20.000 + PPN sisa 2.200; HPP sisa 20.000.
    const returns = await env.repos.journals.listActiveReturnsOf(original.id);
    expect(returnableItems(original, returns, current)[0]).toMatchObject({ quantity: 3, returnedQty: 1, remainingQty: 2 });
    const second = buildReturn(
      { workspaceId, entryDate: "2026-02-08", target: original, activeReturns: returns, lines: [{ itemId: a.id, quantity: 2 }], refund: { kind: "cash", accountId: kas() } },
      current,
    );
    expect(second.source).toBe("return");
    expect(second.lines.find((l) => l.accountId === role("sales_tax_payable"))?.debit).toBe(2_200);
    await post(second);
    expect((await context("2026-02-08")).stocks.get(a.id)).toMatchObject({ qty: 10, value: 100_000 });

    // Melebihi qty asal ditolak (core & repository), void transaksi asal diblokir.
    expectCodeSync(
      () => buildReturn({ workspaceId, entryDate: "2026-02-09", target: original, activeReturns: [], lines: [{ itemId: a.id, quantity: 4 }], refund: { kind: "cash", accountId: kas() } }, current),
      "INVALID_RETURN",
    );
    await expectCode(post({ ...second, entryDate: "2026-02-09" }), "INVALID_RETURN");
    await expectCode(env.journalService.voidJournal(original.id, "2026-02-10"), "HAS_RETURNS");
  });

  it("retur pembelian kredit: kurangi utang, PPN Masukan proporsional", async () => {
    await toPerpetual();
    await env.taxService.updateSettings(workspaceId, { mode: "full_vat", label: "PPN", rateBps: 1200, inclusive: false, dppNumerator: 11, dppDenominator: 12 });
    const purchase = buildItemPurchase(
      { workspaceId, entryDate: "2026-02-01", description: "Beli kredit", payment: { kind: "credit", counterparty: "PT Pemasok" }, lines: [{ itemId: a.id, quantity: 10, amount: 120_000 }], inputVat: 13_200 },
      await context("2026-02-01"),
    );
    const original = await post(purchase.entry);
    const current = await env.repos.accounts.listByWorkspace(workspaceId);
    const role = (r: string) => current.find((x) => x.systemRole === r)!.id;
    // Retur 4 @ 12.000 = 48.000 + PPN round(13.200 × 48.000 / 120.000) = 5.280 → utang berkurang 53.280.
    const ret = buildReturn(
      { workspaceId, entryDate: "2026-02-03", target: original, activeReturns: [], lines: [{ itemId: a.id, quantity: 4 }], refund: { kind: "reduce_claim" } },
      current,
    );
    expect(ret.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [role("accounts_payable"), 53_280, 0],
      [role("inventory"), 0, 48_000],
      [role("input_vat"), 0, 5_280],
    ]);
    await post(ret);
    // Stok: 10 @ 100.000 + 10 @ 120.000 − 4 @ 12.000 → 16 unit, 172.000.
    expect((await context("2026-02-03")).stocks.get(a.id)).toMatchObject({ qty: 16, value: 172_000 });
  });

  it("validasi baris barang & master barang", async () => {
    await toPerpetual();
    const inventory = byRole("inventory").id;
    const base = { workspaceId, entryDate: "2026-02-01", description: "Uji", source: "manual" as const };
    await expectCode(post({ ...base, lines: [{ accountId: inventory, debit: 1_000, credit: 0, itemId: a.id, quantity: -1 }, { accountId: kas(), debit: 0, credit: 1_000 }] }), "INVALID_QUANTITY");
    await expectCode(post({ ...base, lines: [{ accountId: inventory, debit: 1_000, credit: 0, itemId: "x", quantity: 1 }, { accountId: kas(), debit: 0, credit: 1_000 }] }), "ITEM_NOT_FOUND");
    await expectCode(post({ ...base, lines: [{ accountId: inventory, debit: 1_000, credit: 0, quantity: 1 }, { accountId: kas(), debit: 0, credit: 1_000 }] }), "INVALID_QUANTITY");
    await env.itemService.setActive(b.id, false);
    await expectCode(post({ ...base, lines: [{ accountId: inventory, debit: 1_000, credit: 0, itemId: b.id, quantity: 1 }, { accountId: kas(), debit: 0, credit: 1_000 }] }), "ITEM_INACTIVE");

    await expectCode(env.itemService.createItem(workspaceId, { code: "A-01", name: "Duplikat", unit: "pcs", revenueAccountId: null }), "DUPLICATE_ITEM_CODE");
    await expectCode(env.itemService.createItem(workspaceId, { code: "C-01", name: "Salah akun", unit: "pcs", revenueAccountId: kas() }), "INVALID_ACCOUNT");
    await expectCode(env.itemService.deleteItem(a.id), "ITEM_IN_USE");
    const unused = await env.itemService.createItem(workspaceId, { code: "C-01", name: "Baru", unit: "gram", revenueAccountId: null });
    await env.itemService.deleteItem(unused.id);
    expect((await env.repos.items.listByWorkspace(workspaceId)).map((i) => i.code)).toEqual(["A-01", "B-01"]);
  });

  it("peralihan metode biaya & kembali ke periodik tanpa jurnal", async () => {
    await toPerpetual();
    const before = (await journals()).length;
    const { workspace } = await env.inventoryService.changeSettings(workspaceId, { kind: "cost_method", method: "fifo", from: "2026-03-01" });
    expect(workspace.costMethodHistory).toEqual([{ method: "average", from: "2026-01-31" }, { method: "fifo", from: "2026-03-01" }]);
    await expectCode(env.inventoryService.changeSettings(workspaceId, { kind: "cost_method", method: "average", from: "2026-02-01" }), "INVALID_DATE");
    const periodic = await env.inventoryService.changeSettings(workspaceId, { kind: "to_periodic" });
    expect(periodic.workspace.inventoryMethod).toBe("periodic");
    expect((await journals()).length).toBe(before);
    // Stok per barang dibekukan (tetap terbaca).
    expect(stockMovements(await journals(), await env.repos.accounts.listByWorkspace(workspaceId)).length).toBe(2);
  });
});
