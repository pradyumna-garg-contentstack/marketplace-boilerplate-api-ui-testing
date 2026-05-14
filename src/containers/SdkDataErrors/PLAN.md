# SdkDataErrors — Test Plan & Decision Log

## What this tests

The `SdkDataErrors` widget verifies the **setData / onError contract** introduced in App SDK v2.4.
There are two distinct error paths in the SDK:

| Path | Trigger | What happens |
|---|---|---|
| **Tier-1 (Zod)** | `setData` receives wrong shape (e.g. number for text field) | `app-extension-component` validates synchronously via Zod; returns `{ success: false, error }` to the SDK; SDK throws `ValidationError` **before** the form updates |
| **Tier-2 (form)** | `setData` receives correct shape but violates content-type constraints (length, format, required) | `setData` resolves; `react-final-form` inside the host re-validates; host emits `onError` event back to the SDK via post-robot |

Both paths produce the same `ValidationError` shape:

```
{
  code:    "VALIDATION_ERROR",
  name:    "ValidationError",
  message: "Validation Failed",           ← always this string
  details: [
    {
      fieldUid: string,
      reasons:  [{ reason: string, message: string }]
        Tier-1 → reason = Zod error code uppercased, e.g. "INVALID_TYPE"
                 message = Zod default, e.g. "Expected string, received number"
        Tier-2 → reason = form validation code, e.g. "FORMAT", "MIN_LENGTH", "REQUIRED"
                 message = custom error_messages from content-type schema, e.g.
                           "Please enter a valid email address"
    }
  ]
}
```

---

## Files

| File | Purpose |
|---|---|
| `sdk-test-cases.json` | Single source of truth: content-type schemas, baseline entry data, operations, full expected-signal specs |
| `test-runner.ts` | `executeTestCase()` + `assertSetData/FieldOnError/EntryOnError()` — all pure TS, no React |
| `SdkDataErrors.tsx` | React UI: module/test-case selectors (parent) + `TestCaseRunner` (child, remounted per test) |
| `SdkDataErrors.css` | Styles for Operation / Expected / Results cards |
| `scenarios.ts` | Legacy file — superseded by `test-runner.ts`, kept for reference |

---

## Content-type modules

Two content types must exist in the stack before running tests.
The `contentType` objects in `sdk-test-cases.json` contain the exact schemas to create them.
The `FullPage` container's **Module Manager** can create and delete them via the SDK's `api()` method.

### `sdk_tc_text_const` — Text with Length Constraints
- `short_text` (text, min_size=5, max_size=20)
- Tests Tier-1 (number → INVALID_TYPE) and Tier-2 (too short / too long → length error)

### `sdk_tc_val_fmt` — Text with Format and Required
- `email_field` (text, format regex, custom error message "Please enter a valid email address")
- `mandatory_text` (text, mandatory=true)
- Tests Tier-1 (number → INVALID_TYPE), Tier-2 format, Tier-2 required, and **uid isolation**

---

## Test-case taxonomy

### Three measured signals per test

Every test case measures three independent signals and asserts all of them:

1. **`setData` outcome** — `resolved` | `threw-ValidationError` | `threw-Error` | `field-not-found`
   Plus optional error detail checks (code, message, details[].fieldUid, details[].reasons[])

2. **`field.onError` signal** — `fired: true/false`
   `field.onError(cb)` filters the `onError` event to only those `details[]` entries whose
   `fieldUid` matches the subscribed field's uid.  
   Plus optional error detail checks when `fired: true`

3. **`entry.onError` signal** — `fired: true/false`
   `entry.onError(cb)` fires for any field error, no uid filter.  
   Plus optional error detail checks when `fired: true`

### Expected error shape — same for all three signals

```json
"error": {
  "code":    "VALIDATION_ERROR",
  "message": "Validation Failed",
  "details": [
    {
      "fieldUid": "email_field",
      "reasons":  [
        { "reason": "INVALID_TYPE" },
        { "message": "Please enter a valid email address" }
      ]
    }
  ]
}
```

All fields are **optional**. Assertion is **partial-match**: only fields present in `expected.error`
are checked; unspecified fields are ignored. This avoids brittleness when the form reports
errors on multiple fields simultaneously.

### Test cases per module

#### `text_constrained`

| ID | Operation | Expected setData | field.onError | entry.onError |
|---|---|---|---|---|
| TC-F-001 | `short_text = "hello world"` (11 chars, valid) | resolved | false | false |
| TC-F-002 | `short_text = "hi"` (2 chars, too short) | resolved | true · short_text | true · short_text |
| TC-F-003 | `short_text = "this string exceeds max"` (too long) | resolved | true · short_text | true · short_text |
| TC-F-004 | `short_text = 123` (type mismatch) | threw-ValidationError · INVALID_TYPE | false | false |
| TC-E-001 | `entry.setData { short_text: "hello world" }` | resolved | — | false |
| TC-E-002 | `entry.setData { short_text: "hi" }` | resolved | — | true · short_text |
| TC-E-003 | `entry.setData { short_text: 123 }` | threw-ValidationError · INVALID_TYPE | — | false |

#### `validation_format`

| ID | Operation | Expected setData | field.onError | entry.onError |
|---|---|---|---|---|
| TC-F-001 | `email_field = "user@example.com"` | resolved | false | false |
| TC-F-002 | `email_field = "not-an-email"` | resolved | true · email_field · "Please enter a valid email address" | true · email_field · same message |
| TC-F-003 | `mandatory_text = ""` | resolved | true · mandatory_text | true · mandatory_text |
| TC-F-004 | `email_field = "not-an-email"`, **listen on `mandatory_text`** | resolved | **false** (uid isolation) | true · email_field |
| TC-F-005 | `email_field = 42` (type mismatch) | threw-ValidationError · INVALID_TYPE | false | false |
| TC-E-001 | `entry.setData { email_field: "not-an-email" }` | resolved | — | true · email_field · message |
| TC-E-002 | `entry.setData { mandatory_text: "" }` | resolved | — | true · mandatory_text |

---

## Key decisions

### 1 — JSON is the single source of truth
All test configuration lives in `sdk-test-cases.json`: content-type schema, baseline entry, operations,
and full expected signals including error details.  
The React component is a pure renderer of that JSON — it has no hardcoded assertions.

### 2 — Component remounting instead of listener removal
`field.onError(cb)` and `entry.onError(cb)` register callbacks via an anonymous wrapper on the
internal `_emitter`. There is no public `offError()` / unsubscribe API. Calling
`_emitter.removeListener('onError', cb)` with the original callback does not work because the
wrapper (not `cb`) is what was registered.

**Decision**: `TestCaseRunner` is a child component rendered with
`key={moduleId + '::' + testCaseId}`. Changing the test-case selection unmounts the old instance
and mounts a fresh one. React's lifecycle guarantees the old listeners become inert because the
closures they write to (`fieldOnErrorFired`, etc.) belong to the unmounted instance.

In addition, each `executeTestCase` call uses a **cancellation flag** (`let active = true;`).
The cleanup array sets `active = false` after the post-setData wait. This guards against in-flight
tests that complete after a test-case switch.

### 3 — 450 ms wait before calling setData
`EventRegistry` in `app-sdk` debounces `eventRegistration` messages to the host by 400 ms.
If `setData` fires before the host receives the `onError` subscription, the host never sends
the `onError` event back.

**Decision**: `executeTestCase` waits 450 ms after registering `onError` listeners before
calling `setData`. This is a timing contract, not a race-condition fix — the host must have
acknowledged the subscription before the error can be emitted.

### 4 — onError fires only on error state *change*
The host tracks the previous error state per field. If a field already has the exact same
error (e.g. `mandatory_text` is still empty from a previous run), the host does NOT re-emit
`onError` when the same error recurs.

**Decision**: The **Reset to baseline** button calls `entry.setData(module.baseline)` —
always the full entry regardless of test type — before re-running any test case that expects
`onError` to fire. This clears all field errors and resets the form to a known-good state.

The Reset button is always visible in the UI and should be clicked between consecutive runs
of tests that involve overlapping fields (e.g. TC-F-003 → TC-F-004 in `validation_format`).

### 5 — entry.setData baseline reset (not field.setData)
Resetting only the target field of the previous test leaves other fields in stale error state.
Example: TC-F-003 leaves `mandatory_text = ""`. TC-F-004 then triggers an email format error,
but the form reports errors for **both** `email_field` and `mandatory_text`. The `mandatory_text`
uid isolation listener then (correctly, per SDK) fires because `mandatory_text` is in the
error details.

**Decision**: Reset always uses `entry.setData(module.baseline)` to restore all fields.

### 6 — Partial-match assertion for error details
Using exact-match on `details[]` would make TC-F-004 (uid isolation) brittle: if the form
happens to include extra field errors, the test would fail.

**Decision**: Assertion checks that each expected `fieldUid` exists somewhere in actual
`details[]`, and that each expected `reason`/`message` exists in that field's `reasons[]`.
Extra actual fields or reasons are not penalised.

### 8 — Host sends `details` as a single object, not always an array
When exactly one field has a validation error, the host serialises `details` as a plain object
`{ fieldUid, fieldLabel, fieldType, reasons }` rather than a one-element array.
When multiple fields have errors, `details` is an array.

`serializeError()` in `test-runner.ts` normalises this:
```ts
const details = Array.isArray(rawDetails)
  ? rawDetails
  : rawDetails && typeof rawDetails === 'object'
    ? [rawDetails]
    : [];
```

The host also uses `reason: "INVALID_INPUT"` (not `"FORMAT"`) for format-constraint violations.
Test case JSON therefore does not assert `reason` for format errors — only `message`.

### 7 — message assertions only where message is deterministic
`reasons[].message` is asserted only for fields that define `error_messages` in the
content-type schema (e.g. `email_field` → `"Please enter a valid email address"`).  
For `min_size`/`max_size`/`mandatory` errors the message comes from the host's UI strings
and is not in the content-type schema, so no message assertion is made — only `fieldUid`.

---

## Sequence diagram

```
Test runner                         app-sdk                     app-extension-component (host)
─────────────────────────────────────────────────────────────────────────────────────────────
entry.onError(entryCb)     →   _emitter.on('onError', wrapper)
field.onError(fieldCb)     →   _emitter.on('onError', wrapper)
                               EventRegistry.register('onError')
                                   ↓ debounce 400ms
                               post-robot "eventRegistration"  → host registers onError listener
─── wait 450ms ───
field.setData(data)        →   post-robot "setData"            → Zod validate
                                                                  if fail → { success: false, error }
                               throws ValidationError
                                   OR
                                                                  if pass → handler(event)
                               resolves                           form re-validates
                                                                  if error → post-robot "extensionEvent"
                                                                             { name: "onError", data: err }
                               emitter.emitEvent('onError',[err])
                               wrapper filters by fieldUid
                               entryCb(err) / fieldCb(err)
─── wait 600ms (resolved) or 100ms (threw) ───
cleanup()  →  active = false  (deactivates both callbacks)
return CombinedTestResult
auto-assert → AssertionDetail per signal
```

---

## Running tests

1. Open a Contentstack entry for `sdk_tc_text_const` or `sdk_tc_val_fmt`.
2. The widget appears in the **Entry Sidebar** or **Custom Field** location.
3. Select module and test case from the dropdowns.
4. Click **Reset to baseline** before every run (especially mandatory between TC-F-003 and TC-F-004).
5. Click **▶ Execute**.
6. Results auto-assert. Green `✓ ALL PASS` or red `✗ FAILURES` banner shows overall outcome.
7. Each failing check shows `expected X got Y` in red.
