"use client"

import { useState } from "react"
import { MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import type { AppServices } from "@/core/services"
import type { Account, AccountType, JournalEntry } from "@/core/types"
import { ACCOUNT_TYPE_LABELS } from "@/components/ui/account-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { errorMessage } from "@/lib/utils"
import { AccountDialog, CASH_FLOW_LABELS } from "./account-dialog"

const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "cogs", "expense"]

export function AccountsTab({
  services,
  workspaceId,
  accounts,
  journals,
  onChanged,
}: {
  services: AppServices
  workspaceId: string
  accounts: Account[]
  journals: JournalEntry[]
  onChanged: () => void
}) {
  // Akun dipakai = direferensikan baris jurnal draft maupun posted (ADR 009).
  const usedIds = new Set(journals.flatMap((j) => j.lines.map((l) => l.accountId)))
  const [editing, setEditing] = useState<Account | null>(null)

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action()
      toast.success(success)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Akun yang sudah dipakai jurnal tidak bisa dihapus, hanya dinonaktifkan. Akun nonaktif tidak
          muncul di form, tetapi tetap ada di laporan.
        </p>
        <AccountDialog
          services={services}
          workspaceId={workspaceId}
          onSaved={onChanged}
          trigger={
            <Button>
              <PlusIcon data-icon="inline-start" />
              Tambah akun
            </Button>
          }
        />
      </div>

      {TYPE_ORDER.map((type) => {
        const group = accounts.filter((a) => a.accountType === type)
        if (group.length === 0) return null
        return (
          <section key={type} className="overflow-hidden rounded-lg border bg-canvas" aria-label={ACCOUNT_TYPE_LABELS[type]}>
            <h2 className="border-b bg-card px-4 py-2.5 text-sm font-bold">{ACCOUNT_TYPE_LABELS[type]}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Kode</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead className="w-28">Saldo normal</TableHead>
                  <TableHead className="w-28">Arus kas</TableHead>
                  <TableHead className="w-16"><span className="sr-only">Aksi</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.map((account) => {
                  const inUse = usedIds.has(account.id)
                  const canDelete = !inUse && !account.systemRole
                  return (
                    <TableRow key={account.id} className={account.isActive ? undefined : "text-muted-foreground"}>
                      <TableCell className="tabular-nums">{account.code}</TableCell>
                      <TableCell>
                        <span className="mr-2">{account.name}</span>
                        <span className="inline-flex flex-wrap gap-1 align-middle">
                          {account.isCash && <Badge variant="outline">Kas/Bank</Badge>}
                          {account.systemRole && <Badge variant="secondary">Akun sistem</Badge>}
                          {!account.isActive && <Badge className="bg-muted text-muted-foreground">Nonaktif</Badge>}
                          {inUse && <span className="text-xs text-muted-foreground">dipakai jurnal</span>}
                        </span>
                      </TableCell>
                      <TableCell>{account.normalBalance === "debit" ? "Debit" : "Kredit"}</TableCell>
                      <TableCell>{CASH_FLOW_LABELS[account.cashFlowCategory]}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Aksi untuk ${account.name}`}>
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(account)}>Ubah</DropdownMenuItem>
                            {account.isActive ? (
                              <DropdownMenuItem
                                disabled={Boolean(account.systemRole)}
                                onSelect={() => run(() => services.accountService.setActive(account.id, false), `${account.name} dinonaktifkan`)}
                              >
                                Nonaktifkan
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onSelect={() => run(() => services.accountService.setActive(account.id, true), `${account.name} diaktifkan`)}
                              >
                                Aktifkan
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={!canDelete}
                              onSelect={() => run(() => services.accountService.deleteAccount(account.id), `${account.name} dihapus`)}
                            >
                              {canDelete ? "Hapus" : account.systemRole ? "Hapus (akun sistem)" : "Hapus (sudah dipakai)"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </section>
        )
      })}

      {editing && (
        <AccountDialog
          key={editing.id}
          services={services}
          workspaceId={workspaceId}
          account={editing}
          inUse={usedIds.has(editing.id)}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  )
}
