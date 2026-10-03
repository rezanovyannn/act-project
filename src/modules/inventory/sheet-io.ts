"use client"

import { toCsv } from "@/core/backup"
import { parseCsv, type CountSheetLine } from "@/core/stock-count-sheet"

function download(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(fileName: string, rows: (string | number)[][]) {
  download(fileName, new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }))
}

/**
 * Template stok opname .xlsx (ExcelJS dimuat saat dipakai). Kolom Harga/Satuan &
 * Nilai Sisa berupa rumus dari dasar harga (kolom tersembunyi H:I), sehingga
 * rupiah ikut terisi saat qty diketik; hasilnya sama dengan aplikasi.
 */
export async function downloadCountXlsx(fileName: string, header: readonly string[], lines: readonly CountSheetLine[]) {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Stok Opname", { views: [{ state: "frozen", ySplit: 1 }] })
  sheet.addRow([...header, "Dasar Nilai", "Dasar Qty"])
  lines.forEach((line, index) => {
    const r = index + 2
    const [code, name, section, unit, qty, unitPrice, value] = line.cells
    const row = sheet.addRow([code, name, section, unit, qty === "" ? null : qty, null, null, line.basis?.value ?? null, line.basis?.qty ?? null])
    row.getCell(6).value = { formula: `IF(I${r}="","",H${r}/I${r})`, result: unitPrice === "" ? "" : line.basis!.value / line.basis!.qty }
    row.getCell(7).value = {
      formula: `IF(E${r}="","",IF(E${r}=0,0,IF(I${r}="","",ROUND(E${r}*H${r}/I${r},0))))`,
      result: value,
    }
  })
  const head = sheet.getRow(1)
  head.font = { bold: true }
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F3" } }
  const widths = [12, 28, 18, 10, 14, 18, 18, 14, 12]
  widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w))
  sheet.getColumn(5).numFmt = "#,##0"
  sheet.getColumn(6).numFmt = "#,##0.00"
  sheet.getColumn(7).numFmt = "#,##0"
  sheet.getColumn(8).hidden = true
  sheet.getColumn(9).hidden = true
  for (let r = 2; r <= lines.length + 1; r++) {
    sheet.getCell(r, 5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E0" } }
  }
  if (lines.length > 0) {
    const total = sheet.addRow(["Total", null, null, null, null, null, { formula: `SUM(G2:G${lines.length + 1})` }])
    total.font = { bold: true }
  }
  const buffer = await workbook.xlsx.writeBuffer()
  download(fileName, new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
}

/** Baca file CSV atau .xlsx (lembar pertama) menjadi tabel nilai sel. */
export async function readSheetFile(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return parseCsv(await file.text())
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  const table: unknown[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : []
    table.push(values.map((v) => (v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v)))
  })
  return table
}
