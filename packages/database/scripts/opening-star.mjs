import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const v = await p.productVariant.findUnique({ where: { sku: "STAR-BRA-BLK-M" } });
const wh = await p.warehouse.findUnique({ where: { code: "MAIN" } });
if (v && wh) {
  const key = `opening:${v.sku}:${wh.id}`;
  const exists = await p.stockLedgerEntry.findUnique({ where: { idempotencyKey: key } });
  if (!exists) {
    await p.stockLedgerEntry.create({
      data: { warehouseId: wh.id, variantSku: v.sku, type: "OPENING", qtyIn: 15, qtyOut: 0,
        balanceBefore: 0, balanceAfter: 15, unitCost: 500000n, refType: "seed", refId: "demo", idempotencyKey: key },
    });
    console.log("OPENING OK 15");
  } else console.log("already");
}
await p.$disconnect();
