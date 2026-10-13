/** پاک‌سازی دادهٔ تست رهگیری — مرسوله‌های TRK-TEST-* و بازگرداندن وضعیت سفارش‌ها */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const ship = await p.shipment.findMany({
    where: { OR: [{ trackingCode: { startsWith: "TRK-TEST-" } }, { trackingCode: "TRK-TEST-0001" }] },
    select: { id: true, orderId: true },
  });
  const orderIds = [...new Set(ship.map((s) => s.orderId))];

  if (ship.length) {
    await p.shipment.deleteMany({ where: { id: { in: ship.map((s) => s.id) } } });
  }

  // سفارش‌هایی که فقط تست ما تغییرشان داد را برمی‌گردانیم:
  // اگر پرداخت‌شده‌اند به PAID، وگرنه PENDING
  for (const id of orderIds) {
    const o = await p.order.findUnique({ where: { id }, select: { paymentStatus: true, trackingCode: true } });
    if (!o) continue;
    await p.order.update({
      where: { id },
      data: {
        status: o.paymentStatus === "PAID" ? "PAID" : "PENDING",
        trackingCode: o.trackingCode?.startsWith("TRK-TEST-") ? null : o.trackingCode,
      },
    });
  }

  const left = await p.shipment.count({ where: { trackingCode: { startsWith: "TRK-TEST-" } } });
  console.log(`shipments deleted: ${ship.length}, orders restored: ${orderIds.length}, remaining: ${left}`);
  await p.$disconnect();
})();