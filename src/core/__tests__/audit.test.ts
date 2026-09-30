import { describe, expect, it } from "vitest";
import { actorLabel, auditActionLabel, auditChanges, auditSubject, normalizeSnapshot } from "@/core/audit";

describe("audit", () => {
  it("menormalkan snapshot snake_case (DB) dan camelCase (mock)", () => {
    expect(normalizeSnapshot({ entry_number: "JU-2026-0001", is_active: true })).toEqual({ entryNumber: "JU-2026-0001", isActive: true });
    expect(normalizeSnapshot({ entryNumber: "x" })).toEqual({ entryNumber: "x" });
    expect(normalizeSnapshot(null)).toBeNull();
    expect(normalizeSnapshot([1])).toBeNull();
  });

  it("ringkasan subjek per entitas", () => {
    expect(auditSubject({ entityType: "account", entityId: "a", before: null, after: { code: "1-1000", name: "Kas" } })).toBe("1-1000 Kas");
    expect(
      auditSubject({ entityType: "journal", entityId: "j", before: { entry_number: null, description: "Beli bahan" }, after: null }),
    ).toBe("Draft · Beli bahan");
    expect(auditSubject({ entityType: "period", entityId: "p", before: null, after: { start_date: "2026-12-01" } })).toBe("Desember 2026");
    expect(auditSubject({ entityType: "workspace", entityId: "w", before: null, after: null })).toBe("w");
  });

  it("perubahan hanya nilai skalar yang berbeda, abaikan timestamp", () => {
    const changes = auditChanges(
      { name: "Kas", is_active: true, updated_at: "1", lines: [1] },
      { name: "Kas Kecil", is_active: false, updated_at: "2", lines: [2] },
    );
    expect(changes).toEqual([
      { field: "name", label: "Nama", before: "Kas", after: "Kas Kecil" },
      { field: "isActive", label: "Aktif", before: "Ya", after: "Tidak" },
    ]);
    expect(auditChanges(null, { name: "Kas" })).toEqual([]);
    expect(auditChanges({ status: "closed" }, { status: "open" })).toEqual([
      { field: "status", label: "Status", before: "Dikunci", after: "Terbuka" },
    ]);
  });

  it("label aksi & pelaku", () => {
    expect(auditActionLabel("reopen")).toBe("Dibuka kembali");
    expect(auditActionLabel("unknown_action")).toBe("unknown_action");
    expect(actorLabel("u1", "u1")).toBe("Anda");
    expect(actorLabel(null, "u1")).toBe("Sistem");
    expect(actorLabel("0123456789abcdef", "u1")).toBe("Pengguna 01234567");
  });
});
