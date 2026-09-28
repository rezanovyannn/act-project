/**
 * Contract test repository (ADR 003). Dijalankan terhadap setiap implementasi:
 * mock di Fase 1, Supabase lokal di Fase 2.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { monthlyPeriodsForYear } from "@/core/periods";
import type {
  IAccountRepository,
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
}

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).hasCode(code)).toBe(true);
}

export function describeRepositoryContract(
  name: string,
  createRepositories: () => Promise<ContractRepositories> | ContractRepositories,
) {
  describe(`kontrak repository: ${name}`, () => {
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
      repos = await createRepositories();
      workspace = await repos.workspaces.createWithSeed(
        { ownerId: "owner-a", name: "Kedai A", templateType: "fnb", booksStartDate: "2026-01-01" },
        FNB_TEMPLATE.accounts,
        monthlyPeriodsForYear(2026),
      );
      const accounts = await repos.accounts.listByWorkspace(workspace.id);
      kasId = accounts.find((a) => a.code === "1-1100")!.id;
      jualId = accounts.find((a) => a.code === "4-1000")!.id;
    });

    describe("workspace", () => {
      it("createWithSeed membuat workspace, akun, dan periode", async () => {
        expect(workspace).toMatchObject({ currency: "IDR", templateType: "fnb", deletedAt: null });
        expect(await repos.accounts.listByWorkspace(workspace.id)).toHaveLength(FNB_TEMPLATE.accounts.length);
        const periods = await repos.periods.listByWorkspace(workspace.id);
        expect(periods).toHaveLength(12);
        expect(periods.every((p) => p.status === "open")).toBe(true);
      });

      it("hanya menampilkan workspace milik owner dan menyembunyikan yang dihapus", async () => {
        await repos.workspaces.createWithSeed(
          { ownerId: "owner-b", name: "Kedai B", templateType: "fnb", booksStartDate: "2026-01-01" },
          FNB_TEMPLATE.accounts,
          [],
        );
        expect((await repos.workspaces.listByOwner("owner-a")).map((w) => w.name)).toEqual(["Kedai A"]);
        await repos.workspaces.softDelete(workspace.id);
        expect(await repos.workspaces.listByOwner("owner-a")).toEqual([]);
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
