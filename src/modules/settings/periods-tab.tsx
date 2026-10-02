"use client"

import { useState } from "react"
import { LockIcon, LockOpenIcon, PlusIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { actorLabel } from "@/core/audit"
import { formatDate, formatMonth } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { AuditLog, Period } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/utils"

export function PeriodsTab({
  services,
  workspaceId,
  periods,
  auditLogs,
  onChanged,
}: {
  services: AppServices
  workspaceId: string
  periods: Period[]
  auditLogs: AuditLog[]
  onChanged: () => void
}) {
  const [reopening, setReopening] = useState<Period | null>(null)
  const years = [...new Set(periods.map((p) => p.startDate.slice(0, 4)))].sort().reverse()
  const nextYear = Number(years[0] ?? new Date().getFullYear()) + 1
  const periodById = new Map(periods.map((p) => [p.id, p]))
  const statusLogs = auditLogs.filter((l) => l.action === "close" || l.action === "reopen").slice(0, 10)

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
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Periode yang dikunci menolak posting jurnal baru. Kesalahan di periode terkunci dikoreksi
          dengan jurnal pembalik/penyesuaian di periode terbuka.
        </p>
        <Button
          variant="secondary"
          onClick={() => run(() => services.periodService.addNextFiscalYear(workspaceId), `Periode tahun ${nextYear} dibuat`)}
        >
          <PlusIcon data-icon="inline-start" />
          Tambah tahun buku {nextYear}
        </Button>
      </div>

      {years.map((year) => (
        <section key={year} className="overflow-hidden rounded-[24px] bg-canvas ring-1 ring-border" aria-label={`Tahun buku ${year}`}>
          <h2 className="border-b bg-card px-4 py-2.5 text-sm font-bold">Tahun buku {year}</h2>
          <ul className="divide-y">
            {periods
              .filter((p) => p.startDate.startsWith(year))
              .map((period) => (
                <li key={period.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-36 font-medium text-ink">{formatMonth(period.startDate)}</span>
                  <span className="flex-1 text-muted-foreground tabular-nums">
                    {formatDate(period.startDate)} – {formatDate(period.endDate)}
                  </span>
                  {period.status === "open" ? (
                    <>
                      <Badge className="bg-success-pale text-success-deep">Terbuka</Badge>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          run(
                            () => services.periodService.closePeriod(workspaceId, period.id),
                            `${formatMonth(period.startDate)} dikunci`,
                          )
                        }
                      >
                        <LockIcon data-icon="inline-start" />
                        Kunci
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge className="bg-secondary text-ink">
                        <LockIcon /> Dikunci
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => setReopening(period)}>
                        <LockOpenIcon data-icon="inline-start" />
                        Buka kembali
                      </Button>
                    </>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}

      <section aria-labelledby="period-log-title" className="grid gap-2">
        <h2 id="period-log-title" className="text-lg font-semibold">Riwayat kunci & buka periode</h2>
        {statusLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada perubahan status periode.</p>
        ) : (
          <ul className="divide-y rounded-[24px] bg-canvas ring-1 ring-border text-sm">
            {statusLogs.map((log) => {
              const period = periodById.get(log.entityId)
              return (
                <li key={log.id} className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="font-medium text-ink">
                    {log.action === "close" ? "Dikunci" : "Dibuka kembali"} ·{" "}
                    {period ? formatMonth(period.startDate) : log.entityId}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString("id-ID")} · oleh {actorLabel(log.actorId, services.ownerId)}
                  </span>
                  {log.reason && <span className="w-full text-ink">Alasan: {log.reason}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {reopening && (
        <ReopenDialog
          key={reopening.id}
          period={reopening}
          onClose={() => setReopening(null)}
          onConfirm={async (reason) => {
            await services.periodService.reopenPeriod(workspaceId, reopening.id, reason)
            toast.success(`${formatMonth(reopening.startDate)} dibuka kembali`)
            setReopening(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function ReopenDialog({
  period,
  onClose,
  onConfirm,
}: {
  period: Period
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault()
            try {
              await onConfirm(reason)
            } catch (e) {
              setError(errorMessage(e))
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Buka kembali {formatMonth(period.startDate)}?</DialogTitle>
            <DialogDescription>Alasan wajib diisi dan tercatat di audit log.</DialogDescription>
          </DialogHeader>
          <p className="flex gap-2 rounded-lg bg-card px-4 py-3 text-sm text-ink">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            Laporan periode ini yang pernah diterbitkan dapat berubah bila ada jurnal baru.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="reopen-reason">Alasan</Label>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="mis. Nota pembelian bahan tanggal 28 terlambat dicatat"
              required
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
            <Button type="submit">Buka kembali periode</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
