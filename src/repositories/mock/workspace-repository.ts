import { fail } from "@/core/errors";
import type { PeriodRange } from "@/core/periods";
import type { IWorkspaceRepository, NewWorkspace } from "@/core/ports";
import type { SalesTaxSettings } from "@/core/sales-tax";
import type { AccountSeed, Workspace } from "@/core/types";
import type { MockDatabase } from "./mock-database";

export class MockWorkspaceRepository implements IWorkspaceRepository {
  constructor(private readonly db: MockDatabase) {}

  async listByOwner(ownerId: string): Promise<Workspace[]> {
    return this.db
      .read()
      .workspaces.filter((w) => w.ownerId === ownerId && w.deletedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name, "id"));
  }

  async getById(id: string): Promise<Workspace | null> {
    return this.db.read().workspaces.find((w) => w.id === id && w.deletedAt === null) ?? null;
  }

  async createWithSeed(
    input: NewWorkspace,
    accounts: AccountSeed[],
    periods: PeriodRange[],
  ): Promise<Workspace> {
    return this.db.write((state) => {
      const now = this.db.now();
      const workspace: Workspace = {
        id: this.db.generateId(),
        ownerId: input.ownerId,
        name: input.name,
        templateType: input.templateType,
        currency: "IDR",
        booksStartDate: input.booksStartDate,
        salesTaxRateBps: 1000,
        salesTaxInclusive: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      state.workspaces.push(workspace);
      for (const seed of accounts) {
        state.accounts.push({
          ...seed,
          id: this.db.generateId(),
          workspaceId: workspace.id,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
      for (const range of periods) {
        state.periods.push({
          ...range,
          id: this.db.generateId(),
          workspaceId: workspace.id,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
      }
      return workspace;
    });
  }

  async rename(id: string, name: string): Promise<Workspace> {
    return this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      workspace.name = name;
      workspace.updatedAt = this.db.now();
      return workspace;
    });
  }

  async updateSalesTaxSettings(id: string, settings: SalesTaxSettings): Promise<Workspace> {
    return this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      workspace.salesTaxRateBps = settings.rateBps;
      workspace.salesTaxInclusive = settings.inclusive;
      workspace.updatedAt = this.db.now();
      return workspace;
    });
  }

  async softDelete(id: string): Promise<void> {
    this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      workspace.deletedAt = this.db.now();
    });
  }
}
