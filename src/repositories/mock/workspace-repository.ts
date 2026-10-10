import { fail } from "@/core/errors";
import type { PeriodRange } from "@/core/periods";
import type { InventorySettings, IWorkspaceRepository, NewWorkspace } from "@/core/ports";
import { assertValidTaxSettings, type WorkspaceTaxSettings } from "@/core/sales-tax";
import type { WorkspaceBackup } from "@/core/backup";
import { parseBackup } from "@/core/backup-restore";
import type { AccountSeed, Workspace, CateringSettings } from "@/core/types";
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
        salesTaxLabel: input.salesTax.label,
        salesTaxRateBps: input.salesTax.rateBps,
        salesTaxInclusive: input.salesTax.inclusive,
        salesTaxMode: input.salesTax.mode,
        vatDppNumerator: input.salesTax.dppNumerator,
        vatDppDenominator: input.salesTax.dppDenominator,
        inventoryMethod: "periodic",
        costMethodHistory: [],
        stockValuation: "average",
        cateringSettings: { costMode: "detail", pph23Enabled: false, pph23RateBps: 200 },
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

  async updateSalesTaxSettings(id: string, settings: WorkspaceTaxSettings): Promise<Workspace> {
    return this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      assertValidTaxSettings(settings);
      const before = { ...workspace };
      workspace.salesTaxLabel = settings.label;
      workspace.salesTaxMode = settings.mode;
      workspace.vatDppNumerator = settings.dppNumerator;
      workspace.vatDppDenominator = settings.dppDenominator;
      workspace.salesTaxRateBps = settings.rateBps;
      workspace.salesTaxInclusive = settings.inclusive;
      workspace.updatedAt = this.db.now();
      this.db.audit(state, { workspaceId: id, entityType: "workspace", entityId: id, action: "update_tax_settings", before, after: workspace });
      return workspace;
    });
  }

  async updateCateringSettings(id: string, settings: CateringSettings): Promise<Workspace> {
    return this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      // Meniru constraint kolom workspaces (Fase 10B).
      const rateOk = Number.isSafeInteger(settings.pph23RateBps) && settings.pph23RateBps >= 1 && settings.pph23RateBps <= 10_000;
      if (!["detail", "materials"].includes(settings.costMode) || !rateOk) fail("INVALID_AMOUNT", "Pengaturan katering tidak valid");
      const before = { ...workspace };
      workspace.cateringSettings = { costMode: settings.costMode, pph23Enabled: settings.pph23Enabled, pph23RateBps: settings.pph23RateBps };
      workspace.updatedAt = this.db.now();
      this.db.audit(state, { workspaceId: id, entityType: "workspace", entityId: id, action: "update", before, after: workspace });
      return workspace;
    });
  }

  async updateInventorySettings(id: string, settings: InventorySettings): Promise<Workspace> {
    return this.db.write((state) => {
      const workspace = state.workspaces.find((w) => w.id === id && w.deletedAt === null);
      if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
      const before = { ...workspace, costMethodHistory: [...workspace.costMethodHistory] };
      workspace.inventoryMethod = settings.inventoryMethod;
      workspace.costMethodHistory = settings.costMethodHistory.map((h) => ({ ...h }));
      if (settings.stockValuation) workspace.stockValuation = settings.stockValuation;
      workspace.updatedAt = this.db.now();
      this.db.audit(state, { workspaceId: id, entityType: "workspace", entityId: id, action: "update_inventory_settings", before, after: workspace });
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

  /** Meniru RPC restore_workspace (ADR 023): validasi ulang, ID baru, isi persis, atomik. */
  async restoreFromBackup(ownerId: string, name: string, raw: WorkspaceBackup): Promise<Workspace> {
    const { backup } = parseBackup(raw, ["fnb", "retail", "catering"]);
    if (name.trim() === "") fail("EMPTY_NAME", "Nama workspace wajib diisi");
    return this.db.write((state) => {
      const ids = new Map<string, string>();
      const id = (old: string) => {
        let mapped = ids.get(old);
        if (!mapped) ids.set(old, (mapped = this.db.generateId()));
        return mapped;
      };
      const ref = (old: string | null | undefined) => (old ? id(old) : null);
      const now = this.db.now();
      const source = backup.workspace;
      const workspace: Workspace = {
        ...source,
        cateringSettings: source.cateringSettings ?? { costMode: "detail", pph23Enabled: false, pph23RateBps: 200 },
        id: id(source.id),
        ownerId,
        name: name.trim(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const wsId = workspace.id;
      state.workspaces.push(workspace);
      state.accounts.push(...backup.accounts.map((a) => ({ ...a, id: id(a.id), workspaceId: wsId })));
      state.periods.push(...backup.periods.map((p) => ({ ...p, id: id(p.id), workspaceId: wsId })));
      state.items.push(...backup.items.map((i) => ({ ...i, estimatedPrice: i.estimatedPrice ?? null, estimatedPer: i.estimatedPer ?? 1, id: id(i.id), workspaceId: wsId, revenueAccountId: ref(i.revenueAccountId) })));
      state.journals.push(
        ...backup.journals.map((j) => ({
          ...j,
          id: id(j.id),
          workspaceId: wsId,
          settlementOf: ref(j.settlementOf),
          reversalOf: ref(j.reversalOf),
          correctionOf: ref(j.correctionOf),
          returnOf: ref(j.returnOf),
          lines: j.lines.map((l) => ({ ...l, id: id(l.id), accountId: l.accountId ? id(l.accountId) : l.accountId, itemId: ref(l.itemId), orderId: ref(l.orderId ?? null) })),
        })),
      );
      state.stockCounts.push(
        ...backup.stockCounts.map((c) => ({
          ...c,
          id: id(c.id),
          workspaceId: wsId,
          journalEntryId: ref(c.journalEntryId),
          lines: c.lines.map((l) => ({ ...l, itemId: id(l.itemId) })),
          deletedAt: null,
        })),
      );
      state.menus.push(...backup.menus.map((m) => ({ ...m, id: id(m.id), workspaceId: wsId, revenueAccountId: ref(m.revenueAccountId) })));
      state.recipes.push(
        ...backup.recipes.map((r) => ({ ...r, id: id(r.id), workspaceId: wsId, menuId: id(r.menuId), lines: r.lines.map((l) => ({ ...l, itemId: id(l.itemId) })), deletedAt: null })),
      );
      state.portionSummaries.push(
        ...backup.portionSummaries.map((p) => ({ ...p, id: id(p.id), workspaceId: wsId, lines: p.lines.map((l) => ({ ...l, menuId: id(l.menuId) })), deletedAt: null })),
      );
      state.menuSales.push(
        ...backup.menuSales.map((m) => ({ journalEntryId: id(m.journalEntryId), workspaceId: wsId, lines: m.lines.map((l) => ({ ...l, menuId: id(l.menuId) })) })),
      );
      if (backup.profile) state.profiles.push({ ...backup.profile, workspaceId: wsId });
      state.contacts.push(...backup.contacts.map((c) => ({ ...c, id: id(c.id), workspaceId: wsId })));
      state.invoices.push(
        ...backup.invoices.map((inv) => ({
          ...inv,
          id: id(inv.id),
          workspaceId: wsId,
          contactId: ref(inv.contactId),
          journalEntryId: ref(inv.journalEntryId),
          lines: inv.lines.map((l) => ({ ...l, accountId: l.accountId ? id(l.accountId) : "", itemId: ref(l.itemId) })),
          deletedAt: null,
        })),
      );
      state.cateringOrders.push(
        ...(backup.cateringOrders ?? []).map((o) => ({
          ...o,
          id: id(o.id),
          workspaceId: wsId,
          contactId: id(o.contactId),
          invoiceId: ref(o.invoiceId),
          lines: o.lines.map((l) => ({ ...l, accountId: l.accountId ? id(l.accountId) : "", packageId: ref(l.packageId ?? null) })),
          deletedAt: null,
        })),
      );
      state.cateringPackages.push(
        ...(backup.cateringPackages ?? []).map((p) => ({
          ...p,
          id: id(p.id),
          workspaceId: wsId,
          revenueAccountId: ref(p.revenueAccountId),
          lines: p.lines.map((l) => ({ ...l, itemId: id(l.itemId) })),
        })),
      );
      state.orderBills.push(...(backup.orderBills ?? []).map((b) => ({ ...b, id: id(b.id), workspaceId: wsId, orderId: id(b.orderId), deletedAt: null })));
      // Riwayat audit lama ikut, entity_id dipetakan; lalu satu catatan pemulihan.
      state.auditLogs.push(
        ...backup.auditLogs.map((log) => ({
          ...log,
          id: this.db.generateId(),
          workspaceId: wsId,
          entityId: log.entityType === "workspace" ? wsId : ids.get(log.entityId) ?? log.entityId,
        })),
      );
      this.db.audit(state, {
        workspaceId: wsId,
        entityType: "workspace",
        entityId: wsId,
        action: "restore",
        before: null,
        after: workspace,
        reason: `Dipulihkan dari backup "${source.name}" (${backup.exportedAt})`,
      });
      return workspace;
    });
  }
}
