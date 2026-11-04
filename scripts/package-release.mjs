import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function packageRelease(destination) {
  mkdirSync(destination, { recursive: true });
  const stage = mkdtempSync(path.join(tmpdir(), 'qbo-release-'));
  const npm = args => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: stage, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    for (const file of ['package.json', 'package-lock.json', 'dist', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
      cpSync(path.join(root, file), path.join(stage, file), { recursive: true });
    }
    mkdirSync(path.join(stage, 'vendor'));
    const manifest = JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8'));
    const patched = ['intuit-oauth', 'node-quickbooks'];
    for (const name of patched) {
      const archive = manifest.dependencies[name].replace(/^file:/, '');
      cpSync(path.join(root, archive), path.join(stage, archive));
    }
    // Install from the reviewed lockfile before converting local dependency
    // specs to versions. Published bundles then have valid consumer edges and
    // never need to resolve files before the parent package is extracted.
    npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    for (const name of patched) {
      manifest.dependencies[name] = JSON.parse(readFileSync(path.join(stage, 'node_modules', name, 'package.json'), 'utf8')).version;
    }
    manifest.bundleDependencies = patched;
    manifest.files = manifest.files.filter(file => file !== 'vendor/*.tgz');
    // The archive already contains compiled code. npm 10 can still invoke
    // prepare while packing despite --ignore-scripts; build tooling belongs
    // to the checkout, not to this runtime-only staging directory.
    manifest.scripts = { auth: manifest.scripts.auth };
    delete manifest.devDependencies;
    writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', destination]));
    return Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = path.join(root, 'release');
  const artifact = packageRelease(destination);
  console.log(path.join(destination, artifact.filename));
}
