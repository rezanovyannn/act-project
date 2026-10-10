"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { ContactsView } from "@/modules/invoices/contacts-view"
import { useLoader } from "@/lib/utils"
import { useServices } from "@/app/_components/use-services"

export default function ContactsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  const workspace = useLoader(async () => (services ? services.workspaces.getById(workspaceId) : null), [services, workspaceId])
  if (!services || workspace.loading) return <LoadingState />
  return <ContactsView services={services} workspaceId={workspaceId} withCancellationPolicy={workspace.data?.templateType === "catering"} />
}
