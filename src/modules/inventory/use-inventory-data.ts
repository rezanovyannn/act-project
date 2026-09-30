"use client"

import { buildSnapshot, currentCostMethod, type InventorySnapshot } from "@/core/services/inventory-service"
import type { AppServices } from "@/core/services"
import type { Account, IsoDate, Item, JournalEntry, Workspace } from "@/core/types"
import { useLoader } from "@/lib/utils"

export interface InventoryData {
  workspace: Workspace
  accounts: Account[]
  items: Item[]
  journals: JournalEntry[]
}

/** Data persediaan workspace; stok per tanggal dihitung dengan `snapshotAt`. */
export function useInventoryData(services: AppServices, workspaceId: string) {
  return useLoader<InventoryData>(async () => {
    const [workspace, accounts, items, journals] = await Promise.all([
      services.workspaces.getById(workspaceId),
      services.accounts.listByWorkspace(workspaceId),
      services.items.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId),
    ])
    if (!workspace) throw new Error("Workspace tidak ditemukan")
    return { workspace, accounts, items, journals }
  }, [services, workspaceId])
}

export function snapshotAt(data: InventoryData, asOf?: IsoDate): InventorySnapshot {
  return buildSnapshot(data.workspace, data.accounts, data.items, data.journals, asOf)
}

export const COST_METHOD_LABELS = { average: "Rata-rata tertimbang bergerak", fifo: "FIFO" } as const

export function methodSummary(workspace: Workspace): string {
  return workspace.inventoryMethod === "perpetual"
    ? `Perpetual · ${COST_METHOD_LABELS[currentCostMethod(workspace.costMethodHistory)]}`
    : "Periodik"
}
