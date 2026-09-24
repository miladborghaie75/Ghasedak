import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const row = await p.homeSection.findFirst({ where: { type: "BANNER" } });
await p.homeSection.update({
  where: { id: row.id },
  data: {
    config: {
      title: "کالکشن جدید رسید",
      subtitle: "همین حالا ببین",
      ctaLabel: "مشاهده",
      ctaHref: "/c/bra",
    },
    publishStatus: "PUBLISHED",
    enabled: true,
  },
});
console.log("banner fixed:", row.id);
await p.$disconnect();
