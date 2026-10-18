const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WEBSITE = path.resolve(__dirname, '..', '..');

const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 6_500_000;
const BINARY = new Set(['.webp', '.mp4', '.woff2', '.png', '.ico']);
const ASSET_EXTENSIONS = new Set(['.webp', '.mp4', '.woff2', '.svg', '.png', '.ico', '.webmanifest', '.json', '.txt']);
const PNG_ALLOWED = /^assets\/(og\.png|icons\/[^/]+\.png)$/;
const ABSOLUTE_PATH = /\/[U]sers\/|\/[t]mp\/|\/opt\/[h]omebrew|\/[h]ome\/[a-z]|\/[p]rivate\/var\/|C:\\[U]sers/;
const SECRETS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['OpenAI/Anthropic-style key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Cloudflare/account-style 32-hex id', /\b[0-9a-f]{32}\b/],
  ['bearer/api token assignment', /\b(?:api[_-]?key|api[_-]?token|secret|password|CLOUDFLARE_API_TOKEN)\s*[:=]\s*['"][^'"\s]{8,}/i],
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EMAIL_ALLOWED = /^poster@[123]x\.png$/;

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'], {
  cwd: WEBSITE,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .filter((file) => fs.existsSync(path.join(WEBSITE, file)));

const failures = [];
let total = 0;
let largest = { file: '', size: 0 };
for (const file of files) {
  const absolute = path.join(WEBSITE, file);
  const size = fs.statSync(absolute).size;
  total += size;
  if (size > largest.size) largest = { file, size };
  if (size > MAX_FILE_BYTES) failures.push(`${file}: ${size} bytes exceeds ${MAX_FILE_BYTES}`);
  const extension = path.extname(file);
  if (file.startsWith('assets/')) {
    if (!ASSET_EXTENSIONS.has(extension)) failures.push(`${file}: unexpected asset type ${extension}`);
    if (extension === '.png' && !PNG_ALLOWED.test(file)) failures.push(`${file}: raw PNG outside og/icons`);
  }
  if (BINARY.has(extension)) continue;
  const text = fs.readFileSync(absolute, 'utf8');
  text.split('\n').forEach((line, index) => {
    const where = `${file}:${index + 1}`;
    if (ABSOLUTE_PATH.test(line)) failures.push(`${where}: absolute local path`);
    for (const [name, pattern] of SECRETS) if (pattern.test(line)) failures.push(`${where}: possible ${name}`);
    for (const email of line.match(EMAIL) || [])
      if (!EMAIL_ALLOWED.test(email)) failures.push(`${where}: email-like string ${email}`);
  });
}

console.log(`files ${files.length}, total ${total} bytes, largest ${largest.file} (${largest.size} bytes)`);
if (total > MAX_TOTAL_BYTES) failures.push(`total ${total} bytes exceeds ${MAX_TOTAL_BYTES}`);
if (failures.length) {
  console.log(`FAIL scan: ${failures.length} finding(s)`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('PASS scan');
}
