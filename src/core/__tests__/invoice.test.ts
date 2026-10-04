/**
 * Faktur penjualan, kontak & profil usaha (ADR 022). Angka harapan dihitung manual:
 *
 * Faktur PT Maju 15 Mar 2026 (PB1 10% belum termasuk):
 *   Catering nasi box 50 × 25.000 = 1.250.000 (Penjualan Makanan)
 *   Es teh 50 × 5.000 = 250.000 (Penjualan Minuman)
 *   Dasar 1.500.000 + PB1 150.000 = 1.650.000 → Dr Piutang 1.650.000 / Cr 1.250.000 + 250.000 + PB1 150.000.
 * Pelunasan 650.000 → dibayar sebagian (sisa 1.000.000); pelunasan 1.000.000 → lunas.
 * Perpetual: Kue stok awal 100 pcs @ 5.000; faktur 10 pcs × 8.000 tanpa pajak →
 *   Dr Piutang 80.000 / Cr Pendapatan 80.000; Dr HPP 50.000 / Cr Persediaan 50.000 (10 pcs).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { formatInvoiceNumber, nextInvoiceSeq, summarizeInvoices, terbilang, validateProfile, defaultProfile } from "@/core/invoice";
import { buildSettlement } from "@/core/transactions";
import { FULL_VAT_DEFAULTS } from "@/core/sales-tax";
import { purchasesByItem } from "@/core/stock-count";
import type { Account, Contact, Invoice, InvoiceInput } from "@/core/types";
import { createFnbWorkspace, createTestEnv } from "./helpers";

async function expectCode(promise: Promise<unknown> | (() => unknown), code: ValidationCode) {
  const error = typeof promise === "function"
    ? (() => { try { promise(); return null; } catch (e) { return e; } })()
    : await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

describe("faktur penjualan, kontak & profil usaha", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  let maju: Contact;
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;

  const draft = (overrides: Partial<InvoiceInput> = {}): InvoiceInput => ({
    workspaceId,
    kind: "sale",
    contactId: maju.id,
    invoiceDate: "2026-03-15",
    dueDate: "2026-04-14",
    reference: "PO-778",
    notes: null,
    applyTax: true,
    lines: [
      { description: "Catering nasi box", quantity: 50, unit: "box", unitPrice: 25_000, accountId: byCode("4-1000").id, itemId: null },
      { description: "Es teh", quantity: 50, unit: "gelas", unitPrice: 5_000, accountId: byCode("4-2000").id, itemId: null },
    ],
    ...overrides,
  });
  const summaries = async (today = "2026-03-20") => {
    const data = await env.invoiceService.data(workspaceId);
    return summarizeInvoices(data.invoices, data.journals, data.accounts, today);
  };

  beforeEach(async () => {
    env = createTestEnv();
    const ws = await createFnbWorkspace(env);
    workspaceId = ws.workspace.id;
    accounts = ws.accounts;
    maju = await env.invoiceService.createContact(workspaceId, {
      name: "PT Maju",
      isCustomer: true,
      isSupplier: false,
      address: "Jl. Merdeka 1, Bandung",
      phone: null,
      email: "keuangan@maju.co.id",
      npwp: "01.234.567.8-901.000",
      paymentTermDays: 30,
      notes: null,
    });
  });

  it("profil: default, prefix dirapikan, logo & email divalidasi", async () => {
    expect(await env.invoiceService.getProfile(workspaceId)).toMatchObject({ invoicePrefix: "INV", logoDataUrl: null, updatedAt: null });
    const saved = await env.invoiceService.saveProfile(workspaceId, { ...defaultProfile(), invoicePrefix: " kds ", address: "  Jl. A  ", bankInfo: "BCA 123 a.n. Kedai" });
    expect(saved).toMatchObject({ invoicePrefix: "KDS", address: "Jl. A", bankInfo: "BCA 123 a.n. Kedai" });
    expect(validateProfile({ ...defaultProfile(), logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" }).logoDataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
    await expectCode(() => validateProfile({ ...defaultProfile(), logoDataUrl: "data:text/html;base64,PHNjcmlwdD4=" }), "INVALID_PROFILE");
    await expectCode(() => validateProfile({ ...defaultProfile(), invoicePrefix: "INV/X" }), "INVALID_PROFILE");
    await expectCode(() => validateProfile({ ...defaultProfile(), email: "bukan-email" }), "INVALID_PROFILE");
  });

  it("kontak: nama unik tanpa beda huruf, peran wajib, termin 0–365, tidak bisa dihapus bila dipakai faktur", async () => {
    const base = { isCustomer: true, isSupplier: false, address: null, phone: null, email: null, npwp: null, paymentTermDays: 0, notes: null };
    await expectCode(env.invoiceService.createContact(workspaceId, { ...base, name: " pt maju " }), "DUPLICATE_CONTACT");
    await expectCode(env.invoiceService.createContact(workspaceId, { ...base, name: "CV B", isCustomer: false }), "INVALID_INVOICE");
    await expectCode(env.invoiceService.createContact(workspaceId, { ...base, name: "CV B", paymentTermDays: 400 }), "INVALID_INVOICE");
    await env.invoiceService.saveDraft(draft());
    await expectCode(env.invoiceService.deleteContact(maju.id), "CONTACT_IN_USE");
    const unused = await env.invoiceService.createContact(workspaceId, { ...base, name: "CV B" });
    await env.invoiceService.deleteContact(unused.id);
    expect((await env.repos.invoices.listContacts(workspaceId)).map((c) => c.name)).toEqual(["PT Maju"]);
  });

  it("terbit: nomor INV/tahun/bulan/urut, jurnal piutang + pendapatan per baris + PB1, salinan kontak", async () => {
    const issued = await env.invoiceService.issue(draft());
    expect(issued).toMatchObject({ status: "issued", number: "INV/2026/03/0001", contactSnapshot: { name: "PT Maju", npwp: "01.234.567.8-901.000" } });
    const entry = (await env.repos.journals.getById(issued.journalEntryId!))!;
    expect(entry).toMatchObject({ source: "revenue", counterparty: "PT Maju", entryDate: "2026-03-15", description: "Faktur INV/2026/03/0001 · PT Maju", status: "posted" });
    expect(entry.lines.map((l) => [l.accountId, l.debit, l.credit, l.description])).toEqual([
      [byCode("1-1400").id, 1_650_000, 0, null],
      [byCode("4-1000").id, 0, 1_250_000, "Catering nasi box"],
      [byCode("4-2000").id, 0, 250_000, "Es teh"],
      [byCode("2-1200").id, 0, 150_000, "PB1"],
    ]);
    // Urut per tahun berlanjut lintas bulan; prefix mengikuti profil saat terbit.
    await env.invoiceService.saveProfile(workspaceId, { ...defaultProfile(), invoicePrefix: "KDS" });
    const april = await env.invoiceService.issue(draft({ invoiceDate: "2026-04-02", dueDate: "2026-05-02", applyTax: false }));
    expect(april.number).toBe("KDS/2026/04/0002");
    expect(formatInvoiceNumber("INV", "2027-01-05", nextInvoiceSeq([issued, april], "sale", "2027-01-05"))).toBe("INV/2027/01/0001");
    // Faktur terbit tidak bisa diubah/dihapus.
    await expectCode(env.invoiceService.saveDraft(draft(), issued.id), "INVALID_INVOICE");
    await expectCode(env.invoiceService.deleteDraft(issued.id), "INVALID_INVOICE");
  });

  it("syarat terbit: kontak, jatuh tempo, baris, akun pendapatan; periode terkunci membatalkan semuanya", async () => {
    await expectCode(env.invoiceService.issue(draft({ contactId: null })), "CONTACT_NOT_FOUND");
    await expectCode(env.invoiceService.issue(draft({ dueDate: "2026-03-14" })), "INVALID_DATE");
    await expectCode(env.invoiceService.issue(draft({ lines: [] })), "INVALID_INVOICE");
    await expectCode(env.invoiceService.issue(draft({ lines: [{ ...draft().lines[0], unitPrice: 0 }] })), "INVALID_AMOUNT");
    await expectCode(env.invoiceService.issue(draft({ lines: [{ ...draft().lines[0], accountId: byCode("1-1100").id }] })), "INVALID_ACCOUNT");
    await expectCode(env.invoiceService.issue(draft({ lines: [{ ...draft().lines[0], description: " " }] })), "INVALID_INVOICE");
    const periods = await env.repos.periods.listByWorkspace(workspaceId);
    await env.periodService.closePeriod(workspaceId, periods.find((p) => p.startDate === "2026-03-01")!.id);
    const before = await env.repos.journals.listByWorkspace(workspaceId);
    await expectCode(env.invoiceService.issue(draft()), "PERIOD_CLOSED");
    expect(await env.repos.journals.listByWorkspace(workspaceId)).toHaveLength(before.length);
    expect((await env.repos.invoices.listInvoices(workspaceId)).every((i: Invoice) => i.status === "draft" && i.number === null)).toBe(true);
  });

  it("status: belum dibayar → sebagian → lunas; lewat jatuh tempo; batal = void (ditolak bila ada pelunasan)", async () => {
    const issued = await env.invoiceService.issue(draft());
    expect((await summaries())[0]).toMatchObject({ status: "unpaid", total: 1_650_000, paid: 0, outstanding: 1_650_000 });
    expect((await summaries("2026-04-15"))[0].status).toBe("overdue");
    const target = (await env.repos.journals.getById(issued.journalEntryId!))!;
    const pay = (amount: number) => env.journalService.postJournal(buildSettlement({ target, entryDate: "2026-03-25", amount, cashAccountId: byCode("1-1100").id }, accounts));
    const first = await pay(650_000);
    expect((await summaries())[0]).toMatchObject({ status: "partial", paid: 650_000, outstanding: 1_000_000 });
    await expectCode(env.invoiceService.cancel(issued, "2026-03-26", "salah harga"), "HAS_SETTLEMENTS");
    await pay(1_000_000);
    expect((await summaries("2026-12-31"))[0]).toMatchObject({ status: "paid", outstanding: 0 });

    // Faktur lain dibatalkan → status dibatalkan; salin ke draft baru.
    const other = await env.invoiceService.issue(draft({ invoiceDate: "2026-03-16", dueDate: "2026-03-16" }));
    await env.invoiceService.cancel(other, "2026-03-17", "salah harga");
    const cancelled = (await summaries()).find((s) => s.invoice.id === other.id)!;
    expect(cancelled).toMatchObject({ status: "cancelled", total: 1_650_000 });
    const copy = await env.invoiceService.duplicate(other, "2026-03-18", "2026-04-17");
    expect(copy).toMatchObject({ status: "draft", number: null, invoiceDate: "2026-03-18", lines: other.lines });
    expect(first.settlementOf).toBe(issued.journalEntryId);
  });

  it("barang pada metode perpetual: Dr HPP / Cr Persediaan per barang ikut di jurnal faktur", async () => {
    const kue = await env.itemService.createItem(workspaceId, { code: "K-01", name: "Kue", unit: "pcs", revenueAccountId: byCode("4-1000").id });
    await env.inventoryService.changeSettings(workspaceId, { kind: "to_perpetual", entryDate: "2026-01-31", costMethod: "average", counts: [{ itemId: kue.id, quantity: 100, value: 500_000 }] });
    const issued = await env.invoiceService.issue(
      draft({ applyTax: false, lines: [{ description: "Kue", quantity: 10, unit: "pcs", unitPrice: 8_000, accountId: byCode("4-1000").id, itemId: kue.id }] }),
    );
    const entry = (await env.repos.journals.getById(issued.journalEntryId!))!;
    expect(entry.lines.map((l) => [l.accountId, l.debit, l.credit, l.itemId ?? null, l.quantity ?? null])).toEqual([
      [byCode("1-1400").id, 80_000, 0, null, null],
      [byCode("4-1000").id, 0, 80_000, kue.id, 10],
      [byCode("5-1000").id, 50_000, 0, null, null],
      [byCode("1-1300").id, 0, 50_000, kue.id, 10],
    ]);
  });

  it("terbilang", () => {
    expect(terbilang(1_650_000)).toBe("Satu juta enam ratus lima puluh ribu rupiah");
    expect(terbilang(0)).toBe("Nol rupiah");
    expect(terbilang(1_011)).toBe("Seribu sebelas rupiah");
    expect(terbilang(115)).toBe("Seratus lima belas rupiah");
    expect(terbilang(2_500_000_000)).toBe("Dua miliar lima ratus juta rupiah");
    expect(terbilang(21_000_019)).toBe("Dua puluh satu juta sembilan belas rupiah");
  });
});

/**
 * Faktur pembelian (ADR 022, Fase 7B). Angka harapan dihitung manual:
 * CV Pasar Segar, no. faktur PS-0091, 12 Mar 2026:
 *   Ayam (barang) 10.000 g × 55 = 550.000 → Persediaan (qty 10.000, masuk pembelian per bahan COGS)
 *   Gas LPG 2 × 25.000 = 50.000 → Beban Listrik & Air
 *   Mode PB1 (bukan PPN lengkap) → tanpa PPN Masukan; Cr Utang Usaha 600.000.
 * PPN lengkap 12% × 11/12: Servis mesin 1.000.000 → PPN Masukan 110.000, Utang 1.110.000; koreksi 109.999.
 */
describe("faktur pembelian", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  let pasar: Contact;
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;

  beforeEach(async () => {
    env = createTestEnv();
    const ws = await createFnbWorkspace(env);
    workspaceId = ws.workspace.id;
    accounts = ws.accounts;
    pasar = await env.invoiceService.createContact(workspaceId, {
      name: "CV Pasar Segar", isCustomer: false, isSupplier: true, address: "Pasar Kosambi", phone: null, email: null, npwp: null, paymentTermDays: 7, notes: null,
    });
  });

  const purchase = (overrides: Partial<InvoiceInput> = {}): InvoiceInput => ({
    workspaceId,
    kind: "purchase",
    contactId: pasar.id,
    invoiceDate: "2026-03-12",
    dueDate: "2026-03-19",
    reference: "PS-0091",
    notes: null,
    applyTax: true,
    taxOverride: null,
    lines: [],
    ...overrides,
  });

  it("terbit: nomor PB/tahun/bulan/urut, Dr Persediaan (barang+qty) & beban / Cr Utang Usaha, masuk pembelian per bahan", async () => {
    const ayam = await env.itemService.createItem(workspaceId, { code: "P-01", name: "Ayam", unit: "gram", revenueAccountId: null, category: "Protein" });
    const issued = await env.invoiceService.issue(
      purchase({
        lines: [
          // Akun baris barang dipaksa ke Persediaan walau diisi akun lain.
          { description: "Ayam fillet", quantity: 10_000, unit: "gram", unitPrice: 55, accountId: byCode("6-3000").id, itemId: ayam.id },
          { description: "Gas LPG", quantity: 2, unit: "tabung", unitPrice: 25_000, accountId: byCode("6-3000").id, itemId: null },
        ],
      }),
    );
    expect(issued).toMatchObject({ status: "issued", number: "PB/2026/03/0001", reference: "PS-0091", contactSnapshot: { name: "CV Pasar Segar" } });
    const entry = (await env.repos.journals.getById(issued.journalEntryId!))!;
    expect(entry).toMatchObject({ source: "purchase", counterparty: "CV Pasar Segar", description: "Faktur pembelian PB/2026/03/0001 · CV Pasar Segar (PS-0091)" });
    expect(entry.lines.map((l) => [l.accountId, l.debit, l.credit, l.itemId ?? null, l.quantity ?? null])).toEqual([
      [byCode("1-1300").id, 550_000, 0, ayam.id, 10_000],
      [byCode("6-3000").id, 50_000, 0, null, null],
      [byCode("2-1100").id, 0, 600_000, null, null],
    ]);
    const entries = await env.repos.journals.listByWorkspace(workspaceId);
    expect(purchasesByItem(entries, accounts, null, "2026-03-31").get(ayam.id)).toMatchObject({ qty: 10_000, value: 550_000 });
    // Nomor penjualan & pembelian berurutan sendiri-sendiri.
    expect((await summaries())[0]).toMatchObject({ status: "unpaid", total: 600_000, outstanding: 600_000 });
  });

  async function summaries(today = "2026-03-15") {
    const data = await env.invoiceService.data(workspaceId, "purchase");
    return summarizeInvoices(data.invoices, data.journals, data.accounts, today);
  }

  it("syarat terbit: pemasok, nomor faktur pemasok, akun aset/beban", async () => {
    const line = { description: "Gas LPG", quantity: 1, unit: null, unitPrice: 25_000, accountId: byCode("6-3000").id, itemId: null };
    const customer = await env.invoiceService.createContact(workspaceId, { name: "Pelanggan", isCustomer: true, isSupplier: false, address: null, phone: null, email: null, npwp: null, paymentTermDays: 0, notes: null });
    await expectCode(env.invoiceService.issue(purchase({ contactId: customer.id, lines: [line] })), "INVALID_INVOICE");
    await expectCode(env.invoiceService.issue(purchase({ reference: " ", lines: [line] })), "INVALID_INVOICE");
    await expectCode(env.invoiceService.issue(purchase({ lines: [{ ...line, accountId: byCode("4-1000").id }] })), "INVALID_ACCOUNT");
    await expectCode(env.invoiceService.issue(purchase({ lines: [{ ...line, accountId: byCode("1-1100").id }] })), "INVALID_ACCOUNT");
    await expectCode(env.invoiceService.saveDraft(purchase({ taxOverride: -1 })), "INVALID_AMOUNT");
  });

  it("PPN lengkap: PPN Masukan dihitung 12% × 11/12, bisa dikoreksi sesuai faktur pemasok", async () => {
    await env.taxService.updateSettings(workspaceId, { mode: "full_vat", label: "PPN", inclusive: false, ...FULL_VAT_DEFAULTS });
    accounts = await env.repos.accounts.listByWorkspace(workspaceId);
    const inputVat = accounts.find((a) => a.systemRole === "input_vat")!;
    const line = { description: "Servis mesin", quantity: 1, unit: null, unitPrice: 1_000_000, accountId: byCode("6-3000").id, itemId: null };
    const data = await env.invoiceService.data(workspaceId);
    const plan = env.invoiceService.plan(purchase({ lines: [line] }), data);
    expect(plan.totals).toEqual({ base: 1_000_000, tax: 110_000, total: 1_110_000 });
    const issued = await env.invoiceService.issue(purchase({ taxOverride: 109_999, lines: [line] }));
    const entry = (await env.repos.journals.getById(issued.journalEntryId!))!;
    expect(entry.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [byCode("6-3000").id, 1_000_000, 0],
      [inputVat.id, 109_999, 0],
      [byCode("2-1100").id, 0, 1_109_999],
    ]);
  });
});
