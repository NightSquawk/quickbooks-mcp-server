# NightSquawk Tech QuickBooks MCP Server

`@nightsquawktech/quickbooks-mcp-server` is NightSquawk Tech's fork of [Intuit's QuickBooks Online MCP server](https://github.com/intuit/quickbooks-online-mcp-server). It runs locally over stdio for Claude, Cursor, and other MCP clients.

The server exposes **160 tools**: 131 entity/utility tools and our existing **29 `report_*` tools**. This fork keeps its JSON token store, report interface, catalog work, npm package identity, and publishing workflow while incorporating upstream's expanded tools and fixes.

## Setup

```bash
git clone https://github.com/NightSquawk/quickbooks-mcp-server.git
cd quickbooks-mcp-server
npm ci
cp .env.example .env
```

Create an app in the [Intuit Developer Portal](https://developer.intuit.com/), then fill in the static app credentials in `.env`:

```dotenv
QUICKBOOKS_CLIENT_ID=your_client_id
QUICKBOOKS_CLIENT_SECRET=your_client_secret
QUICKBOOKS_ENVIRONMENT=sandbox
QUICKBOOKS_REDIRECT_URI=http://localhost:8000/callback
```

Register the matching redirect URI in your Intuit app. Use credentials for the selected sandbox or production environment.

Sandbox authorization supports HTTP loopback `/callback` URLs on `localhost`, `127.0.0.1`, or `[::1]` and listens on the configured port. The default is `http://localhost:8000/callback`; for example, `http://127.0.0.1:8123/callback` uses port 8123. Unsupported callback URLs, including OAuth Playground URLs, are rejected explicitly. Callback URLs must not contain credentials, query parameters, or fragments.

## Authentication

```bash
npm run auth
```

This explicitly starts browser authorization, even if an existing token can still be refreshed. If no browser is available, the authorization URL is printed to stderr. The OAuth callback validates a random state value and exchanges each authorization code only once.

Static credentials remain in `.env` or the process environment; explicitly provided process variables take precedence. The server resolves `.env` relative to the installed package, independent of its working directory. It never writes rotating tokens into `.env`.

The refresh token and realm ID are stored atomically in the gitignored `.qbo-tokens.json`. Access tokens stay in memory and are refreshed ahead of expiry. Concurrent calls share the refresh operation; a rejected refresh can retry a newer token saved by another process.

For an unattended installation, set `QBO_AUTO_REAUTH=false`. Sandbox tool calls otherwise start browser authorization when needed. Production tool calls fail with reauthorization guidance instead of unexpectedly starting a local browser flow. To authorize production explicitly, configure the registered HTTPS callback and forward it to the local callback server, then run `npm run auth`.

### Existing tokens and custom storage

Existing `QUICKBOOKS_REFRESH_TOKEN` and `QUICKBOOKS_REALM_ID` values are used to initialize the JSON store when it has no saved tokens. Remove the old values from your environment after migration.

For a read-only package installation or separate company connections, set `QUICKBOOKS_TOKEN_STORE_PATH` to an absolute path to a writable **JSON token file**. Give each company connection its own file and keep it outside source control. Unlike upstream, this setting selects only token storage: it does not replace `.env` or change where static app credentials are loaded. Existing upstream env-format token files must be migrated through the environment variables above, not passed as JSON files.

## MCP client configuration

After configuring credentials and authorizing, point your MCP client at the built server:

```json
{
  "mcpServers": {
    "quickbooks": {
      "command": "node",
      "args": ["/absolute/path/to/quickbooks-mcp-server/dist/index.js"],
      "env": {
        "QBO_AUTO_REAUTH": "false"
      }
    }
  }
}
```

## Available tools

Entity tools cover customers, invoices, estimates, bills, vendors, employees, accounts, items, journal entries, bill payments, purchases, payments, sales receipts, credit memos, refund receipts, purchase orders, vendor credits, deposits, transfers, time activities, classes, departments, terms, payment methods, tax entities, company information, preferences, budgets, and attachments. Available operations depend on the entity; tax entities and budgets are read-only.

Notable additions include estimate-to-invoice links, invoice memos/service dates/payment terms, payment reference and multicurrency fields, subaccounts, and bill updates that preserve existing line-level class/tax references. Unsupported top-level parameters produce a warning instead of disappearing silently. Unsupported fields inside closed nested objects, such as invoice line items, are rejected with their field path before execution. Schemas that intentionally accept arbitrary QuickBooks fields remain open.

The existing `delete_invoice` tool name is retained for compatibility; it voids the invoice and preserves the transaction record.
The payment, credit-memo, sales-receipt, refund-receipt, and estimate delete tools perform deletion and are described accordingly.

### Restriction switches

All tools are enabled by default. Set any of these environment variables to the exact string `true` to suppress that category:

- `QUICKBOOKS_DISABLE_WRITE`: create tools.
- `QUICKBOOKS_DISABLE_UPDATE`: update tools.
- `QUICKBOOKS_DISABLE_DELETE`: delete tools.

Set all three for read-only QuickBooks access. Read/search/report tools remain available. These switches restrict QuickBooks operations; PDF output has a separate filesystem setting.

### Attachments and invoice PDFs

`create_attachable` accepts base64 content, an absolute local `file_path`, or an HTTPS `file_url`. Local sources default to home/temp directories; use a semicolon-separated `QUICKBOOKS_ATTACHABLE_BASE_DIR` to select other roots. Credential files, the configured JSON token store (including symlink/hard-link aliases), dot-directories, and the server installation tree are excluded. URL sources validate destinations and redirects.

`get_invoice_pdf` returns base64 by default. Disk output requires `QBO_PDF_OUTPUT_DIR` to name an existing allowed directory. Files are not overwritten unless `overwrite=true`; overwrites replace the output entry atomically without following a final-file symlink or hard link to another file.

PDF downloads stop when the decoded response exceeds 50 MiB, including compressed or chunked responses. Set `QBO_PDF_MAX_BYTES` to a positive integer to change this limit. This bounds the downloaded body; buffering and base64 encoding require additional memory.

### Report tools (29 reports)

Run QuickBooks financial reports via `report_*` tools. All accept optional date range/filter parameters.

**Financial Statements:**
- `report_balance_sheet` - Balance Sheet
- `report_profit_and_loss` - Profit and Loss (Income Statement)
- `report_profit_and_loss_detail` - Profit and Loss with transaction detail
- `report_trial_balance` - Trial Balance
- `report_cash_flow` - Statement of Cash Flows

**Sales & Income:**
- `report_customer_sales` - Sales by Customer
- `report_item_sales` - Sales by Product/Service
- `report_customer_income` - Income by Customer
- `report_department_sales` - Sales by Department
- `report_class_sales` - Sales by Class

**Customer Reports:**
- `report_customer_balance` - Customer Balance Summary
- `report_customer_balance_detail` - Customer Balance Detail
- `report_aged_receivables` - A/R Aging Summary
- `report_aged_receivable_detail` - A/R Aging Detail

**Vendor Reports:**
- `report_vendor_balance` - Vendor Balance Summary
- `report_vendor_balance_detail` - Vendor Balance Detail
- `report_aged_payables` - A/P Aging Summary
- `report_aged_payable_detail` - A/P Aging Detail
- `report_vendor_expenses` - Expenses by Vendor

**Transaction & Ledger Reports:**
- `report_transaction_list` - Transaction List
- `report_transaction_list_with_splits` - Transaction List with Splits
- `report_transaction_list_by_customer` - Transaction List by Customer
- `report_transaction_list_by_vendor` - Transaction List by Vendor
- `report_general_ledger` - General Ledger Detail
- `report_journal` - Journal Report

**Other:**
- `report_inventory_valuation_summary` - Inventory Valuation Summary
- `report_account_list` - Account List Detail
- `report_trial_balance_fr` - Trial Balance (France only)
- `report_tax_summary` - Tax Summary (France only)

The upstream `get_*` report aliases are not registered. Existing clients should continue using `report_*`. Balance sheets with only an `end_date` also send January 1 of that year as `start_date`, following upstream's date-handling correction.

## Development and validation

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:coverage -- --runInBand
npm audit --omit=dev --audit-level=high
```

CI runs build, lint, and tests on Linux and Windows with Node.js 22. Unit tests mock QuickBooks and do not contact a live company. The catalog JSON and `CATALOG_REFACTOR_PLAN.md` remain development resources; they do not register additional tools.

Changes and releases belong to [NightSquawk/quickbooks-mcp-server](https://github.com/NightSquawk/quickbooks-mcp-server). Intuit's repository is an upstream source only.

## Dependency maintenance and releases

Node.js 22 or later is required. Version 0.1.0 includes NightSquawk-maintained copies of `intuit-oauth@4.2.5-nst.1` and `node-quickbooks@2.0.50-nst.1`. The OAuth patch replaces `query-string` and its vulnerable decoder with native URL parsing, following the approach proposed in [Intuit OAuth PR #218](https://github.com/intuit/oauth-jsclient/pull/218), while retaining callback and encoding compatibility. The QuickBooks client escapes backslashes before quotes in structured query values; its dependency manifest carries the secure versions previously enforced only by root-level overrides.

Readable source, licenses, and provenance are in `vendor/`. Run `npm run vendor:pack` after editing those sources, then explicitly reinstall both archive paths (`npm install ./vendor/intuit-oauth-4.2.5-nst.1.tgz ./vendor/node-quickbooks-2.0.50-nst.1.tgz`) to update their integrity in the lockfile. Development installs use the committed local archives. `npm run package:release` builds a separate publishable archive in `release/`, with those patched packages and their runtime dependencies bundled under exact versions. Publish that archive; a raw `npm pack` of the checkout is not a release artifact. `npm run verify:package` installs the staged release archive in an empty consumer project with an empty npm cache, checks the shipped source and dependency tree, runs its production audit, and verifies all 160 tools over MCP. CI runs this check on Linux and Windows. Repository and packaged-consumer production audits remain blocking for high/critical findings; development-only findings are tracked separately.

Release tags use `v<package.json version>`. The publishing workflow repeats validation before publishing with npm provenance and OIDC. Initial publication requires an authorized npm publisher; subsequent trusted publishing must be configured for this repository and `.github/workflows/publish.yml`. These local patches can be removed after compatible upstream releases pass the same checks. All changes and releases remain under NightSquawk.

Coverage now includes the full tool surface loaded by startup/MCP contract tests. `jest.config.js` records the broader measured baseline and stricter gates for authentication, token storage, PDF handling, and the report runner. Upstream's historical 100% claim covered a smaller set of imported modules.
