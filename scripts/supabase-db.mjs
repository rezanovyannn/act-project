#!/usr/bin/env node
/**
 * Menjalankan perintah Supabase CLI yang butuh koneksi database proyek dev
 * (mis. `pnpm db migration list`, `pnpm db db push`), atau proyek production
 * lewat `pnpm db:prod ...` (SUPABASE_PROD_DB_URL, ADR 018).
 *
 * Kenapa perlu skrip ini: dari sebagian jaringan (ISP), hanya sebagian alamat
 * IP pooler Supabase yang dapat dijangkau, sehingga koneksi acak kadang gagal.
 * Skrip mencari IP pooler yang terjangkau lalu memakainya langsung (pooler
 * mengenali proyek dari username, bukan nama host). Password dari
 * SUPABASE_DB_URL di .env.local tidak pernah dicetak.
 */
import { spawn } from "node:child_process";
import { promises as dns } from "node:dns";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import net from "node:net";

function readEnv(name) {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = new RegExp(`^${name}=(.*)$`, "m").exec(text);
  if (!match) throw new Error(`${name} belum diisi di .env.local`);
  return match[1].trim();
}

function reachable(ip, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port, timeout: timeoutMs });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

const production = process.argv[2] === "--prod";
const args = process.argv.slice(production ? 3 : 2);
if (args.length === 0) {
  console.error("Pemakaian: pnpm db <perintah supabase> (dev) atau pnpm db:prod <perintah> (production)");
  process.exit(1);
}
if (production) console.error(">>> TARGET: DATABASE PRODUCTION <<<");

const dbUrl = new URL(readEnv(production ? "SUPABASE_PROD_DB_URL" : "SUPABASE_DB_URL"));
const password = decodeURIComponent(dbUrl.password);
const port = Number(dbUrl.port || 5432);
const ips = await dns.resolve4(dbUrl.hostname);
const results = await Promise.all(ips.map(async (ip) => ((await reachable(ip, port)) ? ip : null)));
const ip = results.find(Boolean);
if (!ip) {
  console.error(`Tidak ada IP pooler (${dbUrl.hostname}) yang dapat dijangkau dari jaringan ini.`);
  process.exit(1);
}
console.error(`Memakai pooler ${ip} (${results.filter(Boolean).length}/${ips.length} IP terjangkau)`);

const pinned = new URL(dbUrl.toString());
pinned.hostname = ip;
if (!pinned.searchParams.has("sslmode")) pinned.searchParams.set("sslmode", "require");

const redact = (chunk) => chunk.toString().split(password).join("****").split(dbUrl.password).join("****");
// Jalankan entry CLI langsung dengan Node (tanpa shell, argumen tidak diinterpretasi).
const require = createRequire(import.meta.url);
const cliPackage = require.resolve("supabase/package.json");
const cliEntry = path.join(path.dirname(cliPackage), require(cliPackage).bin.supabase);
const child = spawn(process.execPath, [cliEntry, ...args, "--db-url", pinned.toString()], {
  stdio: ["inherit", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => process.stdout.write(redact(chunk)));
child.stderr.on("data", (chunk) => process.stderr.write(redact(chunk)));
child.on("exit", (code) => process.exit(code ?? 1));
