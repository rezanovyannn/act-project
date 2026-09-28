"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { EmptyState, LoadingState, PageHeader } from "@/components/ui/page-header"
import { useLoader } from "@/lib/utils"
import { JournalForm } from "@/modules/journal/journal-form"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function EditJournalPage() {
  const { workspaceId, journalId } = useParams<{ workspaceId: string; journalId: string }>()
  const services = useServices()
  const router = useRouter()
  const draft = useLoader(
    async () => (services ? services.journals.getById(journalId) : undefined),
    [services, journalId],
  )

  if (!services || draft.loading || draft.data === undefined) return <LoadingState />
  const entry = draft.data
  if (!entry || entry.workspaceId !== workspaceId || entry.status !== "draft") {
    return (
      <EmptyState title="Draft tidak ditemukan">
        Hanya jurnal draft yang bisa diubah. Jurnal posted diperbaiki lewat Void atau Koreksi.{" "}
        <Link href={routes.journal(workspaceId, journalId)} className="underline">
          Lihat jurnal
        </Link>
      </EmptyState>
    )
  }
  return (
    <div className="grid gap-6">
      <PageHeader title="Ubah draft jurnal" />
      <JournalForm
        key={entry.id}
        services={services}
        workspaceId={workspaceId}
        draft={entry}
        cancelHref={routes.journal(workspaceId, entry.id)}
        onDone={(saved) => router.push(routes.journal(workspaceId, saved.id))}
      />
    </div>
  )
}
