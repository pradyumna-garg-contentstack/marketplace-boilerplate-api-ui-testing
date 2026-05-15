# Test Scenario Design: Content Field Validation via App-SDK

## Context

We are extending the `SdkDataErrors` test infrastructure with ~20 new modules, each targeting a specific field type or nesting context. This plan covers the full design: file structure, parallel execution, content type creation, entry reset, and test case lists with error assertion strategy.

---

## Correction Applied: Mandatory Is NOT a setData Constraint

Mandatory validation is **publish-time only** — entries are saved as draft by default. An empty string on a `mandatory: true` field passes `setData` and fires **no `onError`**. All test cases treat `mandatory: true` as invisible to the setData/onError flow.

---

## The Two Error Layers

| Layer | Trigger | `setData` outcome | `field.onError` | `entry.onError` |
|---|---|---|---|---|
| **Zod / structural** | Wrong JS type (number for text, string for number, etc.) | **throws ValidationError** INVALID_TYPE | does NOT fire | does NOT fire |
| **CMS constraint / form** | Correct type, wrong value: `min_size`, `max_size`, `format` regex, date range | **resolves** | **fires** | **fires** |
| **Null / clear** | `null` | resolves | does NOT fire | does NOT fire |

**Exceptions:** JSON RTE (`allow_json_rte: true`) is NOT `.nullable()` — `null` throws INVALID_TYPE.

**dotted fieldUid pattern for nested errors:**
- Group: `"group.child_field"` / Repeatable group row: `"group.0.child_field"`
- Modular blocks: `"blocks.0.block_uid.child_field"`
- Global field: `"global_field.child_field"` / Two levels: `"outer.inner.child"`

---

## File Structure (Splitting JSON by Module)

Each module gets its own JSON file. Benefits: git-trackable, independently loadable, one file = one Playwright test.

```
src/containers/SdkDataErrors/
├── test-cases/
│   ├── index.ts                        ← aggregates all modules
│   ├── text-multiple.json
│   ├── text-in-group.json
│   ├── text-in-repeatable-group.json
│   ├── text-in-modular-blocks.json
│   ├── text-in-global-field.json
│   ├── text-nested-groups.json
│   ├── number-field.json
│   ├── boolean-field.json
│   ├── date-field.json
│   ├── file-field.json
│   ├── link-field.json
│   ├── reference-field.json
│   ├── select-field.json
│   ├── group-field-complex.json
│   ├── global-field-complex.json
│   ├── custom-extension-field.json
│   ├── taxonomy-field.json
│   ├── ~~json-field.json~~ (removed)
│   ├── json-rte-field.json
│   └── all-fields-complex.json
├── sdk-test-cases.json                 ← existing (text_constrained + validation_format kept here)
├── test-runner.ts
└── SdkDataErrors.tsx
```

`index.ts` exports:
```typescript
import textMultiple from './test-cases/text-multiple.json';
// ... all imports
export const allModules = [textMultiple, textInGroup, ...];
```

Each JSON file has the same shape as existing `sdk-test-cases.json` but contains only **one module** (no outer `modules` array — the file IS the module).

---

## Playwright Parallel Execution Strategy

**In `e2e-marketplace-playwright`** — one spec file, each module is a separate `test()` so Playwright workers parallelize across modules:

```typescript
// e2e/tests/sdk-data-errors.spec.ts
import { allModules } from '../../../marketplace-boilerplate-api-ui-testing/src/containers/SdkDataErrors/test-cases/index';
import fixtures from '../fixtures/sdk-test-fixtures.json';

for (const module of allModules) {
  test(`SDK setData validation — ${module.name}`, async ({ page }) => {
    const { entryUid } = fixtures[module.id];
    await navigateToEntry(page, module.contentType.uid, entryUid);
    await triggerTestRunner(page, module.id);
    await assertModuleResults(page, module);
  });
}
```

Each `test()` runs in its own Playwright worker, on its own content type entry. No test shares state.

---

## Content Type Creation Strategy

Each module defines `contentType` in its JSON. Setup creates these automatically.

**`e2e/utils/helper.ts`** — add:
```typescript
async function createSdkTestModule(module: TestModule): Promise<{contentTypeUid: string, entryUid: string}>
  // 1. POST /v3/content_types — schema from module.contentType.schema
  //    + append `sdk_test_runner` field (JSON type, SdkDataErrors extension field)
  // 2. POST /v3/content_types/{uid}/entries — baseline data from module.baseline
  // Returns { contentTypeUid, entryUid }
```

**`global-setup.ts`** or new `sdk-data-errors-setup.ts` — run before E2E suite:
```typescript
for (const module of allModules) {
  const result = await createSdkTestModule(module);
  fixtures[module.id] = result;
}
writeFileSync('sdk-test-fixtures.json', JSON.stringify(fixtures));
```

**`global-teardown.ts`** — delete all module content types and entries after suite run.

---

## Entry Reset Between Test Cases

After each test case run, the entry **must be reset to `module.baseline`** before the next case. Without this, a previous test's `setData` contaminates the next test's starting state.

**Implementation in `test-runner.ts`** — add a `resetEntry(sdk, baseline)` step **before** each test case execution:

```typescript
async function resetEntry(sdk: UiLocation, baseline: Record<string, any>) {
  // Use CMA (not SDK setData) to avoid SDK-layer side effects
  const cma = sdk.createAdapter();
  const stackApiKey = sdk.stack._data.api_key;
  const entryUid = sdk.location.CustomField.entry.getData().uid;
  const ctUid = sdk.location.CustomField.entry.content_type.uid;
  await cma.ContentType(ctUid).Entry(entryUid).update({ entry: baseline });
  // Small wait for form to re-render
  await delay(300);
}
```

CMA reset is used (not `entry.setData`) because a prior failed test may have left the entry in a state that causes SDK setData to throw — CMA bypasses that.

---

## Error Message Assertion Strategy (Two-Phase)

### Phase 1 — Skeleton (current implementation)
Add `reason` and `fieldUid` assertions only:
```json
"reasons": [{ "reason": "INVALID_TYPE" }]
```

For cases with **known custom messages** from Zod schemas (already in code):
- File type mismatch: `"Expected a valid file uid or an array of file uids"`
- Reference shape error: `"Reference must have a _content_type_uid and uid"`
- JSON non-RTE primitive: `"Expected a valid JSON value"`

### Phase 2 — Lock-in
1. Run each module's tests, capture all `error.details[].reasons[].message` values from console/UI
2. User provides actual log output
3. Add exact messages to each relevant test case's `"expected"` block

---

## Part 1: Text Field — All Nesting Contexts

### Module `text_multiple`
File: `text-multiple.json` | UID: `sdk_tc_text_multiple`
Schema: `tags` (text, `multiple:true`, `min_size:3`)

| ID | Test | Data | Layer | setData | fieldOnError | entryOnError |
|---|---|---|---|---|---|---|
| TC-F-001 | valid array | `["react","node"]` | — | resolved | ✗ | ✗ |
| TC-F-002 | empty array | `[]` | — | resolved | ✗ | ✗ |
| TC-F-003 | null | `null` | — | resolved | ✗ | ✗ |
| TC-F-004 | array item too short | `["ok","ab"]` | CMS constraint | resolved | ✓ `tags` | ✓ |
| TC-F-005 | string, not array | `"react"` | Zod | throws INVALID_TYPE `tags` | ✗ | ✗ |
| TC-F-006 | number | `42` | Zod | throws INVALID_TYPE `tags` | ✗ | ✗ |
| TC-F-007 | array containing number | `["react",42]` | Zod | throws INVALID_TYPE `tags` | ✗ | ✗ |
| TC-F-008 | array containing null | `["react",null]` | — | resolved | ✗ | ✗ |
| TC-E-001 | entry.setData valid | `{tags:["react","node"]}` | — | resolved | ✗ | ✗ |
| TC-E-002 | entry.setData item too short | `{tags:["react","ab"]}` | CMS constraint | resolved | ✗ | ✓ |
| TC-E-003 | entry.setData wrong type | `{tags:42}` | Zod | throws INVALID_TYPE | ✗ | ✗ |

---

### Module `text_in_group`
File: `text-in-group.json` | UID: `sdk_tc_text_group`
Schema: group `address` (single) → `street` (text, `min_size:5`, `max_size:50`)

`field-setdata` targets `"address"`. `subscribeFieldOnErrorUid` = `"address"`.

| ID | Test | Data | Layer | setData | fieldOnError `address` | entryOnError |
|---|---|---|---|---|---|---|
| TC-F-001 | valid group | `{street:"123 Main St"}` | — | resolved | ✗ | ✗ |
| TC-F-002 | null group | `null` | — | resolved | ✗ | ✗ |
| TC-F-003 | street too short | `{street:"Oak"}` | CMS constraint | resolved | ✓ `address.street` in details | ✓ |
| TC-F-004 | street too long (>50) | `{street:"fifty-one characters long string here!!!"}` | CMS constraint | resolved | ✓ `address.street` in details | ✓ |
| TC-F-005 | street is number | `{street:123}` | Zod | throws INVALID_TYPE `address.street` | ✗ | ✗ |
| TC-F-006 | array instead of object | `[{street:"valid"}]` | Zod | throws INVALID_TYPE `address` | ✗ | ✗ |
| TC-F-007 | string instead of object | `"123 Main St"` | Zod | throws INVALID_TYPE `address` | ✗ | ✗ |
| TC-F-008 | uid isolation: subscribe `address`, Zod error on `address.street` | `{street:123}` | Zod | throws | `address` listener NOT fired (throws bypass onError) | ✗ |
| TC-F-009 | direct `address.street` setData — valid | `"456 Oak Ave"` | — | resolved | ✗ | ✗ |
| TC-F-010 | direct `address.street` setData — too short | `"Oak"` | CMS constraint | resolved | ✓ `address.street` | ✓ |
| TC-F-011 | direct `address.street` setData — type mismatch | `123` | Zod | throws INVALID_TYPE `address.street` | ✗ | ✗ |

---

### Module `text_in_repeatable_group`
File: `text-in-repeatable-group.json` | UID: `sdk_tc_text_rep_group`
Schema: group `faq` (`multiple:true`) → `question` (text), `answer` (text)

| ID | Test | Data | Layer | setData | fieldOnError `faq` | entryOnError |
|---|---|---|---|---|---|---|
| TC-F-001 | valid single row | `[{question:"What?",answer:"This."}]` | — | resolved | ✗ | ✗ |
| TC-F-002 | empty array | `[]` | — | resolved | ✗ | ✗ |
| TC-F-003 | null | `null` | — | resolved | ✗ | ✗ |
| TC-F-004 | question number in row 0 | `[{question:42,answer:"x"}]` | Zod | throws INVALID_TYPE `faq.0.question` | ✗ | ✗ |
| TC-F-005 | question number in row 1 | `[{question:"ok"},{question:99}]` | Zod | throws INVALID_TYPE `faq.1.question` | ✗ | ✗ |
| TC-F-006 | object not array | `{question:"What?"}` | Zod | throws INVALID_TYPE `faq` | ✗ | ✗ |
| TC-F-007 | string not array | `"faq content"` | Zod | throws INVALID_TYPE `faq` | ✗ | ✗ |
| TC-E-001 | entry.setData valid | `{faq:[{question:"Why?",answer:"Because."}]}` | — | resolved | ✗ | ✗ |
| TC-E-002 | entry.setData type error in row | `{faq:[{question:42}]}` | Zod | throws INVALID_TYPE `faq.0.question` | ✗ | ✗ |

---

### Module `text_in_modular_blocks`
File: `text-in-modular-blocks.json` | UID: `sdk_tc_text_blocks`
Schema: blocks `sections` with:
- `hero`: `heading` (text, `min_size:5`), `subheading` (text)
- `card`: `label` (text), `body` (text)

| ID | Test | Data | Layer | setData | fieldOnError `sections` | entryOnError |
|---|---|---|---|---|---|---|
| TC-F-001 | valid hero | `[{hero:{heading:"Welcome here!"}}]` | — | resolved | ✗ | ✗ |
| TC-F-002 | valid card | `[{card:{label:"Product A"}}]` | — | resolved | ✗ | ✗ |
| TC-F-003 | two blocks | `[{hero:{heading:"Hi there!"}},{card:{label:"X"}}]` | — | resolved | ✗ | ✗ |
| TC-F-004 | null | `null` | — | resolved | ✗ | ✗ |
| TC-F-005 | empty array | `[]` | — | resolved | ✗ | ✗ |
| TC-F-006 | heading too short | `[{hero:{heading:"Hi"}}]` | CMS constraint | resolved | ✓ fires | ✓ |
| TC-F-007 | heading is number | `[{hero:{heading:123}}]` | Zod | throws INVALID_TYPE `sections.0.hero.heading` | ✗ | ✗ |
| TC-F-008 | unknown block uid | `[{banner:{heading:"Hi"}}]` | Zod | throws INVALID_TYPE `sections` | ✗ | ✗ |
| TC-F-009 | string not array | `"sections content"` | Zod | throws INVALID_TYPE `sections` | ✗ | ✗ |
| TC-F-010 | object not array | `{hero:{heading:"Hi there!"}}` | Zod | throws INVALID_TYPE `sections` | ✗ | ✗ |
| TC-F-011 | error in row 1 | `[{card:{label:"ok"}},{hero:{heading:99}}]` | Zod | throws INVALID_TYPE `sections.1.hero.heading` | ✗ | ✗ |
| TC-F-012 | two block keys in one row | `[{hero:{heading:"Hi there!"},card:{label:"X"}}]` | Zod | throws (one key per row rule) | ✗ | ✗ |

---

### Module `text_in_global_field`
File: `text-in-global-field.json` | UID: `sdk_tc_text_global`
Schema: global_field `author` (single) → `name` (text, `min_size:2`), `bio` (text)

| ID | Test | Data | Layer | setData | fieldOnError `author` | entryOnError |
|---|---|---|---|---|---|---|
| TC-F-001 | valid | `{name:"Jane Doe",bio:"Writer"}` | — | resolved | ✗ | ✗ |
| TC-F-002 | null | `null` | — | resolved | ✗ | ✗ |
| TC-F-003 | name too short | `{name:"J"}` | CMS constraint | resolved | ✓ `author.name` in details | ✓ |
| TC-F-004 | name is number | `{name:123}` | Zod | throws INVALID_TYPE `author.name` | ✗ | ✗ |
| TC-F-005 | bio is number | `{name:"Jane",bio:42}` | Zod | throws INVALID_TYPE `author.bio` | ✗ | ✗ |
| TC-F-006 | array not object | `[{name:"Jane"}]` | Zod | throws INVALID_TYPE `author` | ✗ | ✗ |
| TC-F-007 | direct `author.name` setData — valid | `"Jane Doe"` | — | resolved | ✗ | ✗ |
| TC-F-008 | direct `author.name` setData — type mismatch | `42` | Zod | throws INVALID_TYPE `author.name` | ✗ | ✗ |

---

### Module `text_nested_groups`
File: `text-nested-groups.json` | UID: `sdk_tc_text_nested`
Schema: outer group `location` → inner group `coordinates` → `label` (text, `min_size:3`)

| ID | Test | Data for `location` | Layer | setData | fieldOnError `location` | entryOnError |
|---|---|---|---|---|---|---|
| TC-F-001 | valid 2-level nested | `{coordinates:{label:"Center"}}` | — | resolved | ✗ | ✗ |
| TC-F-002 | null outer group | `null` | — | resolved | ✗ | ✗ |
| TC-F-003 | label too short | `{coordinates:{label:"ab"}}` | CMS constraint | resolved | ✓ `location.coordinates.label` | ✓ |
| TC-F-004 | label is number | `{coordinates:{label:99}}` | Zod | throws INVALID_TYPE `location.coordinates.label` | ✗ | ✗ |
| TC-F-005 | inner group is array | `{coordinates:[{label:"ok"}]}` | Zod | throws INVALID_TYPE `location.coordinates` | ✗ | ✗ |
| TC-F-006 | outer group is array | `[{coordinates:{label:"ok"}}]` | Zod | throws INVALID_TYPE `location` | ✗ | ✗ |

---

## Part 2: All Field Types

### Module `number_field`
File: `number-field.json` | UID: `sdk_tc_number`
Schema: `price` (number), `related_skus` (number, `multiple:true`)

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | price | valid | `29.99` | — | resolved | ✗ |
| TC-F-002 | price | zero | `0` | — | resolved | ✗ |
| TC-F-003 | price | negative | `-5` | — | resolved | ✗ |
| TC-F-004 | price | null | `null` | — | resolved | ✗ |
| TC-F-005 | price | string | `"29.99"` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-006 | price | boolean | `true` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-007 | price | object | `{value:29}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-008 | related_skus | valid array | `[101,102,103]` | — | resolved | ✗ |
| TC-F-009 | related_skus | empty array | `[]` | — | resolved | ✗ |
| TC-F-010 | related_skus | null | `null` | — | resolved | ✗ |
| TC-F-011 | related_skus | single number (not array) | `101` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-012 | related_skus | array with string | `[101,"102"]` | Zod | throws INVALID_TYPE | ✗ |

---

### Module `boolean_field`
File: `boolean-field.json` | UID: `sdk_tc_boolean`
Schema: `is_featured` (boolean), `feature_flags` (boolean, `multiple:true`)

| ID | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|
| TC-F-001 | true | `true` | — | resolved | ✗ |
| TC-F-002 | false | `false` | — | resolved | ✗ |
| TC-F-003 | null | `null` | — | resolved | ✗ |
| TC-F-004 | string "true" | `"true"` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-005 | number 1 | `1` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-006 | object | `{value:true}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-007 | multiple valid array | `[true,false,true]` | — | resolved | ✗ |
| TC-F-008 | multiple: single boolean (not array) | `true` | Zod | throws INVALID_TYPE | ✗ |

---

### Module `date_field`
File: `date-field.json` | UID: `sdk_tc_date`
Schema: `published_at` (isodate), `event_date` (isodate, `startDate:"2025-01-01"`, `endDate:"2026-12-31"`)

Note: Zod schema is `z.string().nullable()` — any string passes Zod; date range is CMS-level.

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | published_at | valid ISO date | `"2025-04-15T09:00:00.000Z"` | — | resolved | ✗ |
| TC-F-002 | published_at | null | `null` | — | resolved | ✗ |
| TC-F-003 | published_at | non-date string | `"not-a-date"` | — | resolved | ✗ (any string passes Zod) |
| TC-F-004 | published_at | number timestamp | `1713168000000` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-005 | published_at | date object | `{year:2025}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-006 | event_date | within range | `"2025-06-15T00:00:00.000Z"` | — | resolved | ✗ |
| TC-F-007 | event_date | before startDate | `"2024-01-01T00:00:00.000Z"` | CMS constraint | resolved | ✓ fires |
| TC-F-008 | event_date | after endDate | `"2027-01-01T00:00:00.000Z"` | CMS constraint | resolved | ✓ fires |

---

### Module `file_field`
File: `file-field.json` | UID: `sdk_tc_file`
Schema: `hero_image` (file, single), `gallery` (file, `multiple:true`)

Note: Zod schema `z.union([z.string(), z.array(z.string())])` — uid strings only, NOT asset objects.

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | hero_image | valid uid | `"blt1234abcd5678"` | — | resolved | ✗ |
| TC-F-002 | hero_image | null | `null` | — | resolved | ✗ |
| TC-F-003 | hero_image | full asset object (**common mistake**) | `{uid:"blt...",url:"https://..."}` | Zod | throws "Expected a valid file uid or an array of file uids" | ✗ |
| TC-F-004 | hero_image | number | `42` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-005 | hero_image | boolean | `true` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-006 | gallery | valid array | `["bltaaa","bltbbb"]` | — | resolved | ✗ |
| TC-F-007 | gallery | empty array | `[]` | — | resolved | ✗ |
| TC-F-008 | gallery | single string (union accepts) | `"bltaaa"` | — | resolved | ✗ |
| TC-F-009 | gallery | array of objects | `[{uid:"blt..."}]` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-010 | gallery | nested array | `[["bltaaa"]]` | Zod | throws INVALID_TYPE | ✗ |

---

### Module `link_field`
File: `link-field.json` | UID: `sdk_tc_link`
Schema: `cta_button` (link, single), `nav_links` (link, `multiple:true`)

Note: Zod requires `{href: string, title: string}` — both keys required.

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | cta_button | valid | `{href:"/about",title:"About Us"}` | — | resolved | ✗ |
| TC-F-002 | cta_button | null | `null` | — | resolved | ✗ |
| TC-F-003 | cta_button | missing href | `{title:"About Us"}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-004 | cta_button | missing title | `{href:"/about"}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-005 | cta_button | href is number | `{href:42,title:"About"}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-006 | cta_button | plain string | `"/about"` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-007 | cta_button | empty object | `{}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-008 | nav_links | valid array | `[{href:"/a",title:"A"},{href:"/b",title:"B"}]` | — | resolved | ✗ |
| TC-F-009 | nav_links | empty array | `[]` | — | resolved | ✗ |
| TC-F-010 | nav_links | item missing title | `[{href:"/a"}]` | Zod | throws INVALID_TYPE | ✗ |

---

### Module `reference_field`
File: `reference-field.json` | UID: `sdk_tc_reference`
Schema: `author` (reference, single), `related_posts` (reference, `multiple:true`)

Note: Zod validates shape `{_content_type_uid, uid}` only — does NOT check `reference_to` allowed types.

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | author | valid single | `{_content_type_uid:"author",uid:"bltabc"}` | — | resolved | ✗ |
| TC-F-002 | author | valid as array | `[{_content_type_uid:"author",uid:"bltabc"}]` | — | resolved | ✗ |
| TC-F-003 | author | null | `null` | — | resolved | ✗ |
| TC-F-004 | author | missing uid | `{_content_type_uid:"author"}` | Zod | throws "Reference must have _content_type_uid and uid" | ✗ |
| TC-F-005 | author | missing _content_type_uid | `{uid:"bltabc"}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-006 | author | string | `"bltabc"` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-007 | related_posts | valid array | `[{_content_type_uid:"blog_post",uid:"bltaaa"}]` | — | resolved | ✗ |
| TC-F-008 | related_posts | empty array | `[]` | — | resolved | ✗ |
| TC-F-009 | related_posts | cross-type refs (Zod doesn't validate reference_to) | `[{_content_type_uid:"blog_post",uid:"bltaaa"},{_content_type_uid:"product",uid:"bltbbb"}]` | — | resolved | ✗ |
| TC-F-010 | related_posts | item missing uid | `[{_content_type_uid:"blog_post"}]` | Zod | throws INVALID_TYPE | ✗ |

---

### Module `select_field`
File: `select-field.json` | UID: `sdk_tc_select`
Schema: `category` (select, `display_type:"dropdown"`, choices: tech/design/business), `tags` (select, `multiple:true`, same choices)

Note: Zod treats select as `z.string().nullable()` — does NOT validate enum choices.

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | category | valid choice | `"tech"` | — | resolved | ✗ |
| TC-F-002 | category | null | `null` | — | resolved | ✗ |
| TC-F-003 | category | invalid choice (not in enum) | `"sports"` | CMS constraint | resolved | investigate: does form fire? |
| TC-F-004 | category | number | `42` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-005 | tags | valid array | `["tech","design"]` | — | resolved | ✗ |
| TC-F-006 | tags | invalid choice in array | `["tech","sports"]` | CMS constraint | resolved | investigate |
| TC-F-007 | tags | string (not array) | `"tech"` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-008 | tags | empty array | `[]` | — | resolved | ✗ |

---

### Module `group_field_complex`
File: `group-field-complex.json` | UID: `sdk_tc_group_complex`
Schema:
- `profile` (group, single): `name` (text, `min_size:3`), `age` (number), `active` (boolean), `avatar` (file)
- `contacts` (group, `multiple:true`): `email` (text, `format` regex for email), `phone` (text)

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | profile | valid | `{name:"Jane",age:30,active:true,avatar:"bltaaa"}` | — | resolved | ✗ |
| TC-F-002 | profile | null | `null` | — | resolved | ✗ |
| TC-F-003 | profile | name too short | `{name:"Jo",age:30}` | CMS constraint | resolved | ✓ `profile.name` |
| TC-F-004 | contacts | email format invalid | `[{email:"not-an-email",phone:"123"}]` | CMS constraint | resolved | ✓ `contacts.0.email` |
| TC-F-005 | profile | name is number | `{name:123,age:30}` | Zod | throws INVALID_TYPE `profile.name` | ✗ |
| TC-F-006 | profile | age is string | `{name:"Jane",age:"30"}` | Zod | throws INVALID_TYPE `profile.age` | ✗ |
| TC-F-007 | profile | active is string | `{name:"Jane",active:"yes"}` | Zod | throws INVALID_TYPE `profile.active` | ✗ |
| TC-F-008 | profile | avatar is full asset object | `{name:"Jane",avatar:{uid:"blt...",url:"..."}}` | Zod | throws INVALID_TYPE `profile.avatar` | ✗ |
| TC-F-009 | profile | array not object | `[{name:"Jane"}]` | Zod | throws INVALID_TYPE `profile` | ✗ |
| TC-F-010 | contacts | valid array | `[{email:"user@example.com",phone:"555-1234"}]` | — | resolved | ✗ |
| TC-F-011 | contacts | email is number | `[{email:42,phone:"555"}]` | Zod | throws INVALID_TYPE `contacts.0.email` | ✗ |
| TC-F-012 | contacts | object not array | `{email:"x@x.com",phone:"555"}` | Zod | throws INVALID_TYPE `contacts` | ✗ |

---

### Module `global_field_complex`
File: `global-field-complex.json` | UID: `sdk_tc_global_complex`
Schema:
- `seo` (global_field, single): `meta_title` (text, `max_size:60`), `meta_description` (text, `max_size:160`), `og_image` (file)
- `social_links` (global_field, `multiple:true`): `platform` (text), `url` (text)

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | seo | valid | `{meta_title:"Best CMS",meta_description:"We are...",og_image:"bltaaa"}` | — | resolved | ✗ |
| TC-F-002 | seo | null | `null` | — | resolved | ✗ |
| TC-F-003 | seo | meta_title too long (>60) | `{meta_title:"sixty-one characters long string here!!!!!!!!!!!!!!!!!!!!!!!!!!"}` | CMS constraint | resolved | ✓ `seo.meta_title` |
| TC-F-004 | seo | meta_title is number | `{meta_title:123}` | Zod | throws INVALID_TYPE `seo.meta_title` | ✗ |
| TC-F-005 | seo | og_image is full asset object | `{og_image:{uid:"blt...",url:"..."}}` | Zod | throws INVALID_TYPE `seo.og_image` | ✗ |
| TC-F-006 | seo | array not object | `[{meta_title:"ok"}]` | Zod | throws INVALID_TYPE `seo` | ✗ |
| TC-F-007 | social_links | valid array | `[{platform:"twitter",url:"https://twitter.com/x"}]` | — | resolved | ✗ |
| TC-F-008 | social_links | platform is number | `[{platform:42,url:"https://..."}]` | Zod | throws INVALID_TYPE `social_links.0.platform` | ✗ |
| TC-F-009 | social_links | object not array | `{platform:"twitter",url:"https://..."}` | Zod | throws INVALID_TYPE `social_links` | ✗ |

---

### Module `custom_extension_field`
File: `custom-extension-field.json` | UID: `sdk_tc_extension`
Schema: `color_picker` (`data_type:"json"`, `extension_uid:"blt..."`)

Note: Extension fields are `data_type:"json"` — Zod applies generic JSON schema (any array OR object). No extension-specific validation.

| ID | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|
| TC-F-001 | valid color object | `{hex:"#0070f3",rgba:"rgb(0,112,243)"}` | — | resolved | ✗ |
| TC-F-002 | valid array form | `["#0070f3","#FF0000"]` | — | resolved | ✗ |
| TC-F-003 | null | `null` | — | resolved | ✗ |
| TC-F-004 | empty object | `{}` | — | resolved | ✗ (any object passes) |
| TC-F-005 | nested complex structure | `{theme:{primary:"#0070f3"},dark:true}` | — | resolved | ✗ |
| TC-F-006 | string (primitive) | `"#0070f3"` | Zod | throws "Expected a valid JSON value" | ✗ |
| TC-F-007 | number | `16733170` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-008 | boolean | `true` | Zod | throws INVALID_TYPE | ✗ |

---

### Module `taxonomy_field`
File: `taxonomy-field.json` | UID: `sdk_tc_taxonomy`
Schema: `categories` (taxonomy, `taxonomy_uid:"product_categories"`)

| ID | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|
| TC-F-001 | valid item | `[{taxonomy_uid:"product_categories",term_uid:"electronics"}]` | — | resolved | ✗ |
| TC-F-002 | multiple items | `[{taxonomy_uid:"product_categories",term_uid:"electronics"},{taxonomy_uid:"product_categories",term_uid:"mobile"}]` | — | resolved | ✗ |
| TC-F-003 | empty array | `[]` | — | resolved | ✗ |
| TC-F-004 | null | `null` | — | resolved | ✗ |
| TC-F-005 | extra keys (looseObject — passes) | `[{taxonomy_uid:"product_categories",term_uid:"electronics",extra:"ok"}]` | — | resolved | ✗ |
| TC-F-006 | missing taxonomy_uid | `[{term_uid:"electronics"}]` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-007 | missing term_uid | `[{taxonomy_uid:"product_categories"}]` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-008 | string not array | `"electronics"` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-009 | object not array | `{taxonomy_uid:"product_categories",term_uid:"electronics"}` | Zod | throws INVALID_TYPE | ✗ |

---

### Module `json_field`
~~File: `json-field.json` | UID: `sdk_tc_json`~~ (removed — plain JSON field not supported; JSON coverage remains via Custom Field + JSON RTE)
Schema: `metadata` (json, non-RTE), `config_list` (json, `multiple:true`)

Note: Zod `z.union([z.array, z.record])` — accepts array OR object, not primitives.

| ID | Field | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|---|
| TC-F-001 | metadata | valid object | `{key:"value",count:5}` | — | resolved | ✗ |
| TC-F-002 | metadata | valid array | `[1,"two",{three:3}]` | — | resolved | ✗ |
| TC-F-003 | metadata | empty object | `{}` | — | resolved | ✗ |
| TC-F-004 | metadata | empty array | `[]` | — | resolved | ✗ |
| TC-F-005 | metadata | null | `null` | — | resolved | ✗ |
| TC-F-006 | metadata | string | `"just a string"` | Zod | throws "Expected a valid JSON value" | ✗ |
| TC-F-007 | metadata | number | `42` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-008 | metadata | boolean | `true` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-009 | config_list | valid array of objects | `[{a:1},{b:2}]` | — | resolved | ✗ |
| TC-F-010 | config_list | object (not array) with `multiple:true` | `{a:1}` | Zod | throws INVALID_TYPE | ✗ |

---

### Module `json_rte_field`
File: `json-rte-field.json` | UID: `sdk_tc_json_rte`
Schema: `article_body` (json, `allow_json_rte:true`)

**Special**: Root must be `{type:"doc",...}`. **NOT nullable** — `null` throws INVALID_TYPE.

| ID | Test | Data | Layer | setData | onError |
|---|---|---|---|---|---|
| TC-F-001 | valid minimal doc | `{type:"doc",children:[]}` | — | resolved | ✗ |
| TC-F-002 | valid doc with paragraph | `{type:"doc",children:[{type:"p",children:[{text:"Hello"}]}]}` | — | resolved | ✗ |
| TC-F-003 | deeply nested valid doc | `{type:"doc",children:[{type:"ul",children:[{type:"li",children:[{text:"item"}]}]}]}` | — | resolved | ✗ |
| TC-F-004 | extra root fields (looseObject — passes) | `{type:"doc",version:3,children:[],extraKey:"ok"}` | — | resolved | ✗ |
| TC-F-005 | null (**NOT nullable**) | `null` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-006 | wrong root type | `{type:"paragraph",children:[]}` | Zod | throws (literal "doc" required) | ✗ |
| TC-F-007 | missing type key | `{children:[{text:"Hello"}]}` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-008 | string (HTML) | `"<p>Hello</p>"` | Zod | throws INVALID_TYPE | ✗ |
| TC-F-009 | plain object no type | `{content:"text"}` | Zod | throws INVALID_TYPE | ✗ |

---

## The "All Fields" Complex Content Type

**Module `all_fields_complex`** | File: `all-fields-complex.json` | UID: `sdk_tc_all_fields`

One content type containing every supported field type. Single entry, all scenarios run against it.

**Schema** (23 fields):
```
title                  text (title field)
text_single            text (min_size:3, max_size:100)
text_multiple          text (multiple:true)
number_single          number
number_multiple        number (multiple:true)
boolean_field          boolean
date_single            isodate
date_with_range        isodate (startDate:"2025-01-01", endDate:"2026-12-31")
file_single            file
file_multiple          file (multiple:true)
link_field             link
reference_single       reference (reference_to: sdk_tc_all_fields — self-ref)
select_single          text (dropdown, choices: opt_a/opt_b/opt_c)
select_multiple        text (multiple:true, checkbox, choices: tag_1/tag_2/tag_3)
group_single           group (single): { sub_text:text(min_size:2), sub_number:number }
group_repeatable       group (multiple:true): { item_name:text }
global_field_ref       global_field (schema: { gf_title:text, gf_image:file })
modular_blocks_field   blocks: text_section{content:text(min_size:5)} + image_section{asset:file,caption:text}
taxonomy_field         taxonomy
json_plain             json (non-RTE)
json_rte               json (allow_json_rte:true)
markdown_field         text (field_metadata.markdown:true)
extension_field        json (extension_uid:"...")
```

**Test groups:**

**Group A — Happy path**: one `entry-setdata` with complete valid payload → resolves

**Group B — Type mismatch per field** (one `field-setdata` per field type with wrong JS type → throws INVALID_TYPE):
- `text_single` ← `123`, `number_single` ← `"twenty"`, `boolean_field` ← `"true"`, `date_single` ← `{}`
- `file_single` ← `{uid:"blt...",url:"..."}`, `link_field` ← `"/url"`, `reference_single` ← `"blt..."`
- `group_single` ← `[]`, `modular_blocks_field` ← `{}`, `json_plain` ← `"string"`
- `json_rte` ← `null`, `taxonomy_field` ← `"electronics"`, `extension_field` ← `42`

**Group C — CMS constraint violations**:
- `text_single` too short → onError fires `text_single`
- `date_with_range` out of range → onError fires `date_with_range`
- `group_single.sub_text` too short → onError fires `group_single.sub_text`
- `modular_blocks_field` content too short → onError fires

**Group D — Null clearing** (all nullable except `json_rte`):
- `null` for each field → resolves; `json_rte` ← `null` → throws INVALID_TYPE

**Group E — Multiple simultaneous mismatches** (`entry-setdata`):
- `{text_single: 123, number_single: "twenty", boolean_field: "yes"}` → throws with 3 INVALID_TYPE details

---

## Summary

| Module | File | UID | ~Cases |
|---|---|---|---|
| text_multiple | text-multiple.json | sdk_tc_text_multiple | 11 |
| text_in_group | text-in-group.json | sdk_tc_text_group | 11 |
| text_in_repeatable_group | text-in-repeatable-group.json | sdk_tc_text_rep_group | 9 |
| text_in_modular_blocks | text-in-modular-blocks.json | sdk_tc_text_blocks | 12 |
| text_in_global_field | text-in-global-field.json | sdk_tc_text_global | 8 |
| text_nested_groups | text-nested-groups.json | sdk_tc_text_nested | 6 |
| number_field | number-field.json | sdk_tc_number | 12 |
| boolean_field | boolean-field.json | sdk_tc_boolean | 8 |
| date_field | date-field.json | sdk_tc_date | 8 |
| file_field | file-field.json | sdk_tc_file | 10 |
| link_field | link-field.json | sdk_tc_link | 10 |
| reference_field | reference-field.json | sdk_tc_reference | 10 |
| select_field | select-field.json | sdk_tc_select | 8 |
| group_field_complex | group-field-complex.json | sdk_tc_group_complex | 12 |
| global_field_complex | global-field-complex.json | sdk_tc_global_complex | 9 |
| custom_extension_field | custom-extension-field.json | sdk_tc_extension | 8 |
| taxonomy_field | taxonomy-field.json | sdk_tc_taxonomy | 9 |
| ~~json_field~~ | ~~json-field.json~~ | ~~sdk_tc_json~~ | ~~10~~ |
| json_rte_field | json-rte-field.json | sdk_tc_json_rte | 9 |
| all_fields_complex | all-fields-complex.json | sdk_tc_all_fields | ~25 |
| **Total** | **20 new modules** | | **~195 test cases** |

---

## Files to Modify / Create

| Repo | File | Change |
|---|---|---|
| boilerplate | `src/containers/SdkDataErrors/test-cases/*.json` | 20 new module JSON files |
| boilerplate | `src/containers/SdkDataErrors/test-cases/index.ts` | New: aggregates all modules |
| boilerplate | `src/containers/SdkDataErrors/test-runner.ts` | Add `resetEntry(sdk, baseline)` called before each test case |
| boilerplate | `e2e/utils/helper.ts` | Add `createSdkTestModule()` |
| boilerplate | `global-setup.ts` | Call `createSdkTestModule` for each new module; write `sdk-test-fixtures.json` |
| boilerplate | `global-teardown.ts` | Delete module content types + entries |
| marketplace-playwright | `e2e/tests/sdk-data-errors.spec.ts` | New: one `test()` per module; parallel workers |
