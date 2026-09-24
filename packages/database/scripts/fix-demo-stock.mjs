import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const v = await p.productVariant.findUnique({ where: { sku: "DEMO-BRA-75B-BLK" } });
const wh = await p.warehouse.findUnique({ where: { code: "MAIN" } });
if (!v || !wh) {
  console.log("MISSING variant/warehouse");
  process.exit(1);
}

await p.$transaction(async (tx) => {
  const agg = await tx.stockLedgerEntry.aggregate({
    where: { warehouseId: wh.id, variantSku: v.sku },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const onHand = (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
  const key = `opening:${v.sku}:${wh.id}`;
  const exists = await tx.stockLedgerEntry.findUnique({ where: { idempotencyKey: key } });
  if (!exists && onHand < 5) {
    await tx.stockLedgerEntry.create({
      data: {
        warehouseId: wh.id,
        variantSku: v.sku,
        type: "OPENING",
        qtyIn: 10,
        qtyOut: 0,
        balanceBefore: onHand,
        balanceAfter: onHand + 10,
        unitCost: 400000n,
        refType: "seed",
        refId: "demo",
        idempotencyKey: key,
      },
    });
    await tx.productVariant.update({ where: { sku: v.sku }, data: { stockQty: onHand + 10 } });
  }
  const rel = await tx.stockReservation.updateMany({
    where: { state: "ACTIVE", expiresAt: { lt: new Date() } },
    data: { state: "RELEASED" },
  });
  console.log("released_expired=" + rel.count);
});

const second = await p.productVariant.findUnique({ where: { sku: "DEMO-BRA-80B-BLK" } });
if (second && wh) {
  const key2 = `opening:${second.sku}:${wh.id}`;
  const exists2 = await p.stockLedgerEntry.findUnique({ where: { idempotencyKey: key2 } });
  if (!exists2) {
    const agg2 = await p.stockLedgerEntry.aggregate({
      where: { warehouseId: wh.id, variantSku: second.sku },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const onHand2 = (agg2._sum.qtyIn ?? 0) - (agg2._sum.qtyOut ?? 0);
    await p.stockLedgerEntry.create({
      data: {
        warehouseId: wh.id,
        variantSku: second.sku,
        type: "OPENING",
        qtyIn: 10,
        qtyOut: 0,
        balanceBefore: onHand2,
        balanceAfter: onHand2 + 10,
        unitCost: 400000n,
        refType: "seed",
        refId: "demo",
        idempotencyKey: key2,
      },
    });
    await p.productVariant.update({ where: { sku: second.sku }, data: { stockQty: onHand2 + 10 } });
  }
}

console.log("OPENING STOCK OK");
await p.$disconnect();
