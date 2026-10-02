"use client"

import { useState } from "react"
import Link from "next/link"
import { formatDate, todayIsoDate } from "@/core/format"
import { generalLedger } from "@/core/general-ledger"
import type { AppServices } from "@/core/services"
import type { Account, JournalEntry } from "@/core/types"
import { AccountCombobox } from "@/components/ui/account-combobox"
import { Amount } from "@/components/ui/amount"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState, LoadingState, PageHeader } from "@/components/ui/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { errorMessage, useLoader } from "@/lib/utils"
import { SOURCE_LABELS } from "./labels"

export function LedgerView({
  services,
  workspaceId,
  journalHref,
  initialAccountId,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
  initialAccountId?: string
}) {
  const data = useLoader(async () => {
    const [accounts, journals] = await Promise.all([
      services.accounts.listByWorkspace(workspaceId),
      services.journals.listByWorkspace(workspaceId, { status: "posted" }),
    ])
    return { accounts, journals }
  }, [services, workspaceId])

  const today = todayIsoDate()
  const [accountId, setAccountId] = useState(initialAccountId ?? "")
  const [fromDate, setFromDate] = useState(`${today.slice(0, 4)}-01-01`)
  const [toDate, setToDate] = useState(today)

  if (data.loading) return <LoadingState />
  if (data.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(data.error)}
      </p>
    )
  }
  const { accounts, journals } = data.data!
  const account = accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.isCash)

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Buku Besar"
        description="Mutasi dan saldo berjalan per akun dari jurnal posted."
      />
      <div className="grid gap-4 rounded-2xl bg-canvas ring-1 ring-border p-4 sm:grid-cols-[minmax(0,2fr)_1fr_1fr] sm:p-6">
        <div className="grid gap-2">
          <Label htmlFor="ledger-account">Akun</Label>
          <AccountCombobox
            id="ledger-account"
            accounts={accounts}
            value={account?.id ?? ""}
            onChange={setAccountId}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ledger-from">Dari tanggal</Label>
          <Input id="ledger-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ledger-to">Sampai tanggal</Label>
          <Input id="ledger-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {account ? (
        <LedgerTable account={account} journals={journals} fromDate={fromDate} toDate={toDate} journalHref={journalHref} />
      ) : (
        <EmptyState title="Pilih akun" />
      )}
    </div>
  )
}

function LedgerTable({
  account,
  journals,
  fromDate,
  toDate,
  journalHref,
}: {
  account: Account
  journals: JournalEntry[]
  fromDate: string
  toDate: string
  journalHref: (entryId: string) => string
}) {
  const ledger = generalLedger(journals, account, {
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  })
  const balanceSide = account.normalBalance === "debit" ? "debit" : "kredit"

  return (
    <div className="grid grid-cols-1 gap-2">
      <p className="text-sm text-muted-foreground">
        {account.code} · {account.name} — saldo normal {balanceSide}
        {!account.isActive && " · nonaktif"}
      </p>
      <div className="overflow-hidden rounded-2xl bg-canvas ring-1 ring-border">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="w-28">Tanggal</TableHead>
              <TableHead className="w-32">Nomor</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead className="w-36 text-right">Debit</TableHead>
              <TableHead className="w-36 text-right">Kredit</TableHead>
              <TableHead className="w-40 text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-card/50">
              <TableCell colSpan={5} className="font-semibold text-ink">
                Saldo awal{fromDate ? ` per ${formatDate(fromDate)}` : ""}
              </TableCell>
              <TableCell className="text-right font-semibold text-ink">
                <Amount value={ledger.openingBalance} />
              </TableCell>
            </TableRow>
            {ledger.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Tidak ada mutasi pada rentang ini.
                </TableCell>
              </TableRow>
            )}
            {ledger.rows.map((row, index) => (
              <TableRow key={`${row.entryId}-${index}`}>
                <TableCell className="tabular-nums">{formatDate(row.entryDate)}</TableCell>
                <TableCell>
                  <Link href={journalHref(row.entryId)} className="tabular-nums text-ink underline-offset-4 hover:underline">
                    {row.entryNumber}
                  </Link>
                </TableCell>
                <TableCell className="max-w-sm">
                  <span className="block truncate">{row.lineDescription ?? row.description}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {SOURCE_LABELS[row.source]}
                    {row.counterparty ? ` · ${row.counterparty}` : ""}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.debit} hideZero />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.credit} hideZero />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.balance} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="border-t-2 border-ink bg-canvas font-bold text-ink">
            <TableRow>
              <TableCell colSpan={3}>Total mutasi & saldo akhir</TableCell>
              <TableCell className="text-right">
                <Amount value={ledger.totalDebit} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={ledger.totalCredit} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={ledger.closingBalance} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  )
}
