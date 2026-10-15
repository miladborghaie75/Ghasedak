/** انواع جایگزینِ امن متن — بدنه در `apply.mjs`. */

export type ApplyErrorCode = "NOT_FOUND" | "LINE_NOT_UNIQUE" | "UNSAFE_REPLACEMENT";

export declare class ReplacementError extends Error {
  code: ApplyErrorCode;
}

export declare function applyReplacement(
  src: string,
  opts: { text: string; replacement: string; line?: number },
): string;
