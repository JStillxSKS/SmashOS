const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const outputDir = path.join(__dirname, "..", "release");

function sleep(ms) {
  try {
    execSync(`powershell -NoProfile -Command "Start-Sleep -Milliseconds ${ms}"`, {
      stdio: "ignore",
    });
  } catch {
    /* ignore */
  }
}

function tryKillLocks() {
  if (process.platform !== "win32") return;
  for (const image of ["electron.exe", "Smash Drums Editor.exe"]) {
    try {
      execSync(`taskkill /F /IM ${image} /T 2>nul`, { stdio: "ignore" });
    } catch {
      /* not running */
    }
  }
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return true;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return true;
    } catch {
      sleep(400);
    }
  }
  return false;
}

tryKillLocks();
sleep(300);

for (const name of ["win-unpacked.tmp", "win-unpacked"]) {
  const target = path.join(outputDir, name);
  if (!removeDir(target)) {
    console.warn(`Warning: could not fully remove ${target}`);
  }
}

fs.mkdirSync(outputDir, { recursive: true });
console.log(`Release output: ${outputDir}`);