import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vendor = fileURLToPath(new URL('../vendor/', import.meta.url));
for (const name of ['intuit-oauth', 'node-quickbooks']) {
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--pack-destination', vendor], {
    cwd: fileURLToPath(new URL(`../vendor/${name}/`, import.meta.url)),
    stdio: 'inherit',
  });
}
