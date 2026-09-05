import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
const root = "/Users/innovdia/Development/carwashpro";
const baseline = "/tmp/tetamu-phase3-baseline.Y5JXB7";
const output = "/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs";
const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex");
const files = [...new Set(execFileSync("git",["ls-files","--cached","--others","--exclude-standard","-z"],{cwd:root,encoding:"utf8"}).split("\0").filter(Boolean))];
const start = [], changed = [], added = [], missing = [];
for (const file of files) {
  const before=path.join(baseline,file),after=path.join(root,file);
  if(existsSync(before)&&statSync(before).isFile()){
    const original=hash(before);start.push({file,sha256:original});
    if(!existsSync(after))missing.push(file);else if(hash(after)!==original)changed.push(file);
  } else added.push(file);
}
const allowed = ["docs/environment-variable-contract.md","src/lib/performance/read.ts","src/lib/attendance/employee-auth/session.ts","src/lib/staff-pwa/client.ts","src/components/staff-pwa/staff-home-overview.tsx","src/app/staff/page.tsx","src/middleware.ts"];
const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
writeFileSync(`${output}/performance-phase3-baseline.json`,JSON.stringify({root,baseline,head,excluded:".env* (including .env.example), uploads, build caches, dependencies and git internals were not copied",files:start},null,2));
const result={head,checked:start.length,unchanged:start.length-changed.length-missing.length,changed,missing,newOrExcluded:added,unexpected:changed.filter(f=>!allowed.includes(f))};
writeFileSync(`${output}/performance-phase3-protection.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({checked:result.checked,unchanged:result.unchanged,changed,missing,unexpected:result.unexpected}));
if(missing.length||result.unexpected.length)process.exitCode=1;
