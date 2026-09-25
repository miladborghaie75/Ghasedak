-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('SMS_MARKETING', 'EMAIL_MARKETING', 'ANALYTICS', 'COOKIES', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "OutboxState" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

-- CreateEnum
CREATE TYPE "StockAlertState" AS ENUM ('PENDING', 'NOTIFIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL DEFAULT 'customer',
    "ownerKey" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEventOutbox" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "OutboxState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'sms',
    "target" TEXT NOT NULL,
    "state" "StockAlertState" NOT NULL DEFAULT 'PENDING',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_ownerKey_idx" ON "ConsentRecord"("ownerKey");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_ownerKey_kind_key" ON "ConsentRecord"("ownerKey", "kind");

-- CreateIndex
CREATE INDEX "DomainEventOutbox_state_availableAt_idx" ON "DomainEventOutbox"("state", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEventOutbox_name_payload_key" ON "DomainEventOutbox"("name", "payload");

-- CreateIndex
CREATE INDEX "StockAlert_state_idx" ON "StockAlert"("state");

-- CreateIndex
CREATE UNIQUE INDEX "StockAlert_variantSku_channel_target_key" ON "StockAlert"("variantSku", "channel", "target");

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_variantSku_fkey" FOREIGN KEY ("variantSku") REFERENCES "ProductVariant"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;
