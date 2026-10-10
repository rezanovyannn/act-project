import { MockAccountRepository } from "./account-repository";
import { MockAuditLogRepository } from "./audit-log-repository";
import { MockCateringRepository } from "./catering-repository";
import { MockInvoiceRepository } from "./invoice-repository";
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
  const invoices = new MockInvoiceRepository(db, journals);
  return {
    workspaces: new MockWorkspaceRepository(db),
    accounts: new MockAccountRepository(db),
    periods: new MockPeriodRepository(db),
    journals,
    stockCounts: new MockStockCountRepository(db, journals),
    menus: new MockMenuRepository(db, journals),
    invoices,
    catering: new MockCateringRepository(db, journals, invoices),
    items: new MockItemRepository(db),
    auditLogs: new MockAuditLogRepository(db),
  };
}

export type MockRepositories = ReturnType<typeof createMockRepositories>;
