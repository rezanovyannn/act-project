"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AUDIT_ENTITY_LABELS,
  actorLabel,
  auditActionLabel,
  auditChanges,
  auditSubject,
} from "@/core/audit"
import type { AppServices } from "@/core/services"
import type { AuditEntity } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { errorMessage, useLoader } from "@/lib/utils"

const PAGE_SIZE = 50

/** Riwayat audit workspace (ROADMAP Fase 3): hanya baca, terbaru lebih dulu. */
export function AuditLogView({
  services,
  workspaceId,
  journalHref,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
}) {
  const [entity, setEntity] = useState<AuditEntity | "all">("all")
  const [limit, setLimit] = useState(PAGE_SIZE)
  const logs = useLoader(
    () => services.auditLogs.listByWorkspace(workspaceId, entity === "all" ? undefined : { entityType: entity }),
    [services, workspaceId, entity],
  )

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Riwayat Audit"
        description="Catatan setiap perubahan jurnal, akun, periode, dan workspace. Tidak dapat diubah."
        actions={
          <div className="grid gap-2">
            <Label htmlFor="audit-entity">Jenis data</Label>
            <Select
              value={entity}
              onValueChange={(value) => {
                setEntity(value as AuditEntity | "all")
                setLimit(PAGE_SIZE)
              }}
            >
              <SelectTrigger id="audit-entity" className="w-44 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                {(Object.keys(AUDIT_ENTITY_LABELS) as AuditEntity[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {AUDIT_ENTITY_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {logs.loading && !logs.data ? (
        <LoadingState />
      ) : logs.error ? (
        <p role="alert" className="text-sm text-destructive">{errorMessage(logs.error)}</p>
      ) : logs.data!.length === 0 ? (
        <p className="rounded-lg bg-card px-4 py-6 text-center text-sm text-muted-foreground">Belum ada catatan audit.</p>
      ) : (
        <div className="grid gap-3">
          <ul className="divide-y rounded-[24px] bg-canvas ring-1 ring-border text-sm" aria-label="Catatan audit">
            {logs.data!.slice(0, limit).map((log) => {
              const subject = auditSubject(log)
              const changes = auditChanges(log.before, log.after)
              return (
                <li key={log.id} className="grid gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge variant="secondary">{AUDIT_ENTITY_LABELS[log.entityType]}</Badge>
                    <span className="font-semibold text-ink">{auditActionLabel(log.action)}</span>
                    {log.entityType === "journal" && log.action !== "delete_draft" ? (
                      <Link href={journalHref(log.entityId)} className="underline underline-offset-4">
                        {subject}
                      </Link>
                    ) : (
                      <span>{subject}</span>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString("id-ID")} · oleh {actorLabel(log.actorId, services.ownerId)}
                  </p>
                  {log.reason && <p className="text-ink">Alasan: {log.reason}</p>}
                  {changes.length > 0 && (
                    <ul className="grid gap-0.5 text-ink">
                      {changes.map((c) => (
                        <li key={c.field}>
                          {c.label}: <span className="text-muted-foreground line-through">{c.before}</span> → {c.after}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Menampilkan {Math.min(limit, logs.data!.length)} dari {logs.data!.length} catatan
            </span>
            {limit < logs.data!.length && (
              <Button variant="secondary" size="sm" onClick={() => setLimit(limit + PAGE_SIZE)}>
                Tampilkan lebih banyak
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
