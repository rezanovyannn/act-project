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
      const audit = (entityType: "workspace" | "account" | "period", entity: { id: string }) =>
        this.db.audit(state, { workspaceId: workspace.id, entityType, entityId: entity.id, action: "create", before: null, after: entity });
      audit("workspace", workspace);
      for (const seed of accounts) {
        const account = {
          ...seed,
          id: this.db.generateId(),
          workspaceId: workspace.id,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.accounts.push(account);
        audit("account", account);
      }
      for (const range of periods) {
        const period = {
          ...range,
          id: this.db.generateId(),
          workspaceId: workspace.id,
          status: "open" as const,
          createdAt: now,
          updatedAt: now,
        };
        state.periods.push(period);
        audit("period", period);
      }
      return workspace;
    });
  }

  async rename(id: string, name: string): Promise<Workspace> {
    return this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      const before = { ...workspace };
      workspace.name = name;
      workspace.updatedAt = this.db.now();
      this.db.audit(state, { workspaceId: id, entityType: "workspace", entityId: id, action: "update", before, after: workspace });
      return workspace;
    });
  }

  async updateSalesTaxSettings(id: string, settings: SalesTaxSettings): Promise<Workspace> {
    return this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      const before = { ...workspace };
      workspace.salesTaxRateBps = settings.rateBps;
      workspace.salesTaxInclusive = settings.inclusive;
      workspace.updatedAt = this.db.now();
      this.db.audit(state, { workspaceId: id, entityType: "workspace", entityId: id, action: "update_tax_settings", before, after: workspace });
      return workspace;
    });
  }

  async softDelete(id: string): Promise<void> {
    this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      workspace.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: id, entityType: "workspace", entityId: id, action: "delete", before: null, after: workspace });
    });
  }
}
