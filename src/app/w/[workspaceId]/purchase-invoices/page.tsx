"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { InvoicesView } from "@/modules/invoices/invoices-view"
import { invoiceRoutes } from "@/app/_components/invoice-routes"
import { useServices } from "@/app/_components/use-services"

export default function PurchaseInvoicesPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return <InvoicesView services={services} kind="purchase" workspaceId={workspaceId} routes={invoiceRoutes(workspaceId, "purchase")} />
}
