#!/usr/bin/env node

/**
 * Auto-install skill into all detected AI coding agents after npm install -g
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillSrc = join(__dirname, '..', 'skills', 'agentos');

if (!existsSync(skillSrc)) {
  process.exit(0);
}

try {
  execFileSync('npx', ['skills', 'add', skillSrc, '-g', '-y', '--copy'], {
    stdio: 'inherit',
    timeout: 30000,
    cwd: join(__dirname, '..'),
  });
  console.log('✔ agentos skill installed via skills CLI (all detected tools)');
  process.exit(0);
} catch {
  // fallback
}

const dest = join(homedir(), '.claude', 'skills', 'agentos');
mkdirSync(dirname(dest), { recursive: true });
cpSync(skillSrc, dest, { recursive: true, force: true });
console.log(`✔ agentos skill installed to ${dest} (fallback)`);
