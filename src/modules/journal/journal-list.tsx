"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { PlusIcon, SearchIcon } from "lucide-react"
import { formatDate } from "@/core/format"
import { reversedEntryIds } from "@/core/reversal"
import type { AppServices } from "@/core/services"
import type { JournalEntry, JournalSource, JournalStatus } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState, LoadingState, PageHeader } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn, errorMessage, useLoader } from "@/lib/utils"
import { JournalStatusBadges, SOURCE_LABELS, journalTotal } from "./labels"

type StatusFilter = "all" | JournalStatus
type SourceFilter = "all" | JournalSource

const PAGE_SIZE = 50

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
]

export function JournalList({
  services,
  workspaceId,
  detailHref,
  newHref,
}: {
  services: AppServices
  workspaceId: string
  detailHref: (entryId: string) => string
  newHref: string
}) {
  const journals = useLoader(
    () => services.journals.listByWorkspace(workspaceId),
    [services, workspaceId],
  )
  const [status, setStatus] = useState<StatusFilter>("all")
  const [source, setSource] = useState<SourceFilter>("all")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [query, setQuery] = useState("")

  const reversed = useMemo(() => reversedEntryIds(journals.data ?? []), [journals.data])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (journals.data ?? [])
      .filter(
        (e) =>
          (status === "all" || e.status === status) &&
          (source === "all" || e.source === source) &&
          (!fromDate || e.entryDate >= fromDate) &&
          (!toDate || e.entryDate <= toDate) &&
          (!q ||
            [e.description, e.entryNumber, e.counterparty].some((field) =>
              field?.toLowerCase().includes(q),
            )),
      )
      .reverse()
  }, [journals.data, status, source, fromDate, toDate, query])

  // Batas tampilan kembali ke awal setiap kali filter berubah.
  const filterKey = [status, source, fromDate, toDate, query].join("|")
  const [page, setPage] = useState({ filterKey, limit: PAGE_SIZE })
  const limit = page.filterKey === filterKey ? page.limit : PAGE_SIZE

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Jurnal Umum"
        description="Semua jurnal di workspace ini. Jurnal posted tidak bisa diubah; gunakan Void atau Koreksi."
        actions={
          <Button asChild>
            <Link href={newHref}>
              <PlusIcon data-icon="inline-start" />
              Jurnal baru
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 rounded-lg bg-card p-4 lg:grid-cols-[auto_1fr]">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter status">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
              className={cn(
                "h-9 rounded-full px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                status === filter.value
                  ? "bg-ink text-white"
                  : "bg-canvas text-ink hover:bg-secondary",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Label htmlFor="journal-search" className="sr-only">
              Cari
            </Label>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="journal-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari keterangan, nomor, pihak…"
              className="pl-9"
            />
          </div>
          <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
            <SelectTrigger aria-label="Filter sumber" className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua sumber</SelectItem>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            aria-label="Dari tanggal"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <Input
            type="date"
            aria-label="Sampai tanggal"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

      {journals.loading ? (
        <LoadingState />
      ) : journals.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(journals.error)}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState title="Tidak ada jurnal">
          {journals.data?.length ? "Coba ubah filter." : "Buat jurnal pertama di workspace ini."}
        </EmptyState>
      ) : (
        <>
          <JournalTable rows={rows.slice(0, limit)} reversed={reversed} detailHref={detailHref} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              Menampilkan {Math.min(limit, rows.length)} dari {rows.length} jurnal
            </span>
            {rows.length > limit && (
              <Button
                variant="secondary"
                onClick={() => setPage({ filterKey, limit: limit + PAGE_SIZE })}
              >
                Tampilkan {Math.min(PAGE_SIZE, rows.length - limit)} lagi
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function JournalTable({
  rows,
  reversed,
  detailHref,
}: {
  rows: JournalEntry[]
  reversed: Set<string>
  detailHref: (entryId: string) => string
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-canvas">
      <Table>
        <TableHeader className="bg-card">
          <TableRow>
            <TableHead className="w-28">Tanggal</TableHead>
            <TableHead className="w-32">Nomor</TableHead>
            <TableHead>Keterangan</TableHead>
            <TableHead className="w-32">Sumber</TableHead>
            <TableHead className="w-36">Status</TableHead>
            <TableHead className="w-40 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((entry) => (
            <TableRow key={entry.id} className="relative">
              <TableCell className="tabular-nums">{formatDate(entry.entryDate)}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {entry.entryNumber ?? "—"}
              </TableCell>
              <TableCell className="max-w-md">
                <Link
                  href={detailHref(entry.id)}
                  className="font-medium text-ink outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
                >
                  <span className="block truncate">{entry.description}</span>
                </Link>
                {entry.counterparty && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.counterparty}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{SOURCE_LABELS[entry.source]}</TableCell>
              <TableCell>
                <JournalStatusBadges entry={entry} voided={reversed.has(entry.id)} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={journalTotal(entry)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
