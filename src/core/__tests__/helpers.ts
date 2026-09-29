import { AccountService } from "@/core/services/account-service";
import { ClosingService } from "@/core/services/closing-service";
import { JournalService } from "@/core/services/journal-service";
import { PeriodService } from "@/core/services/period-service";
import { WorkspaceService } from "@/core/services/workspace-service";
import type { Account, JournalEntryInput, JournalLineInput } from "@/core/types";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import {
  createMockRepositories,
  emptyMockState,
  MemoryStorage,
  MockDatabase,
  type MockState,
} from "@/repositories/mock";

/** Lingkungan test dengan mock repository di memori, id & jam deterministik. */
export function createTestEnv(seed: () => MockState = emptyMockState) {
  let idCounter = 0;
  let tick = 0;
  const storage = new MemoryStorage();
  const db = new MockDatabase({
    storage,
    seed,
    generateId: () => `id-${++idCounter}`,
    actorId: "owner-a",
    now: () => new Date(Date.UTC(2026, 0, 1) + ++tick * 1000).toISOString(),
  });
  const repos = createMockRepositories(db);
  return {
    db,
    storage,
    repos,
    journalService: new JournalService(repos),
    accountService: new AccountService(repos),
    periodService: new PeriodService(repos),
    closingService: new ClosingService(repos),
    workspaceService: new WorkspaceService({
      workspaces: repos.workspaces,
      templates: { fnb: FNB_TEMPLATE },
    }),
  };
}

/** Workspace F&B baru mulai 1 Jan 2026 (periode Jan–Des 2026 open). */
export async function createFnbWorkspace(env: ReturnType<typeof createTestEnv>) {
  const workspace = await env.workspaceService.createWorkspace({
    ownerId: "owner-a",
    name: "Kedai Test",
    templateType: "fnb",
    booksStartDate: "2026-01-01",
  });
  const accounts = await env.repos.accounts.listByWorkspace(workspace.id);
  const byCode = (code: string): Account => {
    const account = accounts.find((a) => a.code === code);
    if (!account) throw new Error(`Akun ${code} tidak ada`);
    return account;
  };
  return { workspace, accounts, byCode };
}

export function line(accountId: string, debit: number, credit: number): JournalLineInput {
  return { accountId, debit, credit };
}

export function entry(
  workspaceId: string,
  lines: JournalLineInput[],
  overrides: Partial<JournalEntryInput> = {},
): JournalEntryInput {
  return {
    workspaceId,
    entryDate: "2026-03-10",
    description: "Transaksi test",
    source: "manual",
    lines,
    ...overrides,
  };
}
