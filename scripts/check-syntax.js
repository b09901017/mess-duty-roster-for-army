#!/usr/bin/env node
/* 把 js/、api/、scripts/ 底下的每個檔案都丟給 node --check，抓語法錯 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS = ["js", "api", "scripts"];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  });
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d), []));
let failed = 0;

files.forEach((file) => {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failed++;
    console.error(`✗ ${path.relative(ROOT, file)}`);
    console.error(String(err.stderr || err.message).trim());
  }
});

console.log(`檢查 ${files.length} 個檔案，${failed} 個有語法錯誤`);
process.exit(failed ? 1 : 0);
