// MCP stdio 冒烟测试：initialize → tools/list → 调用 shaniu_stats / shaniu_prepare_claim / shaniu_market_orders
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const srv = spawn(process.execPath, ["server.js"], {
  cwd: fileURLToPath(new URL(".", import.meta.url)),
  env: { ...process.env, HTTPS_PROXY: "http://127.0.0.1:7890" },
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map();
let idc = 0;
function send(method, params) {
  const id = ++idc;
  srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("timeout " + method)); } }, 30000);
  });
}
srv.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m); pending.delete(m.id); }
  }
});

const init = await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.1" },
});
console.log("initialize ok:", init.result?.serverInfo?.name, init.result?.serverInfo?.version);
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const tools = await send("tools/list", {});
console.log("tools:", tools.result.tools.map((t) => t.name).join(", "));

const stats = await send("tools/call", { name: "shaniu_stats", arguments: {} });
console.log("shaniu_stats:", stats.result.content[0].text.slice(0, 400));

const claim = await send("tools/call", { name: "shaniu_prepare_claim", arguments: { address: "0x51872254046bf76bf71dc941896943293d45624f" } });
console.log("shaniu_prepare_claim:", claim.result.content[0].text.slice(0, 300));

const orders = await send("tools/call", { name: "shaniu_market_orders", arguments: { limit: 3 } });
console.log("shaniu_market_orders:", orders.result.content[0].text.slice(0, 500));

const inv = await send("tools/call", { name: "shaniu_invite_stats", arguments: {} });
console.log("shaniu_invite_stats:", inv.result.content[0].text.slice(0, 300));

srv.kill();
console.log("SMOKE OK");
process.exit(0);
