"use client"

import { useParams, useSearchParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { StockOpnameView } from "@/modules/inventory/stock-opname-form"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function StockOpnamePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  const tab = useSearchParams().get("tab")
  if (!services) return <LoadingState />
  return (
    <StockOpnameView
      services={services}
      workspaceId={workspaceId}
      journalHref={(entryId) => routes.journal(workspaceId, entryId)}
      itemsHref={routes.inventoryItems(workspaceId)}
      settingsHref={routes.settings(workspaceId, "inventory")}
      menusHref={routes.inventoryMenus(workspaceId)}
      initialTab={tab}
    />
  )
}
