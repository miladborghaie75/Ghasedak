const fs = require("fs");
const p = "apps/api/src/cms/cms.controller.ts";
const buf = fs.readFileSync(p);
if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
  fs.writeFileSync(p, buf.subarray(3));
  console.log("BOM removed: " + p);
} else {
  console.log("no BOM: " + p);
}