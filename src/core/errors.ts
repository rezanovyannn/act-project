export type ValidationCode =
  | "INVALID_DATE"
  | "EMPTY_DESCRIPTION"
  | "EMPTY_NAME"
  | "TOO_FEW_LINES"
  | "INVALID_AMOUNT"
  | "LINE_BOTH_SIDES"
  | "LINE_ZERO"
  | "UNBALANCED"
  | "AMOUNT_OVERFLOW"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_OTHER_WORKSPACE"
  | "ACCOUNT_INACTIVE"
  | "PERIOD_NOT_FOUND"
  | "PERIOD_CLOSED"
  | "INVALID_REVERSAL"
  | "ALREADY_REVERSED"
  | "HAS_SETTLEMENTS"
  | "INVALID_SETTLEMENT"
  | "ACCOUNT_IN_USE"
  | "SYSTEM_ACCOUNT"
  | "INVALID_ACCOUNT"
  | "EMPTY_REASON"
  | "DUPLICATE_OPENING_BALANCE"
  | "DUPLICATE_CLOSING"
  | "INVALID_CLOSING"
  | "CLOSING_NOT_FOUND"
  | "NOT_FOUND"
  | "NOT_DRAFT"
  | "NOT_POSTED"
  | "INVALID_TEMPLATE"
  | "DUPLICATE_ACCOUNT_CODE"
  | "INVALID_TAX_LABEL";

export interface ValidationIssue {
  code: ValidationCode;
  /** Pesan untuk ditampilkan ke pengguna (Bahasa Indonesia). */
  message: string;
  /** Indeks baris jurnal (0-based) bila masalahnya ada pada baris tertentu. */
  lineIndex?: number;
}

export class AccountingError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "AccountingError";
    this.issues = issues;
  }

  hasCode(code: ValidationCode): boolean {
    return this.issues.some((issue) => issue.code === code);
  }
}

export function assertNoIssues(issues: ValidationIssue[]): void {
  if (issues.length > 0) {
    throw new AccountingError(issues);
  }
}

export function fail(code: ValidationCode, message: string): never {
  throw new AccountingError([{ code, message }]);
}
