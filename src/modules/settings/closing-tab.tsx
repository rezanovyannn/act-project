"use client"

import { useState } from "react"
import Link from "next/link"
import { InfoIcon, LockIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"
import { INCOME_SUMMARY_SEED } from "@/core/closing"
import { formatDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { Account, Period } from "@/core/types"
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
import { JournalPreview } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { LoadingState } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { errorMessage, useLoader } from "@/lib/utils"

/** Tutup buku akhir tahun (ADR 014). */
export function ClosingTab({
  services,
  workspaceId,
  accounts,
  periods,
  journalHref,
  onChanged,
}: {
  services: AppServices
  workspaceId: string
  accounts: Account[]
  periods: Period[]
  journalHref: (entryId: string) => string
  onChanged: () => void
}) {
  const years = [...new Set(periods.map((p) => Number(p.startDate.slice(0, 4))))].sort((a, b) => b - a)
  const [year, setYear] = useState(() => {
    const current = new Date().getFullYear()
    return years.includes(current - 1) ? current - 1 : (years[0] ?? current)
  })
  const preview = useLoader(() => services.closingService.preview(workspaceId, year), [services, workspaceId, year])
  const [busy, setBusy] = useState(false)

  // Pratinjau: akun Ikhtisar mungkin belum ada (dibuat otomatis saat tutup buku).
  const displayAccounts: Account[] = accounts.some((a) => a.systemRole === "income_summary")
    ? accounts
    : [
        ...accounts,
        {
          ...INCOME_SUMMARY_SEED,
          name: `${INCOME_SUMMARY_SEED.name} (dibuat otomatis)`,
          id: "__income_summary__",
          workspaceId,
          isActive: true,
          createdAt: "",
          updatedAt: "",
          deletedAt: null,
        },
      ]

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      preview.reload()
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Jurnal penutup menolkan akun pendapatan, HPP, dan beban lewat Ikhtisar Laba Rugi ke Laba
          Ditahan, serta menutup Prive ke Laba Ditahan. Setelah itu seluruh periode tahun tersebut
          dikunci.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="closing-year">Tahun buku</Label>
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger id="closing-year" className="w-40 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {preview.loading && !preview.data ? (
        <LoadingState />
      ) : preview.error ? (
        <p role="alert" className="text-sm text-destructive">{errorMessage(preview.error)}</p>
      ) : preview.data!.activeClosing.length > 0 ? (
        <ClosedState
          year={year}
          december={periods.find((p) => p.startDate === `${year}-12-01`)}
          entries={preview.data!.activeClosing}
          journalHref={journalHref}
          busy={busy}
          onCancel={() => run(() => services.closingService.cancel(workspaceId, year), `Tutup buku ${year} dibatalkan`)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="grid content-start gap-4">
            <dl className="grid gap-2 rounded-2xl bg-canvas ring-1 ring-border p-4 text-sm sm:p-6">
              <Row label={`Pendapatan ${year}`} value={preview.data!.plan.revenue} />
              <Row label="HPP" value={preview.data!.plan.cogs} />
              <Row label="Beban operasional" value={preview.data!.plan.expenses} />
              <Row
                label={preview.data!.plan.netIncome >= 0 ? "Laba bersih → Laba Ditahan" : "Rugi bersih → Laba Ditahan"}
                value={preview.data!.plan.netIncome}
                strong
              />
              <Row label="Prive → Laba Ditahan" value={-preview.data!.plan.drawings} />
            </dl>
            {preview.data!.blockers.length > 0 && (
              <ul role="alert" className="grid gap-1 rounded-lg border border-destructive/40 px-4 py-3 text-sm text-destructive">
                {preview.data!.blockers.map((b) => (
                  <li key={b} className="flex gap-2">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            )}
            {preview.data!.warnings.length > 0 && (
              <ul className="grid gap-1 rounded-lg bg-card px-4 py-3 text-sm text-ink">
                {preview.data!.warnings.map((w) => (
                  <li key={w} className="flex gap-2">
                    <InfoIcon className="mt-0.5 size-4 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
            <CloseDialog
              year={year}
              disabled={busy || preview.data!.blockers.length > 0}
              onConfirm={() => run(() => services.closingService.close(workspaceId, year), `Buku tahun ${year} ditutup`)}
            />
          </div>
          <div className="grid content-start gap-3">
            {preview.data!.plan.entries.map((entry) => (
              <JournalPreview key={entry.description} title={entry.description} lines={entry.lines} accounts={displayAccounts} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-4 border-t pt-2 font-bold text-ink" : "flex justify-between gap-4"}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd><Amount value={value} /></dd>
    </div>
  )
}

function CloseDialog({ year, disabled, onConfirm }: { year: number; disabled: boolean; onConfirm: () => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="lg" disabled={disabled} className="w-fit">
          <LockIcon data-icon="inline-start" />
          Tutup buku {year}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tutup buku tahun {year}?</DialogTitle>
          <DialogDescription>
            Jurnal penutup bertanggal 31 Desember {year} akan diposting dan seluruh periode Januari–Desember
            {" "}{year} dikunci. Koreksi setelahnya dilakukan lewat jurnal penyesuaian di periode terbuka.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Batal</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onConfirm}>Tutup buku</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClosedState({
  year,
  december,
  entries,
  journalHref,
  busy,
  onCancel,
}: {
  year: number
  december: Period | undefined
  entries: { id: string; entryNumber: string | null; description: string; entryDate: string }[]
  journalHref: (entryId: string) => string
  busy: boolean
  onCancel: () => void
}) {
  const decemberOpen = december?.status === "open"
  return (
    <div className="grid max-w-3xl gap-4">
      <div className="rounded-lg bg-success-pale px-4 py-3 text-sm text-success-deep">
        <p className="font-semibold">Buku tahun {year} sudah ditutup.</p>
        <ul className="mt-2 grid gap-1">
          {entries.map((e) => (
            <li key={e.id}>
              <Link href={journalHref(e.id)} className="font-semibold underline underline-offset-4">
                {e.entryNumber}
              </Link>{" "}
              · {formatDate(e.entryDate)} · {e.description}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg bg-card px-4 py-3 text-sm text-ink">
        <p className="font-semibold">Membatalkan tutup buku</p>
        <p className="mt-1 text-muted-foreground">
          Hanya bila tutup buku dilakukan karena kesalahan. Seluruh jurnal penutup dibalik sekaligus,
          bertanggal 31 Desember {year}.
          {!decemberOpen && ` Buka kembali periode Desember ${year} di tab Periode terlebih dahulu (alasan wajib).`}
        </p>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" className="mt-3" disabled={busy || !decemberOpen}>
              <Undo2Icon data-icon="inline-start" />
              Batalkan tutup buku {year}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Batalkan tutup buku {year}?</DialogTitle>
              <DialogDescription>
                {entries.length} jurnal penutup akan dibalik dengan jurnal pembalik bertanggal 31 Desember {year}.
                Laba Ditahan dan akun nominal kembali seperti sebelum tutup buku.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Batal</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="destructive" onClick={onCancel}>Batalkan tutup buku</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
