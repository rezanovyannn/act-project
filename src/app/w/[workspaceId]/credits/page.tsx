"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { CreditsView } from "@/modules/transactions/credits-view"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function CreditsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return (
    <CreditsView
      services={services}
      workspaceId={workspaceId}
      journalHref={(entryId) => routes.journal(workspaceId, entryId)}
    />
  )
}
