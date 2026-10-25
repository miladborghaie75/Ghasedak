"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { aiChat, aiChatStream, toAPIMessages } from "@/lib/ai-client";
import { CHAT_ERROR_FALLBACK, resolveAssistantError } from "@/lib/chat-error";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/chat-system-prompt";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatWidgetProps {
  /** باز شدن پیش‌فرض (معمولاً از کوکی/لوکال استوریج کنترل می‌شود) */
  defaultOpen?: boolean;
  /** شناسه نشست برای ادامه گفتگو (اختیاری) */
  sessionId?: string;
}

const WELCOME_MESSAGE = "سلام! من دستیار خرید قاصدک هستم. چطور می‌تونم کمکت کنم؟";
const QUICK_REPLIES = [
  "قیمت و موجودی محصول",
  "راهنماي سایز و فیت",
  "وضعیت سفارش من",
  "مرجوعی و استبدال",
  "روش‌های پرداخت",
  "هزینه و زمان ارسال",
];

const STORAGE_KEY = "ghasedak-chat-session";
const MAX_MESSAGES = 50;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

export function ChatWidget({ defaultOpen = false, sessionId }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // بازیابی از localStorage (فقط سمت کلاینت)
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
            return parsed.messages.map((m: { id: string; role: "user" | "assistant"; content: string; timestamp: string }) => ({
              ...m,
              timestamp: new Date(m.timestamp),
            }));
          }
        }
      } catch {
        // ignore parse errors
      }
    }
    return [{ id: generateId(), role: "assistant", content: WELCOME_MESSAGE, timestamp: new Date() }];
  });
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ذخیره در localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId: sessionId || generateId(),
          messages: messages.slice(-MAX_MESSAGES),
          updatedAt: new Date().toISOString(),
        })
      );
    }
  }, [messages, sessionId]);

  // اسکرول به پایین هنگام اضافه شدن پیام
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // فوکوس روی textarea هنگام باز شدن
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [isOpen]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const sendMessage = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsStreaming(true);
    setError(null);

    // به‌روزرسانی فوری برای UX
    const assistantId = generateId();
    let accumulatedContent = "";
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      const apiMessages = toAPIMessages([...history, { role: "user", content: text }]);

      await aiChatStream(
        apiMessages,
        (chunk) => {
          accumulatedContent += chunk;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: accumulatedContent } : m))
          );
        },
        () => {
          setIsStreaming(false);
        },
        (err) => {
          // پیام خطای تمیز سرور (مثل «چت موقتاً در دسترس نیست») مستقیم در حباب نشان داده می‌شود؛
          // بنر جداگانه لازم نیست — همان متن تکرار می‌شد.
          setError(null);
          setIsStreaming(false);
          const content = resolveAssistantError(err);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content } : m
            )
          );
        }
      );
    } catch (e) {
      setError(String(e));
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: CHAT_ERROR_FALLBACK } : m
        )
      );
    }
  }, [inputValue, isStreaming, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleQuickReply = (text: string) => {
    setInputValue(text);
    sendMessage();
  };

  const clearChat = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    setMessages([{ id: generateId(), role: "assistant", content: WELCOME_MESSAGE, timestamp: new Date() }]);
    setError(null);
  };

  const toggleOpen = () => setIsOpen((prev) => !prev);

  // باز کردن با کلید t (برای دسترس‌پذیری)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "t" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unreadCount = messages.filter((m) => m.role === "assistant" && m.content !== WELCOME_MESSAGE).length;

  return (
    <>
      {/* دکمه چت فلوتینگ */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={isOpen ? "بستن چت" : "باز کردن چت با دستیار خرید"}
        aria-expanded={isOpen}
        aria-controls="chat-sheet"
        className={cn(
          "fixed bottom-4 end-4 z-40 size-14 rounded-full shadow-clay-3",
          "bg-plum text-on-accent flex items-center justify-center",
          "hover:shadow-clay-4 hover:scale-[1.02] active:scale-[0.98]",
          "transition-[box-shadow,transform] duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum focus-visible:ring-offset-2"
        )}
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
        {/* بوج اعداد خوانده‌نشده */}
        {!isOpen && unreadCount > 0 && (
          <span
            className="absolute -top-1 -end-1 size-5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center"
            aria-label={`${unreadCount} پیام خوانده‌نشده`}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* شیت چت */}
      <Sheet open={isOpen} onClose={toggleOpen} title="دستیار خرید قاصدک" className="max-w-sm sm:max-w-md">
        <div id="chat-sheet" className="flex flex-col h-full" role="log" aria-live="polite" aria-label="مکالمه">
          {/* هدر اطلاعات */}
          <div className="mb-4 p-3 rounded-xl bg-primary-tint border border-line">
            <p className="text-sm text-ink font-medium">سلام! چطور می‌تونم کمکت کنم؟</p>
            <p className="text-xs text-muted mt-1">موضوعات: محصول، سایز، سفارش، مرجوعی، پرداخت، ارسال</p>
          </div>

          {/* لیست پیام‌ها */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1" style={{ maxHeight: "50vh" }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-2 max-w-[85%]",
                  msg.role === "user" ? "flex-row-reverse ms-auto" : "flex-row me-auto"
                )}
              >
                {/* آواتار */}
                <div
                  className={cn(
                    "flex-shrink-0 size-8 rounded-full flex items-center justify-center text-[11px] font-bold",
                    msg.role === "user"
                      ? "bg-plum text-on-accent"
                      : "bg-primary-tint text-primary-strong"
                  )}
                  aria-hidden="true"
                >
                  {msg.role === "user" ? "ش" : "ق"}
                </div>

                {/* حباب پیام */}
                <div
                  className={cn(
                    "relative px-4 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words",
                    msg.role === "user"
                      ? "bg-plum text-on-accent rounded-tr-sm"
                      : "bg-surface text-ink border border-line rounded-tl-sm shadow-clay-1"
                  )}
                >
                  <p className="max-w-[280px]">{msg.content}</p>
                  <time className="absolute bottom-1 end-2 text-[10px] opacity-60" dateTime={msg.timestamp.toISOString()}>
                    {formatTime(msg.timestamp)}
                  </time>
                  {msg.role === "assistant" && isStreaming && msg.id === messages[messages.length - 1]?.id && (
                    <span className="inline-block animate-pulse text-plum" aria-hidden="true">●</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* خطای اتصال */}
          {error && (
            <div className="mb-2 p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs" role="alert">
              {error}
            </div>
          )}

          {/* پاسخ‌های سریع (فقط وقتی پیام المساعد آخر باشد) */}
          {messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && !isStreaming && (
            <div className="flex flex-wrap gap-2 mb-2" role="list" aria-label="پاسخ‌های سریع">
              {QUICK_REPLIES.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => handleQuickReply(reply)}
                  className="px-3 py-1.5 text-xs rounded-full bg-primary-tint text-primary-strong border border-line hover:bg-primary-hover transition-colors"
                  role="listitem"
                  aria-label={`پرسیدن درباره ${reply}`}
                >
                  {reply}
                </button>
              ))}
            </div>
          )}

          {/* ورودی پیام */}
          <div className="border-t border-line pt-3 sticky bottom-0 bg-surface">
            <div className="flex gap-2">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="پیام‌تو بنویس… (Enter برای ارسال، Shift+Enter برای خط جدید)"
                disabled={isStreaming}
                rows={1}
                maxLength={2000}
                className={cn(
                  "flex-1 min-h-[44px] max-h-32 px-4 py-2.5 rounded-xl border bg-surface",
                  "text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-plum",
                  "resize-none transition-colors",
                  isStreaming && "opacity-50 cursor-not-allowed"
                )}
                aria-label="متن پیام"
                aria-describedby={error ? "chat-error" : undefined}
              />
              <Button
                type="button"
                onClick={sendMessage}
                disabled={!inputValue.trim() || isStreaming}
                loading={isStreaming}
                size="md"
                variant="primary"
                className="flex-shrink-0 min-h-[44px]"
                aria-label="ارسال پیام"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </Button>
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-muted">
              <span>{inputValue.length}/2000</span>
              <button
                type="button"
                onClick={clearChat}
                className="text-muted hover:text-ink underline"
                aria-label="پاک کردن تاریخچه چت"
              >
                پاک کردن چت
              </button>
            </div>
          </div>
        </div>
      </Sheet>

      {/* استایل انیمیشن شیت */}
      <style jsx global>{`
        @keyframes sheet-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}