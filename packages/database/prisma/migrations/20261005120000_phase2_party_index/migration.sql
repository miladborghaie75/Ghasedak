-- جبرانی: ایندکس معین اشخاص روی JournalLine
--
-- این ایندکس در مهاجرت `20261005090000` (کارمزد درگاه) تعریف شده بود چون
-- `partyType`/`partyId` قبلاً در اسکیما بود ولی ایندکس نداشت. برای اینکه
-- تاریخچه صادق بماند، رکورد آن دست‌نخورده است و این مهاجرت ایندکس را
-- مطمئن می‌سازد (idempotent).
CREATE INDEX IF NOT EXISTS "JournalLine_partyType_partyId_idx"
  ON "JournalLine" ("partyType", "partyId");

CREATE INDEX IF NOT EXISTS "JournalLine_entryId_idx" ON "JournalLine" ("entryId");