/**
 * Contract test repository (ADR 003). Dijalankan terhadap setiap implementasi:
 * mock (Fase 1) dan proyek Supabase dev (Fase 2, ADR 013).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { buildClosingPlan } from "@/core/closing";
import { monthlyPeriodsForYear } from "@/core/periods";
import { buildReversalInput } from "@/core/reversal";
import { buildBackup, type WorkspaceBackup } from "@/core/backup";
import type {
  IAccountRepository,
  IAuditLogRepository,
  IInvoiceRepository,
  IItemRepository,
  IMenuRepository,
  IStockCountRepository,
  IJournalRepository,
  IPeriodRepository,
  IWorkspaceRepository,
} from "@/core/ports";
import type { InvoiceInput, JournalEntryInput, Workspace } from "@/core/types";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { RETAIL_TEMPLATE } from "@/modules/retail/template";
import { VAT_ACCOUNT_SEEDS } from "@/core/vat";

export interface ContractRepositories {
  workspaces: IWorkspaceRepository;
  accounts: IAccountRepository;
  periods: IPeriodRepository;
  journals: IJournalRepository;
  auditLogs: IAuditLogRepository;
  items: IItemRepository;
  stockCounts: IStockCountRepository;
  menus: IMenuRepository;
  invoices: IInvoiceRepository;
}

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).hasCode(code)).toBe(true);
}

/** Satu pengguna: repository miliknya dan id pemiliknya. */
export interface ContractActor {
  repos: ContractRepositories;
  ownerId: string;
}

/** Dua pengguna pada backend yang sama (untuk skenario kepemilikan). */
export interface ContractSetup {
  owner: ContractActor;
  other: ContractActor;
}

export function describeRepositoryContract(
  name: string,
  setup: () => Promise<ContractSetup> | ContractSetup,
) {
  describe(`kontrak repository: ${name}`, () => {
    let actors: ContractSetup;
    let repos: ContractRepositories;
    let workspace: Workspace;
    let kasId: string;
    let jualId: string;

    const sale = (amount: number, overrides: Partial<JournalEntryInput> = {}): JournalEntryInput => ({
      workspaceId: workspace.id,
      entryDate: "2026-03-10",
      description: "Penjualan",
      source: "revenue",
      lines: [
        { accountId: kasId, debit: amount, credit: 0 },
        { accountId: jualId, debit: 0, credit: amount },
      ],
      ...overrides,
    });

    beforeEach(async () => {
      actors = await setup();
      repos = actors.owner.repos;
      workspace = await repos.workspaces.createWithSeed(
        { ownerId: actors.owner.ownerId, name: "Kedai A", templateType: "fnb", booksStartDate: "2026-01-01", salesTax: FNB_TEMPLATE.salesTaxDefaults },
        FNB_TEMPLATE.accounts,
        monthlyPeriodsForYear(2026),
      );
      const accounts = await repos.accounts.listByWorkspace(workspace.id);
      kasId = accounts.find((a) => a.code === "1-1100")!.id;
      jualId = accounts.find((a) => a.code === "4-1000")!.id;
    });

    describe("workspace", () => {
      it("createWithSeed membuat workspace, akun, dan periode", async () => {
        expect(workspace).toMatchObject({
          currency: "IDR",
          templateType: "fnb",
          salesTaxLabel: "PB1",
          salesTaxRateBps: 1000,
          salesTaxInclusive: false,
          deletedAt: null,
        });
        const updated = await repos.workspaces.updateSalesTaxSettings(workspace.id, {
          mode: "full_vat",
          label: "PPN",
          rateBps: 1200,
          inclusive: true,
          dppNumerator: 11,
          dppDenominator: 12,
        });
        expect(updated).toMatchObject({
          salesTaxMode: "full_vat",
          salesTaxLabel: "PPN",
          salesTaxRateBps: 1200,
          salesTaxInclusive: true,
          vatDppNumerator: 11,
          vatDppDenominator: 12,
        });
        const full = { mode: "full_vat" as const, label: "PPN" as const, rateBps: 1200, inclusive: false, dppNumerator: 11, dppDenominator: 12 };
        await expectCode(repos.workspaces.updateSalesTaxSettings(workspace.id, { ...full, label: "PB1" }), "INVALID_TAX_LABEL");
        await expectCode(repos.workspaces.updateSalesTaxSettings(workspace.id, { ...full, dppNumerator: 13 }), "INVALID_AMOUNT");
        const inputVat = await repos.accounts.create(workspace.id, VAT_ACCOUNT_SEEDS[0]);
        expect(inputVat).toMatchObject({ code: "1-1500", systemRole: "input_vat", accountType: "asset" });
        expect(await repos.accounts.listByWorkspace(workspace.id)).toHaveLength(FNB_TEMPLATE.accounts.length + 1);
        const periods = await repos.periods.listByWorkspace(workspace.id);
        expect(periods).toHaveLength(12);
        expect(periods.every((p) => p.status === "open")).toBe(true);
      });

      it("hanya menampilkan workspace milik owner dan menyembunyikan yang dihapus", async () => {
        const { owner, other } = actors;
        const otherWorkspace = await other.repos.workspaces.createWithSeed(
          { ownerId: other.ownerId, name: "Kedai B", templateType: "fnb", booksStartDate: "2026-01-01", salesTax: FNB_TEMPLATE.salesTaxDefaults },
          FNB_TEMPLATE.accounts,
          [],
        );
        const ownIds = async () => (await repos.workspaces.listByOwner(owner.ownerId)).map((w) => w.id);
        expect(await ownIds()).toContain(workspace.id);
        expect(await ownIds()).not.toContain(otherWorkspace.id);
        await repos.workspaces.softDelete(workspace.id);
        expect(await ownIds()).not.toContain(workspace.id);
        expect(await repos.workspaces.getById(workspace.id)).toBeNull();
      });

      it("workspace Retail (ADR 015): CoA & pajak awal sendiri, akun sistem dapat ditambah ulang", async () => {
        const retail = await repos.workspaces.createWithSeed(
          { ownerId: actors.owner.ownerId, name: "Toko A", templateType: "retail", booksStartDate: "2026-01-01", salesTax: RETAIL_TEMPLATE.salesTaxDefaults },
          RETAIL_TEMPLATE.accounts,
          [],
        );
        expect(retail).toMatchObject({ templateType: "retail", salesTaxLabel: "PPN", salesTaxRateBps: 0, salesTaxInclusive: false });
        const accounts = await repos.accounts.listByWorkspace(retail.id);
        expect(accounts.map((a) => a.code).sort()).toEqual(RETAIL_TEMPLATE.accounts.map((a) => a.code).sort());
        expect(accounts.find((a) => a.systemRole === "inventory")?.name).toBe("Persediaan Barang Dagang");
        expect(accounts.find((a) => a.code === "4-1900")).toMatchObject({ accountType: "revenue", normalBalance: "debit" });

        const taxAccount = accounts.find((a) => a.systemRole === "sales_tax_payable")!;
        await expectCode(repos.accounts.softDelete(taxAccount.id), "SYSTEM_ACCOUNT");
        const packaging = accounts.find((a) => a.code === "6-7000")!;
        await repos.accounts.softDelete(packaging.id);
        const again = await repos.accounts.create(retail.id, RETAIL_TEMPLATE.accounts.find((a) => a.code === "6-7000")!);
        expect(again).toMatchObject({ name: "Beban Kemasan", systemRole: null });

        // Workspace lama tanpa akun berperan tertentu: akun template menambahkan perannya.
        const seed = RETAIL_TEMPLATE.accounts.find((a) => a.systemRole === "sales_tax_payable")!;
        const older = await repos.workspaces.createWithSeed(
          { ownerId: actors.owner.ownerId, name: "Toko Lama", templateType: "retail", booksStartDate: "2026-01-01", salesTax: RETAIL_TEMPLATE.salesTaxDefaults },
          RETAIL_TEMPLATE.accounts.filter((a) => a !== seed),
          [],
        );
        expect(await repos.accounts.create(older.id, seed)).toMatchObject({ code: "2-1200", systemRole: "sales_tax_payable" });
        await expectCode(repos.accounts.create(older.id, { ...seed, code: "2-1299" }), "SYSTEM_ACCOUNT");
      });
    });

    describe("akun", () => {
      it("menolak kode akun duplikat dalam workspace", async () => {
        await expectCode(repos.accounts.create(workspace.id, FNB_TEMPLATE.accounts[0]), "DUPLICATE_ACCOUNT_CODE");
      });

      it("akun tanpa mutasi boleh dihapus; akun ber-jurnal tidak, hanya nonaktif", async () => {
        const extra = await repos.accounts.create(workspace.id, {
          ...FNB_TEMPLATE.accounts[0],
          code: "1-1999",
          name: "Kas Kecil",
          systemRole: null,
        });
        expect(await repos.accounts.hasJournalLines(extra.id)).toBe(false);
        await repos.accounts.softDelete(extra.id);
        expect(await repos.accounts.getById(extra.id)).toBeNull();

        await repos.journals.saveDraft(sale(1000));
        expect(await repos.accounts.hasJournalLines(kasId)).toBe(true);
        await expectCode(repos.accounts.softDelete(kasId), "ACCOUNT_INACTIVE");
        const deactivated = await repos.accounts.update(kasId, { isActive: false });
        expect(deactivated.isActive).toBe(false);
      });
    });

    describe("periode", () => {
      it("perubahan status periode tercatat di audit log beserta alasan", async () => {
        const [january] = await repos.periods.listByWorkspace(workspace.id);
        await repos.periods.setStatus(january.id, "closed");
        await repos.periods.setStatus(january.id, "open", "Koreksi transaksi Januari");
        const logs = await repos.auditLogs.listByWorkspace(workspace.id, { entityType: "period", entityId: january.id });
        expect(logs.map((l) => [l.action, l.reason])).toEqual([
          ["reopen", "Koreksi transaksi Januari"],
          ["close", null],
          ["create", null],
        ]);
        expect(logs[0]).toMatchObject({ before: { status: "closed" }, after: { status: "open" } });
      });

      it("menolak periode tumpang tindih dan mengubah status", async () => {
        await expectCode(
          repos.periods.createMany(workspace.id, [{ startDate: "2026-12-15", endDate: "2027-01-14" }]),
          "INVALID_DATE",
        );
        const created = await repos.periods.createMany(workspace.id, monthlyPeriodsForYear(2027));
        expect(created).toHaveLength(12);
        const closed = await repos.periods.setStatus(created[0].id, "closed");
        expect(closed.status).toBe("closed");
      });
    });

    describe("jurnal", () => {
      it("saveDraft membuat dan mengganti draft (header + baris sekaligus)", async () => {
        const draft = await repos.journals.saveDraft(sale(1000));
        expect(draft).toMatchObject({ status: "draft", entryNumber: null });
        expect(draft.lines.map((l) => l.lineNo)).toEqual([1, 2]);

        const replaced = await repos.journals.saveDraft(sale(2500, { description: "Ubah" }), draft.id);
        expect(replaced).toMatchObject({ id: draft.id, description: "Ubah" });
        expect(replaced.lines.map((l) => l.debit + l.credit)).toEqual([2500, 2500]);

        await repos.journals.deleteDraft(draft.id);
        expect(await repos.journals.getById(draft.id)).toBeNull();
        expect(await repos.journals.listByWorkspace(workspace.id)).toEqual([]);
      });

      it("postJournal memberi nomor urut dan filter bekerja", async () => {
        const first = await repos.journals.postJournal(sale(1000));
        const draft = await repos.journals.saveDraft(sale(2000, { entryDate: "2026-03-11" }));
        const second = await repos.journals.postJournal(sale(2000, { entryDate: "2026-03-11" }), draft.id);
        expect([first.entryNumber, second.entryNumber]).toEqual(["JU-2026-0001", "JU-2026-0002"]);
        expect(second.id).toBe(draft.id);
        expect(await repos.journals.listByWorkspace(workspace.id, { status: "draft" })).toEqual([]);
        expect(
          (await repos.journals.listByWorkspace(workspace.id, { fromDate: "2026-03-11" })).map((j) => j.id),
        ).toEqual([second.id]);
      });

      it("postJournal adalah pertahanan terakhir: menolak data tidak valid tanpa penulisan parsial", async () => {
        await expectCode(
          repos.journals.postJournal({
            ...sale(1000),
            lines: [
              { accountId: kasId, debit: 1000, credit: 0 },
              { accountId: jualId, debit: 0, credit: 900 },
            ],
          }),
          "UNBALANCED",
        );
        const periods = await repos.periods.listByWorkspace(workspace.id);
        await repos.periods.setStatus(periods[2].id, "closed");
        await expectCode(repos.journals.postJournal(sale(1000)), "PERIOD_CLOSED");
        expect(await repos.journals.listByWorkspace(workspace.id)).toEqual([]);
      });

      it("jurnal posted immutable", async () => {
        const posted = await repos.journals.postJournal(sale(1000));
        await expectCode(repos.journals.saveDraft(sale(5), posted.id), "NOT_DRAFT");
        await expectCode(repos.journals.deleteDraft(posted.id), "NOT_DRAFT");
        await expectCode(repos.journals.postJournal(sale(5), posted.id), "NOT_DRAFT");
        expect(await repos.journals.getById(posted.id)).toEqual(posted);
      });

      it("pelunasan: tercatat sebagai aktif, ditolak bila berlebih, dan memblokir void transaksi asal", async () => {
        const accounts = await repos.accounts.listByWorkspace(workspace.id);
        const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
        const creditSale = await repos.journals.postJournal({
          ...sale(1000),
          counterparty: "PT Maju",
          lines: [
            { accountId: acc("1-1400"), debit: 1100, credit: 0 },
            { accountId: jualId, debit: 0, credit: 1000 },
            { accountId: acc("2-1200"), debit: 0, credit: 100 },
          ],
        });
        const receipt = (amount: number): JournalEntryInput => ({
          ...sale(amount),
          source: "settlement",
          settlementOf: creditSale.id,
          lines: [
            { accountId: kasId, debit: amount, credit: 0 },
            { accountId: acc("1-1400"), debit: 0, credit: amount },
          ],
        });
        const paid = await repos.journals.postJournal(receipt(600));
        expect(paid).toMatchObject({ settlementOf: creditSale.id, counterparty: null });
        expect((await repos.journals.listActiveSettlementsOf(creditSale.id)).map((j) => j.id)).toEqual([paid.id]);
        await expectCode(repos.journals.postJournal(receipt(501)), "INVALID_SETTLEMENT");

        const reverse = (entry: typeof paid): JournalEntryInput => ({
          ...sale(0),
          source: "reversal",
          reversalOf: entry.id,
          lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
        });
        await expectCode(repos.journals.postJournal(reverse(creditSale)), "HAS_SETTLEMENTS");
        await repos.journals.postJournal(reverse(paid));
        expect(await repos.journals.listActiveSettlementsOf(creditSale.id)).toEqual([]);
        await expect(repos.journals.postJournal(reverse(creditSale))).resolves.toMatchObject({
          reversalOf: creditSale.id,
        });
      });

      it("mutasi jurnal tercatat di audit log", async () => {
        const draft = await repos.journals.saveDraft(sale(1000));
        await repos.journals.postJournal(sale(1000), draft.id);
        const logs = await repos.auditLogs.listByWorkspace(workspace.id, { entityType: "journal" });
        expect(logs.map((l) => l.action)).toEqual(["post", "create_draft"]);
      });

      it("satu jurnal hanya bisa dibalik sekali", async () => {
        const posted = await repos.journals.postJournal(sale(1000));
        const reversalInput: JournalEntryInput = {
          ...sale(1000),
          source: "reversal",
          reversalOf: posted.id,
          lines: sale(1000).lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
        };
        const reversal = await repos.journals.postJournal(reversalInput);
        expect(await repos.journals.findReversalOf(posted.id)).toEqual(reversal);
        await expectCode(repos.journals.postJournal(reversalInput), "ALREADY_REVERSED");
      });
    });

    describe("tutup buku (ADR 014)", () => {
      async function postYear2026() {
        const accounts = await repos.accounts.listByWorkspace(workspace.id);
        const id = (code: string) => accounts.find((a) => a.code === code)!.id;
        await repos.journals.postJournal(sale(1_000));
        await repos.journals.postJournal({
          ...sale(400),
          source: "expense",
          lines: [
            { accountId: id("6-2000"), debit: 400, credit: 0 },
            { accountId: kasId, debit: 0, credit: 400 },
          ],
        });
        await repos.journals.postJournal({
          ...sale(100),
          source: "manual",
          lines: [
            { accountId: id("3-2000"), debit: 100, credit: 0 },
            { accountId: kasId, debit: 0, credit: 100 },
          ],
        });
        return buildClosingPlan(workspace.id, 2026, accounts, await repos.journals.listByWorkspace(workspace.id));
      }

      it("posting jurnal penutup, mengunci periode, dan menolak tutup buku kedua", async () => {
        const plan = await postYear2026();
        expect(plan.entries).toHaveLength(4);
        const closing = await repos.journals.closeFiscalYear(workspace.id, 2026, plan.entries);
        expect(closing.map((e) => [e.source, e.status, e.entryDate])).toEqual(Array(4).fill(["closing", "posted", "2026-12-31"]));
        expect(closing[0].entryNumber).toMatch(/^JU-2026-\d{4}$/);

        const periods = await repos.periods.listByWorkspace(workspace.id);
        expect(periods.every((p) => p.status === "closed")).toBe(true);
        const december = periods.find((p) => p.startDate === "2026-12-01")!;
        const [log] = await repos.auditLogs.listByWorkspace(workspace.id, { entityType: "period", entityId: december.id });
        expect(log).toMatchObject({ action: "close", reason: "Tutup buku 2026" });

        await expectCode(repos.journals.closeFiscalYear(workspace.id, 2026, plan.entries), "DUPLICATE_CLOSING");
      });

      it("menolak tutup buku yang tidak lengkap secara atomik", async () => {
        const plan = await postYear2026();
        await expectCode(repos.journals.closeFiscalYear(workspace.id, 2026, plan.entries.slice(0, 2)), "INVALID_CLOSING");
        const journals = await repos.journals.listByWorkspace(workspace.id);
        expect(journals.some((e) => e.source === "closing")).toBe(false);
        expect((await repos.periods.listByWorkspace(workspace.id)).every((p) => p.status === "open")).toBe(true);
      });

      it("jurnal penutup tidak bisa diposting atau dibalik lewat jalur biasa", async () => {
        const plan = await postYear2026();
        await expectCode(repos.journals.postJournal(plan.entries[0]), "INVALID_CLOSING");
        const [first] = await repos.journals.closeFiscalYear(workspace.id, 2026, plan.entries);
        const december = (await repos.periods.listByWorkspace(workspace.id)).find((p) => p.startDate === "2026-12-01")!;
        await repos.periods.setStatus(december.id, "open", "Uji pembalik jurnal penutup");
        await expectCode(
          repos.journals.postJournal({
            ...sale(0),
            entryDate: "2026-12-31",
            source: "reversal",
            reversalOf: first.id,
            lines: first.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
          }),
          "INVALID_CLOSING",
        );
      });

      it("batalkan tutup buku: butuh Desember terbuka, membalik semua jurnal penutup", async () => {
        const plan = await postYear2026();
        const closing = await repos.journals.closeFiscalYear(workspace.id, 2026, plan.entries);
        await expectCode(repos.journals.cancelFiscalYearClosing(workspace.id, 2026), "PERIOD_CLOSED");

        const december = (await repos.periods.listByWorkspace(workspace.id)).find((p) => p.startDate === "2026-12-01")!;
        await repos.periods.setStatus(december.id, "open", "Salah tutup buku");
        const reversals = await repos.journals.cancelFiscalYearClosing(workspace.id, 2026);
        expect(reversals).toHaveLength(closing.length);
        expect(reversals.every((r) => r.source === "reversal" && r.entryDate === "2026-12-31")).toBe(true);
        expect(new Set(reversals.map((r) => r.reversalOf))).toEqual(new Set(closing.map((c) => c.id)));
        await expectCode(repos.journals.cancelFiscalYearClosing(workspace.id, 2026), "CLOSING_NOT_FOUND");

        // Dapat ditutup ulang.
        const again = await repos.journals.closeFiscalYear(workspace.id, 2026, plan.entries);
        expect(again).toHaveLength(4);
      });
    });

    describe("persediaan perpetual (ADR 017)", () => {
      async function setupItems() {
        const accounts = await repos.accounts.listByWorkspace(workspace.id);
        const role = (r: string) => accounts.find((a) => a.systemRole === r)!.id;
        const item = await repos.items.create(workspace.id, { code: "BRG-1", name: "Kopi bubuk", unit: "gram", revenueAccountId: jualId });
        const purchase = await repos.journals.postJournal({
          workspaceId: workspace.id,
          entryDate: "2026-03-01",
          description: "Beli kopi",
          source: "purchase",
          lines: [
            { accountId: role("inventory"), debit: 50_000, credit: 0, itemId: item.id, quantity: 1_000 },
            { accountId: kasId, debit: 0, credit: 50_000 },
          ],
        });
        const saleEntry = await repos.journals.postJournal({
          workspaceId: workspace.id,
          entryDate: "2026-03-05",
          description: "Jual kopi",
          source: "revenue",
          lines: [
            { accountId: kasId, debit: 30_000, credit: 0 },
            { accountId: jualId, debit: 0, credit: 30_000, itemId: item.id, quantity: 300 },
            { accountId: role("cogs"), debit: 15_000, credit: 0 },
            { accountId: role("inventory"), debit: 0, credit: 15_000, itemId: item.id, quantity: 300 },
          ],
        });
        return { item, purchase, saleEntry, role };
      }

      it("master barang: kode unik, ubah, nonaktif, hapus hanya bila belum dipakai", async () => {
        const item = await repos.items.create(workspace.id, { code: "BRG-1", name: "Gula", unit: "gram", revenueAccountId: null });
        expect(item).toMatchObject({ code: "BRG-1", unit: "gram", isActive: true, revenueAccountId: null, deletedAt: null });
        await expectCode(repos.items.create(workspace.id, { code: "BRG-1", name: "Lain", unit: "pcs", revenueAccountId: null }), "DUPLICATE_ITEM_CODE");
        const updated = await repos.items.update(item.id, { name: "Gula pasir", revenueAccountId: jualId, isActive: false });
        expect(updated).toMatchObject({ name: "Gula pasir", revenueAccountId: jualId, isActive: false });
        expect(await repos.items.hasJournalLines(item.id)).toBe(false);
        await repos.items.softDelete(item.id);
        expect(await repos.items.listByWorkspace(workspace.id)).toEqual([]);
        const [log] = await repos.auditLogs.listByWorkspace(workspace.id, { entityType: "item", entityId: item.id });
        expect(log.action).toBe("delete");
      });

      it("baris jurnal menyimpan barang & qty; pembalik ikut membawa barang", async () => {
        const { item, saleEntry } = await setupItems();
        const inventoryLine = saleEntry.lines.find((l) => l.itemId === item.id && l.credit > 0 && l.quantity === 300);
        expect(inventoryLine).toBeTruthy();
        expect(saleEntry.lines.find((l) => l.accountId === kasId)).toMatchObject({ itemId: null, quantity: null });
        expect(await repos.items.hasJournalLines(item.id)).toBe(true);
        await expectCode(repos.items.softDelete(item.id), "ITEM_IN_USE");
        const reversal = await repos.journals.postJournal(buildReversalInput(saleEntry, "2026-03-06"));
        expect(reversal.lines.filter((l) => l.itemId === item.id).map((l) => [l.debit, l.credit, l.quantity])).toEqual([
          [30_000, 0, 300],
          [15_000, 0, 300],
        ]);
      });

      it("validasi baris barang di lapisan terakhir", async () => {
        const { item, role } = await setupItems();
        const base = { workspaceId: workspace.id, entryDate: "2026-03-07", description: "Uji", source: "manual" as const };
        const withItem = (extra: Record<string, unknown>) => ({
          ...base,
          lines: [{ accountId: role("inventory"), debit: 1_000, credit: 0, ...extra }, { accountId: kasId, debit: 0, credit: 1_000 }],
        });
        await expectCode(repos.journals.postJournal(withItem({ itemId: item.id, quantity: -1 })), "INVALID_QUANTITY");
        await expectCode(repos.journals.postJournal(withItem({ quantity: 5 })), "INVALID_QUANTITY");
        await expectCode(repos.journals.postJournal(withItem({ itemId: "00000000-0000-0000-0000-000000000001", quantity: 1 })), "ITEM_NOT_FOUND");
        await repos.items.update(item.id, { isActive: false });
        await expectCode(repos.journals.postJournal(withItem({ itemId: item.id, quantity: 1 })), "ITEM_INACTIVE");
      });

      it("retur: qty kumulatif dibatasi, transaksi asal ber-retur tidak dapat di-void", async () => {
        const { item, saleEntry, role } = await setupItems();
        const returnOf = (quantity: number, value: number, cost: number): JournalEntryInput => ({
          workspaceId: workspace.id,
          entryDate: "2026-03-08",
          description: "Retur kopi",
          source: "return",
          returnOf: saleEntry.id,
          lines: [
            { accountId: jualId, debit: value, credit: 0, itemId: item.id, quantity },
            { accountId: kasId, debit: 0, credit: value },
            { accountId: role("inventory"), debit: cost, credit: 0, itemId: item.id, quantity },
            { accountId: role("cogs"), debit: 0, credit: cost },
          ],
        });
        await expectCode(repos.journals.postJournal(returnOf(301, 30_100, 15_050)), "INVALID_RETURN");
        const first = await repos.journals.postJournal(returnOf(200, 20_000, 10_000));
        expect(first).toMatchObject({ source: "return", returnOf: saleEntry.id });
        expect(await repos.journals.listActiveReturnsOf(saleEntry.id)).toHaveLength(1);
        await expectCode(repos.journals.postJournal(returnOf(101, 10_100, 5_050)), "INVALID_RETURN");
        await expectCode(repos.journals.postJournal(buildReversalInput(saleEntry, "2026-03-09")), "HAS_RETURNS");
        await expectCode(repos.journals.postJournal({ ...returnOf(1, 100, 50), returnOf: null }), "INVALID_RETURN");
        // Void retur membuka kembali qty yang dapat diretur.
        await repos.journals.postJournal(buildReversalInput(first, "2026-03-09"));
        expect(await repos.journals.listActiveReturnsOf(saleEntry.id)).toHaveLength(0);
        await repos.journals.postJournal(returnOf(300, 30_000, 15_000));
      });

      it("pengaturan persediaan: metode & riwayat metode biaya", async () => {
        const updated = await repos.workspaces.updateInventorySettings(workspace.id, {
          inventoryMethod: "perpetual",
          costMethodHistory: [
            { method: "average", from: "2026-01-01" },
            { method: "fifo", from: "2026-04-01" },
          ],
        });
        expect(updated).toMatchObject({ inventoryMethod: "perpetual", costMethodHistory: [{ method: "average", from: "2026-01-01" }, { method: "fifo", from: "2026-04-01" }] });
        const logs = await repos.auditLogs.listByWorkspace(workspace.id, { entityType: "workspace" });
        expect(logs[0].action).toBe("update_inventory_settings");
      });
    });

    describe("stok opname sisa bahan (ADR 020)", () => {
      async function setup() {
        const accounts = await repos.accounts.listByWorkspace(workspace.id);
        const role = (r: string) => accounts.find((a) => a.systemRole === r)!.id;
        const item = await repos.items.create(workspace.id, { code: "BB-1", name: "Tepung", unit: "gram", revenueAccountId: null, category: "Dry Goods" });
        await repos.journals.postJournal({
          workspaceId: workspace.id,
          entryDate: "2026-03-01",
          description: "Beli tepung",
          source: "purchase",
          lines: [
            { accountId: role("inventory"), debit: 100_000, credit: 0, itemId: item.id, quantity: 10_000 },
            { accountId: kasId, debit: 0, credit: 100_000 },
          ],
        });
        const journal = (date: string, amount: number): JournalEntryInput => ({
          workspaceId: workspace.id,
          entryDate: date,
          description: "Stok opname sisa bahan",
          source: "adjustment",
          lines: [
            { accountId: role("cogs"), debit: amount, credit: 0 },
            { accountId: role("inventory"), debit: 0, credit: amount },
          ],
        });
        return { item, journal };
      }

      it("menyimpan stok opname beserta jurnal & section barang", async () => {
        const { item, journal } = await setup();
        expect(item.category).toBe("Dry Goods");
        const count = await repos.stockCounts.post(
          { workspaceId: workspace.id, countDate: "2026-03-31", valuation: "average", lines: [{ itemId: item.id, quantity: 2_000, value: 20_000 }] },
          journal("2026-03-31", 80_000),
        );
        expect(count).toMatchObject({ countDate: "2026-03-31", valuation: "average", lines: [{ itemId: item.id, quantity: 2_000, value: 20_000 }] });
        expect(count.journalEntryId).toBeTruthy();
        const posted = await repos.journals.getById(count.journalEntryId!);
        expect(posted).toMatchObject({ source: "adjustment", status: "posted" });
        expect(await repos.stockCounts.listByWorkspace(workspace.id)).toHaveLength(1);
        const updated = await repos.items.update(item.id, { category: "Kering" });
        expect(updated.category).toBe("Kering");
      });

      it("menolak tanggal tidak setelah opname terakhir, jurnal salah, qty negatif; tanpa jurnal boleh", async () => {
        const { item, journal } = await setup();
        await repos.stockCounts.post({ workspaceId: workspace.id, countDate: "2026-03-31", valuation: "last", lines: [{ itemId: item.id, quantity: 0, value: 0 }] }, null);
        await expectCode(
          repos.stockCounts.post({ workspaceId: workspace.id, countDate: "2026-03-31", valuation: "average", lines: [] }, null),
          "INVALID_STOCK_COUNT",
        );
        await expectCode(
          repos.stockCounts.post({ workspaceId: workspace.id, countDate: "2026-04-30", valuation: "average", lines: [] }, journal("2026-04-29", 1)),
          "INVALID_STOCK_COUNT",
        );
        await expectCode(
          repos.stockCounts.post({ workspaceId: workspace.id, countDate: "2026-04-30", valuation: "average", lines: [{ itemId: item.id, quantity: -1, value: 0 }] }, null),
          "INVALID_QUANTITY",
        );
        expect(await repos.stockCounts.listByWorkspace(workspace.id)).toHaveLength(1);
      });

      it("batalkan stok opname terakhir membalik jurnalnya; void jurnal juga membatalkan", async () => {
        const { item, journal } = await setup();
        const first = await repos.stockCounts.post(
          { workspaceId: workspace.id, countDate: "2026-03-31", valuation: "average", lines: [{ itemId: item.id, quantity: 2_000, value: 20_000 }] },
          journal("2026-03-31", 80_000),
        );
        const second = await repos.stockCounts.post(
          { workspaceId: workspace.id, countDate: "2026-04-30", valuation: "average", lines: [{ itemId: item.id, quantity: 1_000, value: 10_000 }] },
          journal("2026-04-30", 10_000),
        );
        await expectCode(repos.stockCounts.cancel(first.id, "2026-04-30"), "INVALID_STOCK_COUNT");
        await repos.stockCounts.cancel(second.id, "2026-04-30");
        expect((await repos.journals.findReversalOf(second.journalEntryId!))?.entryDate).toBe("2026-04-30");
        expect((await repos.stockCounts.listByWorkspace(workspace.id)).map((c) => c.id)).toEqual([first.id]);
        const original = (await repos.journals.getById(first.journalEntryId!))!;
        await repos.journals.postJournal(buildReversalInput(original, "2026-04-01"));
        expect(await repos.stockCounts.listByWorkspace(workspace.id)).toEqual([]);
      });
    });

    describe("menu, resep, rekap porsi & penjualan menu (ADR 021)", () => {
      async function setup() {
        const ayam = await repos.items.create(workspace.id, { code: "BB-1", name: "Ayam", unit: "gram", revenueAccountId: null });
        const beras = await repos.items.create(workspace.id, { code: "BB-2", name: "Beras", unit: "gram", revenueAccountId: null });
        const menu = await repos.menus.createMenu(workspace.id, { code: "M-1", name: "Nasi Ayam", category: "Makanan", price: 25_000, revenueAccountId: jualId });
        return { ayam, beras, menu };
      }
      const menuSale = (date: string, amount: number): JournalEntryInput => sale(amount, { entryDate: date });

      it("menu: buat, ubah, kode unik, nonaktif; hapus ditolak bila sudah dipakai", async () => {
        const { menu } = await setup();
        expect(menu).toMatchObject({ code: "M-1", name: "Nasi Ayam", category: "Makanan", price: 25_000, revenueAccountId: jualId, isActive: true });
        await expectCode(repos.menus.createMenu(workspace.id, { code: "M-1", name: "Dobel", price: 0, revenueAccountId: null }), "DUPLICATE_MENU_CODE");
        const updated = await repos.menus.updateMenu(menu.id, { price: 27_000, category: null, isActive: false });
        expect(updated).toMatchObject({ price: 27_000, category: null, isActive: false });
        await expectCode(repos.menus.postMenuSale(menuSale("2026-03-10", 27_000), [{ menuId: menu.id, portions: 1, amount: 27_000 }]), "MENU_INACTIVE");
        await repos.menus.updateMenu(menu.id, { isActive: true });
        await repos.menus.postMenuSale(menuSale("2026-03-10", 27_000), [{ menuId: menu.id, portions: 1, amount: 27_000 }]);
        await expectCode(repos.menus.deleteMenu(menu.id), "MENU_IN_USE");
        const unused = await repos.menus.createMenu(workspace.id, { code: "M-2", name: "Es Teh", price: 5_000, revenueAccountId: null });
        await repos.menus.deleteMenu(unused.id);
        expect((await repos.menus.listMenus(workspace.id)).map((m) => m.code)).toEqual(["M-1"]);
        expect(await repos.menus.getMenu(unused.id)).toBeNull();
      });

      it("resep: versi per tanggal berlaku, simpan ulang mengganti, urutan baris tetap, validasi; bahan resep tidak bisa dihapus", async () => {
        const { ayam, beras, menu } = await setup();
        const base = { workspaceId: workspace.id, menuId: menu.id };
        await repos.menus.saveRecipe({ ...base, effectiveFrom: "2026-01-01", yieldPortions: 1, lines: [{ itemId: beras.id, quantity: 150 }, { itemId: ayam.id, quantity: 100 }] });
        await repos.menus.saveRecipe({ ...base, effectiveFrom: "2026-02-01", yieldPortions: 4, lines: [{ itemId: ayam.id, quantity: 500 }] });
        const replaced = await repos.menus.saveRecipe({ ...base, effectiveFrom: "2026-02-01", yieldPortions: 2, lines: [{ itemId: ayam.id, quantity: 240 }] });
        expect(replaced).toMatchObject({ effectiveFrom: "2026-02-01", yieldPortions: 2, lines: [{ itemId: ayam.id, quantity: 240 }] });
        const recipes = await repos.menus.listRecipes(workspace.id);
        expect(recipes.map((r) => [r.effectiveFrom, r.yieldPortions, r.lines])).toEqual([
          ["2026-01-01", 1, [{ itemId: beras.id, quantity: 150 }, { itemId: ayam.id, quantity: 100 }]],
          ["2026-02-01", 2, [{ itemId: ayam.id, quantity: 240 }]],
        ]);
        await expectCode(repos.menus.saveRecipe({ ...base, effectiveFrom: "2026-03-01", yieldPortions: 0, lines: [{ itemId: ayam.id, quantity: 1 }] }), "INVALID_RECIPE");
        await expectCode(repos.menus.saveRecipe({ ...base, effectiveFrom: "2026-03-01", yieldPortions: 1, lines: [] }), "INVALID_RECIPE");
        await expectCode(repos.menus.saveRecipe({ ...base, effectiveFrom: "2026-03-01", yieldPortions: 1, lines: [{ itemId: ayam.id, quantity: 0 }] }), "INVALID_QUANTITY");
        await expectCode(
          repos.menus.saveRecipe({ ...base, effectiveFrom: "2026-03-01", yieldPortions: 1, lines: [{ itemId: ayam.id, quantity: 1 }, { itemId: ayam.id, quantity: 2 }] }),
          "INVALID_RECIPE",
        );
        await expectCode(repos.items.softDelete(beras.id), "ITEM_IN_USE");
        await repos.menus.deleteRecipe(recipes[0].id);
        await repos.items.softDelete(beras.id);
        expect((await repos.menus.listRecipes(workspace.id)).map((r) => r.effectiveFrom)).toEqual(["2026-02-01"]);
      });

      it("rekap porsi: simpan & hapus, rentang bertumpuk ditolak", async () => {
        const { menu } = await setup();
        const summary = await repos.menus.createPortionSummary({ workspaceId: workspace.id, dateFrom: "2026-03-01", dateTo: "2026-03-15", note: "POS", lines: [{ menuId: menu.id, portions: 120 }] });
        expect(summary).toMatchObject({ dateFrom: "2026-03-01", dateTo: "2026-03-15", note: "POS", lines: [{ menuId: menu.id, portions: 120 }] });
        await expectCode(
          repos.menus.createPortionSummary({ workspaceId: workspace.id, dateFrom: "2026-03-15", dateTo: "2026-03-31", note: null, lines: [{ menuId: menu.id, portions: 1 }] }),
          "INVALID_PORTION_SUMMARY",
        );
        await expectCode(
          repos.menus.createPortionSummary({ workspaceId: workspace.id, dateFrom: "2026-03-20", dateTo: "2026-03-10", note: null, lines: [{ menuId: menu.id, portions: 1 }] }),
          "INVALID_DATE",
        );
        await expectCode(
          repos.menus.createPortionSummary({ workspaceId: workspace.id, dateFrom: "2026-04-01", dateTo: "2026-04-30", note: null, lines: [{ menuId: menu.id, portions: 0 }] }),
          "INVALID_QUANTITY",
        );
        await repos.menus.deletePortionSummary(summary.id);
        expect(await repos.menus.listPortionSummaries(workspace.id)).toEqual([]);
        await repos.menus.createPortionSummary({ workspaceId: workspace.id, dateFrom: "2026-03-10", dateTo: "2026-03-31", note: null, lines: [{ menuId: menu.id, portions: 1 }] });
      });

      it("penjualan menu: jurnal + porsi atomik; jurnal tidak valid tidak menyimpan porsi; void mengeluarkannya", async () => {
        const { menu } = await setup();
        const entry = await repos.menus.postMenuSale(menuSale("2026-03-10", 50_000), [{ menuId: menu.id, portions: 2, amount: 50_000 }]);
        expect(entry).toMatchObject({ source: "revenue", status: "posted", entryDate: "2026-03-10" });
        expect(await repos.menus.listMenuSales(workspace.id)).toEqual([
          { journalEntryId: entry.id, workspaceId: workspace.id, entryDate: "2026-03-10", lines: [{ menuId: menu.id, portions: 2, amount: 50_000 }] },
        ]);
        await expectCode(repos.menus.postMenuSale(menuSale("2026-03-11", 25_000), [{ menuId: menu.id, portions: 0, amount: 25_000 }]), "INVALID_QUANTITY");
        await expectCode(
          repos.menus.postMenuSale({ ...menuSale("2026-03-11", 25_000), source: "manual" }, [{ menuId: menu.id, portions: 1, amount: 25_000 }]),
          "INVALID_ACCOUNT",
        );
        // Jurnal tidak seimbang: ditolak dan tidak ada porsi tersimpan.
        const unbalanced = menuSale("2026-03-11", 25_000);
        unbalanced.lines[1] = { ...unbalanced.lines[1], credit: 24_000 };
        await expectCode(repos.menus.postMenuSale(unbalanced, [{ menuId: menu.id, portions: 1, amount: 25_000 }]), "UNBALANCED");
        expect(await repos.menus.listMenuSales(workspace.id)).toHaveLength(1);
        await repos.journals.postJournal(buildReversalInput(entry, "2026-03-12"));
        expect(await repos.menus.listMenuSales(workspace.id)).toEqual([]);
      });
    });

    describe("profil usaha, kontak & faktur (ADR 022)", () => {
      const contactInput = (name: string) => ({
        name,
        isCustomer: true,
        isSupplier: false,
        address: "Jl. Merdeka 1",
        phone: null,
        email: null,
        npwp: "01.234.567.8-901.000",
        paymentTermDays: 30,
        notes: null,
      });
      async function setup() {
        const accounts = await repos.accounts.listByWorkspace(workspace.id);
        const piutangId = accounts.find((a) => a.systemRole === "accounts_receivable")!.id;
        const contact = await repos.invoices.createContact(workspace.id, contactInput("PT Maju"));
        const input = (date: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput => ({
          workspaceId: workspace.id,
          kind: "sale",
          contactId: contact.id,
          invoiceDate: date,
          dueDate: date,
          reference: "PO-1",
          notes: null,
          applyTax: false,
          lines: [
            { description: "Catering", quantity: 2, unit: "box", unitPrice: 25_000, accountId: jualId, itemId: null },
            { description: "Belum lengkap", quantity: 0, unit: null, unitPrice: 0, accountId: "", itemId: null },
          ],
          ...overrides,
        });
        const journal = (date: string, amount: number): JournalEntryInput => ({
          workspaceId: workspace.id,
          entryDate: date,
          description: "Faktur (nomor otomatis) · PT Maju",
          source: "revenue",
          counterparty: "PT Maju",
          lines: [
            { accountId: piutangId, debit: amount, credit: 0 },
            { accountId: jualId, debit: 0, credit: amount },
          ],
        });
        return { contact, input, journal };
      }

      it("profil: default, simpan & ubah, prefix/logo tidak valid ditolak", async () => {
        expect(await repos.invoices.getProfile(workspace.id)).toMatchObject({ workspaceId: workspace.id, invoicePrefix: "INV", logoDataUrl: null, updatedAt: null });
        const profile = {
          displayName: "Kedai A",
          address: "Jl. A",
          phone: "0812",
          email: "a@kedai.id",
          npwp: "1",
          bankInfo: "BCA 123",
          invoiceNotes: "Terima kasih",
          invoicePrefix: "KDA",
          purchasePrefix: "PBK",
          logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        };
        expect(await repos.invoices.saveProfile(workspace.id, profile)).toMatchObject(profile);
        expect(await repos.invoices.saveProfile(workspace.id, { ...profile, invoicePrefix: "INV", logoDataUrl: null })).toMatchObject({ invoicePrefix: "INV", logoDataUrl: null });
        await expectCode(repos.invoices.saveProfile(workspace.id, { ...profile, invoicePrefix: "inv/x" }), "INVALID_PROFILE");
        await expectCode(repos.invoices.saveProfile(workspace.id, { ...profile, logoDataUrl: "data:text/html;base64,AAAA" }), "INVALID_PROFILE");
      });

      it("kontak: buat, ubah, nama unik tanpa beda huruf, hapus ditolak bila dipakai faktur", async () => {
        const { contact, input } = await setup();
        expect(contact).toMatchObject({ name: "PT Maju", isCustomer: true, paymentTermDays: 30, npwp: "01.234.567.8-901.000" });
        await expectCode(repos.invoices.createContact(workspace.id, contactInput("pt maju")), "DUPLICATE_CONTACT");
        const updated = await repos.invoices.updateContact(contact.id, { ...contactInput("PT Maju Jaya"), isSupplier: true, paymentTermDays: 14 });
        expect(updated).toMatchObject({ name: "PT Maju Jaya", isSupplier: true, paymentTermDays: 14 });
        await repos.invoices.saveDraft(input("2026-03-10"));
        await expectCode(repos.invoices.deleteContact(contact.id), "CONTACT_IN_USE");
        const other = await repos.invoices.createContact(workspace.id, contactInput("CV Lain"));
        await repos.invoices.deleteContact(other.id);
        expect((await repos.invoices.listContacts(workspace.id)).map((c) => c.name)).toEqual(["PT Maju Jaya"]);
      });

      it("draft: simpan & ubah (urutan baris, akun kosong), hapus; jenis tidak bisa diubah", async () => {
        const { input } = await setup();
        const draft = await repos.invoices.saveDraft(input("2026-03-10"));
        expect(draft).toMatchObject({ status: "draft", number: null, journalEntryId: null, reference: "PO-1", lines: input("2026-03-10").lines });
        const changed = await repos.invoices.saveDraft(input("2026-03-11", { applyTax: true, lines: [input("2026-03-11").lines[1], input("2026-03-11").lines[0]] }), draft.id);
        expect(changed).toMatchObject({ id: draft.id, invoiceDate: "2026-03-11", applyTax: true });
        expect(changed.lines.map((l) => l.description)).toEqual(["Belum lengkap", "Catering"]);
        await expectCode(repos.invoices.saveDraft({ ...input("2026-03-11"), kind: "purchase" }, draft.id), "INVALID_INVOICE");
        await expectCode(repos.invoices.saveDraft(input("2026-03-11", { lines: [{ ...input("2026-03-11").lines[0], quantity: -1 }] })), "INVALID_QUANTITY");
        expect(await repos.invoices.listInvoices(workspace.id, "purchase")).toEqual([]);
        await repos.invoices.deleteDraft(draft.id);
        expect(await repos.invoices.listInvoices(workspace.id)).toEqual([]);
      });

      it("terbit: nomor urut per tahun lintas bulan, jurnal & salinan kontak atomik; terbit tidak bisa diubah", async () => {
        const { contact, input, journal } = await setup();
        const snapshot = { name: contact.name, address: contact.address, phone: null, email: null, npwp: contact.npwp };
        const march = await repos.invoices.saveDraft(input("2026-03-10"));
        const issued = await repos.invoices.issue(march.id, journal("2026-03-10", 50_000), snapshot, "INV");
        expect(issued).toMatchObject({ status: "issued", number: "INV/2026/03/0001", contactSnapshot: snapshot });
        const entry = await repos.journals.getById(issued.journalEntryId!);
        expect(entry).toMatchObject({ status: "posted", description: "Faktur INV/2026/03/0001 · PT Maju", counterparty: "PT Maju" });
        const april = await repos.invoices.saveDraft(input("2026-04-02"));
        expect((await repos.invoices.issue(april.id, journal("2026-04-02", 50_000), snapshot, "KDA")).number).toBe("KDA/2026/04/0002");
        await expectCode(repos.invoices.saveDraft(input("2026-03-10"), march.id), "INVALID_INVOICE");
        await expectCode(repos.invoices.deleteDraft(march.id), "INVALID_INVOICE");
        await expectCode(repos.invoices.issue(march.id, journal("2026-03-10", 50_000), snapshot, "INV"), "INVALID_INVOICE");
        // Jurnal tanggal lain atau tidak seimbang: ditolak, faktur tetap draft tanpa nomor.
        const may = await repos.invoices.saveDraft(input("2026-05-05"));
        await expectCode(repos.invoices.issue(may.id, journal("2026-05-06", 1_000), snapshot, "INV"), "INVALID_INVOICE");
        const unbalanced = journal("2026-05-05", 1_000);
        unbalanced.lines[1] = { ...unbalanced.lines[1], credit: 999 };
        await expectCode(repos.invoices.issue(may.id, unbalanced, snapshot, "INV"), "UNBALANCED");
        expect(await repos.invoices.getInvoice(may.id)).toMatchObject({ status: "draft", number: null, journalEntryId: null });
        expect((await repos.journals.listByWorkspace(workspace.id)).filter((j) => j.status === "posted")).toHaveLength(2);
      });

      it("faktur pembelian: nomor urut terpisah dari penjualan, PPN Masukan koreksi tersimpan, sumber jurnal harus purchase", async () => {
        const { input, journal } = await setup();
        const accounts = await repos.accounts.listByWorkspace(workspace.id);
        const utangId = accounts.find((a) => a.systemRole === "accounts_payable")!.id;
        const bebanId = accounts.find((a) => a.accountType === "expense")!.id;
        const supplier = await repos.invoices.createContact(workspace.id, { ...contactInput("CV Pemasok"), isCustomer: false, isSupplier: true });
        const snapshot = { name: "CV Pemasok", address: null, phone: null, email: null, npwp: null };
        const sale = await repos.invoices.saveDraft(input("2026-03-10"));
        await repos.invoices.issue(sale.id, journal("2026-03-10", 50_000), snapshot, "INV");
        const draft = await repos.invoices.saveDraft({
          ...input("2026-03-12"),
          kind: "purchase",
          contactId: supplier.id,
          reference: "PS-0091",
          applyTax: true,
          taxOverride: 109_999,
          lines: [{ description: "Servis", quantity: 1, unit: null, unitPrice: 1_000_000, accountId: bebanId, itemId: null }],
        });
        expect(draft).toMatchObject({ kind: "purchase", taxOverride: 109_999, reference: "PS-0091" });
        await expectCode(repos.invoices.saveDraft({ ...input("2026-03-12"), kind: "purchase", taxOverride: -5 }), "INVALID_AMOUNT");
        const purchaseJournal: JournalEntryInput = {
          workspaceId: workspace.id,
          entryDate: "2026-03-12",
          description: "Faktur pembelian (nomor otomatis) · CV Pemasok (PS-0091)",
          source: "purchase",
          counterparty: "CV Pemasok",
          lines: [
            { accountId: bebanId, debit: 1_000_000, credit: 0 },
            { accountId: utangId, debit: 0, credit: 1_000_000 },
          ],
        };
        await expectCode(repos.invoices.issue(draft.id, { ...purchaseJournal, source: "revenue" }, snapshot, "PB"), "INVALID_INVOICE");
        const issued = await repos.invoices.issue(draft.id, purchaseJournal, snapshot, "PB");
        expect(issued).toMatchObject({ status: "issued", number: "PB/2026/03/0001", taxOverride: 109_999 });
        expect((await repos.journals.getById(issued.journalEntryId!))?.description).toBe("Faktur pembelian PB/2026/03/0001 · CV Pemasok (PS-0091)");
        expect((await repos.invoices.listInvoices(workspace.id, "purchase")).map((i) => i.number)).toEqual(["PB/2026/03/0001"]);
        expect((await repos.invoices.getProfile(workspace.id)).purchasePrefix).toBe("PB");
        await expectCode(
          repos.invoices.saveProfile(workspace.id, { ...(await repos.invoices.getProfile(workspace.id)), purchasePrefix: "pb x" }),
          "INVALID_PROFILE",
        );
      });
    });

    describe("pulihkan backup (ADR 023)", () => {
      async function backupOf(id: string): Promise<WorkspaceBackup> {
        const [ws, accounts, periods, journals, items, auditLogs, stockCounts, menus, recipes, portionSummaries, menuSales, profile, contacts, invoices] =
          await Promise.all([
            repos.workspaces.getById(id),
            repos.accounts.listByWorkspace(id),
            repos.periods.listByWorkspace(id),
            repos.journals.listByWorkspace(id),
            repos.items.listByWorkspace(id),
            repos.auditLogs.listByWorkspace(id),
            repos.stockCounts.listByWorkspace(id),
            repos.menus.listMenus(id),
            repos.menus.listRecipes(id),
            repos.menus.listPortionSummaries(id),
            repos.menus.listMenuSales(id),
            repos.invoices.getProfile(id),
            repos.invoices.listContacts(id),
            repos.invoices.listInvoices(id),
          ]);
        return JSON.parse(JSON.stringify(buildBackup(
          { workspace: ws!, accounts, periods, journals, items, auditLogs, stockCounts, menus, recipes, portionSummaries, menuSales, profile, contacts, invoices },
          "2026-10-05T08:00:00.000Z",
        )));
      }

      it("memulihkan ke workspace baru: nomor jurnal, pelunasan, void, periode terkunci, barang, faktur, audit", async () => {
        const accounts = await repos.accounts.listByWorkspace(workspace.id);
        const role = (r: string) => accounts.find((a) => a.systemRole === r)!.id;
        const item = await repos.items.create(workspace.id, { code: "BB-1", name: "Tepung", unit: "gram", revenueAccountId: null });
        const credit = await repos.journals.postJournal(sale(500_000, { counterparty: "PT A", lines: [
          { accountId: role("accounts_receivable"), debit: 500_000, credit: 0 },
          { accountId: jualId, debit: 0, credit: 500_000 },
        ] }));
        await repos.journals.postJournal({
          workspaceId: workspace.id, entryDate: "2026-03-12", description: "Terima", source: "settlement", counterparty: "PT A", settlementOf: credit.id,
          lines: [{ accountId: kasId, debit: 200_000, credit: 0 }, { accountId: role("accounts_receivable"), debit: 0, credit: 200_000 }],
        });
        const voided = await repos.journals.postJournal(sale(1_000, { entryDate: "2026-03-13" }));
        await repos.journals.postJournal(buildReversalInput(voided, "2026-03-14"));
        await repos.journals.postJournal({
          workspaceId: workspace.id, entryDate: "2026-03-15", description: "Beli", source: "purchase",
          lines: [{ accountId: role("inventory"), debit: 10_000, credit: 0, itemId: item.id, quantity: 1_000 }, { accountId: kasId, debit: 0, credit: 10_000 }],
        });
        const contact = await repos.invoices.createContact(workspace.id, { name: "PT F", isCustomer: true, isSupplier: false, address: null, phone: null, email: null, npwp: null, paymentTermDays: 0, notes: null });
        const draft = await repos.invoices.saveDraft({ workspaceId: workspace.id, kind: "sale", contactId: contact.id, invoiceDate: "2026-03-16", dueDate: "2026-03-16", reference: null, notes: null, applyTax: false,
          lines: [{ description: "Jasa", quantity: 1, unit: null, unitPrice: 75_000, accountId: jualId, itemId: null }] });
        await repos.invoices.issue(draft.id, {
          workspaceId: workspace.id, entryDate: "2026-03-16", description: "Faktur (nomor otomatis)", source: "revenue", counterparty: "PT F",
          lines: [{ accountId: role("accounts_receivable"), debit: 75_000, credit: 0 }, { accountId: jualId, debit: 0, credit: 75_000 }],
        }, { name: "PT F", address: null, phone: null, email: null, npwp: null }, "INV");
        const periods = await repos.periods.listByWorkspace(workspace.id);
        await repos.periods.setStatus(periods.find((p) => p.startDate === "2026-02-01")!.id, "closed");

        const backup = await backupOf(workspace.id);
        const restored = await repos.workspaces.restoreFromBackup(actors.owner.ownerId, "Kedai A (pulihan)", backup);
        expect(restored).toMatchObject({ name: "Kedai A (pulihan)", templateType: "fnb", salesTaxRateBps: workspace.salesTaxRateBps, ownerId: actors.owner.ownerId });
        expect(restored.id).not.toBe(workspace.id);

        const summary = async (id: string) => {
          const accs = await repos.accounts.listByWorkspace(id);
          const code = new Map(accs.map((a) => [a.id, a.code]));
          const journals = await repos.journals.listByWorkspace(id);
          const byNumber = new Map(journals.map((j) => [j.id, j.entryNumber]));
          return journals
            .map((j) => [j.entryNumber, j.entryDate, j.source, byNumber.get(j.settlementOf ?? "") ?? null, byNumber.get(j.reversalOf ?? "") ?? null,
              j.lines.map((l) => [code.get(l.accountId), l.debit, l.credit, l.quantity ?? null])])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        };
        expect(await summary(restored.id)).toEqual(await summary(workspace.id));
        expect((await repos.periods.listByWorkspace(restored.id)).find((p) => p.startDate === "2026-02-01")?.status).toBe("closed");
        expect((await repos.items.listByWorkspace(restored.id)).map((i) => i.code)).toEqual(["BB-1"]);
        const [inv] = await repos.invoices.listInvoices(restored.id);
        expect(inv).toMatchObject({ number: "INV/2026/03/0001", status: "issued", lines: [{ description: "Jasa", unitPrice: 75_000 }] });
        expect((await repos.journals.getById(inv.journalEntryId!))?.entryNumber).toBe((await repos.journals.getById((await repos.invoices.listInvoices(workspace.id))[0].journalEntryId!))?.entryNumber);
        const logs = await repos.auditLogs.listByWorkspace(restored.id);
        expect(logs.filter((l) => l.action === "restore")).toHaveLength(1);
        expect(logs.length).toBe(backup.auditLogs.length + 1);
        // Nomor jurnal berikutnya di workspace pulihan melanjutkan urutan.
        const next = await repos.journals.postJournal({ ...sale(5_000, { entryDate: "2026-03-20" }), workspaceId: restored.id,
          lines: [{ accountId: (await repos.accounts.listByWorkspace(restored.id)).find((a) => a.code === "1-1100")!.id, debit: 5_000, credit: 0 },
            { accountId: (await repos.accounts.listByWorkspace(restored.id)).find((a) => a.code === "4-1000")!.id, debit: 0, credit: 5_000 }] });
        expect(next.entryNumber).toBe(`JU-2026-${String(backup.journals.filter((j) => j.status === "posted").length + 1).padStart(4, "0")}`);
      });

      it("backup tidak seimbang ditolak tanpa membuat workspace", async () => {
        await repos.journals.postJournal(sale(10_000));
        const backup = await backupOf(workspace.id);
        backup.journals[0].lines[0].debit += 1;
        const before = (await repos.workspaces.listByOwner(actors.owner.ownerId)).length;
        await expectCode(repos.workspaces.restoreFromBackup(actors.owner.ownerId, "Rusak", backup), "INVALID_BACKUP");
        expect((await repos.workspaces.listByOwner(actors.owner.ownerId)).length).toBe(before);
      });
    });
  });
}