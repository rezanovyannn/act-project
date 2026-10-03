import type { IAccountRepository, IItemRepository, IJournalRepository, IStockCountRepository, IWorkspaceRepository } from "../ports";
import { fail } from "../errors";
import { buildStockCount, rowsOfSavedCount, type CountContext, type CountRow, type StockCountPlan } from "../stock-count";
import type { IsoDate, StockCount, StockValuation, Workspace } from "../types";

/** Stok opname sisa bahan & tabel COGS (ADR 020). */
export class StockCountService {
  constructor(
    private readonly deps: {
      workspaces: IWorkspaceRepository;
      accounts: IAccountRepository;
      items: IItemRepository;
      journals: IJournalRepository;
      stockCounts: IStockCountRepository;
    },
  ) {}

  async context(workspaceId: string): Promise<CountContext & { workspace: Workspace }> {
    const [workspace, accounts, items, entries, counts] = await Promise.all([
      this.deps.workspaces.getById(workspaceId),
      this.deps.accounts.listByWorkspace(workspaceId),
      this.deps.items.listByWorkspace(workspaceId),
      this.deps.journals.listByWorkspace(workspaceId),
      this.deps.stockCounts.listByWorkspace(workspaceId),
    ]);
    if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
    return { workspace, accounts, items, entries, counts };
  }

  /** Validasi & simpan: jurnal penyesuaian HPP + stok opname, atomik di repository. */
  async post(workspaceId: string, countDate: IsoDate, quantities: ReadonlyMap<string, number>): Promise<{ count: StockCount; plan: StockCountPlan }> {
    const context = await this.context(workspaceId);
    if (context.workspace.inventoryMethod !== "periodic") {
      fail("INVALID_STOCK_COUNT", "Stok opname sisa bahan untuk metode periodik; workspace perpetual memakai stok opname per barang");
    }
    const valuation: StockValuation = context.workspace.stockValuation;
    const plan = buildStockCount(context, { workspaceId, countDate, valuation, quantities });
    const count = await this.deps.stockCounts.post(plan.count, plan.journal);
    return { count, plan };
  }

  async rows(workspaceId: string, countId: string): Promise<CountRow[]> {
    const context = await this.context(workspaceId);
    const count = context.counts.find((c) => c.id === countId);
    if (!count) fail("NOT_FOUND", "Stok opname tidak ditemukan");
    return rowsOfSavedCount(context, count);
  }

  cancel(countId: string, reversalDate: IsoDate): Promise<void> {
    return this.deps.stockCounts.cancel(countId, reversalDate);
  }

  /** Dasar nilai stok akhir per workspace (ADR 020). */
  async setValuation(workspaceId: string, stockValuation: StockValuation): Promise<Workspace> {
    const workspace = await this.deps.workspaces.getById(workspaceId);
    if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
    if (stockValuation !== "average" && stockValuation !== "last") fail("INVALID_STOCK_COUNT", "Metode nilai stok tidak dikenal");
    return this.deps.workspaces.updateInventorySettings(workspaceId, {
      inventoryMethod: workspace.inventoryMethod,
      costMethodHistory: workspace.costMethodHistory,
      stockValuation,
    });
  }
}
