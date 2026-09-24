import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { randomUUID } from "crypto";

const FLOW: Record<string, string[]> = {
  PENDING: ["LABEL_CREATED", "FAILED"],
  LABEL_CREATED: ["IN_TRANSIT", "FAILED"],
  IN_TRANSIT: ["DELIVERED", "RETURNED_TO_SENDER", "FAILED"],
  DELIVERED: [],
  RETURNED_TO_SENDER: [],
  FAILED: [],
};

/** ارسال — بند ۳۷: سفارش و Shipment جدا هستند؛ چند مرسوله مجاز. */
@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { orderId: string; provider?: string; trackingCode?: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    if (order.paymentStatus !== "PAID") {
      throw new BadRequestException({ code: "ORDER_NOT_PAID", message: "ارسال فقط برای سفارش پرداخت‌شده." });
    }
    return this.prisma.shipment.create({
      data: {
        orderId: order.id,
        provider: input.provider ?? null,
        trackingCode: input.trackingCode ?? null,
        status: "PENDING",
      },
    });
  }

  private async assertTransition(id: string, to: string) {
    const s = await this.prisma.shipment.findUnique({ where: { id } });
    if (!s) throw new NotFoundException({ code: "NOT_FOUND", message: "مرسوله یافت نشد." });
    if (!(FLOW[s.status] ?? []).includes(to)) {
      throw new BadRequestException({ code: "SHIPMENT_INVALID_TRANSITION", message: `گذار ${s.status} → ${to} مجاز نیست.` });
    }
    return s;
  }

  async label(id: string, input: { provider: string; trackingCode: string }, actorId?: string) {
    const s = await this.assertTransition(id, "LABEL_CREATED");
    return this.prisma.shipment.update({
      where: { id },
      data: {
        status: "LABEL_CREATED",
        provider: input.provider,
        trackingCode: input.trackingCode,
      },
    });
  }

  async mark(id: string, to: "IN_TRANSIT" | "DELIVERED" | "RETURNED_TO_SENDER" | "FAILED", actorId?: string) {
    const s = await this.assertTransition(id, to);
    return this.prisma.shipment.update({
      where: { id },
      data: {
        status: to,
        ...(to === "DELIVERED" ? { deliveredAt: new Date() } : {}),
        ...(s.status === "LABEL_CREATED" && to === "IN_TRANSIT" ? { shippedAt: new Date() } : {}),
      },
    });
  }

  async track(code: string) {
    const s = await this.prisma.shipment.findFirst({ where: { trackingCode: code } });
    if (!s) throw new NotFoundException({ code: "NOT_FOUND", message: "کد رهگیری یافت نشد." });
    return { status: s.status, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt };
  }
}

void randomUUID;
