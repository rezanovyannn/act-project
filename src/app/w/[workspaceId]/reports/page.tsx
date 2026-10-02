"use client"

import { useParams, useSearchParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { ReportsView } from "@/modules/reports/reports-view"
import { useServices } from "@/app/_components/use-services"

export default function ReportsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  const tab = useSearchParams().get("tab")
  if (!services) return <LoadingState />
  return <ReportsView services={services} workspaceId={workspaceId} initialTab={tab} />
}
