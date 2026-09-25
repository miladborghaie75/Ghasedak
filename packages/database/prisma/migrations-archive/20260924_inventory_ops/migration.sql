-- CreateEnum
CREATE TYPE "QuarantineState" AS ENUM ('HELD', 'RELEASED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "DamageState" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Stocktake" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "countMode" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "toleranceQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "contact" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "QuarantineRecord" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "state" "QuarantineState" NOT NULL DEFAULT 'HELD',
    "refType" TEXT,
    "refId" TEXT,
    "actorId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuarantineRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageRecord" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "unitCost" BIGINT NOT NULL DEFAULT 0,
    "state" "DamageState" NOT NULL DEFAULT 'POSTED',
    "refType" TEXT,
    "refId" TEXT,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'number',
    "defaultValue" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuarantineRecord_number_key" ON "QuarantineRecord"("number");

-- CreateIndex
CREATE INDEX "QuarantineRecord_state_idx" ON "QuarantineRecord"("state");

-- CreateIndex
CREATE INDEX "QuarantineRecord_variantSku_idx" ON "QuarantineRecord"("variantSku");

-- CreateIndex
CREATE UNIQUE INDEX "DamageRecord_number_key" ON "DamageRecord"("number");

-- CreateIndex
CREATE INDEX "DamageRecord_state_idx" ON "DamageRecord"("state");

-- CreateIndex
CREATE INDEX "DamageRecord_variantSku_idx" ON "DamageRecord"("variantSku");

-- AddForeignKey
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarantineRecord" ADD CONSTRAINT "QuarantineRecord_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarantineRecord" ADD CONSTRAINT "QuarantineRecord_variantSku_fkey" FOREIGN KEY ("variantSku") REFERENCES "ProductVariant"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageRecord" ADD CONSTRAINT "DamageRecord_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageRecord" ADD CONSTRAINT "DamageRecord_variantSku_fkey" FOREIGN KEY ("variantSku") REFERENCES "ProductVariant"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

