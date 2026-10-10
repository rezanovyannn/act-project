"use client"

import { useParams, useSearchParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { OrdersView } from "@/modules/catering/orders-view"
import { orderRoutes } from "@/app/_components/order-routes"
import { useServices } from "@/app/_components/use-services"

export default function OrdersPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const tab = useSearchParams().get("tab") ?? undefined
  const services = useServices()
  if (!services) return <LoadingState />
  return <OrdersView services={services} workspaceId={workspaceId} routes={orderRoutes(workspaceId)} initialTab={tab} />
}
