"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2Icon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { AccountingError, type ValidationIssue } from "@/core/errors"
import { formatAccounting, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { JournalEntry, JournalEntryInput } from "@/core/types"
import { AccountCombobox } from "@/components/ui/account-combobox"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingState } from "@/components/ui/page-header"
import { cn, errorMessage, useLoader } from "@/lib/utils"
import { SOURCE_LABELS } from "./labels"

interface LineState {
  key: number
  accountId: string
  description: string
  debit: number | null
  credit: number | null
  /** Barang & qty dari jurnal asal (mis. draft koreksi), dipertahankan apa adanya (ADR 017). */
  itemId: string | null
  quantity: number | null
}

let nextKey = 0
const emptyLine = (): LineState => ({
  key: nextKey++,
  accountId: "",
  description: "",
  debit: 0,
  credit: 0,
  itemId: null,
  quantity: null,
})

function linesFrom(draft?: JournalEntry): LineState[] {
  if (!draft || draft.lines.length === 0) return [emptyLine(), emptyLine()]
  return draft.lines.map((line) => ({
    key: nextKey++,
    accountId: line.accountId,
    description: line.description ?? "",
    debit: line.debit,
    credit: line.credit,
    itemId: line.itemId,
    quantity: line.quantity,
  }))
}

const isMeaningful = (line: LineState) =>
  line.accountId !== "" || line.debit !== 0 || line.credit !== 0 || line.description.trim() !== ""

export function JournalForm({
  services,
  workspaceId,
  draft,
  cancelHref,
  onDone,
}: {
  services: AppServices
  workspaceId: string
  /** Draft yang diedit; kosong = jurnal baru. */
  draft?: JournalEntry
  cancelHref: string
  onDone: (entry: JournalEntry) => void
}) {
  const accounts = useLoader(
    () => services.accounts.listByWorkspace(workspaceId),
    [services, workspaceId],
  )
  const items = useLoader(() => services.items.listByWorkspace(workspaceId), [services, workspaceId])
  const itemsById = new Map((items.data ?? []).map((i) => [i.id, i]))
  const [entryDate, setEntryDate] = useState(draft?.entryDate ?? todayIsoDate())
  const [description, setDescription] = useState(draft?.description ?? "")
  const [lines, setLines] = useState<LineState[]>(() => linesFrom(draft))
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [submitting, setSubmitting] = useState<"draft" | "post" | null>(null)

  const usedAccountIds = new Set(lines.map((l) => l.accountId))
  const selectableAccounts = (accounts.data ?? []).filter(
    (a) => a.isActive || usedAccountIds.has(a.id),
  )

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0)
    const credit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0)
    const hasInvalidAmount = lines.some((l) => l.debit === null || l.credit === null)
    return { debit, credit, difference: debit - credit, hasInvalidAmount }
  }, [lines])
  const balanced = !totals.hasInvalidAmount && totals.debit > 0 && totals.difference === 0

  // Indeks issue merujuk ke baris yang dikirim (baris kosong dibuang).
  const sentRowKeys = lines.filter(isMeaningful).map((l) => l.key)
  const issuesByKey = new Map<number, string[]>()
  const generalIssues: string[] = []
  for (const issue of issues) {
    const key = issue.lineIndex !== undefined ? sentRowKeys[issue.lineIndex] : undefined
    if (key === undefined) generalIssues.push(issue.message)
    else issuesByKey.set(key, [...(issuesByKey.get(key) ?? []), issue.message])
  }

  function updateLine(key: number, patch: Partial<LineState>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function buildInput(): JournalEntryInput {
    return {
      workspaceId,
      entryDate,
      description,
      source: draft?.source ?? "manual",
      counterparty: draft?.counterparty ?? null,
      settlementOf: draft?.settlementOf ?? null,
      correctionOf: draft?.correctionOf ?? null,
      returnOf: draft?.returnOf ?? null,
      lines: lines.filter(isMeaningful).map((l) => ({
        accountId: l.accountId,
        description: l.description.trim() || null,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        itemId: l.itemId,
        quantity: l.quantity,
      })),
    }
  }

  async function submit(action: "draft" | "post") {
    if (totals.hasInvalidAmount) {
      setIssues([
        { code: "INVALID_AMOUNT", message: "Periksa nominal: hanya angka Rupiah bulat tanpa desimal" },
      ])
      return
    }
    setSubmitting(action)
    setIssues([])
    try {
      const input = buildInput()
      const entry =
        action === "post"
          ? await services.journalService.postJournal(input, draft?.id)
          : await services.journalService.saveDraft(input, draft?.id)
      toast.success(
        action === "post" ? `Jurnal ${entry.entryNumber} diposting` : "Draft jurnal disimpan",
      )
      onDone(entry)
    } catch (e) {
      if (e instanceof AccountingError) setIssues(e.issues)
      else setIssues([{ code: "NOT_FOUND", message: errorMessage(e) }])
    } finally {
      setSubmitting(null)
    }
  }

  if (accounts.loading) return <LoadingState />

  return (
    <form
      className="grid grid-cols-1 gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        void submit("post")
      }}
    >
      {draft?.correctionOf && (
        <p className="rounded-lg bg-card px-4 py-3 text-sm text-ink">
          Draft koreksi. Jurnal asal sudah dibalik; perbaiki isian lalu posting.
        </p>
      )}

      <div className="grid gap-4 rounded-lg bg-card p-4 sm:grid-cols-[12rem_1fr] sm:p-6">
        <div className="grid gap-2">
          <Label htmlFor="journal-date">Tanggal</Label>
          <Input
            id="journal-date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="journal-description">Keterangan</Label>
          <Input
            id="journal-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="mis. Pembayaran sewa bulan Oktober"
          />
        </div>
        {draft && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Sumber: {SOURCE_LABELS[draft.source]}
            {draft.counterparty ? ` · ${draft.counterparty}` : ""}
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-canvas">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_10rem_10rem_2.5rem] gap-3 border-b bg-card px-4 py-3 text-sm font-bold text-ink md:grid">
          <span>Akun</span>
          <span>Keterangan baris</span>
          <span className="text-right">Debit</span>
          <span className="text-right">Kredit</span>
          <span className="sr-only">Hapus</span>
        </div>

        <ol className="divide-y">
          {lines.map((line, index) => {
            const lineIssues = issuesByKey.get(line.key)
            return (
              <li key={line.key} className="grid gap-2 px-4 py-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_10rem_10rem_2.5rem] md:items-center">
                  <div className="col-span-2 md:col-span-1">
                    <AccountCombobox
                      id={`line-${line.key}-account`}
                      accounts={selectableAccounts}
                      value={line.accountId}
                      onChange={(accountId) => updateLine(line.key, { accountId })}
                      invalid={Boolean(lineIssues)}
                    />
                  </div>
                  <Input
                    aria-label={`Keterangan baris ${index + 1}`}
                    className="col-span-2 md:col-span-1"
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    placeholder="Opsional"
                  />
                  {line.itemId && (
                    <p className="col-span-2 text-xs text-muted-foreground md:order-last md:col-span-5">
                      Baris barang: {itemsById.get(line.itemId)?.name ?? "barang"} × {line.quantity}{" "}
                      {itemsById.get(line.itemId)?.unit ?? ""} (dipertahankan dari jurnal asal)
                    </p>
                  )}
                  <AmountInput
                    aria-label={`Debit baris ${index + 1}`}
                    value={line.debit}
                    onValueChange={(debit) =>
                      updateLine(line.key, { debit, ...(debit ? { credit: 0 } : {}) })
                    }
                  />
                  <AmountInput
                    aria-label={`Kredit baris ${index + 1}`}
                    value={line.credit}
                    onValueChange={(credit) =>
                      updateLine(line.key, { credit, ...(credit ? { debit: 0 } : {}) })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="col-span-2 justify-self-end md:col-span-1"
                    aria-label={`Hapus baris ${index + 1}`}
                    disabled={lines.length <= 2}
                    onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                {lineIssues && (
                  <p className="text-sm text-destructive">{lineIssues.join(". ")}</p>
                )}
              </li>
            )
          })}
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((current) => [...current, emptyLine()])}
          >
            <PlusIcon data-icon="inline-start" />
            Tambah baris
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t-2 border-ink px-4 py-3 text-sm font-bold text-ink md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_10rem_10rem_2.5rem]">
          <span className="col-span-2">Total</span>
          <Amount value={totals.debit} className="text-right" />
          <Amount value={totals.credit} className="text-right" />
        </div>
      </div>

      <div
        role="status"
        className={cn(
          "flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold",
          balanced ? "bg-success-pale text-success-deep" : "bg-card text-ink",
        )}
      >
        {balanced ? (
          <>
            <CheckCircle2Icon className="size-4" /> Seimbang
          </>
        ) : (
          <>
            <TriangleAlertIcon className="size-4" />
            {totals.hasInvalidAmount
              ? "Ada nominal yang tidak valid"
              : totals.debit === 0
                ? "Isi nominal debit dan kredit"
                : `Selisih ${formatAccounting(Math.abs(totals.difference))} (${totals.difference > 0 ? "debit lebih besar" : "kredit lebih besar"})`}
          </>
        )}
      </div>

      {generalIssues.length > 0 && (
        <ul role="alert" className="grid gap-1 rounded-lg border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {generalIssues.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" asChild>
          <Link href={cancelHref}>Batal</Link>
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={submitting !== null}
          onClick={() => void submit("draft")}
        >
          {submitting === "draft" ? "Menyimpan…" : "Simpan draft"}
        </Button>
        <Button type="submit" disabled={submitting !== null || !balanced}>
          {submitting === "post" ? "Memposting…" : "Posting jurnal"}
        </Button>
      </div>
    </form>
  )
}
