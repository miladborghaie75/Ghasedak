const fs = require("fs");
const path = require("path");
const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const DEST = path.join(
  "C:\\Users\\milad\\AppData\\Local\\Temp\\kilo",
  `ghasedak-pre-rebuild-${STAMP}`,
);
fs.mkdirSync(DEST, { recursive: true });
fs.writeFileSync(path.join(DEST, "BACKUP-INFO.txt"), `source: ${ROOT}\ncreated: ${new Date().toString()}\n`);
console.log(DEST);