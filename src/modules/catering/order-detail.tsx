"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BadgeCheckIcon,
  CoinsIcon,
  CheckCircle2Icon,
  FileTextIcon,
  HandCoinsIcon,
  PencilIcon,
  PrinterIcon,
  ReceiptTextIcon,
  Trash2Icon,
  Undo2Icon,
  XCircleIcon,
} from "lucide-react"
import { toast } from "sonner"
import { policyLabel, SERVICE_TYPE_LABELS, type OrderSummary } from "@/core/catering"
import { formatDate, formatNumber, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import type { CateringData } from "@/core/services/catering-service"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { cn, errorMessage, useLoader } from "@/lib/utils"
import { BillDialog, CancelDialog, CompleteDialog, CostDialog, PaymentDialog } from "./order-dialogs"
import { OrderProfitPanel } from "./order-profit"
import { BillDocument, QuotationDocument } from "./order-documents"
import { OrderEditor, type ContactDialogRenderer } from "./order-editor"
import { OrderStatusBadge, PaymentBadge, type OrderRoutes } from "./orders-view"

type DialogKind = "receive" | "refund" | "bill" | "complete" | "cancel" | "cost" | null

/** Pesanan baru atau detail pesanan (ADR 024). */
export function OrderDetailView({
  services,
  workspaceId,
  orderId,
  routes,
  renderContactDialog,
}: {
  services: AppServices
  workspaceId: string
  /** null = penawaran baru. */
  orderId: string | null
  routes: OrderRoutes
  renderContactDialog: ContactDialogRenderer
}) {
  const router = useRouter()
  const data = useLoader(() => services.cateringService.data(workspaceId), [services, workspaceId, orderId])
  const [editing, setEditing] = useState(false)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const current = data.data!
  const order = orderId ? current.orders.find((o) => o.id === orderId) ?? null : null
  if (orderId && !order) return <p role="alert" className="text-sm text-destructive">Pesanan tidak ditemukan.</p>

  if (!order || editing) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <PageHeader
          title={order ? `Ubah pesanan ${order.number}` : "Penawaran baru"}
          description="Isi klien, detail acara, dan rincian harga. Penawaran bisa dicetak sebagai Quotation/SPH dan diubah sampai pesanan selesai."
          actions={<Button variant="secondary" asChild><Link href={routes.list}>Daftar pesanan</Link></Button>}
        />
        <OrderEditor
          key={order?.updatedAt ?? "baru"}
          services={services}
          data={current}
          order={order}
          contactsHref={routes.contacts}
          profileHref={routes.profile}
          taxHref={routes.tax}
          renderContactDialog={renderContactDialog}
          onCancel={order ? () => setEditing(false) : undefined}
          onSaved={(saved) => {
            setEditing(false)
            if (order) data.reload()
            else router.replace(routes.order(saved.id))
          }}
        />
      </div>
    )
  }
  const summary = services.cateringService.summaries(current, todayIsoDate()).find((s) => s.order.id === order.id)!
  return <OrderDetail services={services} data={current} summary={summary} routes={routes} onEdit={() => setEditing(true)} onChanged={data.reload} />
}

function OrderDetail({
  services,
  data,
  summary,
  routes,
  onEdit,
  onChanged,
}: {
  services: AppServices
  data: CateringData
  summary: OrderSummary
  routes: OrderRoutes
  onEdit: () => void
  onChanged: () => void
}) {
  const router = useRouter()
  const today = todayIsoDate()
  const { order, totals, deposit } = summary
  const contact = data.contacts.find((c) => c.id === order.contactId) ?? null
  const bills = services.cateringService.billSummaries(data, today).filter((b) => b.bill.orderId === order.id)
  const [doc, setDoc] = useState<string>("quotation")
  const [dialog, setDialog] = useState<DialogKind>(null)
  const open = order.state === "quotation" || order.state === "confirmed"
  const shownBill = bills.find((b) => b.bill.id === doc) ?? null
  const payments = data.journals
    .filter((j) => j.status === "posted" && j.deletedAt === null && j.lines.some((l) => l.orderId === order.id))
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? "").localeCompare(b.entryNumber ?? ""))
  const reversed = new Set(payments.filter((j) => j.reversalOf).map((j) => j.reversalOf))
  const profit = services.cateringService.profits(data).get(order.id)!

  const close = () => setDialog(null)
  const done = () => {
    setDialog(null)
    onChanged()
  }

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      toast.success(message)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function remove() {
    try {
      await services.cateringService.deleteOrder(order.id)
      toast.success(`Penawaran ${order.number} dihapus`)
      router.replace(routes.list)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid gap-4 print:hidden">
        <PageHeader
          title={`Pesanan ${order.number}`}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={summary.status} />
              <PaymentBadge status={summary.paymentStatus} />
              {contact?.name} · {SERVICE_TYPE_LABELS[order.serviceType]} · {formatDate(order.eventDate)}{order.eventTime ? ` ${order.eventTime}` : ""} · {formatNumber(order.pax)} pax
            </span>
          }
          actions={<Button variant="secondary" asChild><Link href={routes.list}>Daftar pesanan</Link></Button>}
        />

        <section aria-label="Ringkasan pembayaran" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total pesanan" value={<Amount value={summary.invoice?.total ?? totals.total} />} note={totals.total > 0 ? `≈ Rp ${formatNumber(Math.round((summary.invoice?.total ?? totals.total) / order.pax))}/pax` : ""} />
          <Stat label="DP diterima" value={<Amount value={deposit.received - deposit.refunded - deposit.forfeited} />} note={deposit.applied > 0 ? `dipakai untuk faktur Rp ${formatNumber(deposit.applied)}` : `saldo Uang Muka Rp ${formatNumber(deposit.balance)}`} />
          <Stat label="Sudah dibayar" value={<Amount value={summary.paid} />} note={order.state === "completed" ? "DP + pelunasan" : "DP"} />
          <Stat label="Sisa belum dibayar" value={<Amount value={summary.outstanding} />} note={summary.excessDeposit > 0 ? `kelebihan DP Rp ${formatNumber(summary.excessDeposit)}` : order.state === "completed" ? "piutang faktur" : ""} alert={summary.paymentStatus === "overdue"} />
        </section>

        <div className="flex flex-wrap gap-2">
          {order.state === "quotation" && (
            <Button onClick={() => run(() => services.cateringService.confirm(order), `Pesanan ${order.number} dikonfirmasi`)}>
              <BadgeCheckIcon data-icon="inline-start" /> Konfirmasi pesanan
            </Button>
          )}
          {open && (
            <Button variant={order.state === "quotation" ? "secondary" : "default"} onClick={() => setDialog("receive")}>
              <HandCoinsIcon data-icon="inline-start" /> Terima DP
            </Button>
          )}
          {order.state === "confirmed" && (
            <Button onClick={() => setDialog("complete")}>
              <CheckCircle2Icon data-icon="inline-start" /> Selesaikan pesanan
            </Button>
          )}
          {order.state === "completed" && summary.outstanding > 0 && (
            <Button onClick={() => setDialog("receive")}>
              <HandCoinsIcon data-icon="inline-start" /> Terima pelunasan
            </Button>
          )}
          {summary.excessDeposit > 0 && (
            <Button variant="secondary" onClick={() => setDialog("refund")}>
              <Undo2Icon data-icon="inline-start" /> Kembalikan kelebihan DP
            </Button>
          )}
          {order.state !== "quotation" && (
            <Button variant="secondary" onClick={() => setDialog("cost")}>
              <CoinsIcon data-icon="inline-start" /> Catat biaya
            </Button>
          )}
          {open && (
            <Button variant="secondary" onClick={() => setDialog("bill")}>
              <ReceiptTextIcon data-icon="inline-start" /> Buat invoice DP
            </Button>
          )}
          {order.invoiceId && (
            <Button variant="secondary" asChild>
              <Link href={routes.invoice(order.invoiceId)}><FileTextIcon data-icon="inline-start" /> Faktur pelunasan</Link>
            </Button>
          )}
          {open && (
            <Button variant="secondary" onClick={onEdit}>
              <PencilIcon data-icon="inline-start" /> Ubah
            </Button>
          )}
          {open && (
            <Button variant="ghost" className="text-destructive" onClick={() => setDialog("cancel")}>
              <XCircleIcon data-icon="inline-start" /> Batalkan
            </Button>
          )}
          {order.state === "quotation" && deposit.received === 0 && bills.length === 0 && (
            <Button variant="ghost" className="text-destructive" onClick={remove}>
              <Trash2Icon data-icon="inline-start" /> Hapus penawaran
            </Button>
          )}
        </div>
        {order.state === "cancelled" && (
          <p className="rounded-2xl bg-card px-4 py-3 text-sm text-ink">Dibatalkan {order.cancelledAt ? formatDate(order.cancelledAt.slice(0, 10)) : ""}: {order.cancelReason}</p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid content-start gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
            <h2 className="font-bold text-ink">Detail pesanan</h2>
            <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Klien</dt><dd className="text-ink">{contact?.name ?? "—"}{contact?.phone ? ` · ${contact.phone}` : ""}</dd>
              <dt className="text-muted-foreground">Lokasi</dt><dd className="whitespace-pre-line">{order.location ?? "—"}</dd>
              <dt className="text-muted-foreground">Penawaran</dt><dd>{formatDate(order.quoteDate)}, berlaku s.d. {formatDate(order.validUntil)}</dd>
              <dt className="text-muted-foreground">Pembatalan</dt><dd>{policyLabel(order.cancellationPolicy)}</dd>
              {order.notes && (<><dt className="text-muted-foreground">Catatan</dt><dd className="whitespace-pre-line">{order.notes}</dd></>)}
            </dl>
          </section>
          <section className="grid content-start gap-2 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-border">
            <h2 className="font-bold text-ink">Riwayat pembayaran, biaya & jurnal</h2>
            {payments.length === 0 ? (
              <p className="text-muted-foreground">Belum ada pembayaran. DP yang diterima tercatat otomatis sebagai Uang Muka Pelanggan.</p>
            ) : (
              <ul className="divide-y">
                {payments.map((j) => (
                  <li key={j.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-1.5", (reversed.has(j.id) || j.source === "reversal") && "text-muted-foreground line-through")}>
                    <span>
                      <Link href={routes.journal(j.id)} className="font-medium text-ink hover:underline">{j.entryNumber}</Link>{" "}
                      <span className="text-muted-foreground">{formatDate(j.entryDate)} · {j.description}</span>
                    </span>
                    <Amount value={j.lines.reduce((t, l) => t + l.debit, 0)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {order.state !== "quotation" && <OrderProfitPanel data={data} profit={profit} pax={order.pax} />}

        {bills.length > 0 && (
          <section className="grid gap-2">
            <h2 className="text-sm font-bold text-ink">Invoice DP</h2>
            <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-2">Nomor</th>
                    <th className="px-3 py-2">Tanggal</th>
                    <th className="px-3 py-2">Jatuh tempo</th>
                    <th className="px-3 py-2 text-right">Nominal</th>
                    <th className="px-3 py-2 text-right">Dibayar</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bills.map((b) => (
                    <tr key={b.bill.id}>
                      <td className="px-4 py-2 font-medium text-ink">{b.bill.number}{b.bill.note && <span className="block text-xs text-muted-foreground">{b.bill.note}</span>}</td>
                      <td className="px-3 py-2 tabular-nums">{formatDate(b.bill.billDate)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatDate(b.bill.dueDate)}</td>
                      <td className="px-3 py-2 text-right"><Amount value={b.bill.amount} /></td>
                      <td className="px-3 py-2 text-right"><Amount value={b.paid} /></td>
                      <td className="px-3 py-2"><PaymentBadge status={b.status} /></td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setDoc(b.bill.id)}>Tampilkan</Button>
                          {open && (
                            <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Hapus invoice DP ${b.bill.number}`}
                              onClick={() => run(async () => { await services.cateringService.deleteBill(b.bill.id); if (doc === b.bill.id) setDoc("quotation") }, `Invoice DP ${b.bill.number} dihapus`)}>
                              <Trash2Icon />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dokumen yang dicetak">
          <span className="text-sm text-muted-foreground">Dokumen:</span>
          <Button size="sm" variant={doc === "quotation" ? "default" : "secondary"} onClick={() => setDoc("quotation")}>
            {order.number.startsWith("SPH") ? "Surat penawaran harga" : "Quotation"}
          </Button>
          {bills.map((b) => (
            <Button key={b.bill.id} size="sm" variant={doc === b.bill.id ? "default" : "secondary"} onClick={() => setDoc(b.bill.id)}>{b.bill.number}</Button>
          ))}
          <Button size="sm" className="ml-auto" onClick={() => window.print()}>
            <PrinterIcon data-icon="inline-start" /> Cetak / Simpan PDF
          </Button>
        </div>
      </div>

      {shownBill ? (
        <BillDocument bill={shownBill.bill} order={order} orderTotal={totals.total} profile={data.profile} workspaceName={data.workspace.name} contact={contact} stamp={shownBill.status === "paid" ? "LUNAS" : order.state === "cancelled" ? "DIBATALKAN" : null} />
      ) : (
        <QuotationDocument
          order={order}
          totals={totals}
          profile={data.profile}
          workspaceName={data.workspace.name}
          contact={contact}
          taxLabel={data.workspace.salesTaxLabel}
          taxInclusive={data.workspace.salesTaxInclusive}
          stamp={order.state === "cancelled" ? "DIBATALKAN" : null}
        />
      )}

      {(dialog === "receive" || dialog === "refund") && <PaymentDialog services={services} data={data} summary={summary} mode={dialog} onClose={close} onDone={done} />}
      {dialog === "bill" && <BillDialog services={services} data={data} summary={summary} onClose={close} onDone={(id) => { done(); setDoc(id) }} />}
      {dialog === "complete" && <CompleteDialog services={services} data={data} summary={summary} onClose={close} onDone={done} />}
      {dialog === "cost" && <CostDialog services={services} data={data} summary={summary} onClose={close} onDone={done} />}
      {dialog === "cancel" && <CancelDialog services={services} data={data} summary={summary} onClose={close} onDone={done} />}
    </div>
  )
}

function Stat({ label, value, note, alert }: { label: string; value: React.ReactNode; note: string; alert?: boolean }) {
  return (
    <div className="grid gap-1 rounded-2xl bg-canvas p-4 ring-1 ring-border">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-bold tabular-nums", alert ? "text-destructive" : "text-ink")}>{value}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  )
}
