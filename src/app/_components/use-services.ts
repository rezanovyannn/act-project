"use client";

import { useSyncExternalStore } from "react";
import { getContainer, type Container } from "@/lib/container";

const subscribe = () => () => {};

/**
 * Mengambil container DI di browser. Mengembalikan `null` saat render server
 * (localStorage belum tersedia), sehingga halaman menampilkan status memuat.
 */
export function useServices(): Container | null {
  return useSyncExternalStore(
    subscribe,
    () => getContainer(),
    () => null,
  );
}
