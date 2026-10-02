import { NotebookTextIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Logo aplikasi: ikon merah + wordmark "Pembukuan." (DESIGN_SYSTEM.md). */
export function AppLogo({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const large = size === "lg"
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-bold text-ink", large ? "text-3xl" : "text-lg", className)}>
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center bg-primary text-primary-foreground",
          large ? "size-12 rounded-xl" : "size-7 rounded-lg",
        )}
      >
        <NotebookTextIcon className={large ? "size-7" : "size-4"} />
      </span>
      <span className="tracking-tight">
        Pembukuan<span className="text-primary">.</span>
      </span>
    </span>
  )
}
