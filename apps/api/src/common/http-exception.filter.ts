import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

/**
 * همه خطاها با ساختار ثابت بند ۶۵ برگردانده می‌شوند:
 * { code, message, fieldErrors?, requestId }
 * stack trace هرگز به کلاینت نمی‌رسد.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_ERROR";
    let message = "خطای غیرمنتظره رخ داد.";
    let fieldErrors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as
        | { code?: string; message?: string | string[]; fieldErrors?: Record<string, string[]> }
        | string;

      if (typeof body === "string") {
        message = body;
      } else {
        code = body.code ?? defaultCode(status);
        message = typeof body.message === "string" ? body.message : Array.isArray(body.message) ? body.message.join("، ") : code;
        fieldErrors = body.fieldErrors;
      }
    } else {
      // خطای غیرمنتظره — ثبت کامل در لاگ، پاسخ عمومی به کلاینت (بند ۶۵)
      this.logger.error(
        `Unhandled: ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
    }

    res.status(status).json({
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      requestId: req.requestId,
    });
  }
}

function defaultCode(status: number): string {
  if (status === HttpStatus.NOT_FOUND) return "NOT_FOUND";
  if (status === HttpStatus.UNAUTHORIZED) return "UNAUTHORIZED";
  if (status === HttpStatus.FORBIDDEN) return "FORBIDDEN";
  if (status === HttpStatus.CONFLICT) return "CONFLICT";
  if (status === HttpStatus.BAD_REQUEST) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}
