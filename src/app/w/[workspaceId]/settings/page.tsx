"use client"

import { useParams, useSearchParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { SettingsView } from "@/modules/settings/settings-view"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function SettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  const tab = useSearchParams().get("tab")
  if (!services) return <LoadingState />
  return (
    <SettingsView
      services={services}
      workspaceId={workspaceId}
      journalHref={(entryId) => routes.journal(workspaceId, entryId)}
      initialTab={tab}
      itemsHref={routes.inventoryItems(workspaceId)}
    />
  )
}
