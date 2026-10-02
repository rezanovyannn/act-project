import { describe, expect, it } from "vitest";
import { workspaceOverview } from "@/core/workspace-overview";
import { createFnbWorkspace, createTestEnv, entry, line } from "./helpers";

describe("ringkasan kartu workspace", () => {
  it("workspace baru: belum ada jurnal & saldo awal", async () => {
    const env = createTestEnv();
    const { accounts } = await createFnbWorkspace(env);
    expect(workspaceOverview(accounts, [], "2026-03-15")).toEqual({
      revenueThisMonth: 0,
      postedThisMonth: 0,
      postedTotal: 0,
      draftCount: 0,
      hasOpeningBalance: false,
      lastEntryDate: null,
    });
  });

  it("pendapatan & jurnal bulan berjalan, saldo awal, draft, jurnal terakhir", async () => {
    const env = createTestEnv();
    const { workspace, byCode } = await createFnbWorkspace(env);
    const kas = byCode("1-1100").id;
    const jual = byCode("4-1000").id;
    await env.journalService.postJournal(entry(workspace.id, [line(kas, 1_000_000, 0), line(byCode("3-9000").id, 0, 1_000_000)], { entryDate: "2026-02-01", source: "opening_balance", description: "Saldo awal" }));
    await env.journalService.postJournal(entry(workspace.id, [line(kas, 200_000, 0), line(jual, 0, 200_000)], { entryDate: "2026-02-20", source: "revenue" }));
    await env.journalService.postJournal(entry(workspace.id, [line(kas, 300_000, 0), line(jual, 0, 300_000)], { entryDate: "2026-03-05", source: "revenue" }));
    await env.journalService.saveDraft(entry(workspace.id, [line(kas, 1, 0)], { entryDate: "2026-03-06" }));
    const accounts = await env.repos.accounts.listByWorkspace(workspace.id);
    const journals = await env.repos.journals.listByWorkspace(workspace.id);
    expect(workspaceOverview(accounts, journals, "2026-03-15")).toEqual({
      revenueThisMonth: 300_000,
      postedThisMonth: 1,
      postedTotal: 3,
      draftCount: 1,
      hasOpeningBalance: true,
      lastEntryDate: "2026-03-05",
    });
  });
});
