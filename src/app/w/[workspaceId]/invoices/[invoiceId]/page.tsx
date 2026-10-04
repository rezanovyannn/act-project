"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { InvoiceDetailView } from "@/modules/invoices/invoices-view"
import { invoiceRoutes } from "@/app/_components/invoice-routes"
import { useServices } from "@/app/_components/use-services"

export default function InvoicePage() {
  const { workspaceId, invoiceId } = useParams<{ workspaceId: string; invoiceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return <InvoiceDetailView services={services} workspaceId={workspaceId} invoiceId={invoiceId} routes={invoiceRoutes(workspaceId)} />
}
