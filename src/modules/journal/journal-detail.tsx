"use client"

import { useState } from "react"
import Link from "next/link"
import { PencilIcon, RotateCcwIcon, SendIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"
import { formatDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { JournalEntry } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { JournalStatusBadges, SOURCE_LABELS, journalTotal } from "./labels"
import { ReversalDialog } from "./reversal-dialog"

interface DetailData {
  entry: JournalEntry | null
  all: JournalEntry[]
  accountsById: Map<string, { code: string; name: string; isActive: boolean }>
  itemsById: Map<string, { code: string; name: string; unit: string }>
}

export function JournalDetail({
  services,
  workspaceId,
  entryId,
  detailHref,
  editHref,
  listHref,
  onDeleted,
  onCorrectionDraft,
}: {
  services: AppServices
  workspaceId: string
  entryId: string
  detailHref: (entryId: string) => string
  editHref: (entryId: string) => string
  listHref: string
  onDeleted: () => void
  /** Dipanggil setelah koreksi dengan draft baru yang perlu diperbaiki. */
  onCorrectionDraft: (draftId: string) => void
}) {
  const data = useLoader<DetailData>(async () => {
    const [entry, all, accounts, items] = await Promise.all([
      services.journals.getById(entryId),
      services.journals.listByWorkspace(workspaceId),
      services.accounts.listByWorkspace(workspaceId),
      services.items.listByWorkspace(workspaceId),
    ])
    return {
      entry: entry?.workspaceId === workspaceId ? entry : null,
      all,
      accountsById: new Map(accounts.map((a) => [a.id, a])),
      itemsById: new Map(items.map((i) => [i.id, i])),
    }
  }, [services, workspaceId, entryId])
  const [busy, setBusy] = useState(false)

  if (data.loading) return <LoadingState />
  if (data.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(data.error)}
      </p>
    )
  }
  const { entry, all, accountsById } = data.data!
  if (!entry) {
    return (
      <EmptyState title="Jurnal tidak ditemukan">
        <Link href={listHref} className="underline">
          Kembali ke daftar jurnal
        </Link>
      </EmptyState>
    )
  }

  const reversal = all.find((e) => e.reversalOf === entry.id && e.status === "posted")
  const original = entry.reversalOf ? all.find((e) => e.id === entry.reversalOf) : undefined
  const correctedFrom = entry.correctionOf ? all.find((e) => e.id === entry.correctionOf) : undefined
  const corrections = all.filter((e) => e.correctionOf === entry.id)
  const settlementTarget = entry.settlementOf ? all.find((e) => e.id === entry.settlementOf) : undefined
  const settlements = all.filter((e) => e.settlementOf === entry.id && e.status === "posted")
  const canReverse = entry.status === "posted" && entry.source !== "reversal" && !reversal

  async function postDraft() {
    setBusy(true)
    try {
      const posted = await services.journalService.postDraft(entry!.id)
      toast.success(`Jurnal ${posted.entryNumber} diposting`)
      data.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function deleteDraft() {
    setBusy(true)
    try {
      await services.journalService.deleteDraft(entry!.id)
      toast.success("Draft dihapus")
      onDeleted()
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  const label = (e: JournalEntry) => e.entryNumber ?? `Draft ${formatDate(e.entryDate)}`
  const related: { text: string; target: JournalEntry }[] = [
    ...(original ? [{ text: "Membalik jurnal", target: original }] : []),
    ...(reversal ? [{ text: "Di-void oleh", target: reversal }] : []),
    ...(correctedFrom ? [{ text: "Koreksi atas", target: correctedFrom }] : []),
    ...corrections.map((c) => ({ text: "Dikoreksi menjadi", target: c })),
    ...(settlementTarget ? [{ text: "Melunasi", target: settlementTarget }] : []),
    ...settlements.map((s) => ({ text: "Dilunasi oleh", target: s })),
  ]

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={entry.entryNumber ?? "Draft jurnal"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <JournalStatusBadges entry={entry} voided={Boolean(reversal)} />
            <span>
              {formatDate(entry.entryDate)} · {SOURCE_LABELS[entry.source]}
              {entry.counterparty ? ` · ${entry.counterparty}` : ""}
            </span>
          </span>
        }
        actions={
          entry.status === "draft" ? (
            <>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" disabled={busy}>
                    <Trash2Icon data-icon="inline-start" />
                    Hapus
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Hapus draft?</DialogTitle>
                    <DialogDescription>
                      Draft yang dihapus tidak muncul lagi di daftar jurnal.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="secondary">Batal</Button>
                    </DialogClose>
                    <Button variant="destructive" onClick={deleteDraft} disabled={busy}>
                      Hapus draft
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button variant="secondary" asChild>
                <Link href={editHref(entry.id)}>
                  <PencilIcon data-icon="inline-start" />
                  Ubah
                </Link>
              </Button>
              <Button onClick={postDraft} disabled={busy}>
                <SendIcon data-icon="inline-start" />
                Posting
              </Button>
            </>
          ) : canReverse ? (
            <>
              <ReversalDialog
                services={services}
                entry={entry}
                mode="void"
                onVoided={() => data.reload()}
                trigger={
                  <Button variant="secondary">
                    <Undo2Icon data-icon="inline-start" />
                    Void
                  </Button>
                }
              />
              <ReversalDialog
                services={services}
                entry={entry}
                mode="correct"
                onCorrected={(draft) => onCorrectionDraft(draft.id)}
                trigger={
                  <Button variant="secondary">
                    <RotateCcwIcon data-icon="inline-start" />
                    Koreksi
                  </Button>
                }
              />
            </>
          ) : null
        }
      />

      <div className="rounded-lg bg-card px-4 py-3 sm:px-6">
        <p className="text-xs text-muted-foreground">Keterangan</p>
        <p className="mt-1 text-ink">{entry.description || "—"}</p>
        {related.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm">
            {related.map(({ text, target }) => (
              <li key={`${text}-${target.id}`}>
                <span className="text-muted-foreground">{text} </span>
                <Link href={detailHref(target.id)} className="font-semibold text-ink underline-offset-4 hover:underline">
                  {label(target)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-canvas">
        <Table>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="w-24">Kode</TableHead>
              <TableHead>Akun</TableHead>
              <TableHead>Keterangan baris</TableHead>
              <TableHead className="w-40 text-right">Debit</TableHead>
              <TableHead className="w-40 text-right">Kredit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.lines.map((line) => {
              const account = accountsById.get(line.accountId)
              return (
                <TableRow key={line.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {account?.code ?? "—"}
                  </TableCell>
                  <TableCell className={line.credit > 0 ? "pl-8" : undefined}>
                    {account?.name ?? "(akun tidak ditemukan)"}
                    {account && !account.isActive && (
                      <span className="ml-2 text-xs text-muted-foreground">nonaktif</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {line.description ?? ""}
                    {line.itemId && (
                      <span className="block text-xs">
                        {data.data!.itemsById.get(line.itemId)?.name ?? "Barang"} × {line.quantity}{" "}
                        {data.data!.itemsById.get(line.itemId)?.unit ?? ""}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={line.debit} hideZero />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={line.credit} hideZero />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter className="border-t-2 border-ink bg-canvas font-bold text-ink">
            <TableRow>
              <TableCell colSpan={3}>Total</TableCell>
              <TableCell className="text-right">
                <Amount value={journalTotal(entry)} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={entry.lines.reduce((sum, l) => sum + l.credit, 0)} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {entry.status === "posted" && entry.source === "reversal" && (
        <p className="text-sm text-muted-foreground">
          Jurnal pembalik tidak dapat di-void atau dikoreksi. Bila ada kesalahan, buat jurnal baru.
        </p>
      )}
    </div>
  )
}
