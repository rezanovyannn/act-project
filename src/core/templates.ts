import type { ValidationIssue } from "./errors";
import type { SystemRole, WorkspaceTemplate } from "./types";

/** Akun sistem yang wajib ada di setiap template CoA (ADR 010 & 011). */
export const REQUIRED_SYSTEM_ROLES: readonly SystemRole[] = [
  "opening_balance_equity",
  "retained_earnings",
  "owner_capital",
  "drawings",
];

/**
 * Memastikan seed CoA konsisten: kode unik, `system_role` unik,
 * akun sistem wajib ada, dan setidaknya satu akun kas.
 */
export function validateTemplate(template: WorkspaceTemplate): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const codes = new Set<string>();
  const roles = new Set<SystemRole>();

  for (const account of template.accounts) {
    if (codes.has(account.code)) {
      issues.push({
        code: "DUPLICATE_ACCOUNT_CODE",
        message: `Kode akun ${account.code} duplikat di template ${template.type}`,
      });
    }
    codes.add(account.code);
    if (account.systemRole) {
      if (roles.has(account.systemRole)) {
        issues.push({
          code: "INVALID_TEMPLATE",
          message: `Peran sistem ${account.systemRole} dipakai lebih dari satu akun`,
        });
      }
      roles.add(account.systemRole);
    }
  }

  for (const role of REQUIRED_SYSTEM_ROLES) {
    if (!roles.has(role)) {
      issues.push({
        code: "INVALID_TEMPLATE",
        message: `Template ${template.type} tidak memiliki akun dengan peran ${role}`,
      });
    }
  }
  if (!template.accounts.some((a) => a.isCash)) {
    issues.push({
      code: "INVALID_TEMPLATE",
      message: `Template ${template.type} tidak memiliki akun kas/bank`,
    });
  }
  return issues;
}
