const fs = require('node:fs');

const [currentPath, sourcePath, bindingsPath, outputPath, boundaryPath] = process.argv.slice(2);
if (![currentPath, sourcePath, bindingsPath, outputPath, boundaryPath].every(Boolean)) {
  throw new Error('Usage: node prepare-cloudflare-worker-upload.cjs <current> <source> <bindings-json> <output> <boundary-output>');
}

const current = fs.readFileSync(currentPath, 'utf8');
const source = fs.readFileSync(sourcePath, 'utf8');
const bindingsResponse = JSON.parse(fs.readFileSync(bindingsPath, 'utf8'));
const existingBindings = Array.isArray(bindingsResponse.result)
  ? bindingsResponse.result
  : bindingsResponse.result?.bindings;
if (!Array.isArray(existingBindings)) throw new Error('Worker binding metadata is unavailable.');
const bindings = existingBindings.map((binding) => (
  binding.type === 'secret_text'
    ? { type: 'inherit', name: binding.name }
    : binding
));

const boundaryMatch = current.match(/^--([^\r\n]+)\r?\n/);
if (!boundaryMatch) throw new Error('Unable to detect multipart boundary.');
const boundary = boundaryMatch[1];
const headerEnd = current.indexOf('\r\n\r\n');
const trailingMarker = `\r\n--${boundary}--`;
const trailingIndex = current.lastIndexOf(trailingMarker);
if (headerEnd < 0 || trailingIndex < 0 || trailingIndex <= headerEnd) {
  throw new Error('Current multipart Worker payload does not contain a single replaceable module.');
}

const metadata = JSON.stringify({
  main_module: 'worker-v3.js',
  compatibility_date: '2024-01-01',
  usage_model: 'standard',
  bindings,
});
const metadataPart = [
  `--${boundary}`,
  'Content-Disposition: form-data; name="metadata"',
  'Content-Type: application/json',
  '',
  metadata,
  '',
].join('\r\n');
const modulePart = `${current.slice(0, headerEnd + 4)}${source}${current.slice(trailingIndex)}`;
const next = `${metadataPart}${modulePart}`;
fs.writeFileSync(outputPath, next, { mode: 0o600 });
fs.writeFileSync(boundaryPath, boundary, { mode: 0o600 });
process.stdout.write(`Prepared ${Buffer.byteLength(next)} byte Worker multipart upload with ${bindings.length} preserved bindings.\n`);
