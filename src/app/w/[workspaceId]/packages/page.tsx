"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { PackagesView } from "@/modules/catering/packages-view"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function PackagesPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return <PackagesView services={services} workspaceId={workspaceId} itemsHref={routes.inventoryItems(workspaceId)} />
}
