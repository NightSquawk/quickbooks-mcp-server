# NightSquawk dependency metadata patch for node-quickbooks

This private vendored package contains the unmodified runtime and TypeScript
declarations from [`node-quickbooks@2.0.50`](https://www.npmjs.com/package/node-quickbooks/v/2.0.50),
maintained upstream at <https://github.com/mcohen01/node-quickbooks>.
The package is bundled as a local tarball dependency in the NightSquawk MCP server;
it is not published separately and does not modify the upstream repository.

## Changes in 2.0.50-nst.1

Only the package metadata and this notice are changed. The dependency manifest
carries the security fixes that were previously root-level npm overrides:

- `fast-xml-parser`: `^4.3.2` → `^5.10.1`
- `underscore`: `1.12.1` → `^1.13.8`
- `uuid`: `^8.3.2` → `11.1.1` (retains CommonJS support)

Putting these constraints in this dependency's manifest preserves them when the
MCP server is installed by another project. Root-level npm overrides are not
inherited by consumers. Development dependencies, test scripts, examples, and
credential-based upstream tests are omitted from this runtime package.

## Provenance and license

The original npm archive is
<https://registry.npmjs.org/node-quickbooks/-/node-quickbooks-2.0.50.tgz>,
with integrity:

```
sha512-9Pd29th8gRHXoUfrBcXSmCa3rXtrXUHQLT0GQpTn/gW+4vK5hfNndFhXDPJpsr7wCvFqzG+meBtEvot1WzO+kA==
```

`index.js` and `index.d.ts` are byte-for-byte copies of that release. Its manifest
declares the ISC license, and its runtime header credits Michael Cohen, 2014.
The included `LICENSE` supplies the standard ISC license text with that notice.
The original copyright and license header remains intact in `index.js`.

Remove this vendored copy when an upstream release includes compatible secure
dependency versions and passes the packaged-consumer security checks.
