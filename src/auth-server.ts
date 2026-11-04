#!/usr/bin/env node
import { quickbooksClient } from './clients/quickbooks-client.js';

async function main() {
  console.error('Starting QuickBooks OAuth flow — a browser tab will open for you to authorize.');
  console.error('Listening for callback on http://localhost:8000/callback ...');
  await quickbooksClient.startOAuthFlow();
  console.error('Done. New refresh token and realm ID saved to .qbo-tokens.json');
  process.exit(0);
}

main().catch((err) => {
  console.error('OAuth flow failed:', err);
  process.exit(1);
});
