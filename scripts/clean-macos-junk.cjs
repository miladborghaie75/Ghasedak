const fs = require("fs");
const path = require("path");
const ROOT = process.cwd();

// ۱) فایل‌های زائد مک (AppleDouble با پیشوند ._ و پوشهٔ __MACOSX)
// ۲) فایل‌های .DS_Store و Thumbs.db
// اینها هیچ ربطی به بیلد ندارند و فقط نویزند.
const JUNK_DIRS = new Set(["__MACOSX"]);
const JUNK_FILES = /^\._|^\.DS_Store$|^Thumbs\.db$/i;

let removedFiles = 0;
let removedDirs = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (JUNK_DIRS.has(e.name)) {
        fs.rmSync(full, { recursive: true, force: true });
        removedDirs++;
        continue;
      }
      walk(full);
      continue;
    }
    if (JUNK_FILES.test(e.name)) {
      fs.rmSync(full, { force: true });
      removedFiles++;
    }
  }
}

walk(ROOT);
console.log("removed dirs: " + removedDirs + ", removed files: " + removedFiles);