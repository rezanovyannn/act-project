import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { accountTotals, normalBalance } from "@/core/ledger";
import { monthlyPeriodsForYear } from "@/core/periods";
import { reversedEntryIds } from "@/core/reversal";
import { outstandingAmount } from "@/core/settlement";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { createFnbWorkspace, createTestEnv, entry, line } from "./helpers";

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).hasCode(code)).toBe(true);
}

describe("WorkspaceService", () => {
  it("menyemai CoA template dan periode bulanan open sampai Desember", async () => {
    const env = createTestEnv();
    const workspace = await env.workspaceService.createWorkspace({
      ownerId: "owner-a",
      name: "  Kedai Baru  ",
      templateType: "fnb",
      booksStartDate: "2026-04-15",
    });
    expect(workspace).toMatchObject({ name: "Kedai Baru", currency: "IDR", templateType: "fnb" });

    const accounts = await env.repos.accounts.listByWorkspace(workspace.id);
    expect(accounts).toHaveLength(FNB_TEMPLATE.accounts.length);
    expect(accounts.every((a) => a.isActive && a.workspaceId === workspace.id)).toBe(true);

    const periods = await env.repos.periods.listByWorkspace(workspace.id);
    expect(periods.map((p) => p.startDate)).toEqual(
      ["04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => `2026-${m}-01`),
    );
    expect(periods.every((p) => p.status === "open")).toBe(true);
  });

  it("menolak nama kosong dan tanggal mulai tidak valid", async () => {
    const env = createTestEnv();
    const base = { ownerId: "o", templateType: "fnb" as const };
    await expectCode(
      env.workspaceService.createWorkspace({ ...base, name: " ", booksStartDate: "2026-01-01" }),
      "EMPTY_NAME",
    );
    await expectCode(
      env.workspaceService.createWorkspace({ ...base, name: "X", booksStartDate: "2026-02-30" }),
      "INVALID_DATE",
    );
  });
});

describe("JournalService", () => {
  let env: ReturnType<typeof createTestEnv>;
  let ws: Awaited<ReturnType<typeof createFnbWorkspace>>;
  let kas: string;
  let jual: string;
  let beban: string;

  beforeEach(async () => {
    env = createTestEnv();
    ws = await createFnbWorkspace(env);
    kas = ws.byCode("1-1100").id;
    jual = ws.byCode("4-1000").id;
    beban = ws.byCode("6-9000").id;
  });

  const sale = (amount: number, date = "2026-03-10") =>
    entry(ws.workspace.id, [line(kas, amount, 0), line(jual, 0, amount)], {
      entryDate: date,
      source: "revenue",
      description: "Penjualan",
    });

  describe("draft", () => {
    it("boleh disimpan belum seimbang, diedit, lalu dihapus", async () => {
      const draft = await env.journalService.saveDraft(
        entry(ws.workspace.id, [line(kas, 1000, 0)]),
      );
      expect(draft).toMatchObject({ status: "draft", entryNumber: null });

      const edited = await env.journalService.saveDraft(sale(2000), draft.id);
      expect(edited.id).toBe(draft.id);
      expect(edited.lines).toHaveLength(2);

      await env.journalService.deleteDraft(draft.id);
      expect(await env.repos.journals.getById(draft.id)).toBeNull();
    });

    it("boleh bertanggal di periode tanpa status open; validasi saat posting", async () => {
      const draft = await env.journalService.saveDraft(sale(1000, "2030-01-01"));
      await expectCode(env.journalService.postDraft(draft.id), "PERIOD_NOT_FOUND");
      const stillDraft = await env.repos.journals.getById(draft.id);
      expect(stillDraft?.status).toBe("draft");
    });

    it("menolak nominal pecahan", async () => {
      await expectCode(
        env.journalService.saveDraft(entry(ws.workspace.id, [line(kas, 10.5, 0)])),
        "INVALID_AMOUNT",
      );
    });
  });

  describe("posting", () => {
    it("memposting draft dan memberi nomor urut per tahun buku", async () => {
      const draft = await env.journalService.saveDraft(sale(10_000));
      const posted = await env.journalService.postDraft(draft.id);
      expect(posted).toMatchObject({ id: draft.id, status: "posted", entryNumber: "JU-2026-0001" });
      expect(posted.postedAt).not.toBeNull();

      const second = await env.journalService.postJournal(sale(5_000, "2026-03-11"));
      expect(second.entryNumber).toBe("JU-2026-0002");

      await env.repos.periods.createMany(ws.workspace.id, monthlyPeriodsForYear(2027));
      const nextYear = await env.journalService.postJournal(sale(5_000, "2027-01-02"));
      expect(nextYear.entryNumber).toBe("JU-2027-0001");
    });

    it("menolak jurnal tidak seimbang dan tidak menyimpan apa pun", async () => {
      await expectCode(
        env.journalService.postJournal(
          entry(ws.workspace.id, [line(kas, 1000, 0), line(jual, 0, 900)]),
        ),
        "UNBALANCED",
      );
      expect(await env.repos.journals.listByWorkspace(ws.workspace.id)).toEqual([]);
    });

    it("menolak posting ke periode closed", async () => {
      const periods = await env.repos.periods.listByWorkspace(ws.workspace.id);
      await env.repos.periods.setStatus(periods[2].id, "closed"); // Maret 2026
      await expectCode(env.journalService.postJournal(sale(1000)), "PERIOD_CLOSED");
    });

    it("menolak akun nonaktif", async () => {
      await env.repos.accounts.update(jual, { isActive: false });
      await expectCode(env.journalService.postJournal(sale(1000)), "ACCOUNT_INACTIVE");
    });

    it("menolak membuat jurnal pembalik secara langsung", async () => {
      await expectCode(
        env.journalService.postJournal({ ...sale(1000), source: "reversal" }),
        "INVALID_REVERSAL",
      );
    });

    it("jurnal posted tidak dapat diedit maupun dihapus", async () => {
      const posted = await env.journalService.postJournal(sale(1000));
      await expectCode(env.journalService.saveDraft(sale(2000), posted.id), "NOT_DRAFT");
      await expectCode(env.journalService.deleteDraft(posted.id), "NOT_DRAFT");
      await expectCode(env.journalService.postDraft(posted.id), "NOT_DRAFT");
    });
  });

  describe("void", () => {
    it("membuat jurnal pembalik dengan debit/kredit ditukar dan menihilkan saldo", async () => {
      const original = await env.journalService.postJournal(sale(75_000));
      const reversal = await env.journalService.voidJournal(original.id, "2026-04-02");

      expect(reversal).toMatchObject({
        status: "posted",
        source: "reversal",
        reversalOf: original.id,
        entryDate: "2026-04-02",
        entryNumber: "JU-2026-0002",
      });
      expect(reversal.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
        [kas, 0, 75_000],
        [jual, 75_000, 0],
      ]);

      const all = await env.repos.journals.listByWorkspace(ws.workspace.id);
      expect(reversedEntryIds(all)).toEqual(new Set([original.id]));
      const totals = accountTotals(all);
      expect(normalBalance(ws.byCode("1-1100"), totals.get(kas))).toBe(0);
      expect(normalBalance(ws.byCode("4-1000"), totals.get(jual))).toBe(0);
      // Jurnal asal tetap utuh (immutable).
      expect(await env.repos.journals.getById(original.id)).toEqual(original);
    });

    it("tetap bisa membalik jurnal yang akunnya sudah nonaktif", async () => {
      const original = await env.journalService.postJournal(sale(1000));
      await env.repos.accounts.update(jual, { isActive: false });
      await expect(env.journalService.voidJournal(original.id, "2026-03-12")).resolves.toMatchObject({
        source: "reversal",
      });
    });

    it("menolak void kedua, void atas jurnal pembalik, dan draft", async () => {
      const original = await env.journalService.postJournal(sale(1000));
      const reversal = await env.journalService.voidJournal(original.id, "2026-03-12");
      await expectCode(env.journalService.voidJournal(original.id, "2026-03-13"), "ALREADY_REVERSED");
      await expectCode(env.journalService.voidJournal(reversal.id, "2026-03-13"), "INVALID_REVERSAL");

      const draft = await env.journalService.saveDraft(sale(500));
      await expectCode(env.journalService.voidJournal(draft.id, "2026-03-13"), "NOT_POSTED");
    });

    it("menolak tanggal pembalik sebelum tanggal asal atau di periode closed", async () => {
      const original = await env.journalService.postJournal(sale(1000, "2026-03-10"));
      await expectCode(env.journalService.voidJournal(original.id, "2026-03-09"), "INVALID_REVERSAL");

      const periods = await env.repos.periods.listByWorkspace(ws.workspace.id);
      await env.repos.periods.setStatus(periods[3].id, "closed"); // April 2026
      await expectCode(env.journalService.voidJournal(original.id, "2026-04-05"), "PERIOD_CLOSED");
    });

    it("jurnal di periode yang sudah dikunci dibalik dengan tanggal di periode open", async () => {
      const original = await env.journalService.postJournal(sale(1000, "2026-03-10"));
      const periods = await env.repos.periods.listByWorkspace(ws.workspace.id);
      await env.repos.periods.setStatus(periods[2].id, "closed"); // Maret 2026
      const reversal = await env.journalService.voidJournal(original.id, "2026-04-01");
      expect(reversal.entryDate).toBe("2026-04-01");
    });
  });

  describe("koreksi", () => {
    it("membuat jurnal pembalik dan draft salinan yang tertaut ke jurnal asal", async () => {
      const original = await env.journalService.postJournal(
        entry(ws.workspace.id, [line(beban, 800_000, 0), line(kas, 0, 800_000)], {
          description: "Servis mesin",
          source: "expense",
        }),
      );
      const { reversal, draft } = await env.journalService.correctJournal(original.id, "2026-03-15");

      expect(reversal).toMatchObject({ source: "reversal", reversalOf: original.id });
      expect(reversal.description).toContain("koreksi");
      expect(draft).toMatchObject({
        status: "draft",
        entryNumber: null,
        correctionOf: original.id,
        reversalOf: null,
        source: "expense",
        entryDate: "2026-03-15",
        description: "Servis mesin",
      });

      const fixed = await env.journalService.saveDraft(
        {
          ...entry(ws.workspace.id, [line(beban, 700_000, 0), line(kas, 0, 700_000)]),
          entryDate: "2026-03-15",
          description: "Servis mesin",
          source: "expense",
          correctionOf: original.id,
        },
        draft.id,
      );
      const posted = await env.journalService.postDraft(fixed.id);
      expect(posted).toMatchObject({ status: "posted", correctionOf: original.id });

      const totals = accountTotals(await env.repos.journals.listByWorkspace(ws.workspace.id));
      expect(normalBalance(ws.byCode("6-9000"), totals.get(beban))).toBe(700_000);
    });
  });
});

describe("JournalService: transaksi kredit & pelunasan (ADR 012)", () => {
  let env: ReturnType<typeof createTestEnv>;
  let ws: Awaited<ReturnType<typeof createFnbWorkspace>>;
  let id: (code: string) => string;

  beforeEach(async () => {
    env = createTestEnv();
    ws = await createFnbWorkspace(env);
    id = (code) => ws.byCode(code).id;
  });

  const creditSale = () =>
    env.journalService.postJournal(
      entry(
        ws.workspace.id,
        [line(id("1-1400"), 5_500_000, 0), line(id("4-1000"), 0, 5_000_000), line(id("2-1200"), 0, 500_000)],
        { source: "revenue", counterparty: "PT Maju", description: "Katering kredit" },
      ),
    );

  const receipt = (targetId: string, amount: number, date = "2026-03-20") =>
    env.journalService.postJournal(
      entry(ws.workspace.id, [line(id("1-1200"), amount, 0), line(id("1-1400"), 0, amount)], {
        source: "settlement",
        settlementOf: targetId,
        counterparty: "PT Maju",
        entryDate: date,
        description: "Pelunasan",
      }),
    );

  const outstanding = async (targetId: string) => {
    const target = (await env.repos.journals.getById(targetId))!;
    const settlements = await env.repos.journals.listActiveSettlementsOf(targetId);
    return outstandingAmount(target, settlements, new Map(ws.accounts.map((a) => [a.id, a])));
  };

  it("pelunasan sebagian lalu penuh mengurangi sisa tagihan sampai nol", async () => {
    const sale = await creditSale();
    expect(sale.counterparty).toBe("PT Maju");
    expect(await outstanding(sale.id)).toBe(5_500_000);

    const first = await receipt(sale.id, 3_000_000);
    expect(first).toMatchObject({ source: "settlement", settlementOf: sale.id });
    expect(await outstanding(sale.id)).toBe(2_500_000);

    await receipt(sale.id, 2_500_000, "2026-04-20");
    expect(await outstanding(sale.id)).toBe(0);
  });

  it("menolak pelunasan melebihi sisa tagihan", async () => {
    const sale = await creditSale();
    await receipt(sale.id, 5_000_000);
    await expectCode(receipt(sale.id, 600_000), "INVALID_SETTLEMENT");
  });

  it("menolak pelunasan atas transaksi tunai, target tidak ada, atau yang sudah di-void", async () => {
    const cashSale = await env.journalService.postJournal(
      entry(ws.workspace.id, [line(id("1-1100"), 1000, 0), line(id("4-1000"), 0, 1000)]),
    );
    await expectCode(receipt(cashSale.id, 1000), "INVALID_SETTLEMENT");
    await expectCode(receipt("tidak-ada", 1000), "INVALID_SETTLEMENT");

    const sale = await creditSale();
    await env.journalService.voidJournal(sale.id, "2026-03-15");
    await expectCode(receipt(sale.id, 1000), "INVALID_SETTLEMENT");
  });

  it("menolak jurnal settlement tanpa target dan jurnal yang tidak mengurangi piutang", async () => {
    const sale = await creditSale();
    await expectCode(
      env.journalService.postJournal(
        entry(ws.workspace.id, [line(id("1-1200"), 1000, 0), line(id("1-1400"), 0, 1000)], {
          source: "settlement",
        }),
      ),
      "INVALID_SETTLEMENT",
    );
    await expectCode(
      env.journalService.postJournal(
        entry(ws.workspace.id, [line(id("1-1200"), 1000, 0), line(id("4-1000"), 0, 1000)], {
          source: "settlement",
          settlementOf: sale.id,
        }),
      ),
      "INVALID_SETTLEMENT",
    );
  });

  it("transaksi kredit dengan pelunasan aktif tidak bisa di-void sampai pelunasannya di-void", async () => {
    const sale = await creditSale();
    const paid = await receipt(sale.id, 1_000_000);
    await expectCode(env.journalService.voidJournal(sale.id, "2026-03-25"), "HAS_SETTLEMENTS");
    await expectCode(env.journalService.correctJournal(sale.id, "2026-03-25"), "HAS_SETTLEMENTS");

    await env.journalService.voidJournal(paid.id, "2026-03-25");
    expect(await outstanding(sale.id)).toBe(5_500_000);
    await expect(env.journalService.voidJournal(sale.id, "2026-03-26")).resolves.toMatchObject({
      reversalOf: sale.id,
    });
  });

  it("utang pemasok: pembayaran sebagian dan batas sisa utang", async () => {
    const purchase = await env.journalService.postJournal(
      entry(ws.workspace.id, [line(id("1-1300"), 2_000_000, 0), line(id("2-1100"), 0, 2_000_000)], {
        source: "purchase",
        counterparty: "CV Sumber Pangan",
      }),
    );
    const pay = (amount: number) =>
      env.journalService.postJournal(
        entry(ws.workspace.id, [line(id("2-1100"), amount, 0), line(id("1-1200"), 0, amount)], {
          source: "settlement",
          settlementOf: purchase.id,
          entryDate: "2026-03-30",
        }),
      );
    await pay(1_200_000);
    expect(await outstanding(purchase.id)).toBe(800_000);
    await expectCode(pay(900_000), "INVALID_SETTLEMENT");
  });
});
