import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { packageRelease } from './package-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const scratch = mkdtempSync(path.join(tmpdir(), 'qbo-package-'));
const npm = (args, cwd) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
});

try {
  const artifact = packageRelease(scratch);
  for (const file of artifact.files) {
    assert(!/(^|\/)(\.env(?:\..*)?|\.qbo-tokens.*|tokens\.json)$/.test(file.path), `Credential file packed: ${file.path}`);
  }
  const consumer = path.join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(path.join(consumer, 'package.json'), '{"name":"qbo-package-verification","version":"1.0.0","private":true}\n');
  npm(['install', '--no-audit', '--no-fund', '--cache', path.join(scratch, 'empty-cache'), path.join(scratch, artifact.filename)], consumer);
  npm(['ls', '--all'], consumer);
  process.stdout.write(npm(['audit', '--omit=dev', '--audit-level=high'], consumer));
  const consumerRequire = createRequire(path.join(consumer, 'package.json'));
  const entry = consumerRequire.resolve(manifest.name);
  const installedRoot = path.dirname(path.dirname(entry));
  const installedRequire = createRequire(entry);
  for (const name of ['intuit-oauth', 'node-quickbooks']) {
    const source = path.join(root, 'vendor', name);
    const installed = path.dirname(installedRequire.resolve(`${name}/package.json`));
    // Compare the shipped runtime and notices with the readable source in Git.
    for (const file of readdirSync(source, { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue;
      const relative = path.relative(source, path.join(file.parentPath, file.name));
      assert(readFileSync(path.join(installed, relative)).equals(readFileSync(path.join(source, relative))), `Stale vendored archive: ${name}/${relative}`);
    }
  }
  const lock = readFileSync(path.join(consumer, 'package-lock.json'), 'utf8');
  assert(!/node_modules\/(query-string|decode-uri-component)"/.test(lock), 'Vulnerable OAuth dependency chain returned');

  // Exercise the installed CLI with dummy credentials, without any QuickBooks calls.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(QUICKBOOKS_|QBO_)/.test(key)) delete env[key];
  Object.assign(env, {
    QUICKBOOKS_CLIENT_ID: 'package-test', QUICKBOOKS_CLIENT_SECRET: 'package-test',
    QUICKBOOKS_TOKEN_STORE_PATH: path.join(scratch, 'unused-tokens.json'), QBO_AUTO_REAUTH: 'false',
  });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: consumer, env, stderr: 'pipe' });
  const client = new Client({ name: 'package-verification', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion().version, manifest.version);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 160);
    assert.equal(tools.filter(tool => tool.name.startsWith('report_')).length, 29);
    assert.equal(JSON.parse(readFileSync(path.join(installedRoot, 'package.json'), 'utf8')).version, manifest.version);
  } finally {
    await client.close();
    await transport.close();
  }
  console.log(`Verified ${manifest.name}@${manifest.version}: consumer dependencies, vendor source, audit, and 160 MCP tools.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
