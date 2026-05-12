# marketplace-boilerplate-api-ui-testing — Boilerplate Test App

> For workspace-level context (architecture, data flow, all repositories), read [../CLAUDE.md](../CLAUDE.md) first.

This repository is **dual-purpose**:
1. A **React application** (the Contentstack App) that acts as the test subject for the App SDK. It implements every supported UI Location type and provides a UI to invoke SDK methods and observe their results.
2. A **Playwright E2E test suite** that automates assertions against this app once it is installed in Contentstack.

The app is installed inside Contentstack via the Developer Hub and accessed inside an `<iframe>` embedded in the Contentstack UI. The `e2e-marketplace-playwright` orchestrator interacts with it through that iframe.

---

## Critical Dependency

```json
"@contentstack/app-sdk": "file:../app-sdk"
```

This app **always uses the local `../app-sdk` directory** as its SDK. Changes to `app-sdk` are immediately reflected here after `npm install`. There is no published version involved during development and testing.

---

## Project Structure

```
marketplace-boilerplate-api-ui-testing/
├── manifest.json                 # Contentstack app manifest (UI locations, base URL)
├── playwright.config.ts          # Playwright config for this repo's own E2E tests
├── global-setup.ts               # Logs in and saves storageState.json
├── global-teardown.ts            # Cleans up data.json
├── storageState.json             # Saved browser auth (auto-generated, do not commit)
├── src/                          # React application source
│   ├── index.tsx                 # React entry point
│   ├── containers/               # Route-based UI location components (one per location type)
│   │   ├── FullPage/             # Primary testing playground for most SDK operations
│   │   ├── CustomField/          # Custom field extension
│   │   ├── AppConfiguration/     # App config modal extension
│   │   ├── DashboardWidget/      # Stack dashboard widget
│   │   ├── AssetSidebarWidget/   # Asset sidebar extension
│   │   ├── EntrySidebarWidget/   # Entry sidebar extension
│   │   ├── FieldModifier/        # Field modifier extension
│   │   ├── GlobalFullPage/       # Cross-stack full page extension
│   │   └── SdkDataErrors/        # Variant for testing SDK data validation errors
│   ├── components/               # Reusable UI components
│   │   ├── SdkTestTable/         # Table showing SDK operations and their results
│   │   ├── SdkTestCards/         # Card-based test operation UI
│   │   ├── ConfigModal/          # Configuration modal
│   │   └── Table/                # Event/result table
│   ├── common/
│   │   ├── providers/            # React context providers
│   │   │   ├── MarketplaceAppProvider.tsx   # Root: initializes SDK via ContentstackAppSDK.init()
│   │   │   ├── EntrySidebarExtensionProvider.tsx
│   │   │   ├── CustomFieldExtensionProvider.tsx
│   │   │   └── AppConfigurationExtensionProvider.tsx
│   │   ├── hooks/                # Custom React hooks
│   │   │   ├── useAppSdk.tsx     # Returns the initialized UiLocation SDK instance
│   │   │   ├── useAppConfig.ts   # Returns app configuration
│   │   │   ├── useAppLocation.ts # Returns current UI location string
│   │   │   ├── useFrame.ts       # Frame resize operations
│   │   │   ├── useEntry.tsx      # Entry context
│   │   │   ├── useSdkDataByPath.ts  # Fetch SDK data by dotted path
│   │   │   └── [10+ more hooks]
│   │   ├── contexts/             # React context definitions
│   │   └── types/                # TypeScript type definitions
│   ├── services/
│   │   └── sdk-operations/       # SDK test operation definitions (one file per category)
│   │       ├── index.ts          # Exports all operation maps
│   │       ├── core-operations.ts      # Config, location, region, version, IDs, endpoints
│   │       ├── cma-operations.ts       # Content Management API calls
│   │       ├── frame-operations.ts     # Frame/iframe resizing
│   │       ├── crud-operations.ts      # Create/Read/Update/Delete via CMA adapter
│   │       ├── api-operations.ts       # Direct HTTP API calls (GET/POST/PUT/DELETE)
│   │       ├── store-operations.ts     # Persistent store (localStorage wrapper)
│   │       ├── metadata-operations.ts  # Metadata CRUD
│   │       ├── cts-operations.ts       # Content Type Schema operations
│   │       ├── esb-operations.ts       # Entry Sidebar-specific operations
│   │       ├── asb-operations.ts       # Asset Sidebar-specific operations
│   │       ├── cf-operations.ts        # Custom Field-specific operations
│   │       ├── app-config-operations.ts # App Configuration-specific operations
│   │       ├── dashboard-operations.ts  # Dashboard widget operations
│   │       └── [more operation files]
│   └── hooks/
│       └── useSdkTesting.ts      # Core testing hook: executes SDK operations, tracks results
├── e2e/                          # This repo's own Playwright tests
│   ├── tests/
│   │   ├── app-flow.spec.ts      # Main E2E flow: creates app, content type, entry; validates SDK
│   │   └── seed.spec.ts          # Seed/template for additional tests
│   ├── pages/
│   │   ├── LoginPage.ts          # Contentstack login automation
│   │   ├── EntryPage.ts          # Entry editor page interactions
│   │   └── AssetPage.ts          # Asset management page interactions
│   └── utils/
│       ├── helper.ts             # API helpers: create app, content type, entry, asset
│       └── types.ts              # Type definitions for E2E tests
├── specs/                        # Test plan documentation (placeholder)
├── public/
│   └── logo192.png               # Used in asset upload tests
├── scripts/                      # Utility scripts
├── patches/                      # Dependency patches
└── .env                          # Environment variables (not committed)
```

---

## The React Application

### SDK Initialization
`MarketplaceAppProvider.tsx` initializes the SDK on app load:
```typescript
const sdk = await ContentstackAppSDK.init();
// sdk is a UiLocation instance
```
The SDK instance is then distributed via React context and accessed in any component via `useAppSdk()`.

### UI Location Routing
`App.tsx` uses React Router v6. Each route maps to a container component for a specific UI location:

| Route | Container | UI Location Type |
|---|---|---|
| `/#/full-page` | `FullPage` | `cs.cm.stack.full_page` |
| `/#/custom-field` | `CustomField` | `cs.cm.stack.custom_field` |
| `/#/entry-sidebar` | `EntrySidebarWidget` | `cs.cm.stack.sidebar` |
| `/#/asset-sidebar` | `AssetSidebarWidget` | `cs.cm.stack.asset_sidebar` |
| `/#/stack-dashboard` | `DashboardWidget` | `cs.cm.stack.dashboard` |
| `/#/field-modifier` | `FieldModifier` | `cs.cm.stack.field_modifier` |
| `/#/app-configuration` | `AppConfiguration` | `cs.cm.stack.config` |
| `/#/sdk-data-errors` | `SdkDataErrors` | Used to test setData validation errors |

### SDK Test Operation Framework (`useSdkTesting.ts`)
The core testing hook manages execution of SDK operations and tracks results:

- **State**: `results`, `isExecuting`, `globalError`, `executionQueue`
- **`executeOperation(operation)`**: runs a single SDK operation
- **`executeOperations(operations[])`**: runs a sequential batch
- Operations can declare `requiresPreviousResult: true` to chain on prior results
- Results are validated via optional `validateResult` function

Each operation in `src/services/sdk-operations/` follows this interface:
```typescript
{
  id: string,
  name: string,
  description: string,
  execute: async (sdk: UiLocation, context: OperationContext) => any,
  validateResult?: (result: any) => boolean,
  formatResult?: (result: any) => string,
  requiresPreviousResult?: boolean,
}
```

Operation context provides:
- `cmsInstance` — management API client (built via `sdk.createAdapter()`)
- `stackApiKey` — current stack API key
- `previousResults` — results from prior operations in a batch

### SDK Operation Categories (17 total)

| Category | File | What it tests |
|---|---|---|
| CORE | `core-operations.ts` | getConfig, getCurrentLocation, getCurrentRegion, getAppVersion, ids (orgUID, apiKey), endpoints (CMA) |
| CMA | `cma-operations.ts` | Content Management API calls |
| FRAME | `frame-operations.ts` | Frame resizing, dimension updates |
| CRUD | `crud-operations.ts` | Create/Read/Update/Delete via adapter |
| API | `api-operations.ts` | Direct GET/POST/PUT/DELETE API calls |
| STORE | `store-operations.ts` | Persistent key-value store operations |
| METADATA | `metadata-operations.ts` | Metadata CRUD |
| CTS | `cts-operations.ts` | Content Type Schema operations |
| ESB | `esb-operations.ts` | Entry Sidebar location operations |
| ASB | `asb-operations.ts` | Asset Sidebar location operations |
| CF | `cf-operations.ts` | Custom Field location operations |
| APP_CONFIG | `app-config-operations.ts` | App Configuration location operations |
| FIELD_MODIFIER | *(field modifier ops)* | Field Modifier location operations |
| DASHBOARD | `dashboard-operations.ts` | Dashboard widget operations |
| GLOBAL_FULL_PAGE | *(global full page ops)* | Cross-stack full page operations |

---

## The Contentstack App Manifest (`manifest.json`)

The manifest tells Contentstack which UI locations this app registers and where to load them from. Key fields:

```json
{
  "ui_location": {
    "base_url": "http://localhost:3000",
    "signed": false,
    "locations": [
      { "type": "cs.cm.stack.custom_field", "meta": [{ "path": "/#/custom-field" }] },
      { "type": "cs.cm.stack.full_page",    "meta": [{ "path": "/#/full-page" }] },
      ...
    ]
  },
  "hosting": {
    "provider": "external",
    "deployment_url": "http://localhost:3000"
  }
}
```

For local testing, the app runs on `http://localhost:3000` (`npm start`). The manifest must be uploaded to Contentstack Developer Hub to register the app.

---

## Running the Application

```bash
# Start the React dev server (required for SDK tests)
npm start                  # Starts on http://localhost:3000

# Build for production
npm run build
```

---

## Running the E2E Tests (this repo's own tests)

These tests (`e2e/tests/`) are separate from the main `e2e-marketplace-playwright` orchestrator. They test the full app installation and SDK flow end-to-end:

```bash
npm run test:chrome           # Playwright tests in Chromium (headless)
npm run test:firefox          # Playwright tests in Firefox (headless)
npm run test:chrome-headed    # Headed mode for debugging
npm run test:firefox-headed
npm run show-report           # Open HTML report
```

**Playwright config for this repo:**
- Test files: `./e2e/tests`
- Timeout: 300 seconds per test
- Auth state: `storageState.json` (shared across tests)
- Viewport: 1920×720
- Projects: Chromium, Safari, Firefox
- Base URL: `process.env.ENV_URL`
- Single worker in CI

### global-setup.ts
Logs into Contentstack using `EMAIL` / `PASSWORD` from `.env` and saves the session to `storageState.json`. Handles both classic and Venus UI login flows.

### app-flow.spec.ts (main test)
1. **beforeAll**: Creates a Contentstack app, configures it, creates content type and entry, uploads asset, installs the app
2. Tests: Navigate to full page, assert SDK responses, intercept API requests
3. **afterAll**: Tears down all created resources

---

## Environment Variables

```bash
# Contentstack environment
ENV_URL=https://app.contentstack.com
API_BASE_URL=https://api.contentstack.io

# Login credentials
EMAIL=
PASSWORD=

# Organization and stack context
ORGANIZATION_UID=
STACK_API_KEY=
```

---

## Installing app-sdk versions

```bash
npm run install:dev        # Install from app-sdk#develop branch
npm run install:staging    # Install from app-sdk#staging branch
npm run install:prod       # Install from app-sdk#main branch
```

During active development, the local `file:../app-sdk` dependency is used. These scripts switch to a published GitHub branch version.
