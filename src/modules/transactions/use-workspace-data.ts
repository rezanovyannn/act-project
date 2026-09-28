"use client"

import type { AppServices } from "@/core/services"
import type { Account, JournalEntry, Workspace } from "@/core/types"
import { useLoader } from "@/lib/utils"

export interface WorkspaceData {
  workspace: Workspace
  accounts: Account[]
  journals: JournalEntry[]
}

/** Workspace, akun, dan jurnal untuk form transaksi. */
export function useWorkspaceData(services: AppServices, workspaceId: string) {
  return useLoader<WorkspaceData>(async () => {
    const [workspace, accounts, journals] = await Promise.all([
      services.workspaces.getById(workspaceId),
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId),
    ])
    if (!workspace) throw new Error("Workspace tidak ditemukan")
    return { workspace, accounts, journals }
  }, [services, workspaceId])
}

/** Nama pelanggan/pemasok yang pernah dipakai, untuk saran input. */
export function counterpartyNames(journals: readonly JournalEntry[]): string[] {
  return [...new Set(journals.map((j) => j.counterparty).filter((n): n is string => Boolean(n)))].sort(
    (a, b) => a.localeCompare(b, "id"),
  )
}

export const activeAccounts = (accounts: readonly Account[], predicate: (a: Account) => boolean) =>
  accounts.filter((a) => a.isActive && predicate(a))
