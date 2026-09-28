import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { activeOpeningBalance, buildOpeningBalance } from "@/core/opening-balance";
import { buildFnbMockState } from "@/mocks/fnb/dataset";
import { createFnbWorkspace, createTestEnv, entry, line } from "./helpers";

async function expectCode(promise: Promise<unknown> | (() => unknown), code: ValidationCode) {
  const run = typeof promise === "function" ? Promise.resolve().then(promise) : promise;
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).hasCode(code)).toBe(true);
}

let env: ReturnType<typeof createTestEnv>;
let ws: Awaited<ReturnType<typeof createFnbWorkspace>>;
let id: (code: string) => string;

beforeEach(async () => {
  env = createTestEnv();
  ws = await createFnbWorkspace(env);
  id = (code) => ws.byCode(code).id;
});

const newAccount = {
  code: "6-6000",
  name: "Beban Kebersihan",
  accountType: "expense" as const,
  cashFlowCategory: "operating" as const,
  isCash: false,
};

describe("AccountService (Chart of Accounts)", () => {
  it("menambah akun dengan saldo normal default dan menolak kode duplikat", async () => {
    const account = await env.accountService.createAccount(ws.workspace.id, newAccount);
    expect(account).toMatchObject({ normalBalance: "debit", isActive: true, systemRole: null });
    await expectCode(env.accountService.createAccount(ws.workspace.id, newAccount), "DUPLICATE_ACCOUNT_CODE");
    await expectCode(env.accountService.createAccount(ws.workspace.id, { ...newAccount, code: " " }), "EMPTY_NAME");
  });

  it("akun kas harus aset dan kategorinya otomatis none", async () => {
    await expectCode(
      env.accountService.createAccount(ws.workspace.id, { ...newAccount, isCash: true }),
      "INVALID_ACCOUNT",
    );
    const petty = await env.accountService.createAccount(ws.workspace.id, {
      code: "1-1110",
      name: "Kas Kecil",
      accountType: "asset",
      cashFlowCategory: "operating",
      isCash: true,
    });
    expect(petty.cashFlowCategory).toBe("none");
  });

  it("akun tanpa jurnal bebas diubah dan dihapus", async () => {
    const account = await env.accountService.createAccount(ws.workspace.id, newAccount);
    const updated = await env.accountService.updateAccount(account.id, {
      ...newAccount,
      name: "Beban Kebersihan & Sanitasi",
      accountType: "cogs",
    });
    expect(updated).toMatchObject({ accountType: "cogs", normalBalance: "debit" });
    await env.accountService.deleteAccount(account.id);
    expect(await env.repos.accounts.getById(account.id)).toBeNull();
  });

  it("akun ber-jurnal: tidak bisa dihapus, jenis tidak bisa diubah; nama & kategori boleh; bisa nonaktif", async () => {
    const account = await env.accountService.createAccount(ws.workspace.id, newAccount);
    await env.journalService.postJournal(
      entry(ws.workspace.id, [line(account.id, 1000, 0), line(id("1-1100"), 0, 1000)]),
    );
    await expectCode(env.accountService.deleteAccount(account.id), "ACCOUNT_INACTIVE");
    await expectCode(
      env.accountService.updateAccount(account.id, { ...newAccount, accountType: "asset" }),
      "ACCOUNT_IN_USE",
    );
    await expect(
      env.accountService.updateAccount(account.id, { ...newAccount, name: "Kebersihan", cashFlowCategory: "investing" }),
    ).resolves.toMatchObject({ name: "Kebersihan", cashFlowCategory: "investing" });

    const inactive = await env.accountService.setActive(account.id, false);
    expect(inactive.isActive).toBe(false);
    await expect(env.accountService.setActive(account.id, true)).resolves.toMatchObject({ isActive: true });
  });

  it("akun sistem tidak bisa dihapus, dinonaktifkan, atau diubah jenisnya", async () => {
    const prive = ws.byCode("3-2000");
    await expectCode(env.accountService.deleteAccount(prive.id), "SYSTEM_ACCOUNT");
    await expectCode(env.accountService.setActive(prive.id, false), "SYSTEM_ACCOUNT");
    await expectCode(
      env.accountService.updateAccount(prive.id, {
        code: prive.code,
        name: prive.name,
        accountType: "expense",
        cashFlowCategory: prive.cashFlowCategory,
        isCash: false,
      }),
      "SYSTEM_ACCOUNT",
    );
    // Nama akun sistem boleh diubah.
    await expect(
      env.accountService.updateAccount(prive.id, {
        code: prive.code,
        name: "Pengambilan Pribadi",
        accountType: prive.accountType,
        normalBalance: prive.normalBalance,
        cashFlowCategory: prive.cashFlowCategory,
        isCash: false,
      }),
    ).resolves.toMatchObject({ name: "Pengambilan Pribadi", systemRole: "drawings" });
  });

  it("perubahan akun tercatat di audit log", async () => {
    const account = await env.accountService.createAccount(ws.workspace.id, newAccount);
    await env.accountService.setActive(account.id, false);
    const logs = await env.repos.auditLogs.listByWorkspace(ws.workspace.id, { entityId: account.id });
    expect(logs.map((l) => l.action)).toEqual(["update", "create"]);
    expect(logs[0]).toMatchObject({ actorId: "owner-a", before: { isActive: true }, after: { isActive: false } });
  });
});

describe("PeriodService", () => {
  const march = async () => (await env.repos.periods.listByWorkspace(ws.workspace.id))[2];

  it("periode dikunci menolak posting; dibuka kembali dengan alasan menerima lagi", async () => {
    const period = await march();
    await env.periodService.closePeriod(ws.workspace.id, period.id);
    const sale = entry(ws.workspace.id, [line(id("1-1100"), 1000, 0), line(id("4-1000"), 0, 1000)]);
    await expectCode(env.journalService.postJournal(sale), "PERIOD_CLOSED");
    await expectCode(env.periodService.closePeriod(ws.workspace.id, period.id), "PERIOD_CLOSED");

    await expectCode(env.periodService.reopenPeriod(ws.workspace.id, period.id, "  "), "EMPTY_REASON");
    await env.periodService.reopenPeriod(ws.workspace.id, period.id, "Koreksi nota pembelian terlambat");
    await expect(env.journalService.postJournal(sale)).resolves.toMatchObject({ status: "posted" });
  });

  it("buka kembali tercatat di audit log beserta alasan dan pelaku", async () => {
    const period = await march();
    await env.periodService.closePeriod(ws.workspace.id, period.id);
    await env.periodService.reopenPeriod(ws.workspace.id, period.id, "Salah kunci");
    const logs = await env.repos.auditLogs.listByWorkspace(ws.workspace.id, { entityType: "period", entityId: period.id });
    expect(logs.map((l) => [l.action, l.reason, l.actorId])).toEqual([
      ["reopen", "Salah kunci", "owner-a"],
      ["close", null, "owner-a"],
      ["create", null, "owner-a"],
    ]);
    await expectCode(env.periodService.reopenPeriod(ws.workspace.id, period.id, "sudah terbuka"), "INVALID_DATE");
  });

  it("menambah 12 periode tahun buku berikutnya", async () => {
    const created = await env.periodService.addNextFiscalYear(ws.workspace.id);
    expect(created).toHaveLength(12);
    expect([created[0].startDate, created[11].endDate]).toEqual(["2027-01-01", "2027-12-31"]);
    const again = await env.periodService.addNextFiscalYear(ws.workspace.id);
    expect(again[0].startDate).toBe("2028-01-01");
  });
});

describe("saldo awal", () => {
  const items = () => [
    { accountId: id("1-1100"), amount: 5_000_000 },
    { accountId: id("1-1200"), amount: 20_000_000 },
    { accountId: id("1-1300"), amount: 3_000_000 },
    { accountId: id("1-2100"), amount: 12_000_000 },
  ];

  it("selisih ke Ekuitas Saldo Awal: sama dengan jurnal saldo awal dataset (40 jt)", () => {
    const result = buildOpeningBalance({ workspaceId: ws.workspace.id, entryDate: "2026-01-01", items: items() }, ws.accounts);
    expect(result).toMatchObject({ totalDebit: 40_000_000, totalCredit: 0, equityDifference: 40_000_000 });
    expect(result.entry.lines.at(-1)).toMatchObject({ accountId: id("3-9000"), debit: 0, credit: 40_000_000 });

    const dataset = buildFnbMockState().journals.find((e) => e.id === "je-opening")!;
    expect(dataset.lines.map((l) => [l.debit, l.credit])).toEqual(result.entry.lines.map((l) => [l.debit, l.credit]));
  });

  it("akun bersaldo normal kredit (utang, akumulasi penyusutan) masuk kolom kredit", () => {
    const result = buildOpeningBalance(
      {
        workspaceId: ws.workspace.id,
        entryDate: "2026-01-01",
        items: [
          { accountId: id("1-2100"), amount: 12_000_000 },
          { accountId: id("1-2190"), amount: 2_000_000 },
          { accountId: id("2-2100"), amount: 15_000_000 },
          { accountId: id("1-1100"), amount: 0 },
        ],
      },
      ws.accounts,
    );
    // Debit 12 jt, kredit 17 jt → Ekuitas Saldo Awal di debit 5 jt.
    expect(result.entry.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [id("1-2100"), 12_000_000, 0],
      [id("1-2190"), 0, 2_000_000],
      [id("2-2100"), 0, 15_000_000],
      [id("3-9000"), 5_000_000, 0],
    ]);
  });

  it("menolak akun laba rugi, akun Ekuitas Saldo Awal, nominal tidak valid, dan isian kosong", async () => {
    const build = (list: { accountId: string; amount: number }[]) => () =>
      buildOpeningBalance({ workspaceId: ws.workspace.id, entryDate: "2026-01-01", items: list }, ws.accounts);
    await expectCode(build([{ accountId: id("4-1000"), amount: 1 }]), "INVALID_ACCOUNT");
    await expectCode(build([{ accountId: id("3-9000"), amount: 1 }]), "INVALID_ACCOUNT");
    await expectCode(build([{ accountId: id("1-1100"), amount: -5 }]), "INVALID_AMOUNT");
    await expectCode(build([{ accountId: id("1-1100"), amount: 0 }]), "LINE_ZERO");
  });

  it("hanya satu saldo awal aktif; setelah di-void boleh dibuat ulang", async () => {
    const opening = buildOpeningBalance({ workspaceId: ws.workspace.id, entryDate: "2026-01-01", items: items() }, ws.accounts);
    const posted = await env.journalService.postJournal(opening.entry);
    expect(posted.source).toBe("opening_balance");
    await expectCode(env.journalService.postJournal(opening.entry), "DUPLICATE_OPENING_BALANCE");
    // Lapisan repository juga menolak.
    await expectCode(env.repos.journals.postJournal(opening.entry), "DUPLICATE_OPENING_BALANCE");

    await env.journalService.voidJournal(posted.id, "2026-01-02");
    expect(activeOpeningBalance(await env.repos.journals.listByWorkspace(ws.workspace.id))).toBeNull();
    await expect(env.journalService.postJournal({ ...opening.entry, entryDate: "2026-01-02" })).resolves.toMatchObject({
      source: "opening_balance",
    });
  });
});
