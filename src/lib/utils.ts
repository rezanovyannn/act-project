import { useCallback, useEffect, useState } from "react"
import { AccountingError } from "@/core/errors"

export { cn } from "cn"

/** Pesan error yang ramah pengguna dari error apa pun. */
export function errorMessage(error: unknown): string {
  if (error instanceof AccountingError) {
    return error.issues.map((issue) => issue.message).join(". ")
  }
  if (error instanceof Error) return error.message
  return "Terjadi kesalahan yang tidak diketahui"
}

export interface Loader<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => void
}

/**
 * Memuat data async (mis. dari repository) dan memuat ulang saat `deps`
 * berubah atau `reload()` dipanggil setelah mutasi.
 */
export function useLoader<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): Loader<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({
    loading: true,
  })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    load().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (error: unknown) => !cancelled && setState({ error, loading: false }),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { data: state.data, error: state.error, loading: state.loading, reload }
}
