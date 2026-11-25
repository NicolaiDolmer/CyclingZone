import { readFileSync } from "node:fs";

// Agent shell commands use the merge queue for branch updates.
let command;
try { command = JSON.parse(readFileSync(0, "utf8")).tool_input?.command; }
catch { process.exit(0); }
if (typeof command !== "string") process.exit(0);
const directCli = /(?:^|[;&|{(\r\n])[ \t]*(?:(?:do|then|command)[ \t]+)?[\x22\x27]?gh(?:\.exe)?[\x22\x27]?[ \t]+(?:@\([ \t]*)?[\x22\x27]?pr[\x22\x27]?(?:[ \t]+|[ \t]*,[ \t]*)[\x22\x27]?update-branch\b/i;
const directApi = /(?:^|[;&|{(\r\n])[ \t]*(?:(?:do|then|command)[ \t]+)?[\x22\x27]?gh(?:\.exe)?[\x22\x27]?[ \t]+(?:@\([ \t]*)?[\x22\x27]?api\b[^\r\n;&|]*\/pulls\/[^ \t\r\n;&|]+\/update-branch\b/i;
if (!directCli.test(command) && !directApi.test(command)) process.exit(0);
console.error("BLOCKED: PR branch updates go through merge-queue.ps1. It checks the front of the queue, required check failure and the shared update reservation.");
process.exit(2);
