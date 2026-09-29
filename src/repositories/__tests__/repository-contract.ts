/**
 * Contract test repository (ADR 003). Dijalankan terhadap setiap implementasi:
 * mock (Fase 1) dan proyek Supabase dev (Fase 2, ADR 013).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { monthlyPeriodsForYear } from "@/core/periods";
import type {
  IAccountRepository,
  IAuditLogRepository,
  IJournalRepository,
  IPeriodRepository,
  IWorkspaceRepository,
} from "@/core/ports";
import type { JournalEntryInput, Workspace } from "@/core/types";
import { FNB_TEMPLATE } from "@/modules/fnb/template";

export interface ContractRepositories {
  workspaces: IWorkspaceRepository;
  accounts: IAccountRepository;
  periods: IPeriodRepository;
  journals: IJournalRepository;
  auditLogs: IAuditLogRepository;
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
        { ownerId: actors.owner.ownerId, name: "Kedai A", templateType: "fnb", booksStartDate: "2026-01-01" },
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
          salesTaxRateBps: 1000,
          salesTaxInclusive: false,
          deletedAt: null,
        });
        const updated = await repos.workspaces.updateSalesTaxSettings(workspace.id, {
          rateBps: 500,
          inclusive: true,
        });
        expect(updated).toMatchObject({ salesTaxRateBps: 500, salesTaxInclusive: true });
        expect(await repos.accounts.listByWorkspace(workspace.id)).toHaveLength(FNB_TEMPLATE.accounts.length);
        const periods = await repos.periods.listByWorkspace(workspace.id);
        expect(periods).toHaveLength(12);
        expect(periods.every((p) => p.status === "open")).toBe(true);
      });

      it("hanya menampilkan workspace milik owner dan menyembunyikan yang dihapus", async () => {
        const { owner, other } = actors;
        const otherWorkspace = await other.repos.workspaces.createWithSeed(
          { ownerId: other.ownerId, name: "Kedai B", templateType: "fnb", booksStartDate: "2026-01-01" },
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
  });
}
