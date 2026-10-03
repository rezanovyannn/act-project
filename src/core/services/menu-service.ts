import { fail } from "../errors";
import {
  analyzeVariance,
  buildMenuSale,
  validateMenuInput,
  validatePortionSummary,
  validateRecipe,
  type MenuContext,
  type MenuSaleInput,
  type MenuSalePlan,
  type VarianceAnalysis,
} from "../menu";
import type {
  IAccountRepository,
  IItemRepository,
  IJournalRepository,
  IMenuRepository,
  IStockCountRepository,
  IWorkspaceRepository,
  MenuPatch,
} from "../ports";
import type { JournalEntry, Menu, MenuInput, PortionSummary, PortionSummaryInput, Recipe, RecipeInput, Workspace } from "../types";
import type { JournalService } from "./journal-service";

/** Menu, resep, rekap porsi, penjualan menu, dan variance (ADR 021). */
export class MenuService {
  constructor(
    private readonly deps: {
      workspaces: IWorkspaceRepository;
      accounts: IAccountRepository;
      items: IItemRepository;
      journals: IJournalRepository;
      stockCounts: IStockCountRepository;
      menus: IMenuRepository;
      journalService: JournalService;
    },
  ) {}

  async context(workspaceId: string): Promise<MenuContext & { workspace: Workspace }> {
    const [workspace, accounts, items, entries, counts, menus, recipes, summaries, sales] = await Promise.all([
      this.deps.workspaces.getById(workspaceId),
      this.deps.accounts.listByWorkspace(workspaceId),
      this.deps.items.listByWorkspace(workspaceId),
      this.deps.journals.listByWorkspace(workspaceId),
      this.deps.stockCounts.listByWorkspace(workspaceId),
      this.deps.menus.listMenus(workspaceId),
      this.deps.menus.listRecipes(workspaceId),
      this.deps.menus.listPortionSummaries(workspaceId),
      this.deps.menus.listMenuSales(workspaceId),
    ]);
    if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
    return { workspace, accounts, items, entries, counts, menus, recipes, summaries, sales };
  }

  async createMenu(workspaceId: string, input: MenuInput): Promise<Menu> {
    const clean = validateMenuInput(input);
    await this.requireRevenueAccount(workspaceId, clean.revenueAccountId);
    return this.deps.menus.createMenu(workspaceId, clean);
  }

  async updateMenu(id: string, input: MenuInput): Promise<Menu> {
    const menu = await this.requireMenu(id);
    const clean = validateMenuInput(input);
    await this.requireRevenueAccount(menu.workspaceId, clean.revenueAccountId);
    return this.deps.menus.updateMenu(id, clean);
  }

  async setActive(id: string, isActive: boolean): Promise<Menu> {
    await this.requireMenu(id);
    const patch: MenuPatch = { isActive };
    return this.deps.menus.updateMenu(id, patch);
  }

  async deleteMenu(id: string): Promise<void> {
    await this.requireMenu(id);
    await this.deps.menus.deleteMenu(id);
  }

  async saveRecipe(input: RecipeInput): Promise<Recipe> {
    const menu = await this.requireMenu(input.menuId);
    if (menu.workspaceId !== input.workspaceId) fail("MENU_NOT_FOUND", "Menu tidak ditemukan di workspace ini");
    const items = await this.deps.items.listByWorkspace(input.workspaceId);
    return this.deps.menus.saveRecipe(validateRecipe(input, items));
  }

  deleteRecipe(id: string): Promise<void> {
    return this.deps.menus.deleteRecipe(id);
  }

  async createPortionSummary(input: PortionSummaryInput): Promise<PortionSummary> {
    const [menus, existing] = await Promise.all([
      this.deps.menus.listMenus(input.workspaceId),
      this.deps.menus.listPortionSummaries(input.workspaceId),
    ]);
    return this.deps.menus.createPortionSummary(validatePortionSummary(input, menus, existing));
  }

  deletePortionSummary(id: string): Promise<void> {
    return this.deps.menus.deletePortionSummary(id);
  }

  /** Pratinjau jurnal penjualan menu (dipakai form). */
  async planSale(input: MenuSaleInput): Promise<MenuSalePlan> {
    const [menus, accounts] = await Promise.all([
      this.deps.menus.listMenus(input.workspaceId),
      this.deps.accounts.listByWorkspace(input.workspaceId),
    ]);
    return buildMenuSale(input, menus, accounts);
  }

  /** Validasi jurnal (periode, akun, keseimbangan) lalu simpan atomik bersama porsinya. */
  async postSale(input: MenuSaleInput): Promise<JournalEntry> {
    const plan = await this.planSale(input);
    await this.deps.journalService.validateForPosting(plan.entry);
    return this.deps.menus.postMenuSale(plan.entry, plan.lines);
  }

  async variance(workspaceId: string, countId: string): Promise<VarianceAnalysis> {
    const ctx = await this.context(workspaceId);
    const count = ctx.counts.find((c) => c.id === countId);
    if (!count) fail("NOT_FOUND", "Stok opname tidak ditemukan");
    return analyzeVariance(ctx, count);
  }

  private async requireMenu(id: string): Promise<Menu> {
    const menu = await this.deps.menus.getMenu(id);
    if (!menu) fail("MENU_NOT_FOUND", "Menu tidak ditemukan");
    return menu;
  }

  private async requireRevenueAccount(workspaceId: string, accountId: string | null): Promise<void> {
    if (!accountId) return;
    const account = await this.deps.accounts.getById(accountId);
    if (!account || account.workspaceId !== workspaceId || account.accountType !== "revenue") {
      fail("INVALID_ACCOUNT", "Akun pendapatan menu harus akun pendapatan di workspace ini");
    }
  }
}
