import { fail } from "@/core/errors";
import { periodsOverlap, type PeriodRange } from "@/core/periods";
import type { IPeriodRepository } from "@/core/ports";
import type { Period, PeriodStatus } from "@/core/types";
import type { MockDatabase } from "./mock-database";

export class MockPeriodRepository implements IPeriodRepository {
  constructor(private readonly db: MockDatabase) {}

  async listByWorkspace(workspaceId: string): Promise<Period[]> {
    return this.db
      .read()
      .periods.filter((p) => p.workspaceId === workspaceId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  async createMany(workspaceId: string, ranges: PeriodRange[]): Promise<Period[]> {
    return this.db.write((state) => {
      const existing: PeriodRange[] = state.periods.filter((p) => p.workspaceId === workspaceId);
      const now = this.db.now();
      const created: Period[] = [];
      for (const range of ranges) {
        if (range.startDate > range.endDate) {
          fail("INVALID_DATE", "Tanggal awal periode setelah tanggal akhir");
        }
        if ([...existing, ...created].some((p) => periodsOverlap(p, range))) {
          fail("INVALID_DATE", `Periode ${range.startDate} s.d. ${range.endDate} tumpang tindih`);
        }
        const period: Period = {
          ...range,
          id: this.db.generateId(),
          workspaceId,
          status: "open",
          createdAt: now,
          updatedAt: now,
        };
        created.push(period);
      }
      state.periods.push(...created);
      for (const period of created) {
        this.db.audit(state, { workspaceId, entityType: "period", entityId: period.id, action: "create", before: null, after: period });
      }
      return created;
    });
  }

  async setStatus(id: string, status: PeriodStatus, reason?: string): Promise<Period> {
    return this.db.write((state) => {
      const period = state.periods.find((p) => p.id === id);
      if (!period) fail("NOT_FOUND", "Periode tidak ditemukan");
      const before = { ...period };
      period.status = status;
      period.updatedAt = this.db.now();
      this.db.audit(state, {
        workspaceId: period.workspaceId,
        entityType: "period",
        entityId: period.id,
        action: status === "closed" ? "close" : "reopen",
        before,
        after: period,
        reason: reason?.trim() || null,
      });
      return period;
    });
  }
}
