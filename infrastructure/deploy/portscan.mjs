// اسکن سریع پورت‌های TCP سرور استقرار — فقط برای یافتن پورت باز (SSH/HTTP)
// استفاده: node infrastructure/deploy/portscan.mjs 79.127.11.91
import net from "node:net";

const host = process.argv[2] || "79.127.11.91";
const timeout = 400;
const concurrency = 400;
const open = [];

let next = 1;
let active = 0;
const started = Date.now();

function scan(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (isOpen) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (isOpen) open.push(port);
      resolve();
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function pump() {
  while (next <= 65535) {
    if (active >= concurrency) {
      await new Promise((r) => setTimeout(r, 5));
      continue;
    }
    const port = next++;
    active++;
    scan(port).then(() => {
      active--;
      if (port % 10000 === 0) console.log(`...${port}/65535`);
    });
  }
}

const workers = Array.from({ length: concurrency }, () => pump());
await Promise.all(workers);
while (active > 0) await new Promise((r) => setTimeout(r, 50));
console.log(JSON.stringify({ host, open, ms: Date.now() - started }));
