import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const m = await p.shippingMethod.findFirst({ where: { status: "active" } });
const v = await p.productVariant.findFirst({ where: { sku: { contains: "DEMO" } }, select: { sku: true, price: true } });
console.log(JSON.stringify({ shipId: m?.id, shipName: m?.name, sku: v?.sku, price: v?.price?.toString() }));
await p.$disconnect();
