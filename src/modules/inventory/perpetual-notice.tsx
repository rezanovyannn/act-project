import Link from "next/link"
import { InfoIcon } from "lucide-react"

/** Petunjuk untuk halaman yang hanya berlaku pada metode perpetual (ADR 017). */
export function PerpetualNotice({ settingsHref, feature }: { settingsHref: string; feature: string }) {
  return (
    <div role="note" className="flex gap-3 rounded-lg bg-card px-4 py-4 text-sm text-ink">
      <InfoIcon className="mt-0.5 size-4 shrink-0" />
      <p>
        {feature} tersedia pada metode persediaan <strong>perpetual</strong>. Workspace ini masih memakai metode
        periodik.{" "}
        <Link href={settingsHref} className="font-semibold underline underline-offset-4">
          Ubah di Pengaturan → Persediaan
        </Link>
        .
      </p>
    </div>
  )
}
