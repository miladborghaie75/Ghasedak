/**
 * AI Contracts (گام ۱۸-۳) — انواع مشترک برای چت‌بات مشتری
 * استفاده در: apps/api (کنترلر) و apps/storefront (کلاینت/ویدیجت)
 */

export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIChatResponse {
  content: string;
}

export interface AIChatStreamChunk {
  chunk?: string;
  done?: boolean;
  error?: string;
}

export interface AIChatRequest {
  messages: AIChatMessage[];
  stream?: boolean;
}

export interface AIStatusResponse {
  configured: boolean;
  baseUrl: string;
  model: string;
  key: { configured: boolean; masked: string | null; source: string } | null;
}

export interface AISettingsRequest {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface AISettingsResponse {
  written: string[];
  note: string;
  status: AIStatusResponse;
}

export interface AISuggestRequest {
  text?: string;
  rule?: string;
  detail?: string;
  formal?: boolean;
  file?: string;
}

export interface AISuggestResponse {
  suggestion: string;
}

export interface AITestResponse {
  ok: boolean;
  reply: string;
}