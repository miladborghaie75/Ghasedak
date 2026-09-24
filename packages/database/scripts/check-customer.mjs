import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const c = await p.customer.findUnique({ where: { mobile: "09351112233" } });
console.log("customer:", c?.id, c?.mobile, c?.name);
await p.$disconnect();
