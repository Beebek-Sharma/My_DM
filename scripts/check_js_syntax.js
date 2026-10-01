#!/usr/bin/env node
const fs = require('fs');
const { execFileSync } = require('child_process');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/check_js_syntax.js <file1.js> [file2.js ...]');
  process.exit(2);
}

let hasError = false;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['-c', file], { stdio: 'pipe' });
    console.log(`OK: ${file}`);
  } catch (e) {
    console.error(`Syntax error in ${file}: ${e.stderr ? e.stderr.toString() : e.message}`);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}
