"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getContainer, type Container } from "@/lib/container";

/**
 * Container DI di browser. `null` selama memuat; bila belum login (mode
 * Supabase) pengguna diarahkan ke halaman login.
 */
export function useServices(): Container | null {
  const [container, setContainer] = useState<Container | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    getContainer().then((result) => {
      if (cancelled) return;
      if (result) setContainer(result);
      else router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return container;
}
