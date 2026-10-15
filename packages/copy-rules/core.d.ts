/**
 * انواع TypeScript برای هستهٔ مشترک قواعد لحن — فقط تایپ، بدون اجرا.
 * بدنهٔ واقعی در `core.mjs` است؛ این فایل فقط تا اپ‌های TS (ادمین/فروشگاه)
 * بتوانند بدون خطای strict از همان منبع حقیقت واحد import کنند.
 */

export interface CopyPiece {
  line: number;
  text: string;
}

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";

export interface CopyViolation {
  rule: RuleId;
  file: string;
  line: number;
  text: string;
  detail: string;
}

export declare const PERSIAN: RegExp;
export declare const MESSAGE_MIN_LENGTH: number;

export declare const BARE_PLURAL_VERBS: string[];
export declare const BROKEN_WRITING: string[];
export declare const FAILURE_MARKERS: RegExp[];
export declare const ID_END_NOUNS: string[];
export declare const INFORMAL_WORDS: string[];
export declare const INTERNAL_JARGON: string[];
export declare const PLURAL_PRONOUNS: string[];
export declare const RULE_DETAIL: Record<RuleId, string>;
export declare const RULE_TITLE: Record<RuleId, string>;

export declare function checkCopy(text: string, opts?: { formal?: boolean }): RuleId[];
export declare function extractCopy(src: string, relPath?: string): CopyPiece[];
export declare function hasStringLiteral(src: string, needle: string): boolean;
export declare function isFormalFile(relPath: string, formalFiles?: string[]): boolean;
export declare function normWord(s: string): string;
export declare function words(text: string): string[];
export declare function hasFormalTone(text: string): boolean;
export declare function hasInformalTone(text: string): boolean;
export declare function isPluralVerb(word: string): boolean;
