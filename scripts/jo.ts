// Kill switch and mode CLI: npm run jo -- on | off | test | normal | status
import { KILL_SWITCH_KEY } from "../src/guard/killswitch";
import { MODE_KEY } from "../src/guard/mode";
import { kvArgs, wrangler } from "./wrangler";

function run(cmd: string | undefined) {
  switch (cmd) {
    case "on":
    case "off": {
      wrangler(kvArgs("put", KILL_SWITCH_KEY, cmd === "on" ? "true" : "false"), { capture: true });
      console.log(`Jo is ${cmd.toUpperCase()}. Edge caches pick this up within ~30 seconds.`);
      break;
    }
    case "test":
    case "normal": {
      wrangler(kvArgs("put", MODE_KEY, cmd), { capture: true });
      console.log(`Jo is in ${cmd.toUpperCase()} mode. Takes effect within ~30 seconds.`);
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
      let mode = "";
      try {
        mode = wrangler(kvArgs("get", MODE_KEY), { capture: true }).trim();
      } catch {
        mode = "";
      }
      console.log(`Mode: ${mode === "test" ? "TEST (Jo's own limits lifted)" : "NORMAL"}`);
      console.log("Note: JO_FORCE_OFF=true in wrangler.toml overrides the on/off switch.");
      break;
    }
    default:
      console.error("Usage: npm run jo -- on | off | test | normal | status");
      process.exit(1);
  }
}

try {
  run(process.argv[2]);
} catch {
  console.error("\nThat didn't work. Check you're logged in (npx wrangler login) and that the KV id in wrangler.toml is set.");
  process.exit(1);
}
