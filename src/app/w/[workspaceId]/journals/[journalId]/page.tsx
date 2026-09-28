"use client"

import { useParams, useRouter } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { JournalDetail } from "@/modules/journal/journal-detail"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function JournalDetailPage() {
  const { workspaceId, journalId } = useParams<{ workspaceId: string; journalId: string }>()
  const services = useServices()
  const router = useRouter()
  if (!services) return <LoadingState />
  return (
    <JournalDetail
      services={services}
      workspaceId={workspaceId}
      entryId={journalId}
      detailHref={(entryId) => routes.journal(workspaceId, entryId)}
      editHref={(entryId) => routes.editJournal(workspaceId, entryId)}
      listHref={routes.journals(workspaceId)}
      onDeleted={() => router.push(routes.journals(workspaceId))}
      onCorrectionDraft={(draftId) => router.push(routes.editJournal(workspaceId, draftId))}
    />
  )
}
