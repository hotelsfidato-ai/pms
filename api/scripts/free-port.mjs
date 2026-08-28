import { execSync } from "node:child_process";

/* ══════════════════════════════════════════════════════════════════
   FREE THE PORT BEFORE STARTING

   Twice during CP9 a restart failed with EADDRINUSE, the error went
   into a log nobody was tailing, and the OLD process kept answering.
   Correct query output was read as wrong for an hour because the
   process serving it predated the fix.

   `pkill -f "tsx src/server.ts"` does not reliably kill it on Windows,
   which is why it kept happening. The port is the thing that matters,
   so the port is what this looks at.

   Used by `npm run serve`. `npm run dev` uses `tsx watch`, which
   reloads on edit and does not have this problem in the first place.
   ══════════════════════════════════════════════════════════════════ */

const PORT = Number(process.env.PORT ?? 8787);

function pidsOnPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} ` +
          `-State Listen -ErrorAction SilentlyContinue | ` +
          `Select-Object -ExpandProperty OwningProcess -Unique"`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out.split(/\s+/).filter(Boolean).map(Number);
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    /* Nothing listening — which is the good case. */
    return [];
  }
}

const pids = pidsOnPort(PORT);

if (pids.length === 0) {
  process.exit(0);
}

for (const pid of pids) {
  try {
    process.kill(pid, "SIGKILL");
    console.log(`  freed port ${PORT} (was held by pid ${pid})`);
  } catch (error) {
    console.error(
      `  Could not free port ${PORT}: pid ${pid} — ${error.message}\n` +
        `  Start it anyway and you will be testing the OLD code.`,
    );
    process.exit(1);
  }
}

/* Killing is asynchronous; the socket takes a moment to release, and
   starting into a half-closed port reproduces the exact failure this
   script exists to prevent. */
await new Promise((resolve) => setTimeout(resolve, 400));
