"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { ContactsView } from "@/modules/invoices/contacts-view"
import { useServices } from "@/app/_components/use-services"

export default function ContactsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return <ContactsView services={services} workspaceId={workspaceId} />
}
