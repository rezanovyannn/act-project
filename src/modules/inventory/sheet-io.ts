"use client"

import { toCsv } from "@/core/backup"
import { parseCsv } from "@/core/stock-count-sheet"

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

/** Excel .xlsx (ExcelJS dimuat saat dipakai): header tebal & beku, lebar kolom, kolom qty dapat diisi. */
export async function downloadXlsx(fileName: string, sheetName: string, rows: (string | number)[][]) {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] })
  rows.forEach((row) => sheet.addRow(row))
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F3" } }
  sheet.columns.forEach((column, index) => {
    const longest = Math.max(...rows.map((r) => String(r[index] ?? "").length))
    column.width = Math.min(Math.max(longest + 2, 10), 40)
  })
  const qtyColumn = rows[0].length
  sheet.getColumn(qtyColumn).numFmt = "#,##0"
  sheet.getColumn(qtyColumn).eachCell((cell, rowNumber) => {
    if (rowNumber > 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E0" } }
  })
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
