import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.stockLedgerEntry.findMany({ where: { refType: "order" }, orderBy: { createdAt: "desc" }, take: 3 });
for (const r of rows) {
  console.log(`${r.type} ${r.variantSku} out=${r.qtyOut} bal=${r.balanceAfter} key=${r.idempotencyKey}`);
}
const v = await p.productVariant.findUnique({ where: { sku: "DEMO-BRA-75B-BLK" } });
console.log(`variant stockQty=${v?.stockQty} reserved=${v?.reservedQty}`);
const res = await p.stockReservation.findMany({ where: { refType: "order" }, orderBy: { createdAt: "desc" }, take: 2 });
for (const r of res) console.log(`reservation state=${r.state} qty=${r.qty}`);
await p.$disconnect();
