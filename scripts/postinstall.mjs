#!/usr/bin/env node

/**
 * npm install -g 后自动安装 skill 到所有已检测的 AI 编码工具
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
