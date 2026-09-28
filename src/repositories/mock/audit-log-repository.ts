import type { AuditLogFilter, IAuditLogRepository } from "@/core/ports";
import type { AuditLog } from "@/core/types";
import type { MockDatabase } from "./mock-database";

export class MockAuditLogRepository implements IAuditLogRepository {
  constructor(private readonly db: MockDatabase) {}

  async listByWorkspace(workspaceId: string, filter: AuditLogFilter = {}): Promise<AuditLog[]> {
    return this.db
      .read()
      .auditLogs.filter(
        (log) =>
          log.workspaceId === workspaceId &&
          (!filter.entityType || log.entityType === filter.entityType) &&
          (!filter.entityId || log.entityId === filter.entityId),
      )
      .reverse();
  }
}
