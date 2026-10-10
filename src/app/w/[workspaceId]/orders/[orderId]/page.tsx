"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { OrderDetailView } from "@/modules/catering/order-detail"
import { contactDialogFor, orderRoutes } from "@/app/_components/order-routes"
import { useServices } from "@/app/_components/use-services"

export default function OrderPage() {
  const { workspaceId, orderId } = useParams<{ workspaceId: string; orderId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return <OrderDetailView services={services} workspaceId={workspaceId} orderId={orderId} routes={orderRoutes(workspaceId)} renderContactDialog={contactDialogFor(services, workspaceId)} />
}
