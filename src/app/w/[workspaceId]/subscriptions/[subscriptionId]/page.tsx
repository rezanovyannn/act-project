"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { SubscriptionDetailView } from "@/modules/catering/subscriptions-view"
import { orderRoutes } from "@/app/_components/order-routes"
import { useServices } from "@/app/_components/use-services"

export default function SubscriptionPage() {
  const { workspaceId, subscriptionId } = useParams<{ workspaceId: string; subscriptionId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return <SubscriptionDetailView services={services} workspaceId={workspaceId} subscriptionId={subscriptionId} routes={orderRoutes(workspaceId)} />
}
