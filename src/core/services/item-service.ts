import { fail } from "../errors";
import type { IAccountRepository, IItemRepository } from "../ports";
import type { Item, ItemInput } from "../types";

/**
 * Master barang (ADR 017): kode & nama wajib, satuan dasar wajib, akun
 * pendapatan default harus akun pendapatan. Barang ber-jurnal hanya dapat
 * dinonaktifkan, tidak dihapus (seperti akun, ADR 009).
 */
export class ItemService {
  constructor(private readonly deps: { items: IItemRepository; accounts: IAccountRepository }) {}

  async createItem(workspaceId: string, input: ItemInput): Promise<Item> {
    return this.deps.items.create(workspaceId, await this.validate(workspaceId, input));
  }

  async updateItem(id: string, input: ItemInput): Promise<Item> {
    const item = await this.require(id);
    return this.deps.items.update(id, await this.validate(item.workspaceId, input));
  }

  async setActive(id: string, isActive: boolean): Promise<Item> {
    await this.require(id);
    return this.deps.items.update(id, { isActive });
  }

  async deleteItem(id: string): Promise<void> {
    await this.require(id);
    if (await this.deps.items.hasJournalLines(id)) {
      fail("ITEM_IN_USE", "Barang sudah dipakai jurnal; nonaktifkan saja, tidak bisa dihapus");
    }
    await this.deps.items.softDelete(id);
  }

  private async validate(workspaceId: string, input: ItemInput): Promise<ItemInput> {
    const clean = {
      code: input.code.trim(),
      name: input.name.trim(),
      unit: input.unit.trim(),
      revenueAccountId: input.revenueAccountId || null,
      category: input.category?.trim() || null,
      estimatedPrice: input.estimatedPrice ?? null,
      estimatedPer: input.estimatedPer ?? 1,
    };
    if (clean.code === "") fail("EMPTY_NAME", "Kode barang wajib diisi");
    if (clean.name === "") fail("EMPTY_NAME", "Nama barang wajib diisi");
    if (clean.unit === "") fail("EMPTY_NAME", "Satuan dasar wajib diisi (mis. pcs, gram, ml)");
    // Harga perkiraan: Rp bulat ≥ 0 per jumlah satuan dasar bulat ≥ 1 (Fase 10C).
    if (clean.estimatedPrice !== null && (!Number.isSafeInteger(clean.estimatedPrice) || clean.estimatedPrice < 0)) {
      fail("INVALID_AMOUNT", "Harga perkiraan harus bilangan bulat ≥ 0");
    }
    if (!Number.isSafeInteger(clean.estimatedPer) || clean.estimatedPer < 1) fail("INVALID_QUANTITY", "Harga perkiraan per jumlah satuan minimal 1");
    if (clean.revenueAccountId) {
      const account = await this.deps.accounts.getById(clean.revenueAccountId);
      if (!account || account.workspaceId !== workspaceId || account.accountType !== "revenue") {
        fail("INVALID_ACCOUNT", "Akun pendapatan default harus akun pendapatan di workspace ini");
      }
    }
    return clean;
  }

  private async require(id: string): Promise<Item> {
    const item = await this.deps.items.getById(id);
    if (!item) fail("ITEM_NOT_FOUND", "Barang tidak ditemukan");
    return item;
  }
}
