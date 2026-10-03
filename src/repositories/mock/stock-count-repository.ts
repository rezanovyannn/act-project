import { isValidIsoDate } from "@/core/dates";
import { fail } from "@/core/errors";
import type { IStockCountRepository } from "@/core/ports";
import { buildReversalInput } from "@/core/reversal";
import type { IsoDate, JournalEntryInput, StockCount, StockCountInput } from "@/core/types";
import type { MockJournalRepository } from "./journal-repository";
import type { MockDatabase, MockState } from "./mock-database";

const strip = ({ deletedAt: _deleted, ...count }: StockCount & { deletedAt: string | null }): StockCount => count; // eslint-disable-line @typescript-eslint/no-unused-vars

/** Aktif = belum dibatalkan dan jurnalnya (bila ada) belum di-void (ADR 020). */
function activeCounts(state: MockState, workspaceId: string) {
  const reversed = new Set(state.journals.filter((j) => j.status === "posted" && j.deletedAt === null && j.reversalOf).map((j) => j.reversalOf));
  return state.stockCounts
    .filter((c) => c.workspaceId === workspaceId && c.deletedAt === null && !(c.journalEntryId && reversed.has(c.journalEntryId)))
    .sort((a, b) => a.countDate.localeCompare(b.countDate));
}

/** Stok opname sisa bahan di localStorage; meniru RPC post/cancel_stock_count (ADR 020). */
export class MockStockCountRepository implements IStockCountRepository {
  constructor(
    private readonly db: MockDatabase,
    private readonly journals: MockJournalRepository,
  ) {}

  async listByWorkspace(workspaceId: string): Promise<StockCount[]> {
    return activeCounts(this.db.read(), workspaceId).map(strip);
  }

  async post(input: StockCountInput, journal: JournalEntryInput | null): Promise<StockCount> {
    return this.db.write((state) => {
      if (!isValidIsoDate(input.countDate)) fail("INVALID_DATE", "Tanggal stok opname tidak valid");
      if (input.valuation !== "average" && input.valuation !== "last") fail("INVALID_STOCK_COUNT", "Metode nilai stok tidak dikenal");
      const latest = activeCounts(state, input.workspaceId).at(-1);
      if (latest && input.countDate <= latest.countDate) {
        fail("INVALID_STOCK_COUNT", `Tanggal stok opname harus setelah stok opname terakhir (${latest.countDate})`);
      }
      const seen = new Set<string>();
      for (const line of input.lines) {
        const item = state.items.find((i) => i.id === line.itemId && i.workspaceId === input.workspaceId && i.deletedAt === null);
        if (!item) fail("ITEM_NOT_FOUND", "Barang pada stok opname tidak ditemukan");
        if (seen.has(line.itemId)) fail("INVALID_STOCK_COUNT", "Barang yang sama muncul dua kali");
        seen.add(line.itemId);
        const ok = (n: number) => Number.isSafeInteger(n) && n >= 0;
        if (!ok(line.quantity) || !ok(line.value)) fail("INVALID_QUANTITY", `${item.code}: qty dan nilai harus bilangan bulat ≥ 0`);
      }
      let journalEntryId: string | null = null;
      if (journal) {
        if (journal.workspaceId !== input.workspaceId || journal.source !== "adjustment" || journal.entryDate !== input.countDate) {
          fail("INVALID_STOCK_COUNT", "Jurnal stok opname harus penyesuaian bertanggal sama dengan stok opname");
        }
        journalEntryId = this.journals.postInState(state, journal).id;
      }
      const count = {
        ...input,
        lines: input.lines.map((l) => ({ ...l })),
        id: this.db.generateId(),
        journalEntryId,
        createdAt: this.db.now(),
        deletedAt: null,
      };
      state.stockCounts.push(count);
      return strip(count);
    });
  }

  async cancel(id: string, reversalDate: IsoDate): Promise<void> {
    this.db.write((state) => {
      const count = state.stockCounts.find((c) => c.id === id && c.deletedAt === null);
      if (!count) fail("NOT_FOUND", "Stok opname tidak ditemukan");
      if (activeCounts(state, count.workspaceId).at(-1)?.id !== id) {
        fail("INVALID_STOCK_COUNT", "Hanya stok opname terakhir yang dapat dibatalkan");
      }
      if (count.journalEntryId) {
        const original = state.journals.find((j) => j.id === count.journalEntryId && j.deletedAt === null);
        const reversed = state.journals.some((j) => j.reversalOf === count.journalEntryId && j.status === "posted" && j.deletedAt === null);
        if (original && !reversed) {
          this.journals.postInState(state, buildReversalInput(original, reversalDate, `Pembatalan stok opname ${count.countDate}`));
        }
      }
      count.deletedAt = this.db.now();
    });
  }
}
