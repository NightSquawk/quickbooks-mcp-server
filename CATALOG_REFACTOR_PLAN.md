# QuickBooks MCP — Catalog Refactor Plan

**Status:** In progress — **Phase 3 (entity definition files) COMPLETE**; Phases 1, 2, 4 pending.
**Goal owner:** Kevin · **Author:** Claude · **Date:** 2026-06-20

> Phase 3 done (2026-06-20): 11 rich entity specs authored + adversarially verified +
> written to `src/catalog-entities/entities/*.json` (345 field defs total), plus the
> aggregate `src/catalog-entities/index.json`. All parse, all operations match §6,
> 0 slug mismatches.

---

## 1. Goal

Convert the QuickBooks Online MCP server from **79 hand-coded tools** (50 entity-CRUD
tool files + 29 factory-generated report tools) to the **catalog / spec-driven**
format already proven in the `appfolio-mcp-server`: a small set of **generic tools
driven by JSON definition files**.

Target: **79 tools → 6 generic tools**, backed by per-report and per-entity JSON
spec files that *are* the API surface.

### Why (two independent wins)

1. **Context-cost & tool-selection.** 79 tool schemas load into every LLM context.
   Collapsing to 6 generic tools sharply cuts token cost and improves tool
   selection. (This is the exact rationale AppFolio's own code comments cite.)
2. **Specs-as-files / house-style.** The JSON definition files become the single,
   inspectable, version-controlled "API surface", matching the AppFolio house
   style across the MCP server fleet.

### Decisions locked (by Kevin, 2026-06-20)

| Decision | Choice |
|---|---|
| Scope | **Full** — both reports **and** entities. |
| Entity catalog richness | **Rich field-level specs, hand-authored** (no machine-readable QBO source exists — see §3). |
| Sequencing | Reports first (template), then entities. |

### Non-goals (this pass)

- No change to OAuth / `quickbooks-client.ts` auth flow.
- No change to the underlying `node-quickbooks` calls — only how they are dispatched.
- Expanding beyond the current 11 entities is an **optional follow-on** (see §9), not core scope.

---

## 2. Source-of-truth facts established during study

- **AppFolio pattern** = two trios of generic tools over two JSON catalogs:
  - Reporting: `list_reports` / `describe_report` / `run_report` + `src/catalog/reports/*.json` (137 files) + `index.json`.
  - Database/CRUD: `list_endpoints` / `describe_endpoint` / `call_endpoint` + `src/catalog-db/endpoints/*.json` (156 files) + `index.json`.
  - Loader (`report-spec.ts` / `endpoint-spec.ts`): reads JSON, caches, path-traversal guard (`/^[a-z0-9_]+$/`), spec-based validation (required hard-enforced, field/enum advisory).
  - `RegisterTool`, `ToolDefinition`, `ToolResponse`, lazy client, `formatError` — **identical house scaffolding already present in QuickBooks**. Reuse as-is.
- **QuickBooks reports** already have a single source of truth: `REPORT_CONFIGS` (`src/helpers/report-configs.ts`) + composable zod fragments (`src/helpers/report-schemas.ts`) + generic dispatch `runQuickbooksReport(methodName, options)` (`src/handlers/run-quickbooks-report.handler.ts`). → Report catalog can be **generated**, not authored.
- **QuickBooks entities** have **no machine-readable field source**: `node-quickbooks` is 2,723 lines of pure method wrappers (no JSON/schema), and Intuit publishes no official OpenAPI for the Accounting API — only HTML entity-reference pages + an interactive Explorer. → Rich entity specs must be **hand-authored from Intuit docs** (see §6 authoring sources).
- **Build gap:** `npm run build` is just `tsc`, which does **not** copy `.json` into `dist/`. AppFolio adds `shx cp` steps. We must do the same or the catalog is missing at runtime.

---

## 3. Target architecture

```
src/
  catalog/                         # REPORTS (mirrors AppFolio src/catalog/)
    report-spec.ts                 # types + loadIndex/loadReportSpec/cache/guards
    index.json                     # aggregate: slug, name, category, requiredFilters, paramCount
    reports/                       # 29 files — GENERATED from REPORT_CONFIGS
      balance_sheet.json
      profit_and_loss.json
      ...
  catalog-entities/                # ENTITIES (mirrors AppFolio src/catalog-db/)
    entity-spec.ts                 # types + loadEntityIndex/loadEntitySpec/cache/guards
    index.json                     # aggregate: entity, name, category, operations[], description
    entities/                      # 11 files — HAND-AUTHORED rich field specs
      customer.json
      invoice.json
      ...
  tools/                           # ONLY the 6 generic tools after migration
    list-reports.tool.ts
    describe-report.tool.ts
    run-report.tool.ts
    list-entities.tool.ts
    describe-entity.tool.ts
    call-entity.tool.ts
  handlers/
    run-quickbooks-report.handler.ts   # KEEP (reused by run_report)
    call-quickbooks-entity.handler.ts  # NEW — generic CRUD dispatch
  helpers/
    register-tool.ts                   # KEEP unchanged
    register-report-tools.ts           # REWRITE — register the 3 report tools
    register-entity-tools.ts           # NEW — register the 3 entity tools
    build-quickbooks-search-criteria.ts# KEEP (reused by call_entity search)
    format-error.ts                    # KEEP
    generate-report-catalog.ts         # NEW — one-time generator (dev only, not shipped)
  clients/quickbooks-client.ts         # KEEP unchanged
  types/
    tool-definition.ts                 # KEEP
    tool-response.ts                   # KEEP
    node-quickbooks.d.ts               # KEEP
    report-config.ts                   # KEEP (used by the generator)
  index.ts                             # REWRITE — call registerAllReportTools + registerAllEntityTools only
```

**Deleted after migration (~100 files):**
- All 50 `src/tools/*.tool.ts` entity CRUD files.
- All 50 `src/handlers/*-quickbooks-*.handler.ts` entity files (generic handler replaces them).
- `src/helpers/report-handler-factory.ts` and `src/helpers/report-configs.ts` *after* they have been consumed by the generator (keep `report-configs.ts` until the catalog JSON is generated and committed; then it is dev-only — decide keep-vs-delete in Phase 4).

---

## 4. The 6 generic tools — contracts

### Reports (clone AppFolio 1:1)

- **`list_reports`** — args: `{ category?: string }`. Returns slug/name/category/description/requiredFilters per report + the category list + universal params.
- **`describe_report`** — args: `{ report_name: string }`. Returns the full param spec + requestSample for one report. Fuzzy "did you mean" on miss.
- **`run_report`** — args: `{ report_name, filters?: Record<string,any>, columns?, summarize_column_by?, ... }`. Validates report exists, required filters present, param names known (advisory enums); dispatches `runQuickbooksReport(spec.methodName, body)`.

### Entities (adapt AppFolio's DB trio to node-quickbooks method dispatch)

- **`list_entities`** — args: `{ category?: string, operation?: string }`. Returns entity/name/category/supported-operations/description.
- **`describe_entity`** — args: `{ entity: string }`. Returns operations (with method names + required inputs), rich `fields[]`, `requestSample`, search notes, and the **update rule** (QBO updates are sparse and require `Id` + `SyncToken`).
- **`call_entity`** — args:
  ```ts
  {
    entity: string,                         // "customer"
    operation: "create"|"get"|"update"|"delete"|"search",
    id?: string,                            // get / delete
    body?: any,                             // create / update (full QBO object; update needs Id+SyncToken)
    criteria?: any,                         // search → buildQuickbooksSearchCriteria
    limit?: number, offset?: number,        // search pagination (optional)
  }
  ```
  Validation (mirrors AppFolio: required hard, fields advisory):
  1. entity exists; else fuzzy suggest + "call list_entities".
  2. operation is supported by that entity; else list supported ops.
  3. required input present for the op (`id` for get/delete, `body` for create/update); else helpful error.
  4. dispatch `quickbooks[op.methodName](...)`; search routes criteria through `buildQuickbooksSearchCriteria` then `findX`.
  5. unknown body fields are **not** rejected (advisory only) — avoids false negatives on valid QBO fields.

---

## 5. JSON spec schemas (authoring contract — subagents MUST follow exactly)

### 5a. Report spec — `src/catalog/reports/<slug>.json` (GENERATED)

```jsonc
{
  "slug": "balance_sheet",              // bare, snake_case, matches filename
  "name": "Balance Sheet",
  "category": "Financial Statements",   // from report-configs.ts comment groups
  "description": "…",                   // from REPORT_CONFIGS.description
  "methodName": "reportBalanceSheet",   // node-quickbooks dispatch target
  "requiredFilters": [],                // QBO reports rarely require any
  "parameters": [                       // derived from merged zod fragments
    { "name": "start_date", "type": "string", "required": false, "format": "YYYY-MM-DD", "description": "…" },
    { "name": "accounting_method", "type": "string", "required": false, "enum": ["Cash","Accrual"], "description": "…" }
  ],
  "requestSample": { "start_date": "2024-01-01", "end_date": "2024-12-31" }
}
```

`index.json`:
```jsonc
{
  "generatedFrom": "REPORT_CONFIGS (src/helpers/report-configs.ts)",
  "reportCount": 29,
  "universalParameters": [],            // QBO has none global; keep for shape parity
  "reports": [ { "slug","name","category","description","requiredFilters","paramCount","methodName" } ]
}
```

### 5b. Entity spec — `src/catalog-entities/entities/<entity>.json` (HAND-AUTHORED, RICH)

```jsonc
{
  "entity": "customer",                 // bare, snake_case, matches filename
  "name": "Customer",
  "category": "Sales",                  // see §6 category map
  "description": "A customer of the QuickBooks company.",
  "operations": {
    "create": { "methodName": "createCustomer", "bodyRequired": true },
    "get":    { "methodName": "getCustomer",    "idRequired": true },
    "update": { "methodName": "updateCustomer", "bodyRequired": true, "note": "Sparse update; body must include Id and SyncToken." },
    "delete": { "methodName": "deleteCustomer", "idRequired": true },
    "search": { "methodName": "findCustomers" }
  },
  "fields": [                           // RICH — from Intuit entity reference
    { "name": "Id",          "type": "string",  "required": false, "readOnly": true,  "description": "System-assigned unique id." },
    { "name": "SyncToken",   "type": "string",  "required": false, "description": "Version; required on update." },
    { "name": "DisplayName", "type": "string",  "required": false, "description": "Name shown; must be unique." },
    { "name": "PrimaryEmailAddr", "type": "object", "required": false, "description": "…",
      "attributes": [ { "name": "Address", "type": "string", "required": false, "description": "Email." } ] },
    { "name": "Balance",     "type": "decimal", "required": false, "readOnly": true,  "description": "Open balance." }
    // … full field list per Intuit reference
  ],
  "searchableFields": ["DisplayName","Active","Balance"],   // commonly filterable via query
  "requestSample": { "create": { "DisplayName": "Acme Inc." }, "update": { "Id": "1", "SyncToken": "0", "DisplayName": "Acme LLC" } }
}
```

`index.json`:
```jsonc
{
  "generatedFrom": "Intuit QBO Accounting API entity reference",
  "entityCount": 11,
  "categories": ["Sales","Expenses","Lists","Accountant"],
  "entities": [ { "entity","name","category","description","operations": ["create","get","update","delete","search"] } ]
}
```

**Field object rules:** `name` (exact QBO PascalCase), `type` (`string|decimal|integer|boolean|date|object|array`), `required` (for create), optional `readOnly`, `enum`, `format`, `description`, and `attributes[]` for nested objects/line items (e.g. `Line`, `BillAddr`).

---

## 6. Entity inventory, operations, method map, categories

Operations come from existing tools + `node-quickbooks.d.ts`. **Preserve exactly** (do not invent ops the client lacks):

| Entity (slug) | Category | create | get | update | delete | search | node-quickbooks methods |
|---|---|:--:|:--:|:--:|:--:|:--:|---|
| customer | Sales | ✓ | ✓ | ✓ | ✓ | ✓ | create/get/update/delete/findCustomers |
| estimate | Sales | ✓ | ✓ | ✓ | ✓ | ✓ | …Estimate(s) |
| invoice | Sales | ✓ | ✓ (read) | ✓ | — | ✓ | create/get/update/findInvoices (**no delete**) |
| account | Lists | ✓ | — | ✓ | — | ✓ | create/update/findAccounts (**no get/delete**) |
| item | Lists | ✓ | ✓ (read) | ✓ | — | ✓ | create/get/update/findItems (**no delete**) |
| vendor | Expenses | ✓ | ✓ | ✓ | ✓ | ✓ | …Vendor(s) |
| employee | Lists | ✓ | ✓ | ✓ | — | ✓ | create/get/update/findEmployees (**no delete**) |
| journal_entry | Accountant | ✓ | ✓ | ✓ | ✓ | ✓ | …JournalEntry/JournalEntries |
| bill | Expenses | ✓ | ✓ | ✓ | ✓ | ✓ | …Bill(s) |
| bill_payment | Expenses | ✓ | ✓ | ✓ | ✓ | ✓ | …BillPayment(s) |
| purchase | Expenses | ✓ | ✓ | ✓ | ✓ | ✓ | …Purchase(s) |

> Note: existing Invoice/Item use `read_` naming; in the catalog these map to the **`get`** operation (method `getInvoice`/`getItem`). Confirm `getInvoice`/`getItem` exist in `node-quickbooks.d.ts` during Phase 2 (the read tools currently call them via handlers).

**Authoring sources (Intuit reference, one page per entity):**
`https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/<entity>`
(e.g. `/customer`, `/invoice`, `/bill`, `/billpayment`, `/purchase`, `/journalentry`, `/account`, `/item`, `/vendor`, `/employee`, `/estimate`).
Subagents fetch the entity page (WebFetch / Context7), extract the field table (name, type, required-for-create, read-only, enums, nested attributes), and emit the §5b JSON. Where the page is unreachable, fall back to well-known QBO fields and mark uncertain fields with a `"description"` note — **never invent field names.**

---

## 7. Spec loader & type modules (Phase 1 / Phase 2 detail)

- `report-spec.ts` / `entity-spec.ts`: copy AppFolio's structure verbatim, adjusted to QB shapes — `readFileSync` + `JSON.parse`, module-level `indexCache` + `Map` spec cache, slug guard `/^[a-z0-9_]+$/`, `loadIndex()/loadReportSpec()/isKnownReport()` (and entity equivalents).
- TypeScript interfaces: `ReportSpec`, `ReportParameter`, `ReportIndex(Entry)`; `EntitySpec`, `EntityField`, `EntityOperation`, `EntityIndex(Entry)`. Mirror `appfolio-mcp-server/src/catalog/report-spec.ts` and `catalog-db/endpoint-spec.ts`.

---

## 8. Build / packaging changes

Update `package.json` `build` script (mirror AppFolio's `shx cp`):

```
"build": "tsc && shx mkdir -p dist/catalog dist/catalog-entities && shx cp -r src/catalog/reports dist/catalog && shx cp src/catalog/index.json dist/catalog && shx cp -r src/catalog-entities/entities dist/catalog-entities && shx cp src/catalog-entities/index.json dist/catalog-entities && shx chmod +x dist/*.js"
```

Boot-time sanity check in both register helpers: throw if the relevant `index.json` is empty/missing (fail fast if the copy step didn't run) — same as AppFolio.

---

## 9. Optional follow-on (NOT in core scope)

Once the pattern is proven, the catalog makes adding entities cheap (one JSON file +
`node-quickbooks.d.ts` method decls, no new tools). Candidate QBO entities to add
later: `payment`, `sales_receipt`, `credit_memo`, `refund_receipt`, `deposit`,
`transfer`, `tax_agency`, `term`, `payment_method`, `attachable`, `time_activity`,
`budget`. Flag to Kevin separately; do not expand here.

---

## 10. Phased work breakdown (for subagents)

> **Dependency order:** Phase 1 → Phase 2 → (Phase 3 ∥ ) → Phase 4. Phase 3 is the
> big parallelizable chunk (one agent per entity). Phases 1–2 establish the template
> the subagents copy.

### Phase 1 — Reports layer (template; do first, single agent / me)
1. `src/catalog/report-spec.ts` (types + loader).
2. `src/helpers/generate-report-catalog.ts` — imports `REPORT_CONFIGS`, introspects each merged zod schema (`.shape`, `_def.typeName`, `_def.description`, enum values, `ZodOptional` ⇒ not required), writes `reports/*.json` + `index.json` per §5a. Category from the config grouping.
3. Run generator; commit the 29 JSON + index.json.
4. `src/tools/list-reports.tool.ts`, `describe-report.tool.ts`, `run-report.tool.ts` (clone AppFolio, dispatch via `spec.methodName` + `runQuickbooksReport`).
5. Rewrite `src/helpers/register-report-tools.ts` to register the 3 tools (+ boot sanity check).
6. Update `package.json` build copy step (reports portion).
7. **Acceptance:** `tsc` clean; `dist/catalog/reports` has 29 files; `list_reports`/`describe_report` return data; one `run_report` smoke test if creds available.

### Phase 2 — Entity infrastructure (single agent; after Phase 1)
1. `src/catalog-entities/entity-spec.ts` (types + loader).
2. `src/handlers/call-quickbooks-entity.handler.ts` — generic dispatch over the 5 op-shapes (reuse `buildQuickbooksSearchCriteria`, `formatError`, `quickbooksClient`).
3. `src/tools/list-entities.tool.ts`, `describe-entity.tool.ts`, `call-entity.tool.ts` per §4.
4. `src/helpers/register-entity-tools.ts` (+ boot sanity check).
5. Confirm `getInvoice`/`getItem`/`findEmployees` etc. exist in `node-quickbooks.d.ts`; add decls if missing.
6. **Acceptance:** `tsc` clean; tools register against a stub/seed catalog (1–2 entity JSONs) before Phase 3 fills the rest.

### Phase 3 — Rich entity catalogs (parallel; one agent per entity — 11 agents)
- Each agent owns one entity from §6. Inputs: this plan (§5b schema, §6 row, Intuit URL). Output: `src/catalog-entities/entities/<entity>.json` strictly conforming to §5b, plus its `index.json` entry contribution.
- Rules: exact QBO PascalCase field names; mark `readOnly`; include nested `attributes[]` (Line items, addresses); never invent fields; note `Id`+`SyncToken` on update.
- **Acceptance per file:** valid JSON; passes loader; `operations` match §6 exactly; `describe_entity` renders it.

### Phase 4 — Cleanup, wiring, verification (single agent; last)
1. Rewrite `src/index.ts` to import only `registerAllReportTools` + `registerAllEntityTools`.
2. Delete the 50 entity `*.tool.ts` + 50 entity `*.handler.ts` + `report-handler-factory.ts` (+ decide on `report-configs.ts`/`report-schemas.ts` retention — keep if generator is re-runnable; else remove).
3. Assemble `catalog-entities/index.json` from the 11 files.
4. Finalize `package.json` build copy (entities portion).
5. Update `README.md` to document the 6 generic tools + catalog layout.
6. **Acceptance:** `npm run build` clean; `dist/` contains both catalogs; server boots; exactly 6 tools register; smoke-test one report + one entity get/search (creds permitting); no dangling imports.

---

## 11. Acceptance criteria (whole project)

- [ ] `npm run build` succeeds; `dist/catalog/**` and `dist/catalog-entities/**` populated.
- [ ] Server boots and registers **exactly 6 tools**.
- [ ] `list_reports` (29) and `list_entities` (11) return correct inventories.
- [ ] `describe_report`/`describe_entity` return rich specs from JSON.
- [ ] `run_report` + `call_entity` validate inputs and dispatch correctly.
- [ ] All 50 old entity tool/handler files removed; no dead imports; `tsc` clean.
- [ ] README documents the new format.

---

## 12. Open questions for Kevin

1. **`report-configs.ts` / `report-schemas.ts` after generation:** keep (so the
   catalog stays regenerable) or delete (pure JSON source of truth)? *Recommend keep,
   marked dev-only.*
2. **Entity catalog slugs:** singular (`customer`) per AppFolio resource style —
   confirm. *Recommend singular.*
3. **Optional entity expansion (§9):** in or out for this effort? *Recommend out (separate pass).*
