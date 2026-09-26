/**
 * guard-test.mjs — تست‌های اجباری گارد Recovery (PHASE 1) — بدون هیچ mutation.
 * فقط assertSafeUrl را در process جداگانه صدا می‌زند؛ هیچ اتصالی به DB برقرار نمی‌شود.
 *
 * سناریوها:
 *   1) بدون override + primary          → REFUSE (exit 3)
 *   2) override + مقصد اشتباه           → REFUSE (exit 3)  [db دیگر روی 5433، یا db ghasedak روی پورت دیگر، یا host متفاوت]
 *   3) override بدون system_identifier  → REFUSE (exit 3)
 *   4) override + system_identifier غلط → REFUSE (exit 3)
 *   5) override + primary صحیح + sid صحیح → ALLOW با هشدار واضح
 *   6) بدون override + مقصد rehearsal عادی → ALLOW (رفتار عادی دست‌نخورده)
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const safetyPath = pathToFileURL(join(here, "_safety.mjs")).href;

const PRIMARY_URL = "postgresql://postgres:ghasedak-dev-pw@localhost:5433/ghasedak";
const WRONG_SID = "0000000000000000000";
const GOOD_SID = "7688682880612306664";

const cases = [
  {
    name: "1: no-override + primary → REFUSE",
    env: {},
    url: PRIMARY_URL,
    expect: "refuse",
  },
  {
    name: "2a: override + wrong db on 5433 → REFUSE",
    env: { REHEARSAL_ALLOW_PRIMARY: "1", REHEARSAL_PRIMARY_SYSTEM_IDENTIFIER: GOOD_SID },
    url: "postgresql://postgres:pw@localhost:5433/ghasedak_recovery_rehearsal",
    expect: "refuse",
  },
  {
    name: "2b: override + ghasedak on wrong port → REFUSE",
    env: { REHEARSAL_ALLOW_PRIMARY: "1", REHEARSAL_PRIMARY_SYSTEM_IDENTIFIER: GOOD_SID },
    url: "postgresql://postgres:pw@localhost:5432/ghasedak",
    expect: "refuse",
  },
  {
    name: "2c: override + non-localhost primary → REFUSE",
    env: { REHEARSAL_ALLOW_PRIMARY: "1", REHEARSAL_PRIMARY_SYSTEM_IDENTIFIER: GOOD_SID },
    url: "postgresql://postgres:pw@127.0.0.1:5433/ghasedak",
    expect: "refuse",
  },
  {
    name: "3: override without system_identifier → REFUSE",
    env: { REHEARSAL_ALLOW_PRIMARY: "1" },
    url: PRIMARY_URL,
    expect: "refuse",
  },
  {
    name: "4: override + wrong system_identifier → REFUSE",
    env: { REHEARSAL_ALLOW_PRIMARY: "1", REHEARSAL_PRIMARY_SYSTEM_IDENTIFIER: WRONG_SID },
    url: PRIMARY_URL,
    expect: "refuse",
  },
  {
    name: "5: override + correct primary + verified sid → ALLOW with warning",
    env: { REHEARSAL_ALLOW_PRIMARY: "1", REHEARSAL_PRIMARY_SYSTEM_IDENTIFIER: GOOD_SID },
    url: PRIMARY_URL,
    expect: "allow",
    expectWarning: true,
  },
  {
    name: "6: no-override + normal rehearsal target → ALLOW (baseline behavior intact)",
    env: {},
    url: "postgresql://postgres:rehearsal-pw@127.0.0.1:55432/ghasedak_recovery_rehearsal",
    expect: "allow",
  },
];

const childCode = `
import { assertSafeUrl } from "${safetyPath}";
assertSafeUrl(process.env.TEST_URL, { label: "guard-test" });
console.log("ALLOWED");
`;

let failures = 0;
for (const tc of cases) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", childCode], {
    encoding: "utf8",
    env: { ...process.env, ...tc.env, TEST_URL: tc.url },
  });
  const refused = r.status === 3;
  const allowed = r.status === 0 && /ALLOWED/.test(r.stdout);
  const warned = /PRIMARY OVERRIDE ACTIVE/.test(r.stderr);
  let pass;
  if (tc.expect === "refuse") pass = refused;
  else pass = allowed && (!tc.expectWarning || warned);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${tc.name}`);
  if (!pass) {
    console.log(`   status=${r.status} stdout=${(r.stdout ?? "").trim()} stderr=${(r.stderr ?? "").trim().split("\n").join(" | ")}`);
  }
}

console.log(failures === 0 ? "GUARD_TESTS_PASSED (no mutation performed)" : `GUARD_TESTS_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
