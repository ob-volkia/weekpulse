// Talk to Obsidian on the iPhone through the CDP bridge (pymobiledevice3 webinspector cdp).
//   node tools/phone.mjs eval "<js expression>"
//   node tools/phone.mjs shot out.png        (if the bridge supports Page.captureScreenshot)
import { writeFileSync } from "fs";

const [cmd, arg] = process.argv.slice(2);
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((p) => p.url.startsWith("capacitor://")) ?? list[0];
if (!page) { console.error("No inspectable Obsidian page. Is the phone unlocked with Obsidian open?"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => (ws.onopen = r));
const timer = setTimeout(() => { console.error("timeout"); ws.close(); setTimeout(() => process.exit(2), 200); }, 20000);
if (cmd === "eval") {
  const r = await send("Runtime.evaluate", { expression: arg, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) console.error(JSON.stringify(r.error ?? r.result.exceptionDetails, null, 1));
  else console.log(typeof r.result.result.value === "string" ? r.result.result.value : JSON.stringify(r.result.result.value, null, 1));
} else if (cmd === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.error) console.error(JSON.stringify(r.error));
  else { writeFileSync(arg, Buffer.from(r.result.data, "base64")); console.log("saved", arg); }
}
clearTimeout(timer);
ws.close();
process.exit(0);
