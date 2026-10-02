"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { JournalList } from "@/modules/journal/journal-list"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function JournalsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return (
    <JournalList
      services={services}
      workspaceId={workspaceId}
      detailHref={(entryId) => routes.journal(workspaceId, entryId)}
    />
  )
}
