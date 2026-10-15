/**
 * گام ۱۸-۲ — اندپوینت‌های دستیار AI (تصمیم #۱۵).
 * فقط مسیرهای بدون عارضهٔ جانبی تست می‌شوند: خواندن وضعیت (configured واقعی از env،
 * نه فیک — بند ۱۱۱)، خطای صریح REQUIRES_CREDENTIAL، و اعتبارسنجی‌های ذخیره
 * (بدون فراخوانی credentials.save تا فایل env.local دست‌نخورده بماند).
 */
import "reflect-metadata";
import { CapabilitiesController } from "../src/admin/capabilities.controller";
import { CredentialsService } from "../src/admin/credentials.service";

describe("Phase 17 — AI assistant endpoints (status/validation, بدون فیک)", () => {
  let capabilities: CapabilitiesController;
  const envBackup: Record<string, string | undefined> = {};

  beforeAll(() => {
    // اندپوینت‌های AI فقط از credentials استفاده می‌کنند؛ بقیهٔ وابستگی‌ها در این مسیرها دست نمی‌خورند
    capabilities = new CapabilitiesController(null as never, null as never, null as never, new CredentialsService());
    for (const k of ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"]) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("ai status: بدون تنظیمات → configured=false", async () => {
    const r = (await capabilities.aiStatus()) as { configured: boolean; baseUrl: string; model: string; key: unknown };
    expect(r.configured).toBe(false);
    expect(r.baseUrl).toBe("");
    expect(r.model).toBe("");
  });

  it("ai status: با تنظیمات کامل env → configured=true و کلید فقط ماسک‌شده", async () => {
    process.env.AI_BASE_URL = "https://api.example.com/v1";
    process.env.AI_API_KEY = "sk-1234567890abcdef";
    process.env.AI_MODEL = "test-model";
    const r = (await capabilities.aiStatus()) as {
      configured: boolean;
      baseUrl: string;
      model: string;
      key: { configured: boolean; masked: string | null; source: string } | null;
    };
    expect(r.configured).toBe(true);
    expect(r.baseUrl).toBe("https://api.example.com/v1");
    expect(r.model).toBe("test-model");
    expect(r.key?.masked).toBe("sk-…cdef"); // هرگز کلید کامل در پاسخ نیست (بند ۱۱۱)
    expect(JSON.stringify(r)).not.toContain("sk-1234567890abcdef");
  });

  it("ai test بدون credential → REQUIRES_CREDENTIAL صریح، بدون فراخوانی بیرونی", async () => {
    delete process.env.AI_API_KEY;
    await expect(capabilities.aiTest()).rejects.toMatchObject({ response: { code: "REQUIRES_CREDENTIAL" } });
  });

  it("ai settings: نشانی بدون http(s) رد می‌شود", async () => {
    await expect(capabilities.saveAiSettings({ baseUrl: "ftp://bad" })).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR" },
    });
  });

  it("ai settings: مقدار بیش از حد بلند رد می‌شود", async () => {
    await expect(capabilities.saveAiSettings({ model: "x".repeat(2049) })).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR" },
    });
  });

  it("ai settings: بدنهٔ خالی → EMPTY", async () => {
    await expect(capabilities.saveAiSettings({})).rejects.toMatchObject({ response: { code: "EMPTY" } });
  });

  it("ai suggest: متن خالی یا بلند → VALIDATION_ERROR", async () => {
    await expect(capabilities.aiSuggest({ text: "   " })).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR" },
    });
    await expect(capabilities.aiSuggest({ text: "x".repeat(601) })).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR" },
    });
  });
});
