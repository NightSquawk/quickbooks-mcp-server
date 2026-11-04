# NightSquawk's patched Intuit OAuth client

This directory contains the runtime source and TypeScript declarations from
[`intuit-oauth@4.2.5`](https://registry.npmjs.org/intuit-oauth/-/intuit-oauth-4.2.5.tgz),
originally published by Intuit and authored by Anil Kumar. The original Apache-2.0
license and source copyright notices are retained in `LICENSE` and `src/`.

Source tarball integrity:
`sha512-Hd9es69/0dpx9XMZww5t5XKNElIk2Uo4h8bkthz5CG53nvuYz32IUu3vvx9NcRpDGTzZnD4FddSHloXKY/wzXA==`

NightSquawk version `4.2.5-nst.1` removes `query-string` and its vulnerable
`decode-uri-component` dependency. It adapts the native `URLSearchParams` approach
proposed in [Intuit OAuth PR #218](https://github.com/intuit/oauth-jsclient/pull/218)
(head `e3494ff788ed8cc86e71658801e4f8c3065ace47`). It is maintained and bundled only
within NightSquawk's project; it is not an official Intuit release.

Only `src/OAuthClient.js` has runtime changes:

- Authorization URLs retain sorted fields, `%20` spaces, strict escaping,
  omitted `undefined` fields, and bare keys for explicit `null` fields.
- Callback parsing uses native percent decoding, a null-prototype object,
  arrays for repeated keys, and `null` for bare keys. Duplicate security fields
  must still be handled consistently by the caller; NightSquawk's callback
  handler validates state and normalizes each allowed field to its first value.
- Invalid UTF-8 percent sequences follow WHATWG decoding and become replacement
  characters; invalid percent escapes remain literal. This intentionally replaces
  the vulnerable decoder's recovery behavior and does not retry malformed input.
- CommonJS exports are unchanged. The patch avoids `Object.fromEntries` to avoid
  adding a Node 12 requirement to the upstream package's declared Node 10 minimum.
  NightSquawk's own runtime requirement and CI versions remain authoritative;
  this vendored package is not independently certified for obsolete Node releases.

The package contains only runtime dependencies and no install/publish scripts.
Regression tests are in `tests/unit/clients/patched-oauth.test.ts` in the parent
project. Remove this local patch after an official compatible fix is released
and passes the same regression, packaging, and security checks.
