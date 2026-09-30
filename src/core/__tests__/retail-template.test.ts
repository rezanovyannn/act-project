/**
 * Template kedua (Retail) dan modularitas template (ADR 015, ROADMAP Fase 4A):
 * registrasi template baru tidak mengubah engine akuntansi.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildClosingPlan, validateClosingResult } from "@/core/closing";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { buildInventoryPurchase, buildStockOpname, inventoryBookBalance } from "@/core/inventory";
import { incomeStatement } from "@/core/reports";
import { missingTemplateAccounts, validateTemplate } from "@/core/templates";
import { buildSale, buildTaxPayment } from "@/core/transactions";
import type { Account } from "@/core/types";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { RETAIL_TEMPLATE } from "@/modules/retail/template";
import { createFnbWorkspace, createTestEnv, entry, line } from "./helpers";

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

describe("template Retail", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;

  beforeEach(async () => {
    env = createTestEnv();
    const workspace = await env.workspaceService.createWorkspace({
      ownerId: "owner-a",
      name: "Toko Test",
      templateType: "retail",
      booksStartDate: "2026-01-01",
    });
    workspaceId = workspace.id;
    accounts = await env.repos.accounts.listByWorkspace(workspaceId);
  });

  it("template valid; akun tambahan & kontra Retur tersedia", () => {
    expect(validateTemplate(RETAIL_TEMPLATE)).toEqual([]);
    expect(RETAIL_TEMPLATE.accounts.find((a) => a.code === "4-1900")).toMatchObject({
      name: "Retur & Potongan Penjualan",
      accountType: "revenue",
      normalBalance: "debit",
    });
    const names = RETAIL_TEMPLATE.accounts.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["Beban Angkut Pembelian", "Beban Kemasan", "Prive", "Ikhtisar Laba Rugi"]));
  });

  it("workspace Retail: CoA sendiri, pajak PPN 0%, terisolasi dari F&B", async () => {
    const workspace = (await env.repos.workspaces.getById(workspaceId))!;
    expect(workspace).toMatchObject({ templateType: "retail", salesTaxLabel: "PPN", salesTaxRateBps: 0, salesTaxInclusive: false });
    expect(accounts).toHaveLength(RETAIL_TEMPLATE.accounts.length);
    expect(accounts.find((a) => a.systemRole === "inventory")?.name).toBe("Persediaan Barang Dagang");
    expect(accounts.find((a) => a.systemRole === "sales_tax_payable")?.name).toBe("Utang PPN");
    expect(accounts.some((a) => a.name === "Persediaan Bahan Baku" || a.name === "Utang PB1")).toBe(false);

    const fnb = await createFnbWorkspace(env);
    expect(fnb.workspace).toMatchObject({ templateType: "fnb", salesTaxLabel: "PB1", salesTaxRateBps: 1000 });
    expect(fnb.accounts.every((a) => a.workspaceId === fnb.workspace.id)).toBe(true);
    expect(env.workspaceService.templateOf("retail").inventoryNoun).toBe("barang dagang");
    expect(env.workspaceService.templateOf("fnb").inventoryNoun).toBe("bahan baku");
  });

  it("pengaturan pajak: label PB1/PPN, label lain ditolak", async () => {
    const updated = await env.workspaceService.updateSalesTaxSettings(workspaceId, { label: "PPN", rateBps: 1100, inclusive: true });
    expect(updated).toMatchObject({ salesTaxLabel: "PPN", salesTaxRateBps: 1100, salesTaxInclusive: true });
    await expectCode(
      env.workspaceService.updateSalesTaxSettings(workspaceId, { label: "VAT" as never, rateBps: 1100, inclusive: false }),
      "INVALID_TAX_LABEL",
    );
  });

  it("penjualan & setoran memakai label pajak workspace", () => {
    const sale = buildSale(
      {
        workspaceId,
        entryDate: "2026-03-10",
        description: "Penjualan",
        payment: { kind: "cash", accountId: byCode("1-1100").id },
        items: [{ accountId: byCode("4-1000").id, amount: 100_000 }],
        applyTax: true,
        tax: { rateBps: 1100, inclusive: false },
        taxLabel: "PPN",
      },
      accounts,
    );
    expect(sale.tax).toBe(11_000);
    expect(sale.entry.lines.find((l) => l.accountId === byCode("2-1200").id)).toMatchObject({ description: "PPN", credit: 11_000 });
    const payment = buildTaxPayment({ workspaceId, entryDate: "2026-04-10", amount: 11_000, cashAccountId: byCode("1-1200").id, taxLabel: "PPN" }, accounts);
    expect(payment.description).toBe("Setoran PPN");
  });

  it("persediaan periodik memakai akun Persediaan Barang Dagang", async () => {
    const purchase = buildInventoryPurchase(
      { workspaceId, entryDate: "2026-03-05", description: "Beli barang", payment: { kind: "cash", accountId: byCode("1-1100").id }, amount: 700_000 },
      accounts,
    );
    expect(purchase.lines[0]).toMatchObject({ accountId: byCode("1-1300").id, debit: 700_000 });
    await env.journalService.postJournal(entry(workspaceId, [line(byCode("1-1100").id, 1_000_000, 0), line(byCode("3-1000").id, 0, 1_000_000)], { entryDate: "2026-03-01" }));
    await env.journalService.postJournal(purchase);
    const journals = await env.repos.journals.listByWorkspace(workspaceId);
    const book = inventoryBookBalance(journals, accounts, "2026-03-31");
    expect(book).toBe(700_000);
    const opname = buildStockOpname({ workspaceId, entryDate: "2026-03-31", bookBalance: book, physicalValue: 450_000 }, accounts);
    expect(opname.entry!.lines).toEqual([
      expect.objectContaining({ accountId: byCode("5-1000").id, debit: 250_000 }),
      expect.objectContaining({ accountId: byCode("1-1300").id, credit: 250_000 }),
    ]);
  });

  it("tutup buku menolkan akun kontra Retur & Potongan Penjualan", async () => {
    const kas = byCode("1-1100").id;
    await env.journalService.postJournal(entry(workspaceId, [line(kas, 1_000_000, 0), line(byCode("4-1000").id, 0, 1_000_000)]));
    await env.journalService.postJournal(entry(workspaceId, [line(byCode("4-1900").id, 100_000, 0), line(kas, 0, 100_000)]));
    await env.journalService.postJournal(entry(workspaceId, [line(byCode("6-7000").id, 50_000, 0), line(kas, 0, 50_000)]));
    const journals = await env.repos.journals.listByWorkspace(workspaceId);

    const is = incomeStatement(accounts, journals, { fromDate: "2026-01-01", toDate: "2026-12-31" });
    expect(is.revenue.lines.map((l) => [l.code, l.amount])).toEqual([["4-1000", 1_000_000], ["4-1900", -100_000]]);
    expect(is.netIncome).toBe(850_000);

    const plan = buildClosingPlan(workspaceId, 2026, accounts, journals);
    expect(plan).toMatchObject({ revenue: 900_000, expenses: 50_000, netIncome: 850_000 });
    const closing = await env.repos.journals.closeFiscalYear(workspaceId, 2026, plan.entries);
    const after = await env.repos.journals.listByWorkspace(workspaceId);
    expect(validateClosingResult(2026, accounts, after)).toEqual([]);
    const retur = closing.flatMap((e) => e.lines).find((l) => l.accountId === byCode("4-1900").id);
    expect(retur).toMatchObject({ debit: 0, credit: 100_000 });
  });
});

describe("akun dari template (Pengaturan)", () => {
  it("menampilkan akun yang hilang/dihapus dan menambahkannya kembali beserta perannya", async () => {
    const env = createTestEnv();
    const { accounts, byCode } = await createFnbWorkspace(env);
    expect(missingTemplateAccounts(FNB_TEMPLATE, accounts)).toEqual([]);
    // Workspace lama yang belum punya akun Utang PB1 (peran sales_tax_payable).
    const workspace = await env.repos.workspaces.createWithSeed(
      { ownerId: "owner-a", name: "Kedai Lama", templateType: "fnb", booksStartDate: "2026-01-01", salesTax: FNB_TEMPLATE.salesTaxDefaults },
      FNB_TEMPLATE.accounts.filter((a) => a.code !== "2-1200"),
      [],
    );
    await expectCode(env.accountService.deleteAccount(byCode("2-1200").id), "SYSTEM_ACCOUNT");
    const expense = (await env.repos.accounts.listByWorkspace(workspace.id)).find((a) => a.code === "6-5000")!;
    await env.accountService.deleteAccount(expense.id);
    const missing = await env.accountService.missingTemplateAccounts(workspace.id, FNB_TEMPLATE);
    expect(missing.map((s) => s.code)).toEqual(["2-1200", "6-5000"]);

    const created = await env.accountService.addTemplateAccounts(workspace.id, FNB_TEMPLATE, ["2-1200", "6-5000"]);
    expect(created.map((a) => [a.code, a.systemRole])).toEqual([["2-1200", "sales_tax_payable"], ["6-5000", null]]);
    expect(await env.accountService.missingTemplateAccounts(workspace.id, FNB_TEMPLATE)).toEqual([]);
    await expectCode(env.accountService.addTemplateAccounts(workspace.id, FNB_TEMPLATE, ["1-1100"]), "INVALID_ACCOUNT");
  });

  it("kode yang sudah dipakai akun lain tidak ditawarkan; peran yang sudah dimiliki akun lain juga tidak", () => {
    const template = { ...RETAIL_TEMPLATE, accounts: RETAIL_TEMPLATE.accounts.slice(0, 3) };
    const base = { workspaceId: "w", isActive: true, createdAt: "", updatedAt: "", deletedAt: null };
    const existing: Account[] = [
      { ...template.accounts[0], ...base, id: "a" },
      { ...template.accounts[1], ...base, id: "b", code: "9-9999", name: "Bank Lain" },
      { ...template.accounts[2], ...base, id: "c", code: "1-1301", name: "Stok" },
    ];
    // Kas ada; Bank (kode 1-1200) belum ada; Persediaan: peran sudah dimiliki akun "Stok".
    expect(missingTemplateAccounts(template, existing).map((s) => s.code)).toEqual(["1-1200"]);
  });
});
