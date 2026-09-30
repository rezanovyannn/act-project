"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { PurchaseView } from "@/modules/inventory/purchase-form"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function InventoryPurchasesPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return (
    <PurchaseView
      services={services}
      workspaceId={workspaceId}
      journalHref={(entryId) => routes.journal(workspaceId, entryId)}
    />
  )
}
