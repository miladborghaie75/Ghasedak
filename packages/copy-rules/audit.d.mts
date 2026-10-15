/** انواع رانر ممیزی مشترک — بدنه در `audit.mjs` (همان قاعده‌های تست نگهبان). */

export type ToneRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";

export interface ToneAuditViolation {
  rule: ToneRuleId;
  app: string;
  file: string;
  line: number;
  text: string;
  title: string;
  detail: string;
}

export interface ToneAuditSummary {
  app: string;
  files: number;
  pieces: number;
  violations: number;
  byRule: Record<string, number>;
}

export declare function auditApp(cfg: {
  app: string;
  root: string;
  formalFiles: string[];
  sharedStrings: string[];
}): { violations: ToneAuditViolation[]; summary: ToneAuditSummary };

export declare const SKIP_DIRS: Set<string>;
