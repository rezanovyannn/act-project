import { yearOf } from "../dates";
import { fail } from "../errors";
import { monthlyPeriodsForYear } from "../periods";
import type { IPeriodRepository } from "../ports";
import type { Period } from "../types";

/** Penguncian periode (ADR 006). */
export class PeriodService {
  constructor(private readonly deps: { periods: IPeriodRepository }) {}

  async closePeriod(workspaceId: string, periodId: string): Promise<Period> {
    const period = await this.require(workspaceId, periodId);
    if (period.status === "closed") fail("PERIOD_CLOSED", "Periode sudah dikunci");
    return this.deps.periods.setStatus(periodId, "closed");
  }

  /** Membuka kembali periode `closed`; alasan wajib dan tercatat di audit log. */
  async reopenPeriod(workspaceId: string, periodId: string, reason: string): Promise<Period> {
    const period = await this.require(workspaceId, periodId);
    if (period.status === "open") fail("INVALID_DATE", "Periode sudah terbuka");
    if (reason.trim().length < 5) {
      fail("EMPTY_REASON", "Alasan membuka kembali periode wajib diisi (minimal 5 karakter)");
    }
    return this.deps.periods.setStatus(periodId, "open", reason.trim());
  }

  /** 12 periode bulanan untuk tahun setelah periode terakhir. */
  async addNextFiscalYear(workspaceId: string): Promise<Period[]> {
    const periods = await this.deps.periods.listByWorkspace(workspaceId);
    if (periods.length === 0) fail("PERIOD_NOT_FOUND", "Workspace belum memiliki periode");
    const lastYear = Math.max(...periods.map((p) => yearOf(p.endDate)));
    return this.deps.periods.createMany(workspaceId, monthlyPeriodsForYear(lastYear + 1));
  }

  private async require(workspaceId: string, periodId: string): Promise<Period> {
    const period = (await this.deps.periods.listByWorkspace(workspaceId)).find((p) => p.id === periodId);
    if (!period) fail("NOT_FOUND", "Periode tidak ditemukan");
    return period;
  }
}
