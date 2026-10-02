"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { DashboardView } from "@/modules/dashboard/dashboard-view"
import { routes, TOPBAR_SLOT_ID } from "@/app/_components/routes"
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
      journalHref={(entryId) => routes.journal(workspaceId, entryId)}
      creditsHref={routes.credits(workspaceId)}
      cashFlowHref={`${routes.reports(workspaceId)}?tab=cash`}
      topBarSlotId={TOPBAR_SLOT_ID}
    />
  )
}
