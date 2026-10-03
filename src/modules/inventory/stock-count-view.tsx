"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  InfoIcon,
  SearchIcon,
  TriangleAlertIcon,
  Undo2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"
import { endOfMonth } from "@/core/dates"
import { formatAccounting, formatDate, formatNumber, todayIsoDate } from "@/core/format"
import type { AppServices } from "@/core/services"
import {
  buildStockCount,
  computeCountRows,
  countableItems,
  rowsOfSavedCount,
  sectionOf,
  sumRows,
  type CountContext,
  type CountRow,
  type QtyValue,
  type StockCountPlan,
} from "@/core/stock-count"
import { COUNT_SHEET_HEADER, countSheetLines, countSheetRows, parseCountSheet } from "@/core/stock-count-sheet"
import type { Item, StockCount, Workspace } from "@/core/types"
import { Amount } from "@/components/ui/amount"
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
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { JournalPreview } from "@/components/ui/journal-preview"
import { Label } from "@/components/ui/label"
import { LoadingState, PageHeader } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn, errorMessage as coreErrorMessage, useLoader } from "@/lib/utils"
import { downloadCountXlsx, downloadCsv, readSheetFile } from "./sheet-io"
import { VarianceView } from "./variance-view"

const VALUATION_LABELS = { average: "harga beli rata-rata", last: "harga beli terakhir" } as const

/** Kelompok baris per section (urutan dipertahankan). */
function groupBySection<T extends { item: Item }>(rows: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = sectionOf(row.item)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups]
}

const unitPriceFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 })
/** Harga satuan untuk tampilan saja (nilai tetap dihitung integer dari dasar harga). */
const unitPrice = (basis: QtyValue) => `Rp ${unitPriceFormat.format(basis.value / basis.qty)}`

const qty = (n: number, unit: string) => `${formatNumber(n)} ${unit}`

/** Stok Opname & COGS (ADR 020): input sisa bahan per section dan tabel COGS. */
export function StockCountView({
  services,
  workspaceId,
  journalHref,
  itemsHref,
  settingsHref,
  menusHref,
  initialTab,
}: {
  services: AppServices
  workspaceId: string
  journalHref: (entryId: string) => string
  itemsHref: string
  settingsHref: string
  menusHref: string
  initialTab?: string | null
}) {
  const data = useLoader(() => services.stockCountService.context(workspaceId), [services, workspaceId])
  const [tab, setTab] = useState(initialTab === "cogs" || initialTab === "variance" ? initialTab : "count")
  const [cogsCountId, setCogsCountId] = useState<string | null>(null)

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{coreErrorMessage(data.error)}</p>
  const context = data.data!

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Stok Opname & COGS"
        description={
          <>
            Hitung sisa bahan baku per section; nilai sisa memakai {VALUATION_LABELS[context.workspace.stockValuation]} (
            <Link href={settingsHref} className="underline underline-offset-4">ubah di Pengaturan</Link>).
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="grid grid-cols-1 gap-4">
        <TabsList>
          <TabsTrigger value="count">Stok Opname</TabsTrigger>
          <TabsTrigger value="cogs">COGS</TabsTrigger>
          {context.workspace.templateType === "fnb" && <TabsTrigger value="variance">Variance</TabsTrigger>}
        </TabsList>
        <TabsContent value="count">
          <CountForm
            services={services}
            workspace={context.workspace}
            context={context}
            itemsHref={itemsHref}
            journalHref={journalHref}
            onPosted={(count) => {
              data.reload()
              setCogsCountId(count.id)
              setTab("cogs")
            }}
            onChanged={() => {
              data.reload()
              setCogsCountId(null)
            }}
          />
        </TabsContent>
        <TabsContent value="cogs">
          <CogsTable context={context} selectedId={cogsCountId} onSelect={setCogsCountId} journalHref={journalHref} />
        </TabsContent>
        {context.workspace.templateType === "fnb" && (
          <TabsContent value="variance">
            <VarianceView services={services} context={context} selectedId={cogsCountId} onSelect={setCogsCountId} menusHref={menusHref} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}


function CountForm({
  services,
  workspace,
  context,
  itemsHref,
  journalHref,
  onPosted,
  onChanged,
}: {
  services: AppServices
  workspace: Workspace
  context: CountContext
  itemsHref: string
  journalHref: (entryId: string) => string
  onPosted: (count: StockCount) => void
  onChanged: () => void
}) {
  const [countDate, setCountDate] = useState(() => endOfMonth(todayIsoDate()))
  const [entered, setEntered] = useState<Record<string, string>>({})
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const items = countableItems(context, countDate)
  const quantities = new Map(items.filter((i) => /^\d+$/.test(entered[i.id] ?? "")).map((i) => [i.id, Number(entered[i.id])]))
  const missing = items.filter((i) => !quantities.has(i.id))
  // Pratinjau: bahan yang belum diisi dihitung 0 (nilai & COGS barisnya tidak ditampilkan).
  let rows: CountRow[] = []
  let plan: StockCountPlan | null = null
  let previewError: string | null = null
  try {
    const filled = new Map(items.map((i) => [i.id, quantities.get(i.id) ?? 0]))
    rows = computeCountRows(context, countDate, filled, workspace.stockValuation)
    if (missing.length === 0) {
      plan = buildStockCount(context, { workspaceId: workspace.id, countDate, valuation: workspace.stockValuation, quantities })
    }
  } catch (e) {
    previewError = coreErrorMessage(e)
  }
  const all = sumRows(rows)
  const end = sumRows(rows.filter((r) => quantities.has(r.item.id))).end
  const cogs = all.begin + all.purchase - end
  const filledCount = items.length - missing.length
  const term = search.trim().toLowerCase()
  const shown = term
    ? rows.filter((r) => [r.item.name, r.item.code, sectionOf(r.item)].some((t) => t.toLowerCase().includes(term)))
    : rows
  const latest = [...context.counts].sort((a, b) => b.countDate.localeCompare(a.countDate))[0]
  const fileBase = `stok-opname-${workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${countDate}`

  async function importFile(file: File) {
    try {
      const parsed = parseCountSheet(await readSheetFile(file), context.items)
      const next = { ...entered }
      for (const [itemId, value] of parsed.quantities) next[itemId] = String(value)
      setEntered(next)
      const notes = [
        `${parsed.quantities.size} bahan terisi`,
        parsed.unknownCodes.length ? `${parsed.unknownCodes.length} kode tidak dikenal (${parsed.unknownCodes.slice(0, 3).join(", ")})` : "",
        parsed.invalid.length ? `${parsed.invalid.length} qty tidak valid (${parsed.invalid.slice(0, 3).map((i) => i.code).join(", ")})` : "",
      ].filter(Boolean)
      ;(parsed.unknownCodes.length || parsed.invalid.length ? toast.warning : toast.success)(`Import: ${notes.join(" · ")}`)
    } catch (e) {
      toast.error(`File tidak dapat dibaca: ${coreErrorMessage(e)}`)
    }
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const { count } = await services.stockCountService.post(workspace.id, countDate, quantities)
      toast.success(`Stok opname ${formatDate(countDate)} disimpan`)
      setEntered({})
      onPosted(count)
    } catch (e) {
      setError(coreErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function cancelLatest() {
    if (!latest) return
    try {
      await services.stockCountService.cancel(latest.id, todayIsoDate() < latest.countDate ? latest.countDate : todayIsoDate())
      toast.success(`Stok opname ${formatDate(latest.countDate)} dibatalkan`)
      onChanged()
    } catch (e) {
      toast.error(coreErrorMessage(e))
    }
  }

  if (context.items.length === 0) {
    return (
      <p role="note" className="flex gap-2 rounded-2xl bg-card px-4 py-4 text-sm text-ink">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          Belum ada bahan baku. Tambahkan dulu di{" "}
          <Link href={itemsHref} className="font-semibold underline underline-offset-4">Daftar Barang</Link> (isi Section-nya).
        </span>
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {/* Toolbar: tanggal, cari, template & import */}
      <section className="flex flex-wrap items-end gap-3 rounded-2xl bg-canvas p-4 ring-1 ring-border">
        <div className="grid gap-1.5">
          <Label htmlFor="count-date">Tanggal stok opname</Label>
          <Input id="count-date" type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} className="w-44" />
        </div>
        <div className="grid min-w-48 flex-1 gap-1.5 sm:max-w-72">
          <Label htmlFor="count-search">Cari bahan</Label>
          <InputGroup className="h-9">
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput id="count-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nama, kode, atau section" />
          </InputGroup>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button variant="secondary" size="sm" onClick={() => downloadCsv(`${fileBase}.csv`, countSheetRows(rows, quantities))}>
            <DownloadIcon data-icon="inline-start" /> Template CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              downloadCountXlsx(`${fileBase}.xlsx`, COUNT_SHEET_HEADER, countSheetLines(rows, quantities)).catch((e) => toast.error(coreErrorMessage(e)))
            }
          >
            <FileSpreadsheetIcon data-icon="inline-start" /> Template Excel
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            <UploadIcon data-icon="inline-start" /> Import
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Import file stok opname"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) importFile(file)
              e.target.value = ""
            }}
          />
        </div>
        <p className="basis-full text-xs text-muted-foreground">
          Ketik qty sisa; nilai Rupiah dan COGS terisi otomatis memakai {VALUATION_LABELS[workspace.stockValuation]}. Di template Excel,
          kolom Harga/Satuan dan Nilai Sisa juga berupa rumus. Import mencocokkan bahan lewat kode.
        </p>
      </section>

      {/* Ringkasan */}
      <section aria-label="Ringkasan stok opname" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stok awal" value={all.begin} />
        <Stat label="Pembelian" value={all.purchase} />
        <Stat label="Stok akhir (sisa)" value={end} />
        <Stat label={missing.length ? "COGS (sementara)" : "COGS"} value={cogs} strong />
      </section>
      <div className="grid gap-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{filledCount} dari {items.length} bahan terisi</span>
          {missing.length > 0 && <span>Isi semua bahan (0 bila habis) untuk menyimpan</span>}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-card" role="progressbar" aria-label="Bahan terisi" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={filledCount}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${items.length ? (filledCount / items.length) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Tabel bahan */}
      <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5">Bahan</th>
              <th className="px-3 py-2.5 text-right">Stok awal</th>
              <th className="px-3 py-2.5 text-right">Pembelian</th>
              <th className="px-3 py-2.5 text-right">Harga/satuan</th>
              <th className="w-44 px-3 py-2.5">Qty sisa</th>
              <th className="px-3 py-2.5 text-right">Nilai sisa</th>
              <th className="px-4 py-2.5 text-right">COGS</th>
            </tr>
          </thead>
          {shown.length === 0 && (
            <tbody>
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Tidak ada bahan yang cocok dengan “{search}”.</td></tr>
            </tbody>
          )}
          {groupBySection(shown).map(([section, group]) => {
            const sectionEnd = group.filter((r) => quantities.has(r.item.id)).reduce((t, r) => t + r.end.value, 0)
            return (
              <tbody key={section} className="divide-y border-t">
                <tr className="bg-card/60">
                  <th colSpan={5} scope="rowgroup" className="px-4 py-2 text-left text-xs font-bold tracking-wide text-ink uppercase">
                    {section} <span className="font-medium text-muted-foreground normal-case">· {group.length} bahan</span>
                  </th>
                  <td className="px-3 py-2 text-right text-xs font-semibold text-ink"><Amount value={sectionEnd} /></td>
                  <td />
                </tr>
                {group.map((row) => (
                  <CountRowView
                    key={row.item.id}
                    row={row}
                    filled={quantities.has(row.item.id)}
                    value={entered[row.item.id] ?? ""}
                    onChange={(value) => setEntered((prev) => ({ ...prev, [row.item.id]: value }))}
                  />
                ))}
              </tbody>
            )
          })}
        </table>
      </div>

      {/* Jurnal & simpan */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-3">
          {plan ? (
            plan.journal ? (
              <JournalPreview lines={plan.journal.lines} accounts={context.accounts} title="Jurnal penyesuaian HPP" />
            ) : (
              <p className="rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground">Nilai sisa sama dengan saldo buku; tidak ada jurnal.</p>
            )
          ) : (
            <p className="flex gap-2 rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" /> Pratinjau jurnal penyesuaian HPP muncul setelah semua bahan terisi.
            </p>
          )}
          {plan && plan.unitemizedDifference !== 0 && (
            <p className="flex gap-2 text-sm text-ink">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              Saldo buku Persediaan berbeda {formatAccounting(plan.unitemizedDifference)} dari stok awal + pembelian per bahan
              (mis. pembelian tanpa rincian bahan). Penyesuaian jurnal mengikuti saldo buku.
            </p>
          )}
        </div>
        <aside className="grid content-start gap-3">
          {rows.some((r) => quantities.has(r.item.id) && r.noCost) && (
            <p className="flex gap-2 text-sm text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" /> Ada bahan bersisa tanpa harga beli; nilainya dihitung Rp 0.
            </p>
          )}
          {previewError && <p className="text-sm text-destructive">{previewError}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={saving || !plan} onClick={submit}>
            {saving ? "Menyimpan…" : "Simpan stok opname"}
          </Button>
          {latest && (
            <div className="grid gap-2 rounded-2xl bg-card p-4 text-sm">
              <p className="text-ink">
                Stok opname terakhir: <strong>{formatDate(latest.countDate)}</strong>
                {latest.journalEntryId && (
                  <>
                    {" · "}
                    <Link href={journalHref(latest.journalEntryId)} className="underline underline-offset-4">lihat jurnal</Link>
                  </>
                )}
              </p>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-fit">
                    <Undo2Icon data-icon="inline-start" /> Batalkan stok opname terakhir
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Batalkan stok opname {formatDate(latest.countDate)}?</DialogTitle>
                    <DialogDescription>
                      Jurnal penyesuaian HPP-nya dibalik dan sisa bahan tanggal itu tidak lagi menjadi stok awal periode berikutnya.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Batal</Button></DialogClose>
                    <DialogClose asChild><Button variant="destructive" onClick={cancelLatest}>Batalkan stok opname</Button></DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/** Satu baris bahan: qty sisa diketik, rupiah & COGS dihitung otomatis. */
function CountRowView({
  row,
  filled,
  value,
  onChange,
}: {
  row: CountRow
  filled: boolean
  value: string
  onChange: (value: string) => void
}) {
  const { item } = row
  const over = filled && row.cogs.qty < 0
  return (
    <tr className={cn(filled && "bg-success-pale/30")}>
      <td className="px-4 py-2">
        <span className="font-medium text-ink">{item.name}</span>
        <span className="block text-xs text-muted-foreground">{item.code}</span>
      </td>
      <QtyCell cell={row.begin} unit={item.unit} />
      <QtyCell cell={row.purchase} unit={item.unit} />
      <td className="px-3 py-2 text-right tabular-nums">
        {row.basis ? (
          <>
            <span className="text-ink">{unitPrice(row.basis)}</span>
            <span className="block text-xs text-muted-foreground">per {item.unit}</span>
          </>
        ) : filled && row.end.qty > 0 ? (
          <span className="text-xs text-destructive">Belum ada harga</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <InputGroup className={cn("h-9", !filled && "bg-amber-50")}>
          <InputGroupInput
            aria-label={`Qty sisa ${item.name}`}
            inputMode="numeric"
            placeholder="0"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
            className="text-right tabular-nums"
          />
          <InputGroupAddon align="inline-end"><InputGroupText>{item.unit}</InputGroupText></InputGroupAddon>
        </InputGroup>
      </td>
      <td className="px-3 py-2 text-right">
        {filled ? (
          row.noCost && row.end.qty > 0 ? <span className="text-xs text-destructive">Rp 0 · tanpa harga</span> : <Amount value={row.end.value} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {filled ? (
          <>
            <span className={cn("font-semibold text-ink", over && "text-amber-700")}><Amount value={row.cogs.value} /></span>
            <span className={cn("block text-xs text-muted-foreground tabular-nums", over && "text-amber-700")}>
              {over ? "sisa > awal + beli" : `terpakai ${formatNumber(row.cogs.qty)} ${item.unit}`}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  )
}

function QtyCell({ cell, unit }: { cell: QtyValue; unit: string }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      <span className="text-ink">{formatNumber(cell.qty)} <span className="text-muted-foreground">{unit}</span></span>
      <span className="block text-xs text-muted-foreground"><Amount value={cell.value} /></span>
    </td>
  )
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("grid gap-1 rounded-2xl p-4 ring-1 ring-border", strong ? "bg-ink text-canvas ring-ink" : "bg-canvas")}>
      <span className={cn("text-xs", strong ? "text-canvas/70" : "text-muted-foreground")}>{label}</span>
      <span className="text-lg font-bold tabular-nums"><Amount value={value} /></span>
    </div>
  )
}

function CogsTable({
  context,
  selectedId,
  onSelect,
  journalHref,
}: {
  context: CountContext
  selectedId: string | null
  onSelect: (id: string) => void
  journalHref: (entryId: string) => string
}) {
  const counts = [...context.counts].sort((a, b) => b.countDate.localeCompare(a.countDate))
  // Stok opname yang baru disimpan belum termuat: tunggu, jangan tampilkan yang lama.
  if (selectedId && !counts.some((c) => c.id === selectedId)) return <LoadingState />
  const count = counts.find((c) => c.id === selectedId) ?? counts[0]
  if (!count) {
    return <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">Belum ada stok opname. Simpan stok opname dulu di tab Stok Opname.</p>
  }
  const rows = rowsOfSavedCount(context, count)
  const totals = sumRows(rows)
  const previous = counts.find((c) => c.countDate < count.countDate)

  return (
    <section className="grid gap-4 rounded-2xl bg-canvas p-5 ring-1 ring-border">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">COGS per bahan</h2>
          <p className="text-sm text-muted-foreground">
            Periode {previous ? `setelah ${formatDate(previous.countDate)}` : "awal"} s.d. {formatDate(count.countDate)} · COGS = Stok Awal + Pembelian − Stok Akhir ·
            nilai sisa {VALUATION_LABELS[count.valuation]}
            {count.journalEntryId && (
              <>
                {" · "}
                <Link href={journalHref(count.journalEntryId)} className="underline underline-offset-4">jurnal penyesuaian</Link>
              </>
            )}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cogs-count">Stok opname</Label>
          <Select value={count.id} onValueChange={onSelect}>
            <SelectTrigger id="cogs-count" className="w-48 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {counts.map((c) => <SelectItem key={c.id} value={c.id}>{formatDate(c.countDate)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stok awal" value={totals.begin} />
        <Stat label="Pembelian" value={totals.purchase} />
        <Stat label="Stok akhir" value={totals.end} />
        <Stat label="COGS" value={totals.cogs} strong />
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2.5">Nama bahan baku</th>
              <th className="px-3 py-2.5 text-right">Stok awal</th>
              <th className="px-3 py-2.5 text-right">Pembelian</th>
              <th className="px-3 py-2.5 text-right">Stok akhir</th>
              <th className="px-3 py-2.5 text-right">COGS</th>
            </tr>
          </thead>
          {groupBySection(rows).map(([section, group]) => (
            <tbody key={section} className="divide-y border-t">
              <tr className="bg-card/50">
                <th colSpan={5} scope="rowgroup" className="px-3 py-2 text-left text-xs font-bold tracking-wide text-ink uppercase">{section}</th>
              </tr>
              {group.map((r) => (
                <tr key={r.item.id}>
                  <td className="px-3 py-2 text-ink">{r.item.name}</td>
                  {[r.begin, r.purchase, r.end, r.cogs].map((cell, i) => (
                    <td key={i} className={cn("px-3 py-2 text-right", i === 3 && "font-semibold text-ink")}>
                      <Amount value={cell.value} />
                      <span className="block text-xs text-muted-foreground tabular-nums">{qty(cell.qty, r.item.unit)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot className="border-t-2 border-ink bg-card font-bold text-ink">
            <tr>
              <td className="px-3 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.begin} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.purchase} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.end} /></td>
              <td className="px-3 py-2.5 text-right"><Amount value={totals.cogs} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
