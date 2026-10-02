import * as React from "react"
import { cn } from "cn"

function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border-2 border-dashed px-6 py-12 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

function LoadingState({ label = "Memuat data…" }: { label?: string }) {
  return (
    <div role="status" className="py-12 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export { EmptyState, LoadingState, PageHeader }
