/**
 * Contract test + RLS terhadap proyek Supabase dev (ADR 013).
 * Akun uji didaftarkan lewat Anon Key (konfirmasi email dimatikan di proyek dev);
 * service role key tidak dipakai.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { AccountingError } from "@/core/errors";
import { monthlyPeriodsForYear } from "@/core/periods";
import type { JournalEntryInput, Workspace } from "@/core/types";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { createSupabaseRepositories } from "@/repositories/supabase/repositories";
import { describeRepositoryContract, type ContractActor } from "./repository-contract";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function newClient(): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

interface TestUser extends ContractActor {
  client: SupabaseClient;
}

async function signUpTestUser(label: string): Promise<TestUser> {
  const client = newClient();
  const email = `uji-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password: `Uji-${crypto.randomUUID()}` });
  if (error) throw new Error(`Gagal mendaftarkan akun uji: ${error.message}`);
  if (!data.session || !data.user) {
    throw new Error("Tidak ada sesi setelah daftar: pastikan 'Confirm email' dimatikan di proyek dev");
  }
  return { client, ownerId: data.user.id, repos: createSupabaseRepositories(client) };
}

let userA: TestUser;
let userB: TestUser;

beforeAll(async () => {
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL/ANON_KEY belum diisi di .env.local");
  userA = await signUpTestUser("a");
  userB = await signUpTestUser("b");
});

describeRepositoryContract("supabase (proyek dev)", () => ({
  owner: userA,
  other: userB,
}));

describe("RLS: user B tidak dapat membaca atau menulis data user A", () => {
  let workspaceA: Workspace;
  let postedA: string;
  let kasA: string;
  let jualA: string;

  const sale = (workspaceId: string, amount: number): JournalEntryInput => ({
    workspaceId,
    entryDate: "2026-03-10",
    description: "Penjualan",
    source: "revenue",
    lines: [
      { accountId: kasA, debit: amount, credit: 0 },
      { accountId: jualA, debit: 0, credit: amount },
    ],
  });

  beforeAll(async () => {
    workspaceA = await userA.repos.workspaces.createWithSeed(
      { ownerId: userA.ownerId, name: "Rahasia A", templateType: "fnb", booksStartDate: "2026-01-01", salesTax: FNB_TEMPLATE.salesTaxDefaults },
      FNB_TEMPLATE.accounts,
      monthlyPeriodsForYear(2026),
    );
    const accounts = await userA.repos.accounts.listByWorkspace(workspaceA.id);
    kasA = accounts.find((a) => a.code === "1-1100")!.id;
    jualA = accounts.find((a) => a.code === "4-1000")!.id;
    postedA = (await userA.repos.journals.postJournal(sale(workspaceA.id, 1000))).id;
  });

  it("tidak dapat membaca workspace, akun, periode, jurnal, maupun audit log milik A", async () => {
    const b = userB.repos;
    expect(await b.workspaces.getById(workspaceA.id)).toBeNull();
    expect((await b.workspaces.listByOwner(userA.ownerId)).map((w) => w.id)).not.toContain(workspaceA.id);
    expect(await b.accounts.listByWorkspace(workspaceA.id)).toEqual([]);
    expect(await b.accounts.getById(kasA)).toBeNull();
    expect(await b.periods.listByWorkspace(workspaceA.id)).toEqual([]);
    expect(await b.journals.listByWorkspace(workspaceA.id)).toEqual([]);
    expect(await b.journals.getById(postedA)).toBeNull();
    expect(await b.auditLogs.listByWorkspace(workspaceA.id)).toEqual([]);
    // Pembanding: A sendiri dapat membacanya.
    expect(await userA.repos.journals.getById(postedA)).not.toBeNull();
  });

  it("tidak dapat menulis ke workspace A lewat RPC mana pun", async () => {
    const b = userB.repos;
    const periodsA = await userA.repos.periods.listByWorkspace(workspaceA.id);
    // Dijalankan bergiliran (thunk) agar setiap penolakan langsung ditangani.
    const attempts: [string, () => Promise<unknown>][] = [
      ["postJournal", () => b.journals.postJournal(sale(workspaceA.id, 1000))],
      ["saveDraft", () => b.journals.saveDraft(sale(workspaceA.id, 1000))],
      ["akun baru", () => b.accounts.create(workspaceA.id, { ...FNB_TEMPLATE.accounts[0], code: "9-9999", systemRole: null })],
      ["ubah akun", () => b.accounts.update(kasA, { name: "Diretas" })],
      ["hapus akun", () => b.accounts.softDelete(jualA)],
      ["kunci periode", () => b.periods.setStatus(periodsA[0].id, "closed")],
      ["periode baru", () => b.periods.createMany(workspaceA.id, monthlyPeriodsForYear(2030))],
      ["ganti nama", () => b.workspaces.rename(workspaceA.id, "Diretas")],
      ["hapus workspace", () => b.workspaces.softDelete(workspaceA.id)],
    ];
    for (const [label, attempt] of attempts) {
      const error = await attempt().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, label).toBeInstanceOf(AccountingError);
      expect((error as AccountingError).hasCode("NOT_FOUND"), label).toBe(true);
    }
    // Data A tidak berubah.
    expect((await userA.repos.workspaces.getById(workspaceA.id))?.name).toBe("Rahasia A");
    expect((await userA.repos.accounts.getById(kasA))?.name).toBe("Kas");
    expect(await userA.repos.journals.listByWorkspace(workspaceA.id)).toHaveLength(1);
  });

  it("tabel tidak dapat ditulis langsung, bahkan oleh pemiliknya (wajib lewat RPC)", async () => {
    const direct = [
      await userA.client.from("journal_entries").update({ description: "ubah langsung" }).eq("id", postedA),
      await userA.client.from("journal_lines").delete().eq("journal_entry_id", postedA),
      await userA.client
        .from("journal_entries")
        .insert({ workspace_id: workspaceA.id, entry_date: "2026-03-10", status: "draft", source: "manual" }),
      await userA.client.from("workspaces").update({ name: "ubah langsung" }).eq("id", workspaceA.id),
    ];
    for (const result of direct) {
      expect(result.error?.code).toBe("42501"); // permission denied
    }
    const entry = await userA.repos.journals.getById(postedA);
    expect(entry?.description).toBe("Penjualan");
    expect(entry?.lines).toHaveLength(2);
  });

  it("pengunjung tanpa login tidak dapat membaca apa pun", async () => {
    const anon = newClient();
    const { data, error } = await anon.from("journal_entries").select("id").eq("id", postedA);
    expect(error?.code ?? (data?.length === 0 ? "kosong" : "terbaca")).not.toBe("terbaca");
    const rpc = await anon.rpc("post_journal", { p_input: sale(workspaceA.id, 1), p_draft_id: null });
    expect(rpc.error).not.toBeNull();
  });
});
