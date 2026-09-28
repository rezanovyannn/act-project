"use client"

import { useState } from "react"
import Link from "next/link"
import { formatDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import { listCreditTransactions, type CreditTransaction } from "@/core/settlement"
import type { Account } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { EmptyState, LoadingState, PageHeader } from "@/components/ui/page-header"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage } from "@/lib/utils"
import { SettlementDialog } from "./settlement-dialog"
import { useWorkspaceData } from "./use-workspace-data"

/** Daftar piutang pelanggan & utang pemasok beserta pelunasannya (ADR 012). */
export function CreditsView({
  services,
  workspaceId,
  journalHref,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
}) {
  const data = useWorkspaceData(services, workspaceId)
  const [showSettled, setShowSettled] = useState(false)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) {
    return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  }
  const { accounts, journals } = data.data!
  const credits = listCreditTransactions(journals, accounts)
  const visible = credits.filter((c) => showSettled || c.outstanding > 0)
  const totalOf = (kind: CreditTransaction["kind"]) =>
    credits.filter((c) => c.kind === kind).reduce((sum, c) => sum + c.outstanding, 0)

  const section = (kind: CreditTransaction["kind"]) => (
    <CreditGroups
      credits={visible.filter((c) => c.kind === kind)}
      accounts={accounts}
      services={services}
      journalHref={journalHref}
      onSettled={data.reload}
    />
  )

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Piutang & Utang"
        description="Transaksi kredit yang belum lunas. Pelunasan boleh sebagian dan tidak boleh melebihi sisa tagihan."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-card p-6">
          <p className="text-xs font-medium text-muted-foreground">Total piutang pelanggan</p>
          <Amount value={totalOf("receivable")} className="mt-1 block text-lg font-semibold text-ink" />
        </div>
        <div className="rounded-lg bg-card p-6">
          <p className="text-xs font-medium text-muted-foreground">Total utang pemasok</p>
          <Amount value={totalOf("payable")} className="mt-1 block text-lg font-semibold text-ink" />
        </div>
      </div>
      <Tabs defaultValue="receivable" className="grid grid-cols-1 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="receivable">Piutang</TabsTrigger>
            <TabsTrigger value="payable">Utang</TabsTrigger>
          </TabsList>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showSettled} onCheckedChange={setShowSettled} />
            Tampilkan yang sudah lunas
          </label>
        </div>
        <TabsContent value="receivable">{section("receivable")}</TabsContent>
        <TabsContent value="payable">{section("payable")}</TabsContent>
      </Tabs>
    </div>
  )
}

function CreditGroups({
  credits,
  accounts,
  services,
  journalHref,
  onSettled,
}: {
  credits: CreditTransaction[]
  accounts: Account[]
  services: AppServices
  journalHref: (entryId: string) => string
  onSettled: () => void
}) {
  if (credits.length === 0) return <EmptyState title="Tidak ada transaksi kredit yang belum lunas" />

  const groups = new Map<string, CreditTransaction[]>()
  for (const credit of credits) {
    const name = credit.counterparty ?? "Tanpa nama"
    groups.set(name, [...(groups.get(name) ?? []), credit])
  }

  return (
    <div className="grid gap-4">
      {[...groups.entries()].map(([name, items]) => (
        <section key={name} className="overflow-hidden rounded-lg border bg-canvas">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-3">
            <h2 className="font-semibold">{name}</h2>
            <span className="text-sm">
              Sisa <Amount value={items.reduce((sum, c) => sum + c.outstanding, 0)} className="font-bold text-ink" />
            </span>
          </header>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Tanggal</TableHead>
                <TableHead className="w-32">Nomor</TableHead>
                <TableHead>Keterangan</TableHead>
                <TableHead className="w-36 text-right">Nominal</TableHead>
                <TableHead className="w-36 text-right">Dibayar</TableHead>
                <TableHead className="w-36 text-right">Sisa</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((credit) => (
                <TableRow key={credit.entry.id}>
                  <TableCell className="tabular-nums">{formatDate(credit.entry.entryDate)}</TableCell>
                  <TableCell>
                    <Link href={journalHref(credit.entry.id)} className="tabular-nums text-ink underline-offset-4 hover:underline">
                      {credit.entry.entryNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <span className="block truncate">{credit.entry.description}</span>
                    {credit.settlements.length > 0 && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {credit.settlements.length}× pelunasan, terakhir{" "}
                        {formatDate(credit.settlements.at(-1)!.entryDate)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right"><Amount value={credit.original} /></TableCell>
                  <TableCell className="text-right"><Amount value={credit.paid} /></TableCell>
                  <TableCell className="text-right font-semibold text-ink"><Amount value={credit.outstanding} /></TableCell>
                  <TableCell className="text-right">
                    {credit.outstanding > 0 ? (
                      <SettlementDialog
                        key={`${credit.entry.id}-${credit.outstanding}`}
                        services={services}
                        credit={credit}
                        accounts={accounts}
                        onSettled={onSettled}
                      />
                    ) : (
                      <span className="text-xs font-semibold text-success-deep">Lunas</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  )
}
