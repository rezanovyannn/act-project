/** Kebijakan DP saat pesanan katering dibatalkan (ADR 024). */
import { fail } from "./errors";
import type { CancellationPolicy } from "./types";

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = { kind: "refund", forfeitBps: 0 };

/** 1250 → "12,5%". */
const percent = (bps: number) => `${(bps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

/** "DP dikembalikan penuh", "DP hangus 50%, sisanya dikembalikan", "DP hangus seluruhnya". */
export function policyLabel(policy: CancellationPolicy): string {
  if (policy.kind === "forfeit_all") return "DP hangus seluruhnya";
  if (policy.kind === "forfeit_percent") return `DP hangus ${percent(policy.forfeitBps)}, sisanya dikembalikan`;
  return "DP dikembalikan penuh";
}

export function validatePolicy(policy: CancellationPolicy | null | undefined): CancellationPolicy {
  if (!policy) return { ...DEFAULT_CANCELLATION_POLICY };
  if (!["refund", "forfeit_percent", "forfeit_all"].includes(policy.kind)) fail("INVALID_ORDER", "Kebijakan pembatalan tidak dikenal");
  if (policy.kind !== "forfeit_percent") return { kind: policy.kind, forfeitBps: 0 };
  if (!Number.isSafeInteger(policy.forfeitBps) || policy.forfeitBps <= 0 || policy.forfeitBps >= 10_000) {
    fail("INVALID_ORDER", "Persen DP hangus harus lebih dari 0% dan kurang dari 100%");
  }
  return { kind: "forfeit_percent", forfeitBps: policy.forfeitBps };
}
