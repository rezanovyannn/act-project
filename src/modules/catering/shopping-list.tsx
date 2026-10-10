"use client"

import { useState } from "react"
import Link from "next/link"
import { FileDownIcon, FileSpreadsheetIcon, InfoIcon, PrinterIcon, ShoppingBasketIcon } from "lucide-react"
import { toast } from "sonner"
import { toCsv } from "@/core/backup"
import type { ShoppingList } from "@/core/catering"
import { addDays } from "@/core/dates"
import { formatDate, formatNumber, todayIsoDate } from "@/core/format"
import { fractionToNumber } from "@/core/menu"
import { sectionOf } from "@/core/stock-count"
import type { AppServices } from "@/core/services"
import type { CateringData } from "@/core/services/catering-service"
import { Amount } from "@/components/ui/amount"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { errorMessage } from "@/lib/utils"
import type { OrderRoutes } from "./orders-view"

const qtyText = (n: number) => formatNumber(Math.round(n * 100) / 100)

function download(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const HEADER = ["Section", "Kode", "Bahan", "Satuan", "Kebutuhan", "Dibeli", "Sumber harga", "Perkiraan biaya (Rp)", "Pesanan"]

function tableRows(list: ShoppingList): (string | number)[][] {
  return list.rows.map((r) => [
    sectionOf(r.item),
    r.item.code,
    r.item.name,
    r.item.unit,
    Math.round(fractionToNumber(r.quantity) * 100) / 100,
    r.buyQuantity,
    r.priceSource === "purchase" ? "Pembelian terakhir" : r.priceSource === "estimate" ? "Harga perkiraan" : "Belum ada harga",
    r.cost ?? "",
    r.perOrder.map((p) => `${p.order.number}: ${qtyText(fractionToNumber(p.quantity))}`).join("; "),
  ])
}

/** Daftar belanja bahan dari pesanan dikonfirmasi per rentang tanggal acara (Fase 10C). */
export function ShoppingListTab({ services, data, routes, itemsHref }: { services: AppServices; data: CateringData; routes: OrderRoutes; itemsHref: string }) {
  const today = todayIsoDate()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(addDays(today, 7))
  const valid = Boolean(from && to && from <= to)
  const list = valid ? services.cateringService.shopping(data, from, to) : null
  const fileName = (ext: string) => `daftar-belanja-${from}-sd-${to}.${ext}`

  async function exportXlsx() {
    if (!list) return
    try {
      const { default: ExcelJS } = await import("exceljs")
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet("Daftar Belanja", { views: [{ state: "frozen", ySplit: 1 }] })
      const rows = [HEADER, ...tableRows(list)]
      rows.forEach((row) => sheet.addRow([...row]))
      sheet.addRow(["", "", "Total perkiraan", "", "", "", "", list.totalCost, ""]).font = { bold: true }
      const head = sheet.getRow(1)
      head.font = { bold: true }
      head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F3" } }
      sheet.columns.forEach((column, index) => {
        const longest = Math.max(...rows.map((r) => String(r[index] ?? "").length))
        column.width = Math.min(Math.max(longest + 2, 10), 48)
      })
      for (const col of [5, 6, 8]) sheet.getColumn(col).numFmt = "#,##0.##"
      const buffer = await workbook.xlsx.writeBuffer()
      download(fileName("xlsx"), new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="shopping-from">Acara dari</Label>
            <Input id="shopping-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="shopping-to">sampai</Label>
            <Input id="shopping-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
          </div>
        </div>
        {list && list.rows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.print()}><PrinterIcon data-icon="inline-start" /> Cetak</Button>
            <Button variant="secondary" onClick={() => download(fileName("csv"), new Blob([toCsv([HEADER, ...tableRows(list)])], { type: "text/csv;charset=utf-8" }))}>
              <FileDownIcon data-icon="inline-start" /> CSV
            </Button>
            <Button variant="secondary" onClick={exportXlsx}><FileSpreadsheetIcon data-icon="inline-start" /> Excel</Button>
          </div>
        )}
      </div>
      {!valid && <p role="alert" className="text-sm text-destructive">Tanggal awal tidak boleh setelah tanggal akhir.</p>}
      {list && (
        <>
          <section className="hidden print:block">
            <h1 className="text-xl font-bold">Daftar Belanja · {data.profile.displayName || data.workspace.name}</h1>
            <p className="text-sm">Acara {formatDate(from)} s.d. {formatDate(to)}</p>
          </section>
          <p className="text-sm text-muted-foreground">
            {list.orders.length === 0
              ? "Tidak ada pesanan dikonfirmasi pada rentang ini."
              : <>{list.orders.length} pesanan dikonfirmasi: {list.orders.map((o, i) => (
                  <span key={o.id}>{i > 0 && ", "}<Link href={routes.order(o.id)} className="text-ink underline underline-offset-4 print:no-underline">{o.number}</Link> ({formatDate(o.eventDate)}, {formatNumber(o.pax)} pax)</span>
                ))}</>}
          </p>
          {list.rows.length === 0 ? (
            list.orders.length > 0 && (
              <div className="grid justify-items-center gap-2 rounded-2xl bg-card px-4 py-8 text-center">
                <ShoppingBasketIcon className="size-8 text-muted-foreground" />
                <p className="max-w-md text-sm text-muted-foreground">Baris pesanan belum memakai paket menu, jadi kebutuhan bahan belum bisa dihitung. Pilih paket di baris pesanan.</p>
              </div>
            )
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border print:overflow-visible print:ring-0">
              <table className="w-full min-w-[52rem] text-sm print:min-w-0">
                <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-2.5">Bahan</th>
                    <th className="px-3 py-2.5 text-right">Kebutuhan</th>
                    <th className="px-3 py-2.5 text-right">Dibeli</th>
                    <th className="px-3 py-2.5 text-right">Perkiraan biaya</th>
                    <th className="px-4 py-2.5">Rincian per pesanan</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.rows.map((r) => (
                    <tr key={r.item.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-ink">{r.item.name}</span>
                        <span className="block text-xs text-muted-foreground">{sectionOf(r.item)} · {r.item.code}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{qtyText(fractionToNumber(r.quantity))} {r.item.unit}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatNumber(r.buyQuantity)} {r.item.unit}</td>
                      <td className="px-3 py-2.5 text-right">
                        {r.cost === null ? <span className="text-xs text-destructive">Belum ada harga</span> : <Amount value={r.cost} />}
                        {r.priceSource && <span className="block text-xs text-muted-foreground">{r.priceSource === "purchase" ? "beli terakhir" : "harga perkiraan"}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {r.perOrder.map((p) => (
                          <span key={p.order.id} className="block">{p.order.number} · {formatDate(p.order.eventDate)}: {qtyText(fractionToNumber(p.quantity))} {r.item.unit}</span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 bg-card font-semibold text-ink">
                  <tr>
                    <td className="px-4 py-2.5" colSpan={3}>Total perkiraan belanja</td>
                    <td className="px-3 py-2.5 text-right"><Amount value={list.totalCost} /></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {(list.linesWithoutPackage > 0 || list.rows.some((r) => r.cost === null)) && (
            <p className="flex gap-2 text-xs text-muted-foreground print:hidden">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {list.linesWithoutPackage > 0 && `${list.linesWithoutPackage} baris pesanan tanpa paket (mis. ongkir) tidak dihitung. `}
                {list.rows.some((r) => r.cost === null) && <>Bahan tanpa harga: isi harga perkiraan di <Link href={itemsHref} className="underline underline-offset-4">Daftar Barang</Link>.</>}
              </span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
