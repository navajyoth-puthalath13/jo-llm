// Kill switch CLI: npm run jo -- on | off | status
import { KILL_SWITCH_KEY } from "../src/guard/killswitch";
import { kvArgs, wrangler } from "./wrangler";

const cmd = process.argv[2];

switch (cmd) {
  case "on":
  case "off": {
    wrangler(kvArgs("put", KILL_SWITCH_KEY, cmd === "on" ? "true" : "false"), { capture: true });
    console.log(`Jo is ${cmd.toUpperCase()}. Edge caches pick this up within ~30 seconds.`);
    break;
  }
  case "status": {
    let value = "";
    try {
      value = wrangler(kvArgs("get", KILL_SWITCH_KEY), { capture: true }).trim();
    } catch {
      value = "";
    }
    const on = value === "true";
    console.log(`Jo is ${on ? "ON" : "OFF"} (KV ${KILL_SWITCH_KEY} = ${value ? JSON.stringify(value) : "not set"})`);
    console.log("Note: JO_FORCE_OFF=true in wrangler.toml overrides this.");
    break;
  }
  default:
    console.error("Usage: npm run jo -- on | off | status");
    process.exit(1);
}
