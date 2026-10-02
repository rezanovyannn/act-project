import { AppLogo } from "@/components/ui/app-logo"

/**
 * Tata letak halaman autentikasi (redesign Okt 2026): latar lembut, kartu utama
 * berlogo, dan kartu sekunder opsional (mis. tautan daftar/masuk).
 */
export function AuthCard({
  title,
  description,
  children,
  aside,
}: {
  /** Judul halaman untuk pembaca layar (logo menggantikannya secara visual). */
  title: string
  description: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_28rem_at_15%_35%,color-mix(in_oklab,var(--primary)_8%,transparent),transparent),radial-gradient(36rem_24rem_at_85%_80%,color-mix(in_oklab,#f5c518_10%,transparent),transparent)]"
      />
      <div className="relative grid w-full max-w-md gap-4">
        <section className="grid gap-8 rounded-[32px] bg-canvas px-6 py-10 ring-1 ring-border sm:px-10">
          <div className="grid justify-items-center gap-3 text-center">
            <AppLogo size="lg" />
            <h1 className="sr-only">{title}</h1>
            <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </section>
        {aside && (
          <section className="rounded-[32px] bg-canvas px-6 py-5 text-center text-sm text-muted-foreground ring-1 ring-border">
            {aside}
          </section>
        )}
        <p className="text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Pembukuan · Basis akrual · SAK EMKM</p>
      </div>
    </main>
  )
}
