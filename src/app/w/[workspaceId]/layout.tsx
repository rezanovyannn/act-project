"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { EmptyState, LoadingState } from "@/components/ui/page-header"
import { useLoader } from "@/lib/utils"
import { routes } from "@/app/_components/routes"
import { useServices } from "@/app/_components/use-services"
import { AppShell } from "./_components/app-shell"

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const services = useServices()
  const workspace = useLoader(
    async () => (services ? services.workspaces.getById(workspaceId) : undefined),
    [services, workspaceId],
  )

  if (!services || workspace.loading || workspace.data === undefined) {
    return <LoadingState />
  }
  if (workspace.data === null) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <EmptyState title="Workspace tidak ditemukan">
          <Link href={routes.workspaces()} className="underline">
            Kembali ke daftar workspace
          </Link>
        </EmptyState>
      </main>
    )
  }
  return (
    <AppShell services={services} workspaceId={workspaceId} templateType={workspace.data.templateType}>
      {children}
    </AppShell>
  )
}
