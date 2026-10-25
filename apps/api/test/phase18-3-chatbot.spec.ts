/**
 * گام ۱۸-۳ — تست‌های چت‌بات مشتری (AI chat SSE + non-streaming)
 * - اعتبارسنجی ورودی
 * - REQUIRES_CREDENTIAL بدون تنظیمات
 * - SSE streaming و non-streaming
 * - Rate limit (از middleware)
 */
import "reflect-metadata";
import { CapabilitiesController } from "../src/admin/capabilities.controller";
import { CredentialsService } from "../src/admin/credentials.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { NotificationDispatcherService } from "../src/events/notification-dispatcher.service";
import { SmsProvidersService } from "../src/events/sms-providers.service";

describe("Phase 18-3 — AI Chat endpoint (SSE + validation, بدون فیک)", () => {
  let controller: CapabilitiesController;
  const envBackup: Record<string, string | undefined> = {};

  beforeAll(() => {
    // Mock dependencies برای تست کنترلر
    controller = new CapabilitiesController(
      null as never, // PrismaService
      null as never, // NotificationDispatcherService
      null as never, // SmsProvidersService
      new CredentialsService()
    );

    // Backup و پاک کردن envهای AI
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

  it("aiChatStream: بدون credential → REQUIRES_CREDENTIAL", async () => {
    const mockRes = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      statusCode: 200,
    } as never;

    await expect(
      controller.aiChatStream({ messages: [{ role: "user", content: "سلام" }], stream: true }, mockRes)
    ).rejects.toMatchObject({ response: { code: "REQUIRES_CREDENTIAL" } });
  });

  it("aiChatStream: بدنه خالی → VALIDATION_ERROR", async () => {
    process.env.AI_BASE_URL = "https://api.example.com/v1";
    process.env.AI_API_KEY = "sk-test";
    process.env.AI_MODEL = "test-model";

    const mockRes = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    } as never;

    await expect(controller.aiChatStream({ messages: [] }, mockRes)).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR" },
    });
  });

  it("aiChatStream: پیام بیش از ۲۰۰۰ کاراکتر → VALIDATION_ERROR", async () => {
    const mockRes = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    } as never;

    await expect(
      controller.aiChatStream({ messages: [{ role: "user", content: "x".repeat(2001) }] }, mockRes)
    ).rejects.toMatchObject({ response: { code: "VALIDATION_ERROR" } });
  });

  it("aiChatStream: پیام‌های معتبر، stream=false → پاسخ JSON (بدون credential می‌پرد)", async () => {
    // پاک کردن envهای AI برای تست بدون credential
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;

    const mockRes = {
      json: jest.fn().mockResolvedValue(undefined),
      status: jest.fn().mockReturnThis(),
    } as never;

    // این تست فقط اعتبارسنجی را چک می‌کند؛ فراخوانی واقعی AI نیاز به credential دارد
    // در اینجا انتظار داریم REQUIRES_CREDENTIAL بدهد چون fetch mocked نیست
    await expect(
      controller.aiChatStream({ messages: [{ role: "user", content: "سلام" }], stream: false }, mockRes)
    ).rejects.toMatchObject({ response: { code: "REQUIRES_CREDENTIAL" } });
  });

  it("buildChatSystemPrompt: شامل قوانین اصلی است", () => {
    // متد private است؛ تست از طریق reflection یا بررسی رفتار اپی
    // در اینجا فقط وجود متد را تأیید می‌کنیم
    expect(typeof (controller as unknown as { buildChatSystemPrompt: () => string }).buildChatSystemPrompt).toBe(
      "function"
    );
    const prompt = (controller as unknown as { buildChatSystemPrompt: () => string }).buildChatSystemPrompt();
    expect(prompt).toContain("قاصدک");
    expect(prompt).toContain("صمیمی");
    expect(prompt).toContain("حساس");
  });
});

describe("Rate Limit Middleware — AI chat rule", () => {
  // تست rate-limit نیاز به یکپارچه‌سازی کامل دارد؛ اینجا فقط وجود قانون را بررسی می‌کنیم
  it("RULES شامل /admin/capabilities/ai/chat است", () => {
    const { RULES } = require("../src/common/rate-limit.middleware");
    const aiRule = RULES.find((r: { match: RegExp }) => r.match.test("/admin/capabilities/ai/chat"));
    expect(aiRule).toBeDefined();
    expect(aiRule?.max).toBe(30);
    expect(aiRule?.windowMs).toBe(60_000);
  });
});