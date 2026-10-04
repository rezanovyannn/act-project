"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CopyIcon, FilePlus2Icon, FileTextIcon, HandCoinsIcon, PrinterIcon, SearchIcon, XCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { formatDate, todayIsoDate } from "@/core/format"
import { defaultDueDate, INVOICE_STATUS_LABELS, type InvoiceStatus, type InvoiceSummary } from "@/core/invoice"
import type { AppServices } from "@/core/services"
import type { InvoiceData } from "@/core/services/invoice-service"
import type { Invoice, InvoiceKind } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import { cn, errorMessage, useLoader } from "@/lib/utils"
import { InvoiceDocument } from "./invoice-document"
import { InvoiceEditor } from "./invoice-editor"
import { ReceiptDocument } from "./receipt-document"

export interface InvoiceRoutes {
  list: string
  create: string
  invoice: (id: string) => string
  journal: (entryId: string) => string
  credits: string
  contacts: string
  profile: string
}

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: "bg-secondary text-secondary-foreground",
  unpaid: "bg-card text-ink ring-1 ring-border",
  partial: "bg-amber-100 text-amber-800",
  paid: "bg-success-pale text-success-deep",
  overdue: "bg-destructive/10 text-destructive",
  cancelled: "bg-secondary text-muted-foreground line-through",
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge className={cn("border-0", STATUS_STYLES[status])}>{INVOICE_STATUS_LABELS[status]}</Badge>
}

type Filter = "all" | "draft" | "open" | "overdue" | "paid" | "cancelled"
const FILTERS: { value: Filter; label: string; match: (s: InvoiceStatus) => boolean }[] = [
  { value: "all", label: "Semua", match: () => true },
  { value: "draft", label: "Draft", match: (s) => s === "draft" },
  { value: "open", label: "Belum lunas", match: (s) => s === "unpaid" || s === "partial" || s === "overdue" },
  { value: "overdue", label: "Lewat jatuh tempo", match: (s) => s === "overdue" },
  { value: "paid", label: "Lunas", match: (s) => s === "paid" },
  { value: "cancelled", label: "Dibatalkan", match: (s) => s === "cancelled" },
]

const TEXT = {
  sale: {
    title: "Faktur Penjualan",
    description: "Buat faktur untuk tukar faktur dengan pelanggan; saat diterbitkan, piutang langsung tercatat di jurnal.",
    party: "Pelanggan",
    draftTitle: "Draft faktur penjualan",
    newTitle: "Faktur penjualan baru",
    editorDescription: "Simpan sebagai draft dan ubah kapan saja; terbitkan untuk memberi nomor dan mencatat piutang.",
  },
  purchase: {
    title: "Faktur Pembelian",
    description: "Catat faktur dari pemasok dan cetak tanda terimanya untuk tukar faktur; saat diterbitkan, utang langsung tercatat di jurnal.",
    party: "Pemasok",
    draftTitle: "Draft faktur pembelian",
    newTitle: "Faktur pembelian baru",
    editorDescription: "Isi sesuai faktur dari pemasok; terbitkan untuk memberi nomor internal dan mencatat utang.",
  },
} as const

const contactName = (s: InvoiceSummary, data: InvoiceData) =>
  s.invoice.contactSnapshot?.name ?? data.contacts.find((c) => c.id === s.invoice.contactId)?.name ?? "—"

/** Daftar faktur penjualan/pembelian (ADR 022). */
export function InvoicesView({ services, kind, workspaceId, routes }: { services: AppServices; kind: InvoiceKind; workspaceId: string; routes: InvoiceRoutes }) {
  const text = TEXT[kind]
  const data = useLoader(() => services.invoiceService.data(workspaceId, kind), [services, workspaceId, kind])
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const current = data.data!
  const all = services.invoiceService.summaries(current, todayIsoDate())
  const term = search.trim().toLowerCase()
  const rows = all
    .filter((s) => FILTERS.find((f) => f.value === filter)!.match(s.status))
    .filter((s) => !term || [s.invoice.number ?? "draft", contactName(s, current), s.invoice.reference ?? ""].some((t) => t.toLowerCase().includes(term)))
  const open = all.filter((s) => s.status === "unpaid" || s.status === "partial" || s.status === "overdue")
  const overdue = all.filter((s) => s.status === "overdue")

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title={text.title}
        description={text.description}
        actions={
          <Button asChild>
            <Link href={routes.create}><FilePlus2Icon data-icon="inline-start" /> Faktur baru</Link>
          </Button>
        }
      />
      <section aria-label="Ringkasan faktur" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Belum lunas" value={<Amount value={open.reduce((t, s) => t + s.outstanding, 0)} />} note={`${open.length} faktur`} />
        <Stat label="Lewat jatuh tempo" value={<Amount value={overdue.reduce((t, s) => t + s.outstanding, 0)} />} note={`${overdue.length} faktur`} alert={overdue.length > 0} />
        <Stat label="Draft" value={String(all.filter((s) => s.status === "draft").length)} note="belum diterbitkan" />
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter status">
          {FILTERS.map((f) => (
            <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "secondary"} onClick={() => setFilter(f.value)}>
              {f.label}
            </Button>
          ))}
        </div>
        <InputGroup className="max-w-xs">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput aria-label="Cari faktur" placeholder="Nomor, pelanggan, referensi" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
      </div>
      {all.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl bg-card px-4 py-10 text-center">
          <FileTextIcon className="size-8 text-muted-foreground" />
          <p className="font-semibold text-ink">Belum ada faktur</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Isi dulu <Link href={routes.profile} className="underline underline-offset-4">profil usaha</Link> untuk kop faktur, lalu buat faktur baru.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Nomor</th>
                <th className="px-3 py-2.5">Tanggal</th>
                <th className="px-3 py-2.5">{text.party}</th>
                <th className="px-3 py-2.5">Jatuh tempo</th>
                <th className="px-3 py-2.5 text-right">Total</th>
                <th className="px-3 py-2.5 text-right">Sisa</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => (
                <tr key={s.invoice.id} className="hover:bg-card/60">
                  <td className="px-4 py-2.5">
                    <Link href={routes.invoice(s.invoice.id)} className="font-semibold text-ink hover:underline">
                      {s.invoice.number ?? "Draft"}
                    </Link>
                    {s.invoice.reference && <span className="block text-xs text-muted-foreground">{s.invoice.reference}</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{formatDate(s.invoice.invoiceDate)}</td>
                  <td className="px-3 py-2.5 text-ink">{contactName(s, current)}</td>
                  <td className={cn("px-3 py-2.5 tabular-nums", s.status === "overdue" && "font-semibold text-destructive")}>{formatDate(s.invoice.dueDate)}</td>
                  <td className="px-3 py-2.5 text-right"><Amount value={s.total} /></td>
                  <td className="px-3 py-2.5 text-right">{s.status === "draft" || s.status === "cancelled" ? "—" : <Amount value={s.outstanding} />}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={s.status} /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Tidak ada faktur yang cocok.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
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

/** Faktur baru atau detail faktur: draft → editor, terbit → dokumen + aksi. */
export function InvoiceDetailView({
  services,
  kind,
  workspaceId,
  invoiceId,
  routes,
}: {
  services: AppServices
  workspaceId: string
  kind: InvoiceKind
  /** null = faktur baru. */
  invoiceId: string | null
  routes: InvoiceRoutes
}) {
  const router = useRouter()
  const text = TEXT[kind]
  const data = useLoader(() => services.invoiceService.data(workspaceId, kind), [services, workspaceId, kind, invoiceId])

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const current = data.data!
  const invoice = invoiceId ? current.invoices.find((i) => i.id === invoiceId) ?? null : null
  if (invoiceId && !invoice) return <p role="alert" className="text-sm text-destructive">Faktur tidak ditemukan.</p>

  if (!invoice || invoice.status === "draft") {
    return (
      <div className="grid grid-cols-1 gap-5">
        <PageHeader
          title={invoice ? text.draftTitle : text.newTitle}
          description={text.editorDescription}
          actions={<Button variant="secondary" asChild><Link href={routes.list}>Daftar faktur</Link></Button>}
        />
        <InvoiceEditor
          key={invoice?.updatedAt ?? "baru"}
          services={services}
          kind={kind}
          data={current}
          invoice={invoice}
          contactsHref={routes.contacts}
          profileHref={routes.profile}
          onSaved={(saved) => (invoice ? data.reload() : router.replace(routes.invoice(saved.id)))}
          onIssued={(issued) => (invoice ? data.reload() : router.replace(routes.invoice(issued.id)))}
          onDeleted={() => router.replace(routes.list)}
        />
      </div>
    )
  }
  return <IssuedInvoice services={services} data={current} invoice={invoice} routes={routes} onChanged={data.reload} />
}

function IssuedInvoice({
  services,
  data,
  invoice,
  routes,
  onChanged,
}: {
  services: AppServices
  data: InvoiceData
  invoice: Invoice
  routes: InvoiceRoutes
  onChanged: () => void
}) {
  const router = useRouter()
  const today = todayIsoDate()
  const summary = services.invoiceService.summaries({ ...data, invoices: [invoice] }, today)[0]
  const entry = data.journals.find((j) => j.id === invoice.journalEntryId)
  const role = (id: string) => data.accounts.find((a) => a.id === id)?.systemRole
  const isSale = invoice.kind === "sale"
  const total = isSale
    ? entry?.lines.filter((l) => role(l.accountId) === "accounts_receivable").reduce((t, l) => t + l.debit, 0) ?? summary.total
    : entry?.lines.filter((l) => role(l.accountId) === "accounts_payable").reduce((t, l) => t + l.credit, 0) ?? summary.total
  const tax = isSale
    ? entry?.lines.filter((l) => role(l.accountId) === "sales_tax_payable").reduce((t, l) => t + l.credit - l.debit, 0) ?? 0
    : entry?.lines.filter((l) => role(l.accountId) === "input_vat").reduce((t, l) => t + l.debit - l.credit, 0) ?? 0
  const [doc, setDoc] = useState<"receipt" | "copy">(isSale ? "copy" : "receipt")
  const stamp = summary.status === "cancelled" ? "DIBATALKAN" : summary.status === "paid" ? "LUNAS" : null
  const [cancelDate, setCancelDate] = useState(today < invoice.invoiceDate ? invoice.invoiceDate : today)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function cancel() {
    setBusy(true)
    try {
      await services.invoiceService.cancel(invoice, cancelDate, reason.trim() || "dibatalkan")
      toast.success(`Faktur ${invoice.number} dibatalkan`)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function duplicate() {
    try {
      const contact = data.contacts.find((c) => c.id === invoice.contactId)
      const copy = await services.invoiceService.duplicate(invoice, today, defaultDueDate(today, contact))
      toast.success("Disalin ke draft baru")
      router.push(routes.invoice(copy.id))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid gap-3 print:hidden">
        <PageHeader
          title={`Faktur ${invoice.number}`}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <StatusBadge status={summary.status} />
              {summary.status !== "cancelled" && (
                <>
                  Total <Amount value={summary.total} /> · dibayar <Amount value={summary.paid} /> · sisa <Amount value={summary.outstanding} />
                </>
              )}
            </span>
          }
          actions={<Button variant="secondary" asChild><Link href={routes.list}>Daftar faktur</Link></Button>}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => window.print()}>
            <PrinterIcon data-icon="inline-start" /> Cetak / Simpan PDF
          </Button>
          {summary.outstanding > 0 && (
            <Button variant="secondary" asChild>
              <Link href={routes.credits}><HandCoinsIcon data-icon="inline-start" /> {isSale ? "Terima pembayaran" : "Bayar utang"}</Link>
            </Button>
          )}
          {invoice.journalEntryId && (
            <Button variant="secondary" asChild>
              <Link href={routes.journal(invoice.journalEntryId)}><FileTextIcon data-icon="inline-start" /> Lihat jurnal</Link>
            </Button>
          )}
          <Button variant="secondary" onClick={duplicate}>
            <CopyIcon data-icon="inline-start" /> Salin ke draft baru
          </Button>
          {summary.status !== "cancelled" && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" className="text-destructive" disabled={summary.paid > 0}>
                  <XCircleIcon data-icon="inline-start" /> Batalkan faktur
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Batalkan faktur {invoice.number}?</DialogTitle>
                  <DialogDescription>
                    Jurnal {isSale ? "piutang" : "utang"}nya dibalik (void) pada tanggal di bawah. Nomor faktur tetap terpakai; untuk koreksi, salin ke draft baru lalu terbitkan ulang.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
                  <div className="grid gap-2">
                    <Label htmlFor="cancel-date">Tanggal pembatalan</Label>
                    <Input id="cancel-date" type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="cancel-reason">Alasan</Label>
                    <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah harga" />
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="secondary">Kembali</Button></DialogClose>
                  <DialogClose asChild><Button variant="destructive" disabled={busy} onClick={cancel}>Batalkan faktur</Button></DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {summary.paid > 0 && summary.status !== "cancelled" && (
          <p className="text-xs text-muted-foreground">Faktur yang sudah ada pembayaran tidak dapat dibatalkan; void pelunasannya dulu di Piutang & Utang.</p>
        )}
        {!isSale && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dokumen yang dicetak">
            <span className="text-sm text-muted-foreground">Dokumen:</span>
            <Button size="sm" variant={doc === "receipt" ? "default" : "secondary"} onClick={() => setDoc("receipt")}>Tanda terima faktur</Button>
            <Button size="sm" variant={doc === "copy" ? "default" : "secondary"} onClick={() => setDoc("copy")}>Salinan faktur</Button>
          </div>
        )}
      </div>
      {doc === "receipt" ? (
        <ReceiptDocument invoice={invoice} profile={data.profile} workspaceName={data.workspace.name} total={total} stamp={stamp} />
      ) : (
      <InvoiceDocument
        invoice={invoice}
        profile={data.profile}
        workspaceName={data.workspace.name}
        contact={invoice.contactSnapshot}
        totals={{ base: total - tax, tax, total }}
        taxLabel={isSale ? data.workspace.salesTaxLabel : "PPN Masukan"}
        taxInclusive={isSale && data.workspace.salesTaxInclusive}
        stamp={stamp}
      />
      )}
    </div>
  )
}
