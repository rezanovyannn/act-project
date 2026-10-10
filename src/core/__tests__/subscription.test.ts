/**
 * Katering langganan pascabayar (ADR 024, Fase 10D). Angka harapan dihitung manual:
 *
 * Langganan "Makan siang kantor" PT Sentosa mulai Selasa 15 Sep 2026, Sen–Jum, 50 porsi @ Rp 25.000, PBJT 10%.
 *   September: 12 hari kerja × 50 = 600; Kamis 17 Sep libur (0) → 550; Sabtu 19 Sep tambahan 30 → 580 porsi
 *   = Rp 14.500.000; PBJT 1.450.000 → faktur 15.950.000, tanggal 30 Sep, jatuh tempo +7 hari = 7 Okt.
 *   Oktober: 22 hari kerja × 50 = 1.100 porsi. Bila berakhir 15 Okt: 1–15 Okt = 11 hari kerja → 550 porsi.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { isoWeekday, monthDays, portionsOn, weekdaysLabel } from "@/core/subscription";
import type { Account, Contact, Subscription, SubscriptionInput } from "@/core/types";
import { createTestEnv } from "./helpers";

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

describe("katering langganan", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  let client: Contact;
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;
  const input = (overrides: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
    contactId: client.id,
    name: "Makan siang kantor",
    startDate: "2026-09-15",
    endDate: null,
    pricePerPortion: 25_000,
    revenueAccountId: byCode("4-1000").id,
    defaultPortions: 50,
    weekdays: [5, 1, 2, 3, 4, 1],
    applyTax: true,
    notes: null,
    ...overrides,
  });
  const data = () => env.cateringService.data(workspaceId);
  const get = async (id: string) => (await data()).subscriptions.find((s) => s.id === id)!;

  beforeEach(async () => {
    env = createTestEnv();
    const workspace = await env.workspaceService.createWorkspace({ ownerId: "owner-a", name: "Katering Langganan", templateType: "catering", booksStartDate: "2026-01-01" });
    workspaceId = workspace.id;
    await env.repos.workspaces.updateSalesTaxSettings(workspaceId, { mode: "simple", label: "PBJT", rateBps: 1000, inclusive: false, dppNumerator: 1, dppDenominator: 1 });
    accounts = await env.repos.accounts.listByWorkspace(workspaceId);
    client = await env.invoiceService.createContact(workspaceId, { name: "PT Sentosa", isCustomer: true, isSupplier: false, address: null, phone: null, email: null, npwp: null, paymentTermDays: 7, notes: null });
  });

  it("porsi harian: hari kirim × default, ubahan per tanggal, masa kontrak", async () => {
    let sub = await env.cateringService.saveSubscription(workspaceId, input());
    expect(sub.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(isoWeekday("2026-09-15")).toBe(2);
    expect(portionsOn(sub, "2026-09-14")).toBe(0); // sebelum mulai
    expect(portionsOn(sub, "2026-09-19")).toBe(0); // Sabtu
    expect(monthDays(sub, "2026-09").total).toBe(600);
    sub = await env.cateringService.setSubscriptionDays(sub, { "2026-09-17": 0, "2026-09-19": 30 }, "2026-09-20");
    expect(sub.dayOverrides).toEqual({ "2026-09-17": 0, "2026-09-19": 30 });
    const sept = monthDays(sub, "2026-09");
    expect(sept.total).toBe(580);
    expect(sept.days.find((d) => d.date === "2026-09-19")).toMatchObject({ portions: 30, changed: true, active: true });
    expect(monthDays(sub, "2026-10").total).toBe(1_100);
    // Kembali ke default.
    sub = await env.cateringService.setSubscriptionDays(sub, { "2026-09-19": null }, "2026-09-20");
    expect(monthDays(sub, "2026-09").total).toBe(550);
    await expectCode(env.cateringService.setSubscriptionDays(sub, { "2026-09-01": 10 }, "2026-09-20"), "INVALID_DATE");
    await expectCode(env.cateringService.setSubscriptionDays(sub, { "2026-09-18": -1 }, "2026-09-20"), "INVALID_QUANTITY");
    // Berakhir 15 Okt.
    sub = await env.cateringService.saveSubscription(workspaceId, input({ endDate: "2026-10-15" }), sub.id);
    expect(monthDays(sub, "2026-10").total).toBe(550);
    expect(weekdaysLabel([1, 2, 3, 4, 5])).toBe("Sen–Jum");
    expect(weekdaysLabel([1, 3, 5])).toBe("Sen, Rab, Jum");
  });

  it("validasi: klien pelanggan, harga > 0, hari kirim, tanggal, akun pendapatan", async () => {
    await expectCode(env.cateringService.saveSubscription(workspaceId, input({ pricePerPortion: 0 })), "INVALID_AMOUNT");
    await expectCode(env.cateringService.saveSubscription(workspaceId, input({ weekdays: [] })), "INVALID_ORDER");
    await expectCode(env.cateringService.saveSubscription(workspaceId, input({ endDate: "2026-09-01" })), "INVALID_DATE");
    await expectCode(env.cateringService.saveSubscription(workspaceId, input({ revenueAccountId: byCode("1-1100").id })), "INVALID_ACCOUNT");
    await expectCode(env.cateringService.saveSubscription(workspaceId, input({ name: " " })), "EMPTY_NAME");
  });

  it("tagihan: muncul setelah bulan berakhir, 1 klik draft faktur, bulan terkunci, batal → bisa ditagih ulang", async () => {
    const created = await env.cateringService.saveSubscription(workspaceId, input());
    let sub = await env.cateringService.setSubscriptionDays(created, { "2026-09-17": 0, "2026-09-19": 30 }, "2026-09-20");
    let d = await data();
    expect(env.cateringService.dueBillings(d, "2026-09-30")).toEqual([]); // September belum berakhir
    const due = env.cateringService.dueBillings(d, "2026-10-10");
    expect(due.map((b) => [b.month, b.portions, b.amount])).toEqual([["2026-09", 580, 14_500_000]]);

    const invoice = await env.cateringService.createSubscriptionInvoice(sub, "2026-09", "2026-10-10");
    expect(invoice).toMatchObject({
      status: "draft", kind: "sale", contactId: client.id, invoiceDate: "2026-09-30", dueDate: "2026-10-07", reference: "Langganan 2026-09", applyTax: true,
      lines: [{ description: "Makan siang kantor · September 2026", quantity: 580, unit: "porsi", unitPrice: 25_000, accountId: byCode("4-1000").id }],
    });
    sub = await get(sub.id);
    expect(sub.billedMonths).toEqual({ "2026-09": invoice.id });
    d = await data();
    expect(env.cateringService.dueBillings(d, "2026-10-10")).toEqual([]);
    expect(env.cateringService.billing(d, sub, "2026-09", "2026-10-10").state).toBe("draft");
    await expectCode(env.cateringService.createSubscriptionInvoice(sub, "2026-09", "2026-10-10"), "INVALID_INVOICE");
    await expectCode(env.cateringService.setSubscriptionDays(sub, { "2026-09-18": 10 }, "2026-10-10"), "INVALID_INVOICE");
    await env.cateringService.setSubscriptionDays(sub, { "2026-10-02": 60 }, "2026-10-10"); // bulan lain tetap bisa

    // Terbitkan: piutang 14.500.000 + PBJT 1.450.000.
    const issued = await env.invoiceService.issue(invoice, invoice.id);
    d = await data();
    const summary = env.invoiceService.summaries({ ...d, items: d.items, profile: d.profile }, "2026-10-10").find((s) => s.invoice.id === issued.id)!;
    expect(summary.total).toBe(15_950_000);
    expect(env.cateringService.billing(d, sub, "2026-09", "2026-10-10").state).toBe("issued");

    // Batalkan faktur → September bisa ditagih ulang.
    await env.invoiceService.cancel(issued, "2026-10-11", "Salah porsi");
    d = await data();
    expect(env.cateringService.billing(d, sub, "2026-09", "2026-10-11").state).toBe("none");
    expect(env.cateringService.dueBillings(d, "2026-10-11").map((b) => b.month)).toEqual(["2026-09"]);
    sub = await env.cateringService.setSubscriptionDays(sub, { "2026-09-18": 40 }, "2026-10-11");
    const again = await env.cateringService.createSubscriptionInvoice(sub, "2026-09", "2026-10-11");
    expect(again.lines[0].quantity).toBe(570);

    // Draft dihapus → bisa ditagih ulang; November: Oktober jatuh tagih (1.100 + 10 tambahan 2 Okt).
    await env.invoiceService.deleteDraft(again.id);
    d = await data();
    expect(env.cateringService.dueBillings(d, "2026-11-02").map((b) => [b.month, b.portions])).toEqual([["2026-09", 570], ["2026-10", 1_110]]);
    // Langganan yang pernah ditagih tidak bisa dihapus.
    await expectCode(env.cateringService.deleteSubscription(sub.id), "ORDER_IN_USE");
    await expectCode(env.invoiceService.deleteContact(client.id), "CONTACT_IN_USE");
  });

  it("langganan tanpa tagihan bisa dihapus", async () => {
    const sub: Subscription = await env.cateringService.saveSubscription(workspaceId, input({ name: "Uji" }));
    await env.cateringService.deleteSubscription(sub.id);
    expect((await data()).subscriptions).toEqual([]);
  });
});
