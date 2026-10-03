import { MockAccountRepository } from "./account-repository";
import { MockAuditLogRepository } from "./audit-log-repository";
import { MockItemRepository } from "./item-repository";
import { MockJournalRepository } from "./journal-repository";
import { MockMenuRepository } from "./menu-repository";
import { MockDatabase } from "./mock-database";
import { MockPeriodRepository } from "./period-repository";
import { MockStockCountRepository } from "./stock-count-repository";
import { MockWorkspaceRepository } from "./workspace-repository";

export * from "./mock-database";

export function createMockRepositories(db: MockDatabase) {
  const journals = new MockJournalRepository(db);
  return {
    workspaces: new MockWorkspaceRepository(db),
    accounts: new MockAccountRepository(db),
    periods: new MockPeriodRepository(db),
    journals,
    stockCounts: new MockStockCountRepository(db, journals),
    menus: new MockMenuRepository(db, journals),
    items: new MockItemRepository(db),
    auditLogs: new MockAuditLogRepository(db),
  };
}

export type MockRepositories = ReturnType<typeof createMockRepositories>;
