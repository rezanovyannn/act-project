"use client"

import { useParams, useRouter } from "next/navigation"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { JournalForm } from "@/modules/journal/journal-form"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function NewJournalPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  const router = useRouter()
  if (!services) return <LoadingState />
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Jurnal baru"
        description="Simpan sebagai draft bila belum selesai. Posting hanya bisa bila debit dan kredit seimbang."
      />
      <JournalForm
        services={services}
        workspaceId={workspaceId}
        cancelHref={routes.journals(workspaceId)}
        onDone={(entry) => router.push(routes.journal(workspaceId, entry.id))}
      />
    </div>
  )
}
