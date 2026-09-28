"use client"

import { useParams } from "next/navigation"
import { LoadingState } from "@/components/ui/page-header"
import { TransactionsView } from "@/modules/transactions/transactions-view"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"

export default function TransactionsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  if (!services) return <LoadingState />
  return (
    <TransactionsView
      services={services}
      workspaceId={workspaceId}
      journalHref={(entryId) => routes.journal(workspaceId, entryId)}
    />
  )
}
