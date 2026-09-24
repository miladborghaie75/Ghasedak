import type { Prisma } from "@prisma/client";

/** نوع تراکنش تعاملی Prisma — برای تایپ پارامتر tx در سرویس‌ها */
export type PrismaTransaction = Prisma.TransactionClient;
