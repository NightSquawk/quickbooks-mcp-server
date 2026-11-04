# NightSquawk security patches for node-quickbooks

This private vendored package contains the runtime and TypeScript declarations
from [`node-quickbooks@2.0.50`](https://www.npmjs.com/package/node-quickbooks/v/2.0.50),
maintained upstream at <https://github.com/mcohen01/node-quickbooks>.
The package is bundled as a local tarball dependency in the NightSquawk MCP server;
it is not published separately and does not modify the upstream repository.

## Changes in 2.0.50-nst.1

The dependency manifest carries the security fixes that were previously
root-level npm overrides:

- `fast-xml-parser`: `^4.3.2` → `^5.10.1`
- `underscore`: `1.12.1` → `^1.13.8`
- `uuid`: `^8.3.2` → `11.1.1` (retains CommonJS support)

Putting these constraints in this dependency's manifest preserves them when the
MCP server is installed by another project. Root-level npm overrides are not
inherited by consumers. Development dependencies, test scripts, examples, and
credential-based upstream tests are omitted from this runtime package.

The query runtime patch is in `criteriaToString`: escape existing backslashes
before escaping single quotes in string values, including every `IN` list item.
Without this order, a backslash immediately before a quote can neutralize the
added escape and allow the quote to end the query literal. QuickBooks uses
[backslash escaping for query literals](https://medium.com/intuitdev/deep-dive-into-quickbooks-online-data-queries-b77034bdc144).
Explicit raw query strings retain the upstream API's caller-controlled behavior.
Regression tests exercise `findCustomers` through its real request construction
with only the HTTP adapter replaced; no live QuickBooks requests are made.

`getInvoicePdf` also accepts an optional third `maxContentLength` argument.
The positive integer byte cap reaches Axios before the request starts; its HTTP
adapter aborts when decoded response bytes cross the cap, including chunked
responses and compressed PDFs. The existing two-argument call remains valid.
The MCP handler supplies its configured cap and retains a defensive final check.
Loopback HTTP regressions use the real adapter and verify connection closure
before EOF for oversized and compressed responses; they do not contact QBO.

## Provenance and license

The original npm archive is
<https://registry.npmjs.org/node-quickbooks/-/node-quickbooks-2.0.50.tgz>,
with integrity:

```
sha512-9Pd29th8gRHXoUfrBcXSmCa3rXtrXUHQLT0GQpTn/gW+4vK5hfNndFhXDPJpsr7wCvFqzG+meBtEvot1WzO+kA==
```

`index.d.ts` adds the optional PDF-limit argument. `index.js` differs only by
the marked query-escaping and PDF-limit patches above. The upstream manifest declares the ISC
license, and its runtime header credits Michael Cohen, 2014.
The included `LICENSE` supplies the standard ISC license text with that notice.
The original copyright and license header remains intact in `index.js`.

Remove this vendored copy when an upstream release includes compatible secure
dependency versions and passes the packaged-consumer security checks.
