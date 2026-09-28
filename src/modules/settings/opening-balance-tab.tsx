"use client"

import { useState } from "react"
import Link from "next/link"
import { formatDate } from "@/core/format"
import { activeOpeningBalance, buildOpeningBalance, type OpeningBalanceResult } from "@/core/opening-balance"
import type { AppServices } from "@/core/services"
import type { Account, AccountType, JournalEntry, Workspace } from "@/core/types"
import { ACCOUNT_TYPE_LABELS } from "@/components/ui/account-combobox"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { JournalPreview, PostedNotice } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { errorMessage } from "@/lib/utils"

const GROUPS: AccountType[] = ["asset", "liability", "equity"]

/** Satu jurnal saldo awal atomik; selisih ke Ekuitas Saldo Awal (ROADMAP 1E). */
export function OpeningBalanceTab({
  services,
  workspace,
  accounts,
  journals,
  journalHref,
  onPosted,
}: {
  services: AppServices
  workspace: Workspace
  accounts: Account[]
  journals: JournalEntry[]
  journalHref: (entryId: string) => string
  onPosted: () => void
}) {
  const existing = activeOpeningBalance(journals)
  const [posted, setPosted] = useState<JournalEntry | null>(null)

  if (existing) {
    const total = existing.lines.reduce((sum, l) => sum + l.debit, 0)
    return (
      <div className="grid max-w-2xl gap-4">
        {posted && <PostedNotice entry={posted} href={journalHref(posted.id)} />}
        <div className="grid gap-2 rounded-lg bg-card p-6 text-sm">
          <p className="font-semibold text-ink">Saldo awal sudah diposting</p>
          <p>
            <Link href={journalHref(existing.id)} className="font-semibold text-ink underline underline-offset-4">
              {existing.entryNumber}
            </Link>{" "}
            · {formatDate(existing.entryDate)} · total <Amount value={total} />
          </p>
          <p className="text-muted-foreground">
            Hanya boleh ada satu jurnal saldo awal. Untuk mengubahnya, buka jurnal tersebut lalu Void,
            kemudian isi ulang saldo awal di sini.
          </p>
        </div>
        <JournalPreview title="Isi jurnal saldo awal" lines={existing.lines} accounts={accounts} />
      </div>
    )
  }

  return (
    <OpeningBalanceForm
      services={services}
      workspace={workspace}
      accounts={accounts}
      onPosted={(entry) => {
        setPosted(entry)
        onPosted()
      }}
    />
  )
}

function OpeningBalanceForm({
  services,
  workspace,
  accounts,
  onPosted,
}: {
  services: AppServices
  workspace: Workspace
  accounts: Account[]
  onPosted: (entry: JournalEntry) => void
}) {
  const editable = accounts.filter(
    (a) => a.isActive && GROUPS.includes(a.accountType) && a.systemRole !== "opening_balance_equity",
  )
  const [entryDate, setEntryDate] = useState(workspace.booksStartDate)
  const [amounts, setAmounts] = useState<Record<string, number | null>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const items = Object.entries(amounts).map(([accountId, amount]) => ({ accountId, amount: amount ?? -1 }))
  let result: OpeningBalanceResult | null = null
  try {
    result = buildOpeningBalance({ workspaceId: workspace.id, entryDate, items }, accounts)
  } catch {
    result = null
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const built = buildOpeningBalance({ workspaceId: workspace.id, entryDate, items }, accounts)
      onPosted(await services.journalService.postJournal(built.entry))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="grid content-start gap-5">
        <p className="text-sm text-muted-foreground">
          Isi saldo setiap akun neraca per tanggal mulai pembukuan menurut saldo normalnya (akun kontra
          seperti akumulasi penyusutan diisi positif). Selisih debit dan kredit otomatis masuk ke
          Ekuitas Saldo Awal.
        </p>
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="opening-date">Tanggal saldo awal</Label>
          <Input id="opening-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
          <p className="text-xs text-muted-foreground">Harus berada di periode terbuka.</p>
        </div>
        {GROUPS.map((type) => {
          const group = editable.filter((a) => a.accountType === type)
          if (group.length === 0) return null
          return (
            <fieldset key={type} className="overflow-hidden rounded-lg border bg-canvas">
              <legend className="sr-only">{ACCOUNT_TYPE_LABELS[type]}</legend>
              <p className="border-b bg-card px-4 py-2.5 text-sm font-bold text-ink">{ACCOUNT_TYPE_LABELS[type]}</p>
              <ul className="divide-y">
                {group.map((account) => (
                  <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <label htmlFor={`opening-${account.id}`} className="min-w-0 flex-1 text-sm">
                      <span className="mr-2 text-xs text-muted-foreground tabular-nums">{account.code}</span>
                      {account.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({account.normalBalance === "debit" ? "debit" : "kredit"})
                      </span>
                    </label>
                    <AmountInput
                      id={`opening-${account.id}`}
                      className="w-full sm:w-52"
                      value={amounts[account.id] ?? 0}
                      onValueChange={(value) => setAmounts((current) => ({ ...current, [account.id]: value }))}
                    />
                  </li>
                ))}
              </ul>
            </fieldset>
          )
        })}
      </div>
      <div className="grid content-start gap-4">
        <dl className="grid gap-2 rounded-lg bg-canvas p-4 text-sm ring-1 ring-border">
          <div className="flex justify-between"><dt className="text-muted-foreground">Total debit</dt><dd><Amount value={result?.totalDebit ?? 0} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Total kredit</dt><dd><Amount value={result?.totalCredit ?? 0} /></dd></div>
          <div className="flex justify-between border-t pt-2 font-bold text-ink">
            <dt>Ekuitas Saldo Awal ({(result?.equityDifference ?? 0) >= 0 ? "kredit" : "debit"})</dt>
            <dd><Amount value={Math.abs(result?.equityDifference ?? 0)} /></dd>
          </div>
        </dl>
        <JournalPreview lines={result?.entry.lines ?? []} accounts={accounts} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={saving || !result}>
          {saving ? "Memposting…" : "Posting saldo awal"}
        </Button>
      </div>
    </form>
  )
}
