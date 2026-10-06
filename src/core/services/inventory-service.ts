import { fail } from "../errors";
import { isValidIsoDate } from "../dates";
import { buildPerpetualTransition, type OpeningCount, type PerpetualContext } from "../perpetual";
import type { IAccountRepository, IItemRepository, IJournalRepository, IWorkspaceRepository } from "../ports";
import { inventoryReconciliation, stockAt, type InventoryReconciliation } from "../stock";
import type { Account, AccountSeed, CostMethod, CostMethodPeriod, IsoDate, Item, JournalEntry, Workspace } from "../types";
import type { JournalService } from "./journal-service";

/** Akun Retur & Potongan Penjualan, dibuat otomatis bila belum ada (ADR 017). */
export const SALES_RETURNS_SEED: AccountSeed = {
  code: "4-1900",
  name: "Retur & Potongan Penjualan",
  accountType: "revenue",
  normalBalance: "debit",
  cashFlowCategory: "operating",
  isCash: false,
  systemRole: "sales_returns",
};

export type InventoryChange =
  /** Periodik → perpetual lewat stok opname awal per barang. */
  | { kind: "to_perpetual"; entryDate: IsoDate; costMethod: CostMethod; counts: OpeningCount[] }
  /** Perpetual → periodik, tanpa jurnal (stok per barang dibekukan). */
  | { kind: "to_periodic" }
  /** Rata-rata ↔ FIFO mulai tanggal tertentu, tanpa jurnal. */
  | { kind: "cost_method"; method: CostMethod; from: IsoDate };

export interface InventorySnapshot {
  workspace: Workspace;
  accounts: Account[];
  items: Item[];
  journals: JournalEntry[];
  context: PerpetualContext;
  reconciliation: InventoryReconciliation;
}

/** Metode biaya yang sedang berlaku (elemen terakhir riwayat, default rata-rata). */
export function currentCostMethod(history: readonly CostMethodPeriod[]): CostMethod {
  return history.at(-1)?.method ?? "average";
}

/** Pengaturan & data persediaan perpetual (ADR 017). */
export class InventoryService {
  constructor(
    private readonly deps: {
      workspaces: IWorkspaceRepository;
      accounts: IAccountRepository;
      items: IItemRepository;
      journals: IJournalRepository;
      journalService: JournalService;
    },
  ) {}

  /** Data untuk form perpetual: stok per barang per tanggal & rekonsiliasi. */
  async snapshot(workspaceId: string, asOf?: IsoDate): Promise<InventorySnapshot> {
    const [workspace, accounts, items, journals] = await Promise.all([
      this.deps.workspaces.getById(workspaceId),
      this.deps.accounts.listByWorkspace(workspaceId),
      this.deps.items.listByWorkspace(workspaceId),
      this.deps.journals.listByWorkspace(workspaceId),
    ]);
    if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
    return buildSnapshot(workspace, accounts, items, journals, asOf);
  }

  async changeSettings(workspaceId: string, change: InventoryChange): Promise<{ workspace: Workspace; transitionEntry: JournalEntry | null }> {
    const workspace = await this.deps.workspaces.getById(workspaceId);
    if (!workspace) fail("NOT_FOUND", "Workspace tidak ditemukan");
    const history = [...workspace.costMethodHistory];

    if (change.kind === "to_periodic") {
      if (workspace.inventoryMethod === "periodic") fail("INVALID_ACCOUNT", "Workspace sudah memakai metode periodik");
      return {
        workspace: await this.deps.workspaces.updateInventorySettings(workspaceId, { inventoryMethod: "periodic", costMethodHistory: history, stockValuation: workspace.stockValuation }),
        transitionEntry: null,
      };
    }

    if (change.kind === "cost_method") {
      if (!isValidIsoDate(change.from)) fail("INVALID_DATE", "Tanggal berlaku metode biaya tidak valid");
      const last = history.at(-1);
      if (last && change.from < last.from) {
        fail("INVALID_DATE", `Tanggal berlaku tidak boleh sebelum perubahan metode terakhir (${last.from})`);
      }
      if (currentCostMethod(history) === change.method) fail("INVALID_ACCOUNT", "Metode biaya tersebut sudah berlaku");
      const next = last && last.from === change.from ? [...history.slice(0, -1), { method: change.method, from: change.from }] : [...history, { method: change.method, from: change.from }];
      return {
        workspace: await this.deps.workspaces.updateInventorySettings(workspaceId, { inventoryMethod: workspace.inventoryMethod, costMethodHistory: next }),
        transitionEntry: null,
      };
    }

    if (workspace.inventoryMethod === "perpetual") fail("INVALID_ACCOUNT", "Workspace sudah memakai metode perpetual");
    if (!isValidIsoDate(change.entryDate)) fail("INVALID_DATE", "Tanggal peralihan tidak valid");
    await this.ensureSalesReturnsAccount(workspaceId);
    const nextHistory =
      currentCostMethod(history) === change.costMethod && history.length > 0
        ? history
        : [...history.filter((h) => h.from < change.entryDate), { method: change.costMethod, from: change.entryDate }];
    const snapshot = await this.snapshot(workspaceId, change.entryDate);
    const entry = buildPerpetualTransition(
      {
        workspaceId,
        entryDate: change.entryDate,
        counts: change.counts.filter((c) => c.quantity > 0 || c.value > 0 || snapshot.context.stocks.has(c.itemId)),
        accountBalance: snapshot.reconciliation.accountBalance,
      },
      { ...snapshot.context, costMethodHistory: nextHistory },
    );
    const transitionEntry = entry ? await this.deps.journalService.postJournal(entry) : null;
    return {
      workspace: await this.deps.workspaces.updateInventorySettings(workspaceId, { inventoryMethod: "perpetual", costMethodHistory: nextHistory }),
      transitionEntry,
    };
  }

  /** Membuat akun Retur & Potongan Penjualan bila belum ada (kode dicari yang kosong). */
  ensureSalesReturnsAccount(workspaceId: string): Promise<Account> {
    return ensureSalesReturnsAccount(this.deps.accounts, workspaceId);
  }
}

/** Akun Retur & Potongan Penjualan (dipakai retur & diskon faktur); dibuat bila belum ada. */
export async function ensureSalesReturnsAccount(repo: IAccountRepository, workspaceId: string): Promise<Account> {
  let accounts = await repo.listByWorkspace(workspaceId);
  const existing = accounts.find((a) => a.systemRole === "sales_returns");
  if (existing) return existing;
  const codes = new Set(accounts.map((a) => a.code));
  let code = SALES_RETURNS_SEED.code;
  for (let i = 1; codes.has(code); i++) code = `${SALES_RETURNS_SEED.code}-${i}`;
  await repo.create(workspaceId, { ...SALES_RETURNS_SEED, code });
  accounts = await repo.listByWorkspace(workspaceId);
  return accounts.find((a) => a.systemRole === "sales_returns")!;
}

/** Snapshot dari data yang sudah dimuat (dipakai UI tanpa memuat ulang). */
export function buildSnapshot(
  workspace: Workspace,
  accounts: Account[],
  items: Item[],
  journals: JournalEntry[],
  asOf?: IsoDate,
): InventorySnapshot {
  const stocks = stockAt(journals, accounts, workspace.costMethodHistory, asOf);
  return {
    workspace,
    accounts,
    items,
    journals,
    context: { accounts, items, stocks, costMethodHistory: workspace.costMethodHistory },
    reconciliation: inventoryReconciliation(journals, accounts, stocks, asOf),
  };
}
