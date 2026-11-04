# QuickBooks Online MCP Server

This is a Model Context Protocol (MCP) server implementation for QuickBooks Online integration.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory with the following variables:
```env
QUICKBOOKS_CLIENT_ID=your_client_id
QUICKBOOKS_CLIENT_SECRET=your_client_secret
QUICKBOOKS_ENVIRONMENT=sandbox
```

3. Get your Client ID and Client Secret:
   - Go to the [Intuit Developer Portal](https://developer.intuit.com/)
   - Create a new app or select an existing one
   - Get the Client ID and Client Secret from the app's keys section
   - Add `http://localhost:8000/callback` to the app's Redirect URIs

## Authentication

`.env` holds only the **static** app credentials (`QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_ENVIRONMENT`) and is gitignored — copy `.env.example` to `.env` to get started. The **rotating** refresh token and realm ID are persisted separately to `.qbo-tokens.json` (also gitignored) and managed automatically. The short-lived access token is kept in memory only and re-minted on each launch.

### One-time authorization (recommended)

Run the OAuth flow once to connect your QuickBooks company:

```bash
npm run auth
```

This will:
- Start a temporary local server on `http://localhost:8000/callback`
- Open your default browser automatically
- Redirect you to QuickBooks for authentication
- Save the tokens to `.qbo-tokens.json` once authenticated
- Close automatically when complete

After that, the server keeps itself authenticated automatically: it refreshes the access token ahead of expiry and persists the rotating refresh token on every refresh. You only need to re-run `npm run auth` if the refresh token is left unused long enough to expire (100 days idle).

### Automatic re-authorization

If the refresh token is ever rejected during a tool call, the server launches the browser flow again automatically. Set `QBO_AUTO_REAUTH=false` in `.env` to disable this and instead fail fast with a message telling you to run `npm run auth` (useful for headless/unattended setups).

### Migrating from an older setup

If you already have `QUICKBOOKS_REFRESH_TOKEN` / `QUICKBOOKS_REALM_ID` in your `.env`, they are picked up once on first run and migrated into `.qbo-tokens.json`. You can delete them from `.env` afterward.

## Usage

After authentication is set up, you can use the MCP server to interact with QuickBooks Online. The server provides various tools for managing customers, estimates, bills, and more.

## Available Tools

Added tools for Create, Delete, Get, Search, Update for the following entities:


- Account
- Bill Payment
- Bill
- Customer
- Employee
- Estimate
- Invoice
- Item
- Journal Entry
- Purchase
- Vendor

### Report Tools (29 reports)

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


## Error Handling

If you see an error message like "QuickBooks not connected", make sure to:

1. Check that your `.env` file contains all required variables
2. Verify that your tokens are valid and not expired

