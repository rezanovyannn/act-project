import type { InvoiceRoutes } from "@/modules/invoices/invoices-view"
import { routes } from "./routes"

/** URL yang dipakai modul faktur (ADR 022). */
export function invoiceRoutes(workspaceId: string): InvoiceRoutes {
  return {
    list: routes.invoices(workspaceId),
    create: routes.newInvoice(workspaceId),
    invoice: (id) => routes.invoice(workspaceId, id),
    journal: (entryId) => routes.journal(workspaceId, entryId),
    credits: routes.credits(workspaceId),
    contacts: routes.contacts(workspaceId),
    profile: routes.settings(workspaceId, "profile"),
  }
}
