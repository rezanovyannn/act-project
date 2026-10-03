"use client"

import { useParams, useSearchParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { MenusView } from "@/modules/inventory/menus-view"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function InventoryMenusPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  const tab = useSearchParams().get("tab")
  if (!services) return <LoadingState />
  return (
    <MenusView
      services={services}
      workspaceId={workspaceId}
      itemsHref={routes.inventoryItems(workspaceId)}
      menuSaleHref={routes.transactions(workspaceId, "menu_sale")}
      varianceHref={routes.inventoryStockOpname(workspaceId, "variance")}
      initialTab={tab}
    />
  )
}
