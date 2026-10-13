/**
 * Seed دادهٔ جغرافیایی ایران — idempotent (upsert روی نام یکتا).
 * اجرا: node scripts/seed-geo.mjs
 * بدون migration — جدولهای Province/City از قبل موجودند.
 */
import { PrismaClient } from "@prisma/client";
import { IRAN_PROVINCES } from "../packages/database/prisma/geo-data.mjs";

const db = new PrismaClient();
const slugify = (name) => name.trim().replace(/\s+/g, "-");

let provinceCreated = 0, provinceExisting = 0;
let cityCreated = 0, cityExisting = 0;

for (const [pi, p] of IRAN_PROVINCES.entries()) {
  const existing = await db.province.findUnique({ where: { name: p.province }, select: { id: true } });
  const province = existing
    ? (provinceExisting++, existing)
    : (provinceCreated++, await db.province.create({ data: { name: p.province, slug: slugify(p.province), sortOrder: pi } }));

  for (const [ci, cityName] of p.cities.entries()) {
    const cslug = slugify(cityName);
    const city = await db.city.findFirst({ where: { provinceId: province.id, name: cityName }, select: { id: true } });
    if (city) {
      cityExisting++;
      continue;
    }
    await db.city.create({ data: { provinceId: province.id, name: cityName, slug: cslug, sortOrder: ci } });
    cityCreated++;
  }
}

const pc = await db.province.count();
const cc = await db.city.count();
console.log(`provinces: +${provinceCreated} created, ${provinceExisting} existing (total ${pc})`);
console.log(`cities: +${cityCreated} created, ${cityExisting} existing (total ${cc})`);
await db.$disconnect();
