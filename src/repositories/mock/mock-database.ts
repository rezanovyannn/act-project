import type { Account, AuditEntity, AuditLog, BusinessProfile, CateringOrder, CateringPackage, Contact, Invoice, OrderBill, Item, JournalEntry, Menu, MenuSaleLine, Period, PortionSummary, Recipe, StockCount, Workspace } from "@/core/types";

/** Subset API `localStorage` yang dipakai; memudahkan test dengan storage memori. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** Naikkan bila bentuk data berubah; data lama di browser akan diganti seed. */
export const MOCK_SCHEMA_VERSION = 13;
export const MOCK_STORAGE_KEY = "act-project:mock-db";

export interface MockState {
  schemaVersion: number;
  workspaces: Workspace[];
  accounts: Account[];
  periods: Period[];
  journals: JournalEntry[];
  items: Item[];
  /** Stok opname sisa bahan (ADR 020); dibatalkan = deletedAt terisi. */
  stockCounts: (StockCount & { deletedAt: string | null })[];
  /** Menu, resep, rekap porsi, penjualan menu (ADR 021). */
  menus: Menu[];
  recipes: (Recipe & { deletedAt: string | null })[];
  portionSummaries: (PortionSummary & { deletedAt: string | null })[];
  /** Rincian porsi penjualan menu; aktif selama jurnalnya belum di-void. */
  menuSales: { journalEntryId: string; workspaceId: string; lines: MenuSaleLine[] }[];
  /** Profil usaha, kontak, faktur (ADR 022). */
  profiles: BusinessProfile[];
  contacts: Contact[];
  invoices: (Invoice & { deletedAt: string | null })[];
  /** Pesanan katering & invoice DP (ADR 024). */
  cateringOrders: (CateringOrder & { deletedAt: string | null })[];
  orderBills: (OrderBill & { deletedAt: string | null })[];
  /** Paket menu katering (Fase 10C). */
  cateringPackages: CateringPackage[];
  auditLogs: AuditLog[];
}

export function emptyMockState(): MockState {
  return {
    schemaVersion: MOCK_SCHEMA_VERSION,
    workspaces: [],
    accounts: [],
    periods: [],
    journals: [],
    items: [],
    stockCounts: [],
    menus: [],
    recipes: [],
    portionSummaries: [],
    menuSales: [],
    profiles: [],
    contacts: [],
    invoices: [],
    cateringOrders: [],
    orderBills: [],
    cateringPackages: [],
    auditLogs: [],
  };
}

export interface MockDatabaseOptions {
  storage: KeyValueStorage;
  seed: () => MockState;
  storageKey?: string;
  now?: () => string;
  generateId?: () => string;
  /** Pengguna yang melakukan mutasi (Fase 2: auth.uid()). */
  actorId?: string;
}

export interface AuditInput {
  workspaceId: string;
  entityType: AuditEntity;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  reason?: string | null;
}

/**
 * Penyimpanan mock bersama untuk semua repository. Setiap mutasi dijalankan
 * pada salinan state lalu disimpan sekaligus, sehingga error di tengah
 * operasi tidak meninggalkan penulisan parsial (meniru transaksi DB).
 */
export class MockDatabase {
  private readonly storage: KeyValueStorage;
  private readonly seed: () => MockState;
  private readonly storageKey: string;
  readonly now: () => string;
  readonly generateId: () => string;
  readonly actorId: string;

  constructor(options: MockDatabaseOptions) {
    this.storage = options.storage;
    this.seed = options.seed;
    this.storageKey = options.storageKey ?? MOCK_STORAGE_KEY;
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.actorId = options.actorId ?? "system";
  }

  /** Mencatat audit log di dalam `write()` yang sama (atomik, meniru trigger DB). */
  audit(state: MockState, input: AuditInput): void {
    state.auditLogs.push({
      id: this.generateId(),
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      reason: input.reason ?? null,
      before: structuredClone(input.before ?? null),
      after: structuredClone(input.after ?? null),
      actorId: this.actorId,
      createdAt: this.now(),
    });
  }

  /** Salinan state terkini (aman dimodifikasi pemanggil). */
  read(): MockState {
    const raw = this.storage.getItem(this.storageKey);
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as MockState;
        if (parsed.schemaVersion === MOCK_SCHEMA_VERSION) return parsed;
      } catch {
        // Data rusak: jatuh ke seed di bawah.
      }
    }
    const seeded = this.seed();
    this.persist(seeded);
    return structuredClone(seeded);
  }

  /** Menjalankan mutasi secara atomik dan mengembalikan hasilnya. */
  write<T>(mutate: (state: MockState) => T): T {
    const state = this.read();
    const result = mutate(state);
    this.persist(state);
    return structuredClone(result);
  }

  /** Mengembalikan data ke dataset seed. */
  reset(): void {
    this.persist(this.seed());
  }

  private persist(state: MockState): void {
    this.storage.setItem(this.storageKey, JSON.stringify(state));
  }
}
