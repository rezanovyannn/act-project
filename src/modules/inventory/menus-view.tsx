"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import {
  ChefHatIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"
import { endOfMonth } from "@/core/dates"
import { formatDate, formatNumber, todayIsoDate } from "@/core/format"
import { basesAt, fractionValue, recipeAt, recipeCostPerPortion, type MenuContext } from "@/core/menu"
import type { AppServices } from "@/core/services"
import { compareBySection, type QtyValue } from "@/core/stock-count"
import { parsePortionSheet, portionSheetRows } from "@/core/stock-count-sheet"
import type { Account, Menu, PortionSummary, Recipe, Workspace } from "@/core/types"
import { Amount } from "@/components/ui/amount"
import { AmountInput } from "@/components/ui/amount-input"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
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
import { cn, errorMessage, useLoader } from "@/lib/utils"
import { downloadCsv, downloadTableXlsx, readSheetFile } from "./sheet-io"

type Context = MenuContext & { workspace: Workspace }

const NO_ACCOUNT = "__none__"
const categoryOf = (menu: Pick<Menu, "category">) => menu.category?.trim() || "Tanpa kategori"
const percent = new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 1 })

function groupByCategory<T>(rows: T[], menuOf: (row: T) => Menu): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = categoryOf(menuOf(row))
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups]
}

/** Menu & Resep (ADR 021): daftar menu, resep berversi, dan rekap porsi. */
export function MenusView({
  services,
  workspaceId,
  itemsHref,
  menuSaleHref,
  varianceHref,
  initialTab,
}: {
  services: AppServices
  workspaceId: string
  itemsHref: string
  menuSaleHref: string
  varianceHref: string
  initialTab?: string | null
}) {
  const data = useLoader(() => services.menuService.context(workspaceId), [services, workspaceId])
  const [tab, setTab] = useState(initialTab === "portions" ? "portions" : "menus")

  if (data.loading && !data.data) return <LoadingState />
  if (data.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(data.error)}</p>
  const ctx = data.data!

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        title="Menu & Resep"
        description={
          <>
            Resep per porsi menjadi dasar <strong>theoretical cost</strong>. Porsi terjual diambil dari{" "}
            <Link href={menuSaleHref} className="underline underline-offset-4">Penjualan menu</Link> atau Rekap Porsi; hasilnya
            dibandingkan dengan stok opname di{" "}
            <Link href={varianceHref} className="underline underline-offset-4">Stok Opname &amp; COGS → Variance</Link>.
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="grid grid-cols-1 gap-4">
        <TabsList>
          <TabsTrigger value="menus">Menu &amp; Resep</TabsTrigger>
          <TabsTrigger value="portions">Rekap Porsi</TabsTrigger>
        </TabsList>
        <TabsContent value="menus">
          <MenuList services={services} ctx={ctx} itemsHref={itemsHref} onChanged={data.reload} />
        </TabsContent>
        <TabsContent value="portions">
          <PortionSummaries services={services} ctx={ctx} onChanged={data.reload} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------- Menu

function MenuList({ services, ctx, itemsHref, onChanged }: { services: AppServices; ctx: Context; itemsHref: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Menu | "new" | null>(null)
  const [recipeFor, setRecipeFor] = useState<Menu | null>(null)
  const today = todayIsoDate()
  const bases = basesAt(ctx, today, ctx.workspace.stockValuation)
  const menus = [...ctx.menus].sort(compareBySection)
  const revenueAccounts = ctx.accounts.filter((a) => a.accountType === "revenue" && a.isActive && a.systemRole !== "sales_returns")
  const withRecipe = menus.filter((m) => recipeAt(ctx.recipes, m.id, today)).length

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action()
      toast.success(success)
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {menus.length} menu · {withRecipe} dengan resep berlaku hari ini · biaya bahan memakai{" "}
          {ctx.workspace.stockValuation === "last" ? "harga beli terakhir" : "harga beli rata-rata"}
        </p>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" /> Tambah menu
        </Button>
      </div>

      {ctx.items.length === 0 && (
        <p role="note" className="flex gap-2 rounded-2xl bg-card px-4 py-3 text-sm text-ink">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            Resep memakai bahan dari <Link href={itemsHref} className="font-semibold underline underline-offset-4">Daftar Barang</Link>;
            tambahkan bahan dulu.
          </span>
        </p>
      )}

      {menus.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl bg-card px-4 py-10 text-center">
          <ChefHatIcon className="size-8 text-muted-foreground" />
          <p className="font-semibold text-ink">Belum ada menu</p>
          <p className="max-w-md text-sm text-muted-foreground">Tambahkan menu yang dijual, lalu isi resepnya (bahan per porsi).</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Menu</th>
                <th className="px-3 py-2.5 text-right">Harga jual</th>
                <th className="px-3 py-2.5">Resep berlaku</th>
                <th className="px-3 py-2.5 text-right">Biaya bahan/porsi</th>
                <th className="px-3 py-2.5 text-right">Food cost</th>
                <th className="w-12" />
              </tr>
            </thead>
            {groupByCategory(menus, (m) => m).map(([category, group]) => (
              <tbody key={category} className="divide-y border-t">
                <tr className="bg-card/60">
                  <th colSpan={6} scope="rowgroup" className="px-4 py-2 text-left text-xs font-bold tracking-wide text-ink uppercase">
                    {category} <span className="font-medium text-muted-foreground normal-case">· {group.length} menu</span>
                  </th>
                </tr>
                {group.map((menu) => {
                  const recipe = recipeAt(ctx.recipes, menu.id, today)
                  const future = ctx.recipes.filter((r) => r.menuId === menu.id && r.effectiveFrom > today)
                  const cost = recipe ? recipeCostPerPortion(recipe, bases) : null
                  return (
                    <tr key={menu.id} className={cn(!menu.isActive && "opacity-60")}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-ink">{menu.name}</span>
                        {!menu.isActive && <Badge variant="secondary" className="ml-2">Nonaktif</Badge>}
                        <span className="block text-xs text-muted-foreground">{menu.code}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right"><Amount value={menu.price} /></td>
                      <td className="px-3 py-2.5">
                        {recipe ? (
                          <button type="button" className="text-left hover:underline" onClick={() => setRecipeFor(menu)}>
                            <span className="text-ink">{recipe.lines.length} bahan · {recipe.yieldPortions} porsi</span>
                            <span className="block text-xs text-muted-foreground">sejak {formatDate(recipe.effectiveFrom)}</span>
                          </button>
                        ) : (
                          <Button variant="secondary" size="xs" onClick={() => setRecipeFor(menu)}>
                            {future.length ? `Berlaku ${formatDate(future[0].effectiveFrom)}` : "Isi resep"}
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {cost ? (
                          <>
                            <Amount value={cost.cost} />
                            {cost.missing.length > 0 && <span className="block text-xs text-destructive">{cost.missing.length} bahan belum ada harga</span>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {cost && menu.price > 0 ? (
                          <span className={cn(cost.cost / menu.price > 0.4 ? "font-semibold text-amber-700" : "text-ink")}>
                            {percent.format(cost.cost / menu.price)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Aksi untuk ${menu.name}`}>
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setRecipeFor(menu)}>Resep</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEditing(menu)}>Ubah</DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                run(() => services.menuService.setActive(menu.id, !menu.isActive), `${menu.name} ${menu.isActive ? "dinonaktifkan" : "diaktifkan"}`)
                              }
                            >
                              {menu.isActive ? "Nonaktifkan" : "Aktifkan"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => run(() => services.menuService.deleteMenu(menu.id), `${menu.name} dihapus`)}
                            >
                              Hapus
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Biaya bahan/porsi = estimasi hari ini dari resep berlaku × harga bahan; food cost = biaya ÷ harga jual (di atas 40% ditandai).
      </p>

      {editing && (
        <MenuDialog
          services={services}
          workspaceId={ctx.workspace.id}
          menu={editing === "new" ? null : editing}
          categories={[...new Set(ctx.menus.map((m) => m.category).filter((c): c is string => !!c))].sort()}
          revenueAccounts={revenueAccounts}
          onClose={() => setEditing(null)}
          onSaved={(menu, isNew) => {
            setEditing(null)
            onChanged()
            if (isNew) setRecipeFor(menu)
          }}
        />
      )}
      {recipeFor && (
        <RecipeDialog
          services={services}
          ctx={ctx}
          menu={recipeFor}
          bases={bases}
          onClose={() => setRecipeFor(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  )
}

function MenuDialog({
  services,
  workspaceId,
  menu,
  categories,
  revenueAccounts,
  onClose,
  onSaved,
}: {
  services: AppServices
  workspaceId: string
  menu: Menu | null
  categories: string[]
  revenueAccounts: Account[]
  onClose: () => void
  onSaved: (menu: Menu, isNew: boolean) => void
}) {
  const [code, setCode] = useState(menu?.code ?? "")
  const [name, setName] = useState(menu?.name ?? "")
  const [category, setCategory] = useState(menu?.category ?? "")
  const [price, setPrice] = useState<number | null>(menu?.price ?? 0)
  const [revenueAccountId, setRevenueAccountId] = useState(menu?.revenueAccountId ?? revenueAccounts[0]?.id ?? NO_ACCOUNT)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const input = { code, name, category, price: price ?? -1, revenueAccountId: revenueAccountId === NO_ACCOUNT ? null : revenueAccountId }
    try {
      const saved = menu ? await services.menuService.updateMenu(menu.id, input) : await services.menuService.createMenu(workspaceId, input)
      toast.success(`${saved.code} · ${saved.name} disimpan`)
      onSaved(saved, !menu)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{menu ? "Ubah menu" : "Tambah menu"}</DialogTitle>
            <DialogDescription>Harga jual dipakai sebagai harga default di Penjualan menu.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="menu-code">Kode</Label>
              <Input id="menu-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="menu-name">Nama menu</Label>
              <Input id="menu-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="menu-category">Kategori</Label>
              <Input id="menu-category" list="menu-category-options" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="mis. Makanan, Minuman" />
              <datalist id="menu-category-options">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="menu-price">Harga jual per porsi</Label>
              <AmountInput id="menu-price" value={price} onValueChange={setPrice} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="menu-revenue">Akun pendapatan</Label>
            <Select value={revenueAccountId} onValueChange={setRevenueAccountId}>
              <SelectTrigger id="menu-revenue" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>Belum diatur</SelectItem>
                {revenueAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan menu"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Resep

interface DraftLine {
  key: number
  itemId: string
  quantity: string
}

function RecipeDialog({
  services,
  ctx,
  menu,
  bases,
  onClose,
  onSaved,
}: {
  services: AppServices
  ctx: Context
  menu: Menu
  bases: ReadonlyMap<string, QtyValue | null>
  onClose: () => void
  onSaved: () => void
}) {
  const today = todayIsoDate()
  const versions = ctx.recipes.filter((r) => r.menuId === menu.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
  const current = recipeAt(versions, menu.id, today) ?? versions[0] ?? null
  const [selected, setSelected] = useState<string>(current?.id ?? "new")
  const recipe = versions.find((v) => v.id === selected) ?? null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Resep · {menu.name}</DialogTitle>
          <DialogDescription>
            Qty dalam satuan dasar bahan. Mengubah resep? Simpan dengan tanggal berlaku baru agar periode lama tetap memakai resep lama.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Versi resep">
          {versions.map((v) => (
            <Button key={v.id} type="button" size="sm" variant={selected === v.id ? "default" : "secondary"} onClick={() => setSelected(v.id)}>
              Berlaku {formatDate(v.effectiveFrom)}
              {v.id === current?.id && v.effectiveFrom <= today ? " · aktif" : ""}
            </Button>
          ))}
          <Button type="button" size="sm" variant={selected === "new" ? "default" : "secondary"} onClick={() => setSelected("new")}>
            <PlusIcon data-icon="inline-start" /> Versi baru
          </Button>
        </div>
        <RecipeEditor
          key={selected}
          services={services}
          ctx={ctx}
          menu={menu}
          recipe={recipe}
          template={recipe ?? current}
          bases={bases}
          onSaved={() => {
            onSaved()
            onClose()
          }}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}

let lineKey = 0

function RecipeEditor({
  services,
  ctx,
  menu,
  recipe,
  template,
  bases,
  onSaved,
  onCancel,
}: {
  services: AppServices
  ctx: Context
  menu: Menu
  /** Versi yang sedang diubah (null = versi baru). */
  recipe: Recipe | null
  /** Isian awal (versi baru menyalin versi berlaku). */
  template: Recipe | null
  bases: ReadonlyMap<string, QtyValue | null>
  onSaved: () => void
  onCancel: () => void
}) {
  const items = ctx.items.filter((i) => i.isActive || template?.lines.some((l) => l.itemId === i.id)).sort(compareBySection)
  const [effectiveFrom, setEffectiveFrom] = useState(recipe?.effectiveFrom ?? todayIsoDate())
  const [yieldPortions, setYieldPortions] = useState(String(template?.yieldPortions ?? 1))
  const [lines, setLines] = useState<DraftLine[]>(() =>
    template ? template.lines.map((l) => ({ key: ++lineKey, itemId: l.itemId, quantity: String(l.quantity) })) : [{ key: ++lineKey, itemId: "", quantity: "" }],
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const filled = lines.filter((l) => l.itemId && /^\d+$/.test(l.quantity) && Number(l.quantity) > 0)
  const portions = /^\d+$/.test(yieldPortions) && Number(yieldPortions) > 0 ? Number(yieldPortions) : null
  const draft: Recipe | null = portions
    ? { id: "", createdAt: "", workspaceId: ctx.workspace.id, menuId: menu.id, effectiveFrom, yieldPortions: portions, lines: filled.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) })) }
    : null
  const cost = draft ? recipeCostPerPortion(draft, bases) : null
  const replaces = !recipe && ctx.recipes.some((r) => r.menuId === menu.id && r.effectiveFrom === effectiveFrom)
  const itemById = (id: string) => ctx.items.find((i) => i.id === id)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await services.menuService.saveRecipe({
        workspaceId: ctx.workspace.id,
        menuId: menu.id,
        effectiveFrom,
        yieldPortions: portions ?? 0,
        lines: lines.filter((l) => l.itemId || l.quantity).map((l) => ({ itemId: l.itemId, quantity: /^\d+$/.test(l.quantity) ? Number(l.quantity) : 0 })),
      })
      toast.success(`Resep ${menu.name} berlaku ${formatDate(effectiveFrom)} disimpan`)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!recipe) return
    try {
      await services.menuService.deleteRecipe(recipe.id)
      toast.success(`Resep berlaku ${formatDate(recipe.effectiveFrom)} dihapus`)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="recipe-date">Berlaku mulai</Label>
          <Input id="recipe-date" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="recipe-yield">Resep untuk</Label>
          <InputGroup>
            <InputGroupInput id="recipe-yield" inputMode="numeric" value={yieldPortions} onChange={(e) => setYieldPortions(e.target.value.replace(/\D/g, ""))} />
            <InputGroupAddon align="inline-end"><InputGroupText>porsi</InputGroupText></InputGroupAddon>
          </InputGroup>
        </div>
      </div>
      {recipe && effectiveFrom !== recipe.effectiveFrom && (
        <p className="text-xs text-muted-foreground">Tanggal diubah: disimpan sebagai versi baru; versi {formatDate(recipe.effectiveFrom)} tetap ada.</p>
      )}
      {replaces && <p className="text-xs text-amber-700">Sudah ada versi berlaku {formatDate(effectiveFrom)}; versi itu akan diganti.</p>}

      <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2">Bahan</th>
              <th className="w-40 px-3 py-2">Qty</th>
              <th className="px-3 py-2 text-right">Biaya</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line, index) => {
              const item = itemById(line.itemId)
              const qty = /^\d+$/.test(line.quantity) ? Number(line.quantity) : 0
              const basis = item ? bases.get(item.id) ?? null : null
              return (
                <tr key={line.key}>
                  <td className="px-3 py-2">
                    <Select value={line.itemId} onValueChange={(itemId) => setLines(lines.map((l) => (l.key === line.key ? { ...l, itemId } : l)))}>
                      <SelectTrigger aria-label={`Bahan baris ${index + 1}`} className="w-full bg-background"><SelectValue placeholder="Pilih bahan" /></SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id} disabled={lines.some((l) => l.itemId === i.id && l.key !== line.key)}>
                            {i.name} <span className="text-muted-foreground">· {i.code}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <InputGroup>
                      <InputGroupInput
                        aria-label={`Qty baris ${index + 1}`}
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(e) => setLines(lines.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value.replace(/\D/g, "") } : l)))}
                        className="text-right tabular-nums"
                      />
                      <InputGroupAddon align="inline-end"><InputGroupText>{item?.unit ?? ""}</InputGroupText></InputGroupAddon>
                    </InputGroup>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {item && qty > 0 ? (
                      basis ? <Amount value={fractionValue({ n: BigInt(qty), d: BigInt(1) }, basis)} /> : <span className="text-xs text-destructive">Belum ada harga</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-1 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus baris ${index + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
                    >
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setLines([...lines, { key: ++lineKey, itemId: "", quantity: "" }])}>
          <PlusIcon data-icon="inline-start" /> Tambah bahan
        </Button>
        {cost && (
          <p className="text-sm text-ink">
            Biaya bahan per porsi ≈ <strong><Amount value={cost.cost} /></strong>
            {menu.price > 0 && <span className="text-muted-foreground"> · food cost {percent.format(cost.cost / menu.price)}</span>}
          </p>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="sm:justify-between">
        <div>
          {recipe && (
            <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
              <Trash2Icon data-icon="inline-start" /> Hapus versi ini
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>Batal</Button>
          <Button type="button" disabled={saving} onClick={save}>{saving ? "Menyimpan…" : "Simpan resep"}</Button>
        </div>
      </DialogFooter>
    </div>
  )
}

// ---------------------------------------------------------------- Rekap porsi

function PortionSummaries({ services, ctx, onChanged }: { services: AppServices; ctx: Context; onChanged: () => void }) {
  const today = todayIsoDate()
  const menus = ctx.menus.filter((m) => m.isActive).sort(compareBySection)
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 7)}-01`)
  const [dateTo, setDateTo] = useState(endOfMonth(today))
  const [note, setNote] = useState("")
  const [entered, setEntered] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const portions = new Map(menus.filter((m) => /^\d+$/.test(entered[m.id] ?? "")).map((m) => [m.id, Number(entered[m.id])]))
  const total = [...portions.values()].reduce((t, n) => t + n, 0)
  const fileBase = `rekap-porsi-${dateFrom}-${dateTo}`
  const summaries = [...ctx.summaries].sort((a, b) => b.dateFrom.localeCompare(a.dateFrom))
  const menuName = (id: string) => ctx.menus.find((m) => m.id === id)?.name ?? "Menu terhapus"

  async function importFile(file: File) {
    try {
      const parsed = parsePortionSheet(await readSheetFile(file), ctx.menus)
      const next = { ...entered }
      for (const [menuId, value] of parsed.quantities) next[menuId] = String(value)
      setEntered(next)
      const notes = [
        `${parsed.quantities.size} menu terisi`,
        parsed.unknownCodes.length ? `${parsed.unknownCodes.length} kode tidak dikenal (${parsed.unknownCodes.slice(0, 3).join(", ")})` : "",
        parsed.invalid.length ? `${parsed.invalid.length} porsi tidak valid` : "",
      ].filter(Boolean)
      ;(parsed.unknownCodes.length || parsed.invalid.length ? toast.warning : toast.success)(`Import: ${notes.join(" · ")}`)
    } catch (e) {
      toast.error(`File tidak dapat dibaca: ${errorMessage(e)}`)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await services.menuService.createPortionSummary({
        workspaceId: ctx.workspace.id,
        dateFrom,
        dateTo,
        note,
        lines: [...portions].map(([menuId, n]) => ({ menuId, portions: n })),
      })
      toast.success(`Rekap porsi ${formatDate(dateFrom)} – ${formatDate(dateTo)} disimpan`)
      setEntered({})
      setNote("")
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(summary: PortionSummary) {
    try {
      await services.menuService.deletePortionSummary(summary.id)
      toast.success("Rekap porsi dihapus")
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-4">
      <p role="note" className="flex gap-2 rounded-2xl bg-card px-4 py-3 text-sm text-ink">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          Rekap porsi (mis. dari laporan POS atau ojek online) <strong>menggantikan</strong> Penjualan menu pada tanggal yang
          dicakupnya, agar porsi tidak terhitung dua kali. Rentang rekap tidak boleh bertumpuk.
        </span>
      </p>

      <section className="grid gap-4 rounded-2xl bg-canvas p-4 ring-1 ring-border sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="portion-from">Dari tanggal</Label>
            <Input id="portion-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-44" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="portion-to">Sampai tanggal</Label>
            <Input id="portion-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-44" />
          </div>
          <div className="grid min-w-48 flex-1 gap-1.5">
            <Label htmlFor="portion-note">Catatan</Label>
            <Input id="portion-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Laporan POS Januari" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => downloadCsv(`${fileBase}.csv`, portionSheetRows(menus, portions))}>
              <DownloadIcon data-icon="inline-start" /> Template CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadTableXlsx(`${fileBase}.xlsx`, "Rekap Porsi", portionSheetRows(menus, portions), 4).catch((e) => toast.error(errorMessage(e)))}
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
              aria-label="Import file rekap porsi"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) importFile(file)
                e.target.value = ""
              }}
            />
          </div>
        </div>

        {menus.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada menu aktif.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2.5">Menu</th>
                  <th className="w-44 px-3 py-2.5">Porsi terjual</th>
                </tr>
              </thead>
              {groupByCategory(menus, (m) => m).map(([category, group]) => (
                <tbody key={category} className="divide-y border-t">
                  <tr className="bg-card/60">
                    <th colSpan={2} scope="rowgroup" className="px-4 py-2 text-left text-xs font-bold tracking-wide text-ink uppercase">{category}</th>
                  </tr>
                  {group.map((menu) => (
                    <tr key={menu.id} className={cn(portions.has(menu.id) && "bg-success-pale/30")}>
                      <td className="px-4 py-2">
                        <span className="font-medium text-ink">{menu.name}</span>
                        <span className="block text-xs text-muted-foreground">{menu.code}</span>
                      </td>
                      <td className="px-3 py-2">
                        <InputGroup className="h-9">
                          <InputGroupInput
                            aria-label={`Porsi ${menu.name}`}
                            inputMode="numeric"
                            placeholder="0"
                            value={entered[menu.id] ?? ""}
                            onChange={(e) => setEntered((prev) => ({ ...prev, [menu.id]: e.target.value.replace(/\D/g, "") }))}
                            className="text-right tabular-nums"
                          />
                          <InputGroupAddon align="inline-end"><InputGroupText>porsi</InputGroupText></InputGroupAddon>
                        </InputGroup>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink">Total <strong>{formatNumber(total)}</strong> porsi dari {portions.size} menu</p>
          <Button disabled={saving || total === 0} onClick={save}>{saving ? "Menyimpan…" : "Simpan rekap"}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>

      <section className="grid gap-2">
        <h2 className="font-semibold text-ink">Rekap tersimpan</h2>
        {summaries.length === 0 ? (
          <p className="rounded-2xl bg-card px-4 py-4 text-sm text-muted-foreground">Belum ada rekap porsi.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-canvas ring-1 ring-border">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-card text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2.5">Periode</th>
                  <th className="px-3 py-2.5">Menu</th>
                  <th className="px-3 py-2.5 text-right">Total porsi</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {summaries.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-ink">{formatDate(s.dateFrom)} – {formatDate(s.dateTo)}</span>
                      {s.note && <span className="block text-xs text-muted-foreground">{s.note}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {s.lines.slice(0, 3).map((l) => `${menuName(l.menuId)} ${formatNumber(l.portions)}`).join(" · ")}
                      {s.lines.length > 3 && ` · +${s.lines.length - 3} menu`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(s.lines.reduce((t, l) => t + l.portions, 0))}</td>
                    <td className="px-2 py-2.5">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Hapus rekap ${s.dateFrom}`}><Trash2Icon /></Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Hapus rekap {formatDate(s.dateFrom)} – {formatDate(s.dateTo)}?</DialogTitle>
                            <DialogDescription>Penjualan menu pada tanggal tersebut kembali dihitung pada analisa variance.</DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild><Button variant="secondary">Batal</Button></DialogClose>
                            <DialogClose asChild><Button variant="destructive" onClick={() => remove(s)}>Hapus rekap</Button></DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

