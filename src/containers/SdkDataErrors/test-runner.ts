import { hydrateSdkDataErrorsPayload, resolveTestAssetUid } from './hydrate-asset-uids';

// Serialized form of a ValidationError as captured across the post-robot boundary.
export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  isValidationError: boolean;
  details?: Array<{
    fieldUid: string;
    fieldLabel?: string;
    fieldType?: string;
    reasons: Array<{ reason: string; message: string }>;
  }>;
}

export type SetDataOutcome =
  | 'resolved'
  | 'threw-ValidationError'
  | 'threw-Error'
  | 'field-not-found';

export interface SetDataSignal {
  outcome: SetDataOutcome;
  error: SerializedError | null;
}

export interface OnErrorSignal {
  fired: boolean;
  error: SerializedError | null;
}

export interface CombinedTestResult {
  setData: SetDataSignal;
  fieldOnError: OnErrorSignal;
  entryOnError: OnErrorSignal;
  elapsedMs: number;
}

export interface TestCaseOperation {
  type: 'field-setdata' | 'entry-setdata';
  targetFieldUid?: string;
  subscribeFieldOnErrorUid: string | null;
  data: unknown;
}

// Unified error expectation — identical shape for setData.error, fieldOnError.error, entryOnError.error.
// All fields are optional: only those present are asserted; others are ignored.
export interface ExpectedErrorDetail {
  fieldUid: string;
  reasons?: Array<{
    reason?: string;   // e.g. "INVALID_TYPE" (Zod rejection)
    message?: string;  // e.g. "Please enter a valid email address" (form validation)
  }>;
}

export interface ExpectedError {
  code?: string;
  message?: string;
  details?: ExpectedErrorDetail[];
}

export interface ExpectedSetDataSignal {
  outcome: string;
  error?: ExpectedError | null;
}

export interface ExpectedOnErrorSignal {
  fired: boolean;
  error?: ExpectedError | null;
}

export interface ExpectedSignals {
  setData: ExpectedSetDataSignal;
  fieldOnError: ExpectedOnErrorSignal;
  entryOnError: ExpectedOnErrorSignal;
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  operation: TestCaseOperation;
  expected: ExpectedSignals;
}

export interface ContentTypeModule {
  id: string;
  name: string;
  description: string;
  contentType: Record<string, unknown>;
  baseline: Record<string, unknown>;
  testCases: TestCase[];
}

// --- Assertion result types ---

export interface AssertionCheck {
  label: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
}

export interface AssertionDetail {
  pass: boolean;
  checks: AssertionCheck[];
}

// --- Internal helpers ---

function serializeError(e: unknown): SerializedError | null {
  if (!e) return null;
  const err = e as any;
  // Host sends details as a single object when only one field is invalid,
  // and as an array when multiple fields are invalid. Normalise to always array.
  const rawDetails = err.details;
  const details = Array.isArray(rawDetails)
    ? rawDetails
    : rawDetails && typeof rawDetails === 'object'
      ? [rawDetails]
      : [];
  return {
    name: err.name ?? 'Error',
    message: err.message ?? String(err),
    code: err.code,
    isValidationError:
      err.code === 'VALIDATION_ERROR' ||
      err.constructor?.name === 'ValidationError',
    details,
  };
}

function getLocationEntry(sdk: any): any {
  const loc = sdk?.location;
  if (loc?.CustomField?.entry) return loc.CustomField.entry;
  if (loc?.SidebarWidget?.entry) return loc.SidebarWidget.entry;
  if (loc?.FieldModifierLocation?.entry) return loc.FieldModifierLocation.entry;
  throw new Error(
    'No supported location (expected CustomField, SidebarWidget, or FieldModifier)',
  );
}

// Partial-match error assertion: every specified field must match; unspecified fields are ignored.
function checkError(
  expected: ExpectedError | null | undefined,
  actual: SerializedError | null,
): AssertionCheck[] {
  if (!expected) return [];
  const checks: AssertionCheck[] = [];

  if (expected.code !== undefined) {
    checks.push({
      label: 'code',
      expected: expected.code,
      actual: actual?.code ?? null,
      pass: actual?.code === expected.code,
    });
  }

  if (expected.message !== undefined) {
    checks.push({
      label: 'message',
      expected: expected.message,
      actual: actual?.message ?? null,
      pass: actual?.message === expected.message,
    });
  }

  for (const expDetail of expected.details ?? []) {
    const actDetail = (actual?.details ?? []).find(d => d.fieldUid === expDetail.fieldUid);

    checks.push({
      label: `fieldUid: ${expDetail.fieldUid}`,
      expected: expDetail.fieldUid,
      actual: actDetail?.fieldUid ?? null,
      pass: !!actDetail,
    });

    if (!actDetail) continue;

    for (const expReason of expDetail.reasons ?? []) {
      if (expReason.reason !== undefined) {
        const found = actDetail.reasons.some(r => r.reason === expReason.reason);
        checks.push({
          label: `reason (${expDetail.fieldUid})`,
          expected: expReason.reason,
          actual: actDetail.reasons.map(r => r.reason).join(', ') || null,
          pass: found,
        });
      }
      if (expReason.message !== undefined) {
        const found = actDetail.reasons.some(r => r.message === expReason.message);
        checks.push({
          label: `message (${expDetail.fieldUid})`,
          expected: expReason.message,
          actual: actDetail.reasons.map(r => r.message).join(', ') || null,
          pass: found,
        });
      }
    }
  }

  return checks;
}

// --- Test execution ---

export interface ExecuteTestCaseOptions {
  /** From `useAppLocation` → `location.entry.getData()?.uid`; falls back to SDK entry if omitted. */
  entryUid?: string;
}

export async function executeTestCase(
  sdk: any,
  testCase: TestCase,
  options?: ExecuteTestCaseOptions,
): Promise<CombinedTestResult> {
  const startTime = Date.now();
  const entry = getLocationEntry(sdk);

  console.group(`[SDK-DE] ▶ ${testCase.id} · "${testCase.name}"`);
  console.log('[SDK-DE] description:', testCase.description);
  console.log('[SDK-DE] expected:', {
    'setData.outcome': testCase.expected.setData.outcome,
    ...(testCase.expected.setData.error ? { 'setData.error': testCase.expected.setData.error } : {}),
    'fieldOnError.fired': testCase.expected.fieldOnError.fired,
    ...(testCase.expected.fieldOnError.error ? { 'fieldOnError.error': testCase.expected.fieldOnError.error } : {}),
    'entryOnError.fired': testCase.expected.entryOnError.fired,
    ...(testCase.expected.entryOnError.error ? { 'entryOnError.error': testCase.expected.entryOnError.error } : {}),
  });

  const assetUid = await resolveTestAssetUid(sdk, sdk?.endpoints?.CMA);
  const entryUid =
    (options?.entryUid ?? '').trim() ||
    String(entry.getData?.()?.uid ?? '').trim();
  const hydrate = (value: any) => hydrateSdkDataErrorsPayload(value, assetUid, entryUid);

  let fieldOnErrorFired = false;
  let fieldOnErrorError: SerializedError | null = null;
  let entryOnErrorFired = false;
  let entryOnErrorError: SerializedError | null = null;

  const cleanup: Array<() => void> = [];

  const subscribeUid = testCase.operation.subscribeFieldOnErrorUid;
  if (subscribeUid) {
    const f = entry.getField(subscribeUid);
    if (f) {
      let active = true;
      const fieldCb = (err: unknown) => {
        if (!active) return;
        fieldOnErrorFired = true;
        fieldOnErrorError = serializeError(err);
        console.log(`[SDK-DE] event field.onError received  field="${subscribeUid}"  error=${JSON.stringify(serializeError(err), null, 2)}`);
      };
      f.onError(fieldCb);
      cleanup.push(() => { active = false; });
    }
  }

  {
    let active = true;
    const entryCb = (err: unknown) => {
      if (!active) return;
      entryOnErrorFired = true;
      entryOnErrorError = serializeError(err);
      console.log(`[SDK-DE] event entry.onError received  error=${JSON.stringify(serializeError(err), null, 2)}`);
    };
    entry.onError(entryCb);
    cleanup.push(() => { active = false; });
  }

  // EventRegistry debounces registration by 400ms before sending to host.
  await new Promise<void>(r => setTimeout(r, 450));

  let outcome: SetDataOutcome = 'resolved';
  let setDataError: SerializedError | null = null;

  try {
    if (testCase.operation.type === 'field-setdata') {
      const targetUid = testCase.operation.targetFieldUid ?? '';
      const field = entry.getField(targetUid);
      if (!field) {
        console.warn(`[SDK-DE] field not found: "${targetUid}"`);
        console.groupEnd();
        cleanup.forEach(fn => fn());
        return {
          setData: {
            outcome: 'field-not-found',
            error: { name: 'Error', message: `Field "${targetUid}" not found`, isValidationError: false },
          },
          fieldOnError: { fired: false, error: null },
          entryOnError: { fired: false, error: null },
          elapsedMs: Date.now() - startTime,
        };
      }
      const hydratedData = hydrate(testCase.operation.data);
      console.log(`[SDK-DE] → field.setData  field="${targetUid}"  data=`, hydratedData);
      await field.setData(hydratedData);
    } else {
      const hydratedData = hydrate(testCase.operation.data) as Record<string, unknown>;
      console.log('[SDK-DE] → entry.setData  data=', hydratedData);
      await entry.setData(hydratedData);
    }
  } catch (e: unknown) {
    const err = e as any;
    const isVE =
      err?.code === 'VALIDATION_ERROR' ||
      err?.constructor?.name === 'ValidationError';
    outcome = isVE ? 'threw-ValidationError' : 'threw-Error';
    setDataError = serializeError(e);
  }

  console.log(`[SDK-DE] ← setData  outcome="${outcome}"  error=${JSON.stringify(setDataError, null, 2)}`);

  const waitMs = outcome === 'resolved' ? 600 : 100;
  await new Promise<void>(r => setTimeout(r, waitMs));

  cleanup.forEach(fn => fn());

  console.log(`[SDK-DE] ← field.onError  fired=${fieldOnErrorFired}  error=${JSON.stringify(fieldOnErrorError, null, 2)}`);
  console.log(`[SDK-DE] ← entry.onError  fired=${entryOnErrorFired}  error=${JSON.stringify(entryOnErrorError, null, 2)}`);
  console.log(`[SDK-DE] elapsed: ${Date.now() - startTime}ms`);
  console.groupEnd();

  return {
    setData: { outcome, error: setDataError },
    fieldOnError: { fired: fieldOnErrorFired, error: fieldOnErrorError },
    entryOnError: { fired: entryOnErrorFired, error: entryOnErrorError },
    elapsedMs: Date.now() - startTime,
  };
}

// --- Assertion functions (return AssertionDetail, not boolean) ---

export function assertSetData(
  result: CombinedTestResult,
  expected: ExpectedSignals,
): AssertionDetail {
  const checks: AssertionCheck[] = [
    {
      label: 'outcome',
      expected: expected.setData.outcome,
      actual: result.setData.outcome,
      pass: result.setData.outcome === expected.setData.outcome,
    },
    ...checkError(expected.setData.error, result.setData.error),
  ];
  return { pass: checks.every(c => c.pass), checks };
}

export function assertFieldOnError(
  result: CombinedTestResult,
  expected: ExpectedSignals,
): AssertionDetail {
  const checks: AssertionCheck[] = [
    {
      label: 'fired',
      expected: expected.fieldOnError.fired,
      actual: result.fieldOnError.fired,
      pass: result.fieldOnError.fired === expected.fieldOnError.fired,
    },
    ...checkError(expected.fieldOnError.error, result.fieldOnError.error),
  ];
  return { pass: checks.every(c => c.pass), checks };
}

export function assertEntryOnError(
  result: CombinedTestResult,
  expected: ExpectedSignals,
): AssertionDetail {
  const checks: AssertionCheck[] = [
    {
      label: 'fired',
      expected: expected.entryOnError.fired,
      actual: result.entryOnError.fired,
      pass: result.entryOnError.fired === expected.entryOnError.fired,
    },
    ...checkError(expected.entryOnError.error, result.entryOnError.error),
  ];
  return { pass: checks.every(c => c.pass), checks };
}
