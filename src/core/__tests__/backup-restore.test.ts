/**
 * Pulihkan backup ke workspace baru (ADR 023): isi identik (nomor jurnal,
 * saldo per akun, periode terkunci, faktur, stok opname, menu, variance),
 * backup rusak ditolak tanpa menulis apa pun.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildBackup, type WorkspaceBackup } from "@/core/backup";
import { parseBackup, restoredName } from "@/core/backup-restore";
import { AccountingError } from "@/core/errors";
import { listCreditTransactions } from "@/core/settlement";
import { buildSettlement } from "@/core/transactions";
import type { Account, JournalEntry } from "@/core/types";
import { createFnbWorkspace, createTestEnv } from "./helpers";

describe("pulihkan backup", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;

  async function backupOf(id: string): Promise<WorkspaceBackup> {
    const r = env.repos;
    const [workspace, accs, periods, journals, items, auditLogs, stockCounts, menus, recipes, portionSummaries, menuSales, profile, contacts, invoices] =
      await Promise.all([
        r.workspaces.getById(id),
        r.accounts.listByWorkspace(id),
        r.periods.listByWorkspace(id),
        r.journals.listByWorkspace(id),
        r.items.listByWorkspace(id),
        r.auditLogs.listByWorkspace(id),
        r.stockCounts.listByWorkspace(id),
        r.menus.listMenus(id),
        r.menus.listRecipes(id),
        r.menus.listPortionSummaries(id),
        r.menus.listMenuSales(id),
        r.invoices.getProfile(id),
        r.invoices.listContacts(id),
        r.invoices.listInvoices(id),
      ]);
    // Lewat JSON seperti file unduhan.
    return JSON.parse(
      JSON.stringify(
        buildBackup(
          { workspace: workspace!, accounts: accs, periods, journals, items, auditLogs, stockCounts, menus, recipes, portionSummaries, menuSales, profile, contacts, invoices },
          "2026-10-05T08:00:00.000Z",
        ),
      ),
    );
  }

  /** Saldo per kode akun & daftar nomor jurnal: sidik jari isi pembukuan. */
  async function fingerprint(id: string) {
    const accs = await env.repos.accounts.listByWorkspace(id);
    const code = new Map(accs.map((a) => [a.id, a.code]));
    const journals = await env.repos.journals.listByWorkspace(id);
    const balances: Record<string, number> = {};
    for (const j of journals.filter((x) => x.status === "posted")) {
      for (const l of j.lines) balances[code.get(l.accountId)!] = (balances[code.get(l.accountId)!] ?? 0) + l.debit - l.credit;
    }
    const credits = listCreditTransactions(journals, accs).map((c) => [c.entry.entryNumber, c.paid, c.outstanding]);
    const reversed = journals.filter((j) => j.reversalOf).map((j) => [j.entryNumber, journals.find((o) => o.id === j.reversalOf)?.entryNumber]);
    const periods = (await env.repos.periods.listByWorkspace(id)).map((p) => [p.startDate, p.status]);
    return { balances, numbers: journals.map((j: JournalEntry) => j.entryNumber).sort(), credits, reversed, periods };
  }

  beforeEach(async () => {
    env = createTestEnv();
    const ws = await createFnbWorkspace(env);
    workspaceId = ws.workspace.id;
    accounts = ws.accounts;
    const kas = byCode("1-1100").id;
    await env.journalService.postJournal({
      workspaceId, entryDate: "2026-01-02", description: "Modal", source: "manual",
      lines: [{ accountId: kas, debit: 10_000_000, credit: 0 }, { accountId: byCode("3-1000").id, debit: 0, credit: 10_000_000 }],
    });
    const credit = await env.journalService.postJournal({
      workspaceId, entryDate: "2026-01-05", description: "Jual kredit", source: "revenue", counterparty: "PT A",
      lines: [{ accountId: byCode("1-1400").id, debit: 550_000, credit: 0 }, { accountId: byCode("4-1000").id, debit: 0, credit: 550_000 }],
    });
    await env.journalService.postJournal(buildSettlement({ target: credit, entryDate: "2026-01-06", amount: 300_000, cashAccountId: kas }, accounts));
    const wrong = await env.journalService.postJournal({
      workspaceId, entryDate: "2026-01-07", description: "Salah", source: "manual",
      lines: [{ accountId: byCode("6-3000").id, debit: 100_000, credit: 0 }, { accountId: kas, debit: 0, credit: 100_000 }],
    });
    await env.journalService.voidJournal(wrong.id, "2026-01-08");
    await env.journalService.saveDraft({
      workspaceId, entryDate: "2026-01-09", description: "Draft", source: "manual",
      lines: [{ accountId: byCode("6-2000").id, debit: 1_000, credit: 0 }, { accountId: "", debit: 0, credit: 0 }],
    });
    const ayam = await env.itemService.createItem(workspaceId, { code: "P-01", name: "Ayam", unit: "gram", revenueAccountId: null, category: "Protein" });
    await env.journalService.postJournal({
      workspaceId, entryDate: "2026-01-10", description: "Beli ayam", source: "purchase",
      lines: [{ accountId: byCode("1-1300").id, debit: 500_000, credit: 0, itemId: ayam.id, quantity: 10_000 }, { accountId: kas, debit: 0, credit: 500_000 }],
    });
    const menu = await env.menuService.createMenu(workspaceId, { code: "M-01", name: "Nasi Ayam", category: "Makanan", price: 25_000, revenueAccountId: byCode("4-1000").id });
    await env.menuService.saveRecipe({ workspaceId, menuId: menu.id, effectiveFrom: "2026-01-01", yieldPortions: 1, lines: [{ itemId: ayam.id, quantity: 100 }] });
    await env.menuService.postSale({
      workspaceId, entryDate: "2026-01-20", description: "Penjualan menu", payment: { kind: "cash", accountId: kas },
      lines: [{ menuId: menu.id, portions: 40, amount: 1_000_000 }], applyTax: false, tax: { rateBps: 1000, inclusive: false },
    });
    await env.stockCountService.post(workspaceId, "2026-01-31", new Map([[ayam.id, 5_000]]));
    const contact = await env.invoiceService.createContact(workspaceId, {
      name: "PT Faktur", isCustomer: true, isSupplier: false, address: "Jl. A", phone: null, email: null, npwp: null, paymentTermDays: 30, notes: null,
    });
    await env.invoiceService.saveProfile(workspaceId, {
      displayName: "Kedai A", address: null, phone: null, email: null, npwp: null, bankInfo: "BCA 1", invoiceNotes: null,
      invoicePrefix: "KDA", purchasePrefix: "PB", quotationPrefix: "QUO", logoDataUrl: null,
    });
    await env.invoiceService.issue({
      workspaceId, kind: "sale", contactId: contact.id, invoiceDate: "2026-01-25", dueDate: "2026-02-24", reference: null, notes: null, applyTax: true,
      lines: [{ description: "Katering", quantity: 10, unit: "box", unitPrice: 30_000, accountId: byCode("4-1000").id, itemId: null }],
    });
    const periods = await env.repos.periods.listByWorkspace(workspaceId);
    await env.periodService.closePeriod(workspaceId, periods.find((p) => p.startDate === "2026-01-01")!.id);
  });

  it("isi pulihan identik: saldo, nomor jurnal, void, pelunasan, periode, faktur, menu, stok opname, variance", async () => {
    const backup = await backupOf(workspaceId);
    const before = await fingerprint(workspaceId);
    const restored = await env.workspaceService.restoreBackup("owner-a", backup, restoredName("Kedai Test", "2026-10-05"));
    expect(restored).toMatchObject({ name: "Kedai Test (pulihan 05-10-2026)", templateType: "fnb", ownerId: "owner-a" });
    expect(restored.id).not.toBe(workspaceId);
    expect(await fingerprint(restored.id)).toEqual(before);

    const [inv] = await env.repos.invoices.listInvoices(restored.id);
    expect(inv).toMatchObject({ number: "KDA/2026/01/0001", status: "issued", contactSnapshot: { name: "PT Faktur" } });
    expect((await env.repos.journals.getById(inv.journalEntryId!))?.workspaceId).toBe(restored.id);
    expect((await env.repos.invoices.getProfile(restored.id)).bankInfo).toBe("BCA 1");
    const drafts = (await env.repos.journals.listByWorkspace(restored.id)).filter((j) => j.status === "draft");
    expect(drafts).toHaveLength(1);

    const [count] = await env.repos.stockCounts.listByWorkspace(restored.id);
    const original = await env.menuService.variance(workspaceId, (await env.repos.stockCounts.listByWorkspace(workspaceId))[0].id);
    const copy = await env.menuService.variance(restored.id, count.id);
    expect(copy.totals).toEqual(original.totals);
    expect(copy.totals).toEqual({ theoretical: 200_000, actual: 250_000, variance: 50_000 });

    // Riwayat audit lama ikut + satu catatan pemulihan.
    const logs = await env.repos.auditLogs.listByWorkspace(restored.id);
    expect(logs.length).toBe(backup.auditLogs.length + 1);
    expect(logs.filter((l) => l.action === "restore").map((l) => l.reason)).toEqual(['Dipulihkan dari backup "Kedai Test" (2026-10-05T08:00:00.000Z)']);
    // Workspace asal tidak berubah.
    expect(await fingerprint(workspaceId)).toEqual(before);
  });

  it("backup rusak ditolak tanpa menulis data; backup lama tanpa bagian baru tetap bisa", async () => {
    const backup = await backupOf(workspaceId);
    const workspacesBefore = (await env.repos.workspaces.listByOwner("owner-a")).length;
    const tampered = structuredClone(backup);
    const target = tampered.journals.find((j) => j.status === "posted")!;
    target.lines[0].debit += 1;
    const expectInvalid = async (raw: unknown, text: string) => {
      const error = await env.workspaceService.restoreBackup("owner-a", raw, "X").then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AccountingError);
      expect((error as AccountingError).issues[0]).toMatchObject({ code: "INVALID_BACKUP" });
      expect((error as AccountingError).message).toContain(text);
    };
    await expectInvalid(tampered, "tidak seimbang");
    await expectInvalid({ format: "lain" }, "Bukan file backup");
    await expectInvalid({ ...backup, version: 2 }, "Versi backup");
    const orphan = structuredClone(backup);
    orphan.invoices[0].contactId = "tidak-ada";
    await expectInvalid(orphan, "kontak tidak ada");
    expect((await env.repos.workspaces.listByOwner("owner-a")).length).toBe(workspacesBefore);

    // Backup versi awal (sebelum stok opname/menu/faktur) tetap dapat dipulihkan.
    const legacy: Record<string, unknown> = { ...backup };
    for (const key of ["stockCounts", "menus", "recipes", "portionSummaries", "menuSales", "profile", "contacts", "invoices"]) delete legacy[key];
    legacy.journals = backup.journals.filter((j) => !backup.invoices.some((i) => i.journalEntryId === j.id) && !backup.menuSales.some((m) => m.journalEntryId === j.id) && !backup.stockCounts.some((c) => c.journalEntryId === j.id));
    const { summary } = parseBackup(legacy, ["fnb", "retail"]);
    expect(summary.counts).toMatchObject({ invoices: 0, menus: 0, stockCounts: 0 });
    const restored = await env.workspaceService.restoreBackup("owner-a", legacy, "Lama");
    expect((await env.repos.journals.listByWorkspace(restored.id)).length).toBe((legacy.journals as unknown[]).length);
  });

  it("ringkasan isi backup untuk ditampilkan sebelum dipulihkan", async () => {
    const { summary } = parseBackup(await backupOf(workspaceId), ["fnb", "retail"]);
    expect(summary).toMatchObject({
      workspaceName: "Kedai Test",
      templateType: "fnb",
      exportedAt: "2026-10-05T08:00:00.000Z",
      counts: { items: 1, contacts: 1, invoices: 1, menus: 1, stockCounts: 1 },
      dateRange: { from: "2026-01-02", to: "2026-01-31" },
    });
  });
});
