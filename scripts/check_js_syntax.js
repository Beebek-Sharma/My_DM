#!/usr/bin/env node
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/check_js_syntax.js <file.js>');
  process.exit(2);
}

try {
  const code = fs.readFileSync(file, 'utf8');
  // Compile without executing
  new Function(code);
  console.log(`OK: ${file}`);
} catch (e) {
  console.error(`Syntax error in ${file}: ${e.message}`);
  process.exit(1);
}
