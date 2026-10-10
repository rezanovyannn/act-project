"use client"

import type { AppServices } from "@/core/services"
import { ContactDialog } from "@/modules/invoices/contacts-view"
import type { ContactDialogRenderer } from "@/modules/catering/order-editor"
import type { OrderRoutes } from "@/modules/catering/orders-view"
import { routes } from "./routes"

/** URL yang dipakai modul katering (ADR 024). */
export function orderRoutes(workspaceId: string): OrderRoutes {
  return {
    list: routes.orders(workspaceId),
    create: routes.newOrder(workspaceId),
    order: (id) => routes.order(workspaceId, id),
    invoice: (id) => routes.invoice(workspaceId, id),
    journal: (entryId) => routes.journal(workspaceId, entryId),
    contacts: routes.contacts(workspaceId),
    profile: routes.settings(workspaceId, "profile"),
    tax: routes.settings(workspaceId, "tax"),
  }
}

/** Dialog kontak modul faktur diteruskan ke modul katering lewat composition root. */
export function contactDialogFor(services: AppServices, workspaceId: string): ContactDialogRenderer {
  return function OrderContactDialog({ onClose, onSaved }) {
    return (
      <ContactDialog services={services} workspaceId={workspaceId} contact={null} defaults={{ isCustomer: true }} withCancellationPolicy onClose={onClose} onSaved={onSaved} />
    )
  }
}
