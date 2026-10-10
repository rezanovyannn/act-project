/**
 * Pesanan katering, DP, invoice DP, pengakuan pendapatan & pembatalan (ADR 024).
 * Angka harapan dihitung manual:
 *
 * Pesanan Bu Sari (acara 20 Okt 2026, 100 pax), PBJT 10% belum termasuk:
 *   Paket prasmanan 100 × 45.000 = 4.500.000 (Pendapatan Katering)
 *   Ongkir 1 × 200.000 = 200.000 (Pendapatan Ongkir & Sewa Alat)
 *   Subtotal 4.700.000 + PBJT 470.000 = 5.170.000.
 * Invoice DP 50% = 2.585.000; DP diterima 2.000.000 (Bank) → invoice DP dibayar sebagian (sisa 585.000).
 *   Jurnal DP: Dr Bank 2.000.000 / Cr Uang Muka Pelanggan 2.000.000.
 * Selesai 20 Okt: Faktur INV/2026/10/0001 → Dr Piutang 5.170.000 / Cr 4.500.000 + 200.000 + PBJT 470.000;
 *   DP dipakai: Dr Uang Muka 2.000.000 / Cr Piutang 2.000.000 → sisa piutang 3.170.000; saldo Uang Muka 0.
 * Pelunasan 3.170.000 (Kas) → lunas; Piutang 0.
 *
 * Pembatalan PT Lancar (DP 1.000.000, hangus 30%): Dr Uang Muka 1.000.000 / Cr Kas 700.000 / Cr Pendapatan Pembatalan 300.000.
 *
 * Laba per pesanan Bu Sari (Fase 10B): pendapatan 4.700.000 (tanpa PBJT); biaya bahan 2.000.000 (HPP) +
 *   transport 300.000 → laba kotor 2.400.000, margin 2.400.000/4.700.000 = 51,06% (5106 bps), per pax 24.000.
 *   Estimasi bahan 1.800.000 + transport 250.000 = 2.050.000.
 * PPh 23 2% × dasar 4.700.000 = 94.000; sisa piutang 3.170.000 → kas 3.076.000 + PPh 23 94.000.
 *
 * Paket & daftar belanja (Fase 10C): Paket A resep untuk 10 pax = beras 1.000 g, ayam 1.500 g, sayur 3 ikat.
 *   Harga: beras perkiraan Rp 15.000 / 1.000 g (Rp 15/g); ayam beli terakhir 5.000 g Rp 200.000 (Rp 40/g,
 *   mengalahkan perkiraan Rp 35/g); sayur tanpa harga.
 *   Pesanan 100 pax: beras 10.000 g = 150.000, ayam 15.000 g = 600.000, sayur 30 ikat (tanpa harga) → 750.000.
 *   Pesanan 15 pax: beras 1.500 g = 22.500, ayam 2.250 g = 90.000, sayur 4,5 ikat → dibeli 5.
 *   Gabungan: beras 11.500 g = 172.500; ayam 17.250 g = 690.000; sayur 34,5 → 35 ikat; total 862.500.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCancellation,
  costCategoryOf,
  lineFromPackage,
  defaultCostAccount,
  defaultWithholding,
  depositFlows,
  forfeitAmount,
  nextNumberSeq,
  orderTotals,
  ordersByDate,
  policyLabel,
  summarizeBills,
  validateOrderInput,
} from "@/core/catering";
import { buildBackup } from "@/core/backup";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { validateTemplate } from "@/core/templates";
import type { Account, CateringOrder, CateringOrderInput, Contact, JournalEntry } from "@/core/types";
import { CATERING_TEMPLATE } from "@/modules/catering/template";
import { createTestEnv } from "./helpers";

async function expectCode(promise: Promise<unknown> | (() => unknown), code: ValidationCode) {
  const error = typeof promise === "function"
    ? (() => { try { promise(); return null; } catch (e) { return e; } })()
    : await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

/** Saldo akun (debit − kredit) dari semua jurnal posted. */
function balanceOf(journals: readonly JournalEntry[], accountId: string): number {
  return journals
    .filter((e) => e.status === "posted" && e.deletedAt === null)
    .flatMap((e) => e.lines)
    .filter((l) => l.accountId === accountId)
    .reduce((t, l) => t + l.debit - l.credit, 0);
}

describe("template katering", () => {
  it("CoA valid: Uang Muka Pelanggan, Utang PBJT, Pendapatan Pembatalan; PBJT 0%", () => {
    expect(validateTemplate(CATERING_TEMPLATE)).toEqual([]);
    const deposit = CATERING_TEMPLATE.accounts.find((a) => a.systemRole === "customer_deposits")!;
    expect(deposit).toMatchObject({ name: "Uang Muka Pelanggan", accountType: "liability", normalBalance: "credit", cashFlowCategory: "operating" });
    expect(CATERING_TEMPLATE.accounts.find((a) => a.systemRole === "sales_tax_payable")!.name).toBe("Utang PBJT");
    expect(CATERING_TEMPLATE.accounts.some((a) => a.name === "Pendapatan Pembatalan" && a.accountType === "revenue")).toBe(true);
    expect(CATERING_TEMPLATE.salesTaxDefaults).toMatchObject({ label: "PBJT", rateBps: 0, mode: "simple" });
  });
});

describe("pesanan katering, DP & invoice", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  let sari: Contact;
  let lancar: Contact;
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;

  const input = (overrides: Partial<CateringOrderInput> = {}): CateringOrderInput => ({
    workspaceId,
    contactId: sari.id,
    serviceType: "event",
    eventDate: "2026-10-20",
    eventTime: "11:00",
    location: "Gedung Serbaguna",
    pax: 100,
    quoteDate: "2026-10-01",
    validUntil: "2026-10-08",
    applyTax: true,
    discount: null,
    notes: null,
    cancellationPolicy: { kind: "refund", forfeitBps: 0 },
    costEstimates: {},
    lines: [
      { description: "Paket prasmanan", quantity: 100, unit: "pax", unitPrice: 45_000, accountId: byCode("4-1000").id, itemId: null },
      { description: "Ongkir", quantity: 1, unit: null, unitPrice: 200_000, accountId: byCode("4-1100").id, itemId: null },
    ],
    ...overrides,
  });

  const data = () => env.cateringService.data(workspaceId);
  const summary = async (order: CateringOrder, today = "2026-10-05") => {
    const d = await data();
    return env.cateringService.summaries(d, today).find((s) => s.order.id === order.id)!;
  };

  beforeEach(async () => {
    env = createTestEnv();
    const workspace = await env.workspaceService.createWorkspace({ ownerId: "owner-a", name: "Katering Test", templateType: "catering", booksStartDate: "2026-01-01" });
    workspaceId = workspace.id;
    await env.repos.workspaces.updateSalesTaxSettings(workspaceId, { mode: "simple", label: "PBJT", rateBps: 1000, inclusive: false, dppNumerator: 1, dppDenominator: 1 });
    accounts = await env.repos.accounts.listByWorkspace(workspaceId);
    const contact = { isCustomer: true, isSupplier: false, address: null, phone: null, email: null, npwp: null, paymentTermDays: 7, notes: null };
    sari = await env.invoiceService.createContact(workspaceId, { ...contact, name: "Bu Sari" });
    lancar = await env.invoiceService.createContact(workspaceId, { ...contact, name: "PT Lancar", cancellationPolicy: { kind: "forfeit_percent", forfeitBps: 3000 } });
  });

  it("workspace katering memakai label PBJT dan punya akun Uang Muka Pelanggan", async () => {
    const workspace = await env.repos.workspaces.getById(workspaceId);
    expect(workspace!.templateType).toBe("catering");
    expect(workspace!.salesTaxLabel).toBe("PBJT");
    expect(accounts.find((a) => a.systemRole === "customer_deposits")!.code).toBe("2-1300");
  });

  it("nomor quotation QUO/yyyy/mm/urut, prefix SPH dari profil; total = subtotal + PBJT", async () => {
    const first = await env.cateringService.saveOrder(input());
    expect(first.number).toBe("QUO/2026/10/0001");
    expect(first.state).toBe("quotation");
    const profile = await env.invoiceService.getProfile(workspaceId);
    await env.invoiceService.saveProfile(workspaceId, { ...profile, quotationPrefix: "SPH" });
    const second = await env.cateringService.saveOrder(input());
    expect(second.number).toBe("SPH/2026/10/0002");
    const workspace = (await env.repos.workspaces.getById(workspaceId))!;
    expect(orderTotals(first, workspace)).toEqual({ subtotal: 4_700_000, discount: 0, base: 4_700_000, tax: 470_000, total: 5_170_000 });
    expect(orderTotals({ ...first, discount: { kind: "percent", value: 1000 } }, workspace)).toEqual({ subtotal: 4_700_000, discount: 470_000, base: 4_230_000, tax: 423_000, total: 4_653_000 });
  });

  it("alur lengkap: invoice DP, DP masuk (otomatis konfirmasi), selesai → faktur + DP dipakai, pelunasan → lunas", async () => {
    let order = await env.cateringService.saveOrder(input());
    const bill = await env.cateringService.createBill({ workspaceId, orderId: order.id, billDate: "2026-10-02", dueDate: "2026-10-09", amount: 2_585_000, note: "DP 50%" });
    expect(bill.number).toBe("INV-DP/2026/10/0001");

    // DP diterima ke Bank (dipilih), penawaran otomatis dikonfirmasi.
    const dp = await env.cateringService.receivePayment(order, { date: "2026-10-03", amount: 2_000_000, cashAccountId: byCode("1-1200").id });
    expect(dp.source).toBe("deposit");
    expect(dp.lines.map((l) => [l.accountId, l.debit, l.credit, l.orderId])).toEqual([
      [byCode("1-1200").id, 2_000_000, 0, order.id],
      [byCode("2-1300").id, 0, 2_000_000, order.id],
    ]);
    order = (await env.repos.catering.getOrder(order.id))!;
    expect(order.state).toBe("confirmed");

    let s = await summary(order);
    expect(s.deposit.balance).toBe(2_000_000);
    expect(s.outstanding).toBe(3_170_000);
    expect(s.paymentStatus).toBe("partial");
    const d = await data();
    const bills = env.cateringService.billSummaries(d, "2026-10-05");
    expect(bills[0]).toMatchObject({ paid: 2_000_000, outstanding: 585_000, status: "partial" });

    // Pesanan selesai: faktur terbit + DP dipakai.
    order = await env.cateringService.complete(order, { date: "2026-10-20", dueDate: "2026-10-27" });
    expect(order.state).toBe("completed");
    const invoice = (await env.repos.invoices.getInvoice(order.invoiceId!))!;
    expect(invoice).toMatchObject({ number: "INV/2026/10/0001", reference: order.number, status: "issued" });
    s = await summary(order, "2026-10-21");
    expect(s.invoice).toMatchObject({ total: 5_170_000, paid: 2_000_000, outstanding: 3_170_000, status: "partial" });
    expect(s.deposit).toMatchObject({ received: 2_000_000, applied: 2_000_000, balance: 0 });
    let journals = await env.repos.journals.listByWorkspace(workspaceId);
    expect(balanceOf(journals, byCode("2-1300").id)).toBe(0);
    expect(balanceOf(journals, byCode("1-1400").id)).toBe(3_170_000);
    expect(balanceOf(journals, byCode("4-1000").id)).toBe(-4_500_000);
    expect(balanceOf(journals, byCode("2-1200").id)).toBe(-470_000);
    // Semua baris jurnal faktur bertag pesanan (untuk laba per pesanan, 10B).
    const invoiceJournal = journals.find((e) => e.id === invoice.journalEntryId)!;
    expect(invoiceJournal.lines.every((l) => l.orderId === order.id)).toBe(true);

    // Pelunasan ke Kas.
    await env.cateringService.receivePayment(order, { date: "2026-10-25", amount: 3_170_000, cashAccountId: byCode("1-1100").id });
    s = await summary(order, "2026-10-25");
    expect(s).toMatchObject({ paymentStatus: "paid", outstanding: 0, paid: 5_170_000 });
    journals = await env.repos.journals.listByWorkspace(workspaceId);
    expect(balanceOf(journals, byCode("1-1400").id)).toBe(0);
    expect(balanceOf(journals, byCode("1-1100").id)).toBe(3_170_000);
    expect(balanceOf(journals, byCode("1-1200").id)).toBe(2_000_000);

    // Pesanan selesai tidak bisa diubah, dibatalkan, atau menerima DP baru.
    await expectCode(env.cateringService.saveOrder(input(), order.id), "INVALID_ORDER");
    await expectCode(env.cateringService.cancel(order, { date: "2026-10-26", reason: "x", policy: order.cancellationPolicy, cashAccountId: null, forfeitAccountId: null }), "INVALID_ORDER");
  });

  it("daftar per klien cocok dengan saldo Uang Muka Pelanggan & Piutang Usaha", async () => {
    const a = await env.cateringService.saveOrder(input());
    await env.cateringService.receivePayment(a, { date: "2026-10-03", amount: 1_000_000, cashAccountId: byCode("1-1100").id });
    const b = await env.cateringService.saveOrder(input({ eventDate: "2026-10-10", pax: 20, lines: [{ description: "Nasi box", quantity: 20, unit: "box", unitPrice: 30_000, accountId: byCode("4-1000").id, itemId: null }] }));
    await env.cateringService.receivePayment(b, { date: "2026-10-03", amount: 200_000, cashAccountId: byCode("1-1100").id });
    await env.cateringService.complete((await env.repos.catering.getOrder(b.id))!, { date: "2026-10-10", dueDate: "2026-10-17" });
    const d = await data();
    const [client] = env.cateringService.clients(d, "2026-10-11");
    const journals = d.journals;
    expect(client.name).toBe("Bu Sari");
    expect(client.depositHeld).toBe(-balanceOf(journals, byCode("2-1300").id));
    expect(client.receivable).toBe(balanceOf(journals, byCode("1-1400").id));
    // b: 20 × 30.000 = 600.000 + PBJT 60.000 = 660.000 − DP 200.000 = 460.000; a: 5.170.000 − 1.000.000.
    expect(client).toMatchObject({ orders: 2, depositHeld: 1_000_000, receivable: 460_000, outstanding: 460_000 + 4_170_000, nextEventDate: "2026-10-20" });
  });

  it("DP melebihi total: sisa tetap di Uang Muka, dapat dikembalikan (tidak boleh melebihi saldo)", async () => {
    let order = await env.cateringService.saveOrder(input({ applyTax: false, lines: [{ description: "Tumpeng", quantity: 1, unit: null, unitPrice: 900_000, accountId: byCode("4-1000").id, itemId: null }] }));
    await env.cateringService.receivePayment(order, { date: "2026-10-03", amount: 1_000_000, cashAccountId: byCode("1-1100").id });
    order = await env.cateringService.complete((await env.repos.catering.getOrder(order.id))!, { date: "2026-10-20", dueDate: "2026-10-20" });
    let s = await summary(order, "2026-10-20");
    expect(s).toMatchObject({ paymentStatus: "paid", excessDeposit: 100_000 });
    await expectCode(env.cateringService.refundDeposit(order, { date: "2026-10-21", amount: 150_000, cashAccountId: byCode("1-1100").id }), "INVALID_DEPOSIT");
    // Pesanan selesai: pembayaran baru = pelunasan faktur (sudah lunas → ditolak), bukan DP.
    await expectCode(env.cateringService.receivePayment(order, { date: "2026-10-21", amount: 10_000, cashAccountId: byCode("1-1100").id }), "INVALID_SETTLEMENT");
    await env.cateringService.refundDeposit(order, { date: "2026-10-21", amount: 100_000, cashAccountId: byCode("1-1100").id });
    s = await summary(order, "2026-10-21");
    expect(s.excessDeposit).toBe(0);
    expect(s.deposit).toMatchObject({ received: 1_000_000, applied: 900_000, refunded: 100_000, balance: 0 });
  });

  it("pembatalan: kebijakan default dari kontak, DP hangus 30% & dikembalikan 70%, saldo DP nol", async () => {
    const order = await env.cateringService.saveOrder(input({ contactId: lancar.id, cancellationPolicy: lancar.cancellationPolicy! }));
    expect(order.cancellationPolicy).toEqual({ kind: "forfeit_percent", forfeitBps: 3000 });
    expect(policyLabel(order.cancellationPolicy)).toBe("DP hangus 30%, sisanya dikembalikan");
    await env.cateringService.receivePayment(order, { date: "2026-10-03", amount: 1_000_000, cashAccountId: byCode("1-1100").id });
    const confirmed = (await env.repos.catering.getOrder(order.id))!;
    const cancel = { date: "2026-10-10", reason: "Acara diundur", policy: confirmed.cancellationPolicy, cashAccountId: byCode("1-1100").id, forfeitAccountId: byCode("4-1200").id };
    const plan = env.cateringService.cancellationPlan(confirmed, await data(), cancel);
    expect(plan).toMatchObject({ refund: 700_000, forfeit: 300_000 });
    expect(plan.entry!.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [byCode("2-1300").id, 1_000_000, 0],
      [byCode("1-1100").id, 0, 700_000],
      [byCode("4-1200").id, 0, 300_000],
    ]);
    const cancelled = await env.cateringService.cancel(confirmed, cancel);
    expect(cancelled).toMatchObject({ state: "cancelled", cancelReason: "Acara diundur" });
    const d = await data();
    expect(balanceOf(d.journals, byCode("2-1300").id)).toBe(0);
    expect(balanceOf(d.journals, byCode("4-1200").id)).toBe(-300_000);
    expect(depositFlows(d.journals, d.accounts).get(order.id)).toMatchObject({ received: 1_000_000, refunded: 700_000, forfeited: 300_000, balance: 0 });
    // Tidak bisa menerima DP lagi setelah dibatalkan.
    await expectCode(env.cateringService.receivePayment(cancelled, { date: "2026-10-11", amount: 1, cashAccountId: byCode("1-1100").id }), "INVALID_ORDER");
    await expectCode(env.journalService.postJournal(plan.entry!), "INVALID_DEPOSIT");
  });

  it("pembatalan tanpa DP tidak membuat jurnal; DP hangus seluruhnya wajib akun pendapatan", async () => {
    const order = await env.cateringService.saveOrder(input());
    const cancelled = await env.cateringService.cancel(order, { date: "2026-10-05", reason: "Batal", policy: order.cancellationPolicy, cashAccountId: null, forfeitAccountId: null });
    expect(cancelled.state).toBe("cancelled");
    expect((await env.repos.journals.listByWorkspace(workspaceId)).length).toBe(0);
    const accountsList = await env.repos.accounts.listByWorkspace(workspaceId);
    expect(() => buildCancellation({ ...order, state: "confirmed" }, "Bu Sari", { date: "2026-10-05", reason: "x", policy: { kind: "forfeit_all", forfeitBps: 0 }, cashAccountId: null, forfeitAccountId: null }, 500_000, accountsList)).toThrow(AccountingError);
    expect(forfeitAmount(333_333, { kind: "forfeit_percent", forfeitBps: 5000 })).toBe(166_667);
  });

  it("void DP yang belum dipakai mengembalikan saldo; DP yang sudah dipakai melunasi faktur tidak bisa di-void", async () => {
    const order = await env.cateringService.saveOrder(input());
    const first = await env.cateringService.receivePayment(order, { date: "2026-10-03", amount: 500_000, cashAccountId: byCode("1-1100").id });
    await env.journalService.voidJournal(first.id, "2026-10-04", "Salah input");
    let s = await summary(order);
    expect(s.deposit.balance).toBe(0);
    const reversal = (await env.repos.journals.listByWorkspace(workspaceId)).find((e) => e.reversalOf === first.id)!;
    expect(reversal.lines.every((l) => l.orderId === order.id)).toBe(true);

    const second = await env.cateringService.receivePayment((await env.repos.catering.getOrder(order.id))!, { date: "2026-10-04", amount: 800_000, cashAccountId: byCode("1-1100").id });
    await env.cateringService.complete((await env.repos.catering.getOrder(order.id))!, { date: "2026-10-20", dueDate: "2026-10-27" });
    await expectCode(env.journalService.voidJournal(second.id, "2026-10-21", "Coba"), "INVALID_DEPOSIT");
    s = await summary(order, "2026-10-21");
    expect(s.deposit).toMatchObject({ received: 800_000, applied: 800_000, balance: 0 });
  });

  it("validasi: pax, jam, masa berlaku, konfirmasi butuh baris lengkap, hapus hanya penawaran tanpa DP", async () => {
    expect(() => validateOrderInput(input({ pax: 0 }))).toThrow(AccountingError);
    expect(() => validateOrderInput(input({ eventTime: "25:00" }))).toThrow(AccountingError);
    expect(() => validateOrderInput(input({ validUntil: "2026-09-30" }))).toThrow(AccountingError);
    const empty = await env.cateringService.saveOrder(input({ lines: [{ description: "", quantity: 0, unit: null, unitPrice: 0, accountId: "", itemId: null }] }));
    await expectCode(env.cateringService.confirm(empty), "INVALID_ORDER");
    await env.cateringService.deleteOrder(empty.id);
    expect(await env.repos.catering.getOrder(empty.id)).toBeNull();

    const paid = await env.cateringService.saveOrder(input());
    await env.cateringService.createBill({ workspaceId, orderId: paid.id, billDate: "2026-10-02", dueDate: "2026-10-02", amount: 1_000_000, note: null });
    await expectCode(env.cateringService.deleteOrder(paid.id), "ORDER_IN_USE");
    await expectCode(env.cateringService.createBill({ workspaceId, orderId: paid.id, billDate: "2026-10-02", dueDate: "2026-10-02", amount: 4_170_001, note: null }), "INVALID_AMOUNT");
    // Nomor quotation tidak dipakai ulang setelah penawaran dihapus.
    expect((await env.cateringService.saveOrder(input())).number).toBe("QUO/2026/10/0003");
  });

  it("backup & pulihkan menyertakan pesanan, invoice DP, dan tag pesanan di jurnal", async () => {
    const order = await env.cateringService.saveOrder(input());
    await env.cateringService.createBill({ workspaceId, orderId: order.id, billDate: "2026-10-02", dueDate: "2026-10-09", amount: 2_000_000, note: null });
    await env.cateringService.receivePayment(order, { date: "2026-10-03", amount: 2_000_000, cashAccountId: byCode("1-1200").id });
    await env.cateringService.complete((await env.repos.catering.getOrder(order.id))!, { date: "2026-10-20", dueDate: "2026-10-27" });
    const d = await data();
    const backup = buildBackup(
      { workspace: d.workspace, accounts: d.accounts, periods: await env.repos.periods.listByWorkspace(workspaceId), journals: d.journals, items: [], auditLogs: [], profile: d.profile, contacts: d.contacts, invoices: d.invoices, cateringOrders: d.orders, orderBills: d.bills },
      "2026-10-21T00:00:00.000Z",
    );
    expect(env.workspaceService.inspectBackup(JSON.parse(JSON.stringify(backup))).summary.counts.orders).toBe(1);
    const restored = await env.workspaceService.restoreBackup("owner-a", JSON.parse(JSON.stringify(backup)), "Pulihan");
    const r = await env.cateringService.data(restored.id);
    const [before] = env.cateringService.summaries(d, "2026-10-21");
    const [after] = env.cateringService.summaries(r, "2026-10-21");
    expect(after.order).toMatchObject({ number: before.order.number, state: "completed" });
    expect(after.order.id).not.toBe(before.order.id);
    expect(after.deposit).toEqual(before.deposit);
    expect(after.invoice).toMatchObject({ total: 5_170_000, outstanding: 3_170_000 });
    expect(r.bills).toHaveLength(1);
    expect(r.bills[0].orderId).toBe(after.order.id);
    // Tag pesanan di jurnal ikut dipetakan.
    expect(r.journals.flatMap((e) => e.lines).filter((l) => l.orderId).every((l) => l.orderId === after.order.id)).toBe(true);
  });

  it("biaya per pesanan: kategori dari akun, bahan langsung HPP, laba kotor & estimasi, void menetralkan", async () => {
    expect(costCategoryOf(byCode("5-1000"))).toBe("materials");
    expect(costCategoryOf(byCode("6-1300"))).toBe("transport");
    expect(costCategoryOf(byCode("6-2000"))).toBe("other");
    expect(costCategoryOf(byCode("1-1100"))).toBeNull();
    expect(defaultCostAccount(accounts, "labor")!.code).toBe("6-1100");
    expect(defaultCostAccount(accounts, "materials")!.code).toBe("5-1000");

    let order = await env.cateringService.saveOrder(input({ costEstimates: { materials: 1_800_000, transport: 250_000, labor: 0 } }));
    expect(order.costEstimates).toEqual({ materials: 1_800_000, transport: 250_000 });
    await env.cateringService.receivePayment(order, { date: "2026-10-03", amount: 2_000_000, cashAccountId: byCode("1-1200").id });
    order = (await env.repos.catering.getOrder(order.id))!;
    const bahan = await env.cateringService.recordCost(order, {
      date: "2026-10-19", category: "materials", accountId: byCode("5-1000").id, amount: 2_000_000, description: "Belanja pasar", payment: { kind: "cash", accountId: byCode("1-1100").id },
    });
    expect(bahan.lines.map((l) => [l.accountId, l.debit, l.credit, l.orderId])).toEqual([
      [byCode("5-1000").id, 2_000_000, 0, order.id],
      [byCode("1-1100").id, 0, 2_000_000, null],
    ]);
    await env.cateringService.recordCost(order, {
      date: "2026-10-20", category: "transport", accountId: byCode("6-1300").id, amount: 300_000, description: "", payment: { kind: "credit", counterparty: "Rental Pickup" },
    });
    const salah = await env.cateringService.recordCost(order, {
      date: "2026-10-20", category: "labor", accountId: byCode("6-1100").id, amount: 999_000, description: "Salah input", payment: { kind: "cash", accountId: byCode("1-1100").id },
    });
    await env.journalService.voidJournal(salah.id, "2026-10-21", "Salah");
    await expectCode(env.cateringService.recordCost(order, {
      date: "2026-10-20", category: "materials", accountId: byCode("6-1300").id, amount: 1, description: "", payment: { kind: "cash", accountId: byCode("1-1100").id },
    }), "INVALID_ACCOUNT");
    await env.cateringService.complete(order, { date: "2026-10-20", dueDate: "2026-10-27" });

    let d = await data();
    let profit = env.cateringService.profits(d).get(order.id)!;
    expect(profit).toMatchObject({ revenue: 4_700_000, totalCost: 2_300_000, profit: 2_400_000, marginBps: 5106, profitPerPax: 24_000, estimateTotal: 2_050_000 });
    expect(profit.costs).toMatchObject({ materials: 2_000_000, transport: 300_000, labor: 0 });
    // Semua pendapatan & biaya bertag pesanan → sama dengan laba kotor di Laba Rugi.
    const pl = d.journals.filter((e) => e.status === "posted").flatMap((e) => e.lines).reduce((t, l) => {
      const type = d.accounts.find((a) => a.id === l.accountId)!.accountType;
      return type === "revenue" ? t + l.credit - l.debit : type === "cogs" || type === "expense" ? t - (l.debit - l.credit) : t;
    }, 0);
    expect(pl).toBe(profit.profit);

    // Mode bahan baku saja: biaya transport tidak dihitung & tidak bisa dicatat.
    await env.cateringService.updateSettings(workspaceId, { costMode: "materials", pph23Enabled: false, pph23RateBps: 200 });
    d = await data();
    profit = env.cateringService.profits(d).get(order.id)!;
    expect(profit).toMatchObject({ totalCost: 2_000_000, profit: 2_700_000, estimateTotal: 1_800_000 });
    await expectCode(env.cateringService.recordCost(order, {
      date: "2026-10-20", category: "transport", accountId: byCode("6-1300").id, amount: 1, description: "", payment: { kind: "cash", accountId: byCode("1-1100").id },
    }), "INVALID_ACCOUNT");
  });

  it("PPh 23 dipotong pelanggan saat pelunasan: harus diaktifkan, default 2% × tanpa PBJT", async () => {
    let order = await env.cateringService.saveOrder(input());
    await env.cateringService.receivePayment(order, { date: "2026-10-03", amount: 2_000_000, cashAccountId: byCode("1-1200").id });
    order = await env.cateringService.complete((await env.repos.catering.getOrder(order.id))!, { date: "2026-10-20", dueDate: "2026-10-27" });
    const withholding = defaultWithholding(4_700_000, 200, 3_170_000);
    expect(withholding).toBe(94_000);
    const pay = { date: "2026-10-25", amount: 3_076_000, cashAccountId: byCode("1-1100").id };
    await expectCode(env.cateringService.receivePayment(order, pay, withholding), "INVALID_SETTLEMENT");
    const workspace = await env.cateringService.updateSettings(workspaceId, { costMode: "detail", pph23Enabled: true, pph23RateBps: 200 });
    expect(workspace.cateringSettings).toEqual({ costMode: "detail", pph23Enabled: true, pph23RateBps: 200 });
    await expectCode(env.cateringService.updateSettings(workspaceId, { costMode: "detail", pph23Enabled: true, pph23RateBps: 0 }), "INVALID_AMOUNT");
    const entry = await env.cateringService.receivePayment(order, pay, withholding);
    expect(entry.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [byCode("1-1100").id, 3_076_000, 0],
      [byCode("1-1500").id, 94_000, 0],
      [byCode("1-1400").id, 0, 3_170_000],
    ]);
    const s = await summary(order, "2026-10-25");
    expect(s).toMatchObject({ paymentStatus: "paid", outstanding: 0 });
    const d = await data();
    expect(balanceOf(d.journals, byCode("1-1500").id)).toBe(94_000);
    // PPh 23 tidak berlaku untuk DP.
    const other = await env.cateringService.saveOrder(input());
    await expectCode(env.cateringService.receivePayment(other, { date: "2026-10-03", amount: 100, cashAccountId: byCode("1-1100").id }, 2), "INVALID_DEPOSIT");
  });

  it("paket menu: validasi, harga bahan (beli terakhir > perkiraan), estimasi resep, daftar belanja gabungan", async () => {
    const item = (code: string, name: string, unit: string, estimatedPrice: number | null, estimatedPer = 1) =>
      env.itemService.createItem(workspaceId, { code, name, unit, revenueAccountId: null, category: "Bahan", estimatedPrice, estimatedPer });
    const beras = await item("B-1", "Beras", "gram", 15_000, 1_000);
    const ayam = await item("B-2", "Ayam", "gram", 35_000, 1_000);
    const sayur = await item("B-3", "Sayur asem", "ikat", null);
    expect(beras).toMatchObject({ estimatedPrice: 15_000, estimatedPer: 1_000 });
    await env.journalService.postJournal({
      workspaceId, entryDate: "2026-10-01", description: "Beli ayam", source: "purchase",
      lines: [{ accountId: byCode("1-1300").id, debit: 200_000, credit: 0, itemId: ayam.id, quantity: 5_000 }, { accountId: byCode("1-1100").id, debit: 0, credit: 200_000 }],
    });
    const lines = [{ itemId: beras.id, quantity: 1_000 }, { itemId: ayam.id, quantity: 1_500 }, { itemId: sayur.id, quantity: 3 }];
    const pkg = await env.cateringService.savePackage(workspaceId, { code: "pa", name: "Prasmanan A", description: "Nasi, ayam bakar, sayur asem", pricePerPax: 45_000, revenueAccountId: null, yieldPax: 10, lines });
    expect(pkg.code).toBe("PA");
    await expectCode(env.cateringService.savePackage(workspaceId, { ...pkg, code: "PA" }), "DUPLICATE_MENU_CODE");
    await expectCode(env.cateringService.savePackage(workspaceId, { ...pkg, code: "PB", lines: [...lines, { itemId: beras.id, quantity: 1 }] }), "INVALID_RECIPE");
    await expectCode(env.cateringService.savePackage(workspaceId, { ...pkg, code: "PB", lines: [{ itemId: beras.id, quantity: 0 }] }), "INVALID_QUANTITY");

    const line = lineFromPackage(pkg, 100, byCode("4-1000").id);
    expect(line).toMatchObject({ description: "Prasmanan A (Nasi, ayam bakar, sayur asem)", quantity: 100, unit: "pax", unitPrice: 45_000, accountId: byCode("4-1000").id, packageId: pkg.id });
    let d = await data();
    const prices = env.cateringService.prices(d, "2026-10-20");
    expect(prices.get(ayam.id)).toMatchObject({ source: "purchase", basis: { qty: 5_000, value: 200_000 } });
    expect(prices.get(beras.id)).toMatchObject({ source: "estimate", basis: { qty: 1_000, value: 15_000 } });
    expect(prices.get(sayur.id)).toBeNull();
    expect(env.cateringService.materials(d, [line], "2026-10-20")).toEqual({ cost: 750_000, missing: [sayur.id] });

    const big = await env.cateringService.saveOrder(input({ eventDate: "2026-10-20", lines: [line, input().lines[1]] }));
    expect(big.lines[0].packageId).toBe(pkg.id);
    await env.cateringService.confirm(big);
    const small = await env.cateringService.saveOrder(input({ eventDate: "2026-10-21", pax: 15, lines: [lineFromPackage(pkg, 15, byCode("4-1000").id)] }));
    await env.cateringService.confirm(small);
    await env.cateringService.saveOrder(input({ eventDate: "2026-10-21", lines: [lineFromPackage(pkg, 999, byCode("4-1000").id)] })); // penawaran: tidak ikut
    const later = await env.cateringService.saveOrder(input({ eventDate: "2026-11-02", lines: [lineFromPackage(pkg, 50, byCode("4-1000").id)] }));
    await env.cateringService.confirm(later); // di luar rentang

    d = await data();
    const list = env.cateringService.shopping(d, "2026-10-20", "2026-10-21");
    expect(list.orders.map((o) => o.id)).toEqual([big.id, small.id]);
    expect(list.linesWithoutPackage).toBe(1);
    expect(list.rows.map((r) => [r.item.name, r.buyQuantity, r.cost, r.priceSource])).toEqual([
      ["Beras", 11_500, 172_500, "estimate"],
      ["Ayam", 17_250, 690_000, "purchase"],
      ["Sayur asem", 35, null, null],
    ]);
    expect(list.totalCost).toBe(862_500);
    expect(list.rows[2].perOrder.map((p) => [p.order.id, Number(p.quantity.n) / Number(p.quantity.d)])).toEqual([[big.id, 30], [small.id, 4.5]]);

    // Paket dipakai pesanan tidak bisa dihapus; bahan resep paket tidak bisa dihapus.
    await expectCode(env.cateringService.deletePackage(pkg.id), "ORDER_IN_USE");
    await expectCode(env.itemService.deleteItem(sayur.id), "ITEM_IN_USE");
    const off = await env.cateringService.setPackageActive(pkg.id, false);
    expect(off.isActive).toBe(false);
  });

  it("status invoice DP FIFO, urutan nomor per tahun, kalender per tanggal", () => {
    const flows = new Map([["o1", { received: 1_500_000, applied: 0, refunded: 0, forfeited: 0, balance: 1_500_000 }]]);
    const bill = (id: string, billDate: string, amount: number) => ({ id, workspaceId: "w", orderId: "o1", number: id, billDate, dueDate: "2026-10-10", amount, note: null, createdAt: billDate });
    const result = summarizeBills([bill("b2", "2026-10-05", 1_000_000), bill("b1", "2026-10-01", 1_000_000)], flows, "2026-10-12");
    expect(result.map((r) => [r.bill.id, r.paid, r.status])).toEqual([["b2", 500_000, "overdue"], ["b1", 1_000_000, "paid"]]);
    expect(nextNumberSeq(["QUO/2026/10/0007", "SPH/2026/11/0009", "QUO/2025/12/0020"], "2026-12-01")).toBe(10);
    const order = (id: string, eventDate: string, eventTime: string | null, state: CateringOrder["state"] = "confirmed") => ({ id, eventDate, eventTime, state }) as CateringOrder;
    const calendar = ordersByDate([order("a", "2026-10-20", "18:00"), order("b", "2026-10-20", "09:00"), order("c", "2026-10-21", null, "cancelled"), order("d", "2026-11-01", null)], "2026-10");
    expect([...calendar.keys()]).toEqual(["2026-10-20"]);
    expect(calendar.get("2026-10-20")!.map((o) => o.id)).toEqual(["b", "a"]);
  });
});
