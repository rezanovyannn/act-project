import { isValidIsoDate } from "@/core/dates";
import { fail } from "@/core/errors";
import type { IMenuRepository, MenuPatch } from "@/core/ports";
import type {
  JournalEntry,
  JournalEntryInput,
  Menu,
  MenuInput,
  MenuSale,
  MenuSaleLine,
  PortionSummary,
  PortionSummaryInput,
  Recipe,
  RecipeInput,
} from "@/core/types";
import type { MockJournalRepository } from "./journal-repository";
import type { MockDatabase, MockState } from "./mock-database";

type Deleted<T> = T & { deletedAt: string | null };
const strip = <T extends { deletedAt: string | null }>({ deletedAt: _deleted, ...rest }: T): Omit<T, "deletedAt"> => rest; // eslint-disable-line @typescript-eslint/no-unused-vars

const reversedIds = (state: MockState) =>
  new Set(state.journals.filter((j) => j.status === "posted" && j.deletedAt === null && j.reversalOf).map((j) => j.reversalOf));

function activeSales(state: MockState, workspaceId: string): MockState["menuSales"] {
  const reversed = reversedIds(state);
  return state.menuSales.filter((s) => s.workspaceId === workspaceId && !reversed.has(s.journalEntryId));
}

function assertUniqueCode(state: MockState, workspaceId: string, code: string, exceptId?: string): void {
  const taken = state.menus.some((m) => m.workspaceId === workspaceId && m.deletedAt === null && m.code === code && m.id !== exceptId);
  if (taken) fail("DUPLICATE_MENU_CODE", `Kode menu ${code} sudah dipakai`);
}

function requireMenu(state: MockState, id: string, workspaceId?: string): Menu {
  const menu = state.menus.find((m) => m.id === id && m.deletedAt === null && (!workspaceId || m.workspaceId === workspaceId));
  if (!menu) fail("MENU_NOT_FOUND", "Menu tidak ditemukan");
  return menu;
}

const isCount = (n: number) => Number.isSafeInteger(n) && n > 0;

/** Menu, resep, rekap porsi, penjualan menu di localStorage; meniru RPC ADR 021. */
export class MockMenuRepository implements IMenuRepository {
  constructor(
    private readonly db: MockDatabase,
    private readonly journals: MockJournalRepository,
  ) {}

  async listMenus(workspaceId: string): Promise<Menu[]> {
    return this.db
      .read()
      .menus.filter((m) => m.workspaceId === workspaceId && m.deletedAt === null)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async getMenu(id: string): Promise<Menu | null> {
    return this.db.read().menus.find((m) => m.id === id && m.deletedAt === null) ?? null;
  }

  async createMenu(workspaceId: string, input: MenuInput): Promise<Menu> {
    return this.db.write((state) => {
      assertUniqueCode(state, workspaceId, input.code);
      const now = this.db.now();
      const menu: Menu = {
        code: input.code,
        name: input.name,
        category: input.category ?? null,
        price: input.price,
        revenueAccountId: input.revenueAccountId,
        id: this.db.generateId(),
        workspaceId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      state.menus.push(menu);
      this.db.audit(state, { workspaceId, entityType: "menu", entityId: menu.id, action: "create", before: null, after: menu });
      return menu;
    });
  }

  async updateMenu(id: string, patch: MenuPatch): Promise<Menu> {
    return this.db.write((state) => {
      const menu = requireMenu(state, id);
      if (patch.code !== undefined) assertUniqueCode(state, menu.workspaceId, patch.code, id);
      const before = { ...menu };
      Object.assign(menu, patch, { updatedAt: this.db.now() });
      this.db.audit(state, { workspaceId: menu.workspaceId, entityType: "menu", entityId: id, action: "update", before, after: menu });
      return menu;
    });
  }

  async deleteMenu(id: string): Promise<void> {
    this.db.write((state) => {
      const menu = requireMenu(state, id);
      const used =
        activeSales(state, menu.workspaceId).some((s) => s.lines.some((l) => l.menuId === id)) ||
        state.portionSummaries.some((s) => s.deletedAt === null && s.lines.some((l) => l.menuId === id));
      if (used) fail("MENU_IN_USE", "Menu sudah punya penjualan/rekap porsi; nonaktifkan saja, tidak bisa dihapus");
      menu.deletedAt = this.db.now();
      for (const recipe of state.recipes) if (recipe.menuId === id && recipe.deletedAt === null) recipe.deletedAt = menu.deletedAt;
      this.db.audit(state, { workspaceId: menu.workspaceId, entityType: "menu", entityId: id, action: "delete", before: menu, after: null });
    });
  }

  async listRecipes(workspaceId: string): Promise<Recipe[]> {
    return this.db
      .read()
      .recipes.filter((r) => r.workspaceId === workspaceId && r.deletedAt === null)
      .sort((a, b) => a.menuId.localeCompare(b.menuId) || a.effectiveFrom.localeCompare(b.effectiveFrom))
      .map(strip);
  }

  async saveRecipe(input: RecipeInput): Promise<Recipe> {
    return this.db.write((state) => {
      requireMenu(state, input.menuId, input.workspaceId);
      if (!isValidIsoDate(input.effectiveFrom)) fail("INVALID_DATE", "Tanggal berlaku resep tidak valid");
      if (!isCount(input.yieldPortions)) fail("INVALID_RECIPE", "Jumlah porsi resep harus bilangan bulat ≥ 1");
      if (input.lines.length === 0) fail("INVALID_RECIPE", "Resep minimal berisi satu bahan");
      const seen = new Set<string>();
      for (const line of input.lines) {
        const item = state.items.find((i) => i.id === line.itemId && i.workspaceId === input.workspaceId && i.deletedAt === null);
        if (!item) fail("ITEM_NOT_FOUND", "Bahan pada resep tidak ditemukan");
        if (seen.has(item.id)) fail("INVALID_RECIPE", `${item.name} muncul dua kali di resep`);
        seen.add(item.id);
        if (!isCount(line.quantity)) fail("INVALID_QUANTITY", `${item.name}: qty harus bilangan bulat > 0`);
      }
      const now = this.db.now();
      for (const old of state.recipes) {
        if (old.menuId === input.menuId && old.effectiveFrom === input.effectiveFrom && old.deletedAt === null) {
          old.deletedAt = now;
          this.db.audit(state, { workspaceId: old.workspaceId, entityType: "recipe", entityId: old.id, action: "delete", before: old, after: null });
        }
      }
      const recipe: Deleted<Recipe> = { ...input, lines: input.lines.map((l) => ({ ...l })), id: this.db.generateId(), createdAt: now, deletedAt: null };
      state.recipes.push(recipe);
      this.db.audit(state, { workspaceId: input.workspaceId, entityType: "recipe", entityId: recipe.id, action: "create", before: null, after: recipe });
      return strip(recipe);
    });
  }

  async deleteRecipe(id: string): Promise<void> {
    this.db.write((state) => {
      const recipe = state.recipes.find((r) => r.id === id && r.deletedAt === null);
      if (!recipe) fail("NOT_FOUND", "Resep tidak ditemukan");
      recipe.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: recipe.workspaceId, entityType: "recipe", entityId: id, action: "delete", before: recipe, after: null });
    });
  }

  async listPortionSummaries(workspaceId: string): Promise<PortionSummary[]> {
    return this.db
      .read()
      .portionSummaries.filter((s) => s.workspaceId === workspaceId && s.deletedAt === null)
      .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
      .map(strip);
  }

  async createPortionSummary(input: PortionSummaryInput): Promise<PortionSummary> {
    return this.db.write((state) => {
      if (!isValidIsoDate(input.dateFrom) || !isValidIsoDate(input.dateTo) || input.dateFrom > input.dateTo) {
        fail("INVALID_DATE", "Rentang tanggal rekap tidak valid");
      }
      const overlap = state.portionSummaries.find(
        (s) => s.workspaceId === input.workspaceId && s.deletedAt === null && s.dateFrom <= input.dateTo && input.dateFrom <= s.dateTo,
      );
      if (overlap) fail("INVALID_PORTION_SUMMARY", `Rentang bertumpuk dengan rekap ${overlap.dateFrom} s.d. ${overlap.dateTo}`);
      if (input.lines.length === 0) fail("INVALID_PORTION_SUMMARY", "Isi porsi minimal satu menu");
      const seen = new Set<string>();
      for (const line of input.lines) {
        const menu = requireMenu(state, line.menuId, input.workspaceId);
        if (seen.has(menu.id)) fail("INVALID_PORTION_SUMMARY", `${menu.name} muncul dua kali di rekap`);
        seen.add(menu.id);
        if (!isCount(line.portions)) fail("INVALID_QUANTITY", `${menu.name}: porsi harus bilangan bulat > 0`);
      }
      const summary: Deleted<PortionSummary> = {
        ...input,
        lines: input.lines.map((l) => ({ ...l })),
        id: this.db.generateId(),
        createdAt: this.db.now(),
        deletedAt: null,
      };
      state.portionSummaries.push(summary);
      this.db.audit(state, { workspaceId: input.workspaceId, entityType: "portion_summary", entityId: summary.id, action: "create", before: null, after: summary });
      return strip(summary);
    });
  }

  async deletePortionSummary(id: string): Promise<void> {
    this.db.write((state) => {
      const summary = state.portionSummaries.find((s) => s.id === id && s.deletedAt === null);
      if (!summary) fail("NOT_FOUND", "Rekap porsi tidak ditemukan");
      summary.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: summary.workspaceId, entityType: "portion_summary", entityId: id, action: "delete", before: summary, after: null });
    });
  }

  async listMenuSales(workspaceId: string): Promise<MenuSale[]> {
    const state = this.db.read();
    return activeSales(state, workspaceId)
      .map((sale) => {
        const entry = state.journals.find((j) => j.id === sale.journalEntryId);
        return { journalEntryId: sale.journalEntryId, workspaceId, entryDate: entry?.entryDate ?? "", lines: sale.lines.map((l) => ({ ...l })) };
      })
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  }

  async postMenuSale(journal: JournalEntryInput, lines: MenuSaleLine[]): Promise<JournalEntry> {
    return this.db.write((state) => {
      if (journal.source !== "revenue") fail("INVALID_ACCOUNT", "Jurnal penjualan menu harus bersumber penjualan");
      if (lines.length === 0) fail("LINE_ZERO", "Isi minimal satu menu");
      for (const line of lines) {
        const menu = requireMenu(state, line.menuId, journal.workspaceId);
        if (!menu.isActive) fail("MENU_INACTIVE", `${menu.name} nonaktif`);
        if (!isCount(line.portions) || !isCount(line.amount)) fail("INVALID_QUANTITY", `${menu.name}: porsi dan nominal harus bilangan bulat > 0`);
      }
      const entry = this.journals.postInState(state, journal);
      state.menuSales.push({ journalEntryId: entry.id, workspaceId: journal.workspaceId, lines: lines.map((l) => ({ ...l })) });
      return entry;
    });
  }
}
