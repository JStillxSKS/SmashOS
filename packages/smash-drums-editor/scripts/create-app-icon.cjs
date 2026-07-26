const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ps1 = path.join(__dirname, "create-app-icon.ps1");
execFileSync(
  "powershell",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
  { stdio: "inherit" }
);