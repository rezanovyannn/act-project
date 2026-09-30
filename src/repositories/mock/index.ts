import { MockAccountRepository } from "./account-repository";
import { MockAuditLogRepository } from "./audit-log-repository";
import { MockItemRepository } from "./item-repository";
import { MockJournalRepository } from "./journal-repository";
import { MockDatabase } from "./mock-database";
import { MockPeriodRepository } from "./period-repository";
import { MockWorkspaceRepository } from "./workspace-repository";

export * from "./mock-database";

export function createMockRepositories(db: MockDatabase) {
  return {
    workspaces: new MockWorkspaceRepository(db),
    accounts: new MockAccountRepository(db),
    periods: new MockPeriodRepository(db),
    journals: new MockJournalRepository(db),
    items: new MockItemRepository(db),
    auditLogs: new MockAuditLogRepository(db),
  };
}

export type MockRepositories = ReturnType<typeof createMockRepositories>;
