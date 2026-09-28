"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { DashboardView } from "@/modules/dashboard/dashboard-view"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function DashboardPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return (
    <DashboardView
      services={services}
      workspaceId={workspaceId}
      journalsHref={routes.journals(workspaceId)}
      newJournalHref={routes.newJournal(workspaceId)}
      journalHref={(entryId) => routes.journal(workspaceId, entryId)}
    />
  )
}
