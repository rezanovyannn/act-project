"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  buildCancellation,
  buildDepositReceipt,
  buildDepositRefund,
  buildOrderSettlement,
  forfeitAmount,
  policyLabel,
  type OrderSummary,
} from "@/core/catering"
import { addDays } from "@/core/dates"
import { formatDate, todayIsoDate } from "@/core/format"
import { mulDivRound } from "@/core/stock"
import { parsePercentBps, PENDING_DISCOUNT_ACCOUNT_ID, withDiscountAccount } from "@/core/invoice"
import type { AppServices } from "@/core/services"
import type { CateringData } from "@/core/services/catering-service"
import type { CancellationPolicy, JournalEntryInput } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
import { Button } from "@/components/ui/button"
import { CancellationPolicyField } from "@/components/ui/cancellation-policy-field"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { JournalPreview } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { errorMessage } from "@/lib/utils"

const clientName = (data: CateringData, summary: OrderSummary) => data.contacts.find((c) => c.id === summary.order.contactId)?.name ?? "Klien"

/** Rekening kas/bank tanpa pilihan awal: dipilih setiap kali (Catatan Keputusan 85). */
function CashAccountSelect({ data, value, onChange, label }: { data: CateringData; value: string; onChange: (id: string) => void; label: string }) {
  const cash = data.accounts.filter((a) => a.isCash && a.isActive && a.deletedAt === null)
  return (
    <div className="grid gap-2">
      <Label htmlFor="order-cash-account">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="order-cash-account" className="w-full bg-background"><SelectValue placeholder="Pilih rekening kas/bank" /></SelectTrigger>
        <SelectContent>
          {cash.map((a) => (
            <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function tryBuild<T>(build: () => T): { value: T | null; error: string | null } {
  try {
    return { value: build(), error: null }
  } catch (e) {
    return { value: null, error: errorMessage(e) }
  }
}

/**
 * Terima pembayaran (DP sebelum selesai, pelunasan sesudahnya) atau kembalikan
 * kelebihan DP; jurnal dibuat otomatis (Catatan Keputusan 83).
 */
export function PaymentDialog({
  services,
  data,
  summary,
  mode,
  onClose,
  onDone,
}: {
  services: AppServices
  data: CateringData
  summary: OrderSummary
  mode: "receive" | "refund"
  onClose: () => void
  onDone: () => void
}) {
  const { order } = summary
  const today = todayIsoDate()
  const suggested = mode === "refund" ? summary.excessDeposit : summary.outstanding
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState<number | null>(suggested > 0 ? suggested : null)
  const [cashAccountId, setCashAccountId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = clientName(data, summary)
  const payment = { date, amount: amount ?? 0, cashAccountId }
  const completed = order.state === "completed"
  const invoiceJournal = completed ? data.journals.find((j) => j.id === data.invoices.find((i) => i.id === order.invoiceId)?.journalEntryId) : undefined

  const plan = cashAccountId && amount
    ? tryBuild<JournalEntryInput>(() =>
        mode === "refund"
          ? buildDepositRefund(order, name, payment, summary.deposit.balance, data.accounts)
          : completed && invoiceJournal
            ? buildOrderSettlement(order, name, invoiceJournal, payment, data.accounts)
            : buildDepositReceipt(order, name, payment, data.accounts),
      )
    : { value: null, error: null }

  const title = mode === "refund" ? "Kembalikan kelebihan DP" : completed ? "Terima pelunasan" : "Terima DP"
  const description =
    mode === "refund"
      ? `Saldo DP ${order.number} yang belum terpakai dikembalikan ke klien.`
      : completed
        ? `Pelunasan faktur pesanan ${order.number}; mengurangi piutang klien.`
        : `Uang muka dicatat sebagai Uang Muka Pelanggan (utang) sampai pesanan selesai.${order.state === "quotation" ? " Penawaran otomatis dikonfirmasi." : ""}`

  async function submit() {
    setError(null)
    if (!cashAccountId) return setError("Pilih rekening kas/bank")
    setBusy(true)
    try {
      const entry =
        mode === "refund"
          ? await services.cateringService.refundDeposit(order, payment)
          : await services.cateringService.receivePayment(order, payment)
      toast.success(`${title}: jurnal ${entry.entryNumber} diposting`)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title} · {order.number}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="payment-date">Tanggal</Label>
            <Input id="payment-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="payment-amount">Nominal</Label>
            <AmountInput id="payment-amount" value={amount} onValueChange={setAmount} />
          </div>
        </div>
        <CashAccountSelect data={data} value={cashAccountId} onChange={setCashAccountId} label={mode === "refund" ? "Dibayar dari rekening" : "Masuk ke rekening"} />
        {mode === "receive" && suggested > 0 && (
          <p className="text-xs text-muted-foreground">Sisa yang belum dibayar: <Amount value={suggested} /></p>
        )}
        {plan.value && <JournalPreview lines={plan.value.lines} accounts={data.accounts} title="Jurnal otomatis" />}
        {(error ?? plan.error) && <p role="alert" className="text-sm text-destructive">{error ?? plan.error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !plan.value} onClick={submit}>{busy ? "Menyimpan…" : title}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Buat invoice DP (dokumen tagihan tanpa jurnal). */
export function BillDialog({
  services,
  data,
  summary,
  onClose,
  onDone,
}: {
  services: AppServices
  data: CateringData
  summary: OrderSummary
  onClose: () => void
  onDone: (billId: string) => void
}) {
  const { order, totals } = summary
  const today = todayIsoDate()
  const billed = data.bills.filter((b) => b.orderId === order.id).reduce((t, b) => t + b.amount, 0)
  const remaining = Math.max(totals.total - billed, 0)
  const [billDate, setBillDate] = useState(today)
  const [dueDate, setDueDate] = useState(addDays(today, 7) < order.eventDate ? addDays(today, 7) : today)
  const [kind, setKind] = useState<"percent" | "amount">("percent")
  const [percent, setPercent] = useState(billed === 0 ? "50" : "")
  const [rupiah, setRupiah] = useState<number | null>(null)
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bps = parsePercentBps(percent || "0")
  const amount = kind === "percent" ? (bps ? mulDivRound(totals.total, bps, 10_000) : 0) : rupiah ?? 0

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const bill = await services.cateringService.createBill({
        workspaceId: order.workspaceId,
        orderId: order.id,
        billDate,
        dueDate,
        amount,
        note: note || (kind === "percent" && bps ? `DP ${percent.replace(".", ",")}%` : null),
      })
      toast.success(`Invoice DP ${bill.number} dibuat`)
      onDone(bill.id)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invoice DP · {order.number}</DialogTitle>
          <DialogDescription>Dokumen tagihan uang muka untuk klien. Jurnal baru dibuat saat DP dibayar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="bill-date">Tanggal invoice</Label>
            <Input id="bill-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bill-due">Jatuh tempo</Label>
            <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="bill-kind">Nominal DP</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger id="bill-kind" className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Persen dari total</SelectItem>
                <SelectItem value="amount">Rupiah</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "percent" ? (
            <InputGroup>
              <InputGroupInput aria-label="Persen DP" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.,]/g, ""))} className="text-right tabular-nums" />
              <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
            </InputGroup>
          ) : (
            <AmountInput aria-label="DP rupiah" value={rupiah} onValueChange={setRupiah} />
          )}
        </div>
        <p className="text-sm">
          DP ditagih: <strong><Amount value={amount} /></strong> dari total <Amount value={totals.total} />
          {billed > 0 && <span className="text-muted-foreground"> · sudah ditagih <Amount value={billed} />, sisa <Amount value={remaining} /></span>}
        </p>
        <div className="grid gap-2">
          <Label htmlFor="bill-note">Keterangan (opsional)</Label>
          <Input id="bill-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. DP 50% / Termin 2" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button disabled={busy || amount <= 0} onClick={submit}>{busy ? "Menyimpan…" : "Buat invoice DP"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Selesaikan pesanan: faktur pelunasan terbit & DP melunasinya (atomik). */
export function CompleteDialog({
  services,
  data,
  summary,
  onClose,
  onDone,
}: {
  services: AppServices
  data: CateringData
  summary: OrderSummary
  onClose: () => void
  onDone: () => void
}) {
  const { order } = summary
  const [date, setDate] = useState(order.eventDate)
  const [dueDate, setDueDate] = useState(services.cateringService.defaultDueDate(order, data, order.eventDate))
  const [dueTouched, setDueTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const plan = tryBuild(() => services.cateringService.completionPlan(order, data, { date, dueDate }))
  const total = plan.value?.totals.total ?? summary.totals.total
  const applied = Math.min(summary.deposit.balance, total)

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const done = await services.cateringService.complete(order, { date, dueDate })
      toast.success(`Pesanan ${done.number} selesai; faktur pelunasan diterbitkan`)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Selesaikan pesanan {order.number}?</DialogTitle>
          <DialogDescription>
            Pendapatan diakui pada tanggal di bawah: faktur penjualan terbit dari rincian pesanan, lalu DP yang sudah diterima otomatis melunasi faktur. Setelah selesai, pesanan tidak dapat diubah.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="complete-date">Tanggal acara/pengiriman</Label>
            <Input
              id="complete-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                if (!dueTouched && e.target.value) setDueDate(services.cateringService.defaultDueDate(order, data, e.target.value))
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="complete-due">Jatuh tempo pelunasan</Label>
            <Input id="complete-due" type="date" value={dueDate} onChange={(e) => { setDueTouched(true); setDueDate(e.target.value) }} />
          </div>
        </div>
        <dl className="grid gap-1.5 rounded-2xl bg-card p-4 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Total faktur</dt><dd><Amount value={total} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">DP dipakai</dt><dd><Amount value={-applied} /></dd></div>
          <div className="flex justify-between border-t pt-1.5 font-bold text-ink"><dt>Sisa tagihan (piutang)</dt><dd><Amount value={total - applied} /></dd></div>
          {summary.deposit.balance > total && (
            <p className="text-xs text-muted-foreground">Kelebihan DP <Amount value={summary.deposit.balance - total} /> tetap di Uang Muka Pelanggan dan dapat dikembalikan.</p>
          )}
        </dl>
        {plan.value && (
          <>
            <JournalPreview lines={plan.value.entry.lines} accounts={withDiscountAccount(data.accounts)} title={`Jurnal faktur ${formatDate(date)}`} />
            {applied > 0 && (
              <p className="text-xs text-muted-foreground">Ditambah jurnal pelunasan otomatis: Uang Muka Pelanggan (debit) / Piutang Usaha (kredit) <Amount value={applied} />.</p>
            )}
            {plan.value.entry.lines.some((l) => l.accountId === PENDING_DISCOUNT_ACCOUNT_ID) && (
              <p className="text-xs text-muted-foreground">Akun 4-1900 Retur & Potongan Penjualan dibuat otomatis untuk diskon.</p>
            )}
          </>
        )}
        {(error ?? plan.error) && <p role="alert" className="text-sm text-destructive">{error ?? plan.error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !plan.value} onClick={submit}>{busy ? "Memproses…" : "Selesaikan & terbitkan faktur"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Batalkan pesanan: saldo DP dikembalikan dan/atau hangus menurut kebijakan. */
export function CancelDialog({
  services,
  data,
  summary,
  onClose,
  onDone,
}: {
  services: AppServices
  data: CateringData
  summary: OrderSummary
  onClose: () => void
  onDone: () => void
}) {
  const { order } = summary
  const revenue = data.accounts.filter((a) => a.accountType === "revenue" && a.isActive && a.deletedAt === null && a.systemRole !== "sales_returns")
  const [date, setDate] = useState(todayIsoDate())
  const [reason, setReason] = useState("")
  const [policy, setPolicy] = useState<CancellationPolicy | null>(order.cancellationPolicy)
  const [cashAccountId, setCashAccountId] = useState("")
  const [forfeitAccountId, setForfeitAccountId] = useState((revenue.find((a) => a.name.toLowerCase().includes("pembatalan")) ?? revenue[0])?.id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const balance = summary.deposit.balance
  const input = { date, reason: reason || "-", policy: policy ?? order.cancellationPolicy, cashAccountId: cashAccountId || null, forfeitAccountId: forfeitAccountId || null }
  const forfeit = policy ? forfeitAmount(balance, policy) : 0
  const refund = balance - forfeit
  const plan = policy ? tryBuild(() => buildCancellation(order, clientName(data, summary), input, balance, data.accounts)) : { value: null, error: "Lengkapi persen DP hangus" }

  async function submit() {
    setError(null)
    if (reason.trim() === "") return setError("Alasan pembatalan wajib diisi")
    if (!policy) return setError("Lengkapi persen DP hangus")
    setBusy(true)
    try {
      await services.cateringService.cancel(order, { ...input, reason: reason.trim(), policy })
      toast.success(`Pesanan ${order.number} dibatalkan`)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Batalkan pesanan {order.number}?</DialogTitle>
          <DialogDescription>
            {balance > 0
              ? <>Saldo DP <Amount value={balance} /> diselesaikan menurut kebijakan pembatalan. Kebijakan pesanan ini: {policyLabel(order.cancellationPolicy)}.</>
              : "Belum ada DP, sehingga tidak ada jurnal yang dibuat."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="grid gap-2">
            <Label htmlFor="cancel-order-date">Tanggal</Label>
            <Input id="cancel-order-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cancel-order-reason">Alasan</Label>
            <Input id="cancel-order-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. acara diundur" />
          </div>
        </div>
        {balance > 0 && (
          <>
            <CancellationPolicyField label="Kebijakan yang dipakai" value={policy} onChange={(p) => setPolicy(p)} />
            {policy && refund > 0 && (
              <CashAccountSelect data={data} value={cashAccountId} onChange={setCashAccountId} label={`DP dikembalikan dari rekening`} />
            )}
            {policy && forfeit > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="cancel-forfeit-account">DP hangus dicatat ke</Label>
                <Select value={forfeitAccountId} onValueChange={setForfeitAccountId}>
                  <SelectTrigger id="cancel-forfeit-account" className="w-full bg-background"><SelectValue placeholder="Akun pendapatan" /></SelectTrigger>
                  <SelectContent>
                    {revenue.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {policy && (
              <p className="text-sm">
                Dikembalikan <strong><Amount value={refund} /></strong> · hangus <strong><Amount value={forfeit} /></strong>
              </p>
            )}
            {plan.value?.entry && <JournalPreview lines={plan.value.entry.lines} accounts={data.accounts} title="Jurnal pembatalan" />}
          </>
        )}
        {(error ?? (balance > 0 ? plan.error : null)) && <p role="alert" className="text-sm text-destructive">{error ?? plan.error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Kembali</Button>
          <Button variant="destructive" disabled={busy || (balance > 0 && !plan.value)} onClick={submit}>{busy ? "Memproses…" : "Batalkan pesanan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
