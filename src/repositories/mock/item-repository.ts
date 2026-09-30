import { fail } from "@/core/errors";
import type { IItemRepository, ItemPatch } from "@/core/ports";
import type { Item, ItemInput } from "@/core/types";
import type { MockDatabase, MockState } from "./mock-database";

function isUsedByJournal(state: MockState, itemId: string): boolean {
  return state.journals.some((entry) => entry.deletedAt === null && entry.lines.some((line) => line.itemId === itemId));
}

function assertUniqueCode(state: MockState, workspaceId: string, code: string, exceptId?: string): void {
  const taken = state.items.some(
    (i) => i.workspaceId === workspaceId && i.deletedAt === null && i.code === code && i.id !== exceptId,
  );
  if (taken) fail("DUPLICATE_ITEM_CODE", `Kode barang ${code} sudah dipakai`);
}

/** Master barang di localStorage (ADR 017). */
export class MockItemRepository implements IItemRepository {
  constructor(private readonly db: MockDatabase) {}

  async listByWorkspace(workspaceId: string): Promise<Item[]> {
    return this.db
      .read()
      .items.filter((i) => i.workspaceId === workspaceId && i.deletedAt === null)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async getById(id: string): Promise<Item | null> {
    return this.db.read().items.find((i) => i.id === id && i.deletedAt === null) ?? null;
  }

  async create(workspaceId: string, input: ItemInput): Promise<Item> {
    return this.db.write((state) => {
      assertUniqueCode(state, workspaceId, input.code);
      const now = this.db.now();
      const item: Item = {
        ...input,
        id: this.db.generateId(),
        workspaceId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      state.items.push(item);
      this.db.audit(state, { workspaceId, entityType: "item", entityId: item.id, action: "create", before: null, after: item });
      return item;
    });
  }

  async update(id: string, patch: ItemPatch): Promise<Item> {
    return this.db.write((state) => {
      const item = state.items.find((i) => i.id === id && i.deletedAt === null);
      if (!item) fail("ITEM_NOT_FOUND", "Barang tidak ditemukan");
      if (patch.code !== undefined) assertUniqueCode(state, item.workspaceId, patch.code, id);
      const before = { ...item };
      Object.assign(item, patch, { updatedAt: this.db.now() });
      this.db.audit(state, { workspaceId: item.workspaceId, entityType: "item", entityId: id, action: "update", before, after: item });
      return item;
    });
  }

  async softDelete(id: string): Promise<void> {
    this.db.write((state) => {
      const item = state.items.find((i) => i.id === id && i.deletedAt === null);
      if (!item) fail("ITEM_NOT_FOUND", "Barang tidak ditemukan");
      if (isUsedByJournal(state, id)) fail("ITEM_IN_USE", "Barang sudah dipakai jurnal; nonaktifkan saja, tidak bisa dihapus");
      item.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: item.workspaceId, entityType: "item", entityId: id, action: "delete", before: item, after: null });
    });
  }

  async hasJournalLines(id: string): Promise<boolean> {
    return isUsedByJournal(this.db.read(), id);
  }
}
