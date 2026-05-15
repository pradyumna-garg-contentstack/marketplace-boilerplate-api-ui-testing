import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppLocation } from '../../common/hooks/useAppLocation';
import { useAppSdk } from '../../common/hooks/useAppSdk';
import { hydrateSdkDataErrorsPayload, resolveTestAssetUid } from './hydrate-asset-uids';
import './SdkDataErrors.css';
import { allModules } from './test-cases/index';
import {
  AssertionDetail,
  ContentTypeModule,
  ExpectedError,
  ExpectedOnErrorSignal,
  ExpectedSetDataSignal,
  TestCase,
  assertEntryOnError,
  assertFieldOnError,
  assertSetData,
  executeTestCase,
} from './test-runner';

const MODULES: ContentTypeModule[] = [
  ...(allModules as unknown as ContentTypeModule[]),
];

function detectLocation(sdk: any): string {
  const loc = sdk?.location;
  if (loc?.CustomField) return 'custom-field';
  if (loc?.SidebarWidget) return 'entry-sidebar';
  if (loc?.FieldModifierLocation) return 'field-modifier';
  return 'unknown';
}

function getCurrentContentTypeUid(sdk: any): string | null {
  const loc = sdk?.location;
  const entry =
    loc?.CustomField?.entry ??
    loc?.SidebarWidget?.entry ??
    loc?.FieldModifierLocation?.entry;
  return entry?.content_type?.uid ?? null;
}

// --- Expected card sub-components ---

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  return String(v);
}

const ExpectedErrorRows: React.FC<{ error: ExpectedError }> = ({ error }) => (
  <>
    {error.code !== undefined && (
      <div className="sdk-de-kv"><span className="sdk-de-kv-key">code</span><span className="sdk-de-kv-val">{error.code}</span></div>
    )}
    {error.message !== undefined && (
      <div className="sdk-de-kv"><span className="sdk-de-kv-key">message</span><span className="sdk-de-kv-val">&quot;{error.message}&quot;</span></div>
    )}
    {(error.details ?? []).map(d => (
      <React.Fragment key={d.fieldUid}>
        <div className="sdk-de-kv"><span className="sdk-de-kv-key">fieldUid</span><span className="sdk-de-kv-val sdk-de-kv-val--uid">{d.fieldUid}</span></div>
        {(d.reasons ?? []).map((r, i) => (
          <React.Fragment key={i}>
            {r.reason !== undefined && (
              <div className="sdk-de-kv sdk-de-kv--indent"><span className="sdk-de-kv-key">reason</span><span className="sdk-de-kv-val">{r.reason}</span></div>
            )}
            {r.message !== undefined && (
              <div className="sdk-de-kv sdk-de-kv--indent"><span className="sdk-de-kv-key">message</span><span className="sdk-de-kv-val">&quot;{r.message}&quot;</span></div>
            )}
          </React.Fragment>
        ))}
      </React.Fragment>
    ))}
  </>
);

const SetDataExpected: React.FC<{ signal: ExpectedSetDataSignal }> = ({ signal }) => (
  <div className="sdk-de-exp-section">
    <span className="sdk-de-exp-signal">setData</span>
    <div className="sdk-de-kv"><span className="sdk-de-kv-key">outcome</span><span className="sdk-de-kv-val sdk-de-kv-val--outcome">{signal.outcome}</span></div>
    {signal.error && <ExpectedErrorRows error={signal.error} />}
  </div>
);

const OnErrorExpected: React.FC<{ label: string; signal: ExpectedOnErrorSignal }> = ({ label, signal }) => (
  <div className="sdk-de-exp-section">
    <span className="sdk-de-exp-signal">{label}</span>
    <div className="sdk-de-kv"><span className="sdk-de-kv-key">fired</span><span className={`sdk-de-kv-val ${signal.fired ? 'sdk-de-kv-val--true' : 'sdk-de-kv-val--false'}`}>{String(signal.fired)}</span></div>
    {signal.error && <ExpectedErrorRows error={signal.error} />}
  </div>
);

// --- Results card sub-component ---

const CheckRow: React.FC<{ check: { label: string; expected: unknown; actual: unknown; pass: boolean } }> = ({ check }) => (
  <div className={`sdk-de-check-row ${check.pass ? 'sdk-de-check-row--pass' : 'sdk-de-check-row--fail'}`}>
    <span className="sdk-de-check-label">{check.label}</span>
    {check.pass ? (
      <span className="sdk-de-check-actual">{fmtVal(check.actual)}</span>
    ) : (
      <span className="sdk-de-check-mismatch">
        expected&nbsp;<em>{fmtVal(check.expected)}</em>&nbsp;got&nbsp;<em>{fmtVal(check.actual)}</em>
      </span>
    )}
    <span className={`sdk-de-check-icon ${check.pass ? 'sdk-de-check-icon--pass' : 'sdk-de-check-icon--fail'}`}>
      {check.pass ? '✓' : '✗'}
    </span>
  </div>
);

const SignalResult: React.FC<{ label: string; detail: AssertionDetail; testId: string }> = ({ label, detail, testId }) => (
  <div className="sdk-de-result-section">
    <div className={`sdk-de-result-signal ${detail.pass ? 'sdk-de-result-signal--pass' : 'sdk-de-result-signal--fail'}`}>
      <span>{label}</span>
      <span
        data-test-id={testId}
        className={`sdk-de-result-signal-badge ${detail.pass ? 'sdk-de-result-signal-badge--pass' : 'sdk-de-result-signal-badge--fail'}`}
      >
        {detail.pass ? 'PASS' : 'FAIL'}
      </span>
    </div>
    {detail.checks.map((c, i) => <CheckRow key={i} check={c} />)}
  </div>
);

// --- TestCaseRunner ---
// Mounted fresh for every test case selection (via key prop on parent).
// This ensures all onError listeners from the previous test case are deactivated.

interface TestCaseRunnerProps {
  sdk: any;
  testCase: TestCase;
  module: ContentTypeModule;
}

const TestCaseRunner: React.FC<TestCaseRunnerProps> = ({ sdk, testCase, module }) => {
  const { location } = useAppLocation();
  const entryUid = useMemo(() => {
    const locEntry = (location as { entry?: { getData?: () => { uid?: string } } })?.entry;
    return String(locEntry?.getData?.()?.uid ?? '').trim();
  }, [location]);

  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    setDataDetail: AssertionDetail;
    fieldDetail: AssertionDetail;
    entryDetail: AssertionDetail;
    elapsedMs: number;
  } | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const execute = useCallback(async () => {
    if (!sdk) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await executeTestCase(sdk as any, testCase, { entryUid });
      if (!mountedRef.current) return;
      setResult({
        setDataDetail: assertSetData(r, testCase.expected),
        fieldDetail: assertFieldOnError(r, testCase.expected),
        entryDetail: assertEntryOnError(r, testCase.expected),
        elapsedMs: r.elapsedMs,
      });
    } catch (e: any) {
      if (!mountedRef.current) return;
      console.error('[SdkDataErrors] execute caught:', e);
      // Surface unexpected runner errors as a failed setData assertion
      const failedDetail: AssertionDetail = {
        pass: false,
        checks: [{ label: 'runner error', expected: 'no error', actual: e?.message ?? String(e), pass: false }],
      };
      setResult({
        setDataDetail: failedDetail,
        fieldDetail: { pass: false, checks: [] },
        entryDetail: { pass: false, checks: [] },
        elapsedMs: 0,
      });
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }, [sdk, testCase, module, entryUid]);

  const resetToBaseline = useCallback(async () => {
    if (!sdk) return;
    setResetting(true);
    setResetError(null);
    try {
      const entry = (location as any)?.entry;
      if (!entry) throw new Error('No entry found in current location');
      // Reset field-by-field using field.setData (confirmed supported).
      // entry.setData sends setEntryData which may not be handled by older host versions.
      const assetUid = await resolveTestAssetUid(sdk, (sdk as any)?.endpoints?.CMA);
      const baseline = hydrateSdkDataErrorsPayload(
        { ...(module.baseline as Record<string, unknown>) },
        assetUid,
        entryUid,
      ) as Record<string, unknown>;
      for (const [uid, value] of Object.entries(baseline)) {
        const field = entry.getField(uid);
        if (field) await field.setData(value);
      }
      if (mountedRef.current) setResult(null);
    } catch (e: any) {
      if (mountedRef.current) setResetError(e?.message ?? String(e));
    } finally {
      if (mountedRef.current) setResetting(false);
    }
  }, [sdk, module, location, entryUid]);

  const op = testCase.operation;
  const exp = testCase.expected;
  const overallPass = result ? (result.setDataDetail.pass && result.fieldDetail.pass && result.entryDetail.pass) : null;

  return (
    <>
      <div className="sdk-de-description">{testCase.description}</div>

      {/* Operation card */}
      <div className="sdk-de-card">
        <div className="sdk-de-card-title">OPERATION</div>
        <div className="sdk-de-kv"><span className="sdk-de-kv-key">type</span><span className="sdk-de-kv-val">{op.type}</span></div>
        {op.targetFieldUid && (
          <div className="sdk-de-kv"><span className="sdk-de-kv-key">target</span><span className="sdk-de-kv-val sdk-de-kv-val--uid">{op.targetFieldUid}</span></div>
        )}
        {op.subscribeFieldOnErrorUid && (
          <div className="sdk-de-kv"><span className="sdk-de-kv-key">listen</span><span className="sdk-de-kv-val sdk-de-kv-val--uid">{op.subscribeFieldOnErrorUid}</span></div>
        )}
        <div className="sdk-de-kv">
          <span className="sdk-de-kv-key">data</span>
          <span className="sdk-de-kv-val sdk-de-kv-val--data">{JSON.stringify(op.data)}</span>
        </div>
      </div>

      {/* Expected card */}
      <div className="sdk-de-card">
        <div className="sdk-de-card-title">EXPECTED</div>
        <SetDataExpected signal={exp.setData} />
        <OnErrorExpected label="field.onError" signal={exp.fieldOnError} />
        <OnErrorExpected label="entry.onError" signal={exp.entryOnError} />
      </div>

      {/* Action buttons */}
      <div className="sdk-de-actions">
        <button
          data-test-id="sdk-de-execute"
          className="sdk-de-run-btn"
          onClick={execute}
          disabled={running || !sdk}
        >
          {running ? 'Running…' : '▶  Execute'}
        </button>
        <button
          data-test-id="sdk-de-reset"
          className="sdk-de-reset-btn"
          onClick={resetToBaseline}
          disabled={resetting || running || !sdk}
        >
          {resetting ? 'Resetting…' : '↺  Reset to baseline'}
        </button>
      </div>

      {resetError && (
        <div className="sdk-de-reset-error">Reset failed: {resetError}</div>
      )}

      {/* Results card */}
      {result && (
        <div className="sdk-de-card sdk-de-card--results">
          <div className="sdk-de-card-title">
            RESULTS
            <span className="sdk-de-elapsed">({result.elapsedMs}ms)</span>
            <span className={`sdk-de-overall ${overallPass ? 'sdk-de-overall--pass' : 'sdk-de-overall--fail'}`}>
              {overallPass ? '✓ ALL PASS' : '✗ FAILURES'}
            </span>
          </div>
          <SignalResult label="setData"       detail={result.setDataDetail} testId="sdk-de-setdata-status" />
          <SignalResult label="field.onError" detail={result.fieldDetail}   testId="sdk-de-field-on-error-status" />
          <SignalResult label="entry.onError" detail={result.entryDetail}   testId="sdk-de-entry-on-error-status" />
        </div>
      )}
    </>
  );
};

// --- Root component (module/test-case selectors only) ---

const SdkDataErrors: React.FC = () => {
  const appSdk = useAppSdk();
  const locationType = useMemo(() => detectLocation(appSdk), [appSdk]);
  const currentCtUid = useMemo(() => getCurrentContentTypeUid(appSdk), [appSdk]);

  const availableModules = useMemo(
    () => (currentCtUid ? MODULES.filter(m => (m.contentType as any).uid === currentCtUid) : MODULES),
    [currentCtUid],
  );

  const [selectedModuleId, setSelectedModuleId] = useState<string>(availableModules[0]?.id ?? '');
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string>(
    availableModules[0]?.testCases[0]?.id ?? '',
  );

  const selectedModule = useMemo(
    () => availableModules.find(m => m.id === selectedModuleId) ?? availableModules[0],
    [availableModules, selectedModuleId],
  );

  const selectedTestCase = useMemo(
    () => selectedModule?.testCases.find(tc => tc.id === selectedTestCaseId) ?? selectedModule?.testCases[0],
    [selectedModule, selectedTestCaseId],
  ) as TestCase | undefined;

  const onModuleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const mid = e.target.value;
    setSelectedModuleId(mid);
    const mod = availableModules.find(m => m.id === mid);
    const firstTcId = mod?.testCases[0]?.id ?? '';
    setSelectedTestCaseId(firstTcId);
    console.log(`[SDK-DE] module selected: ${mid} · "${mod?.name ?? ''}"`);
    if (mod?.testCases[0]) {
      const tc = mod.testCases[0];
      console.log(`[SDK-DE] test case auto-selected: ${tc.id} · "${tc.name}"`);
      console.log('[SDK-DE] expected:', {
        'setData.outcome': tc.expected.setData.outcome,
        'fieldOnError.fired': tc.expected.fieldOnError.fired,
        'entryOnError.fired': tc.expected.entryOnError.fired,
      });
    }
  }, [availableModules]);

  const onTestCaseChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const tcId = e.target.value;
    setSelectedTestCaseId(tcId);
    const tc = selectedModule?.testCases.find(t => t.id === tcId);
    console.log(`[SDK-DE] test case selected: ${tcId} · "${tc?.name ?? ''}"`);
    if (tc) {
      console.log('[SDK-DE] expected:', {
        'setData.outcome': tc.expected.setData.outcome,
        'fieldOnError.fired': tc.expected.fieldOnError.fired,
        'entryOnError.fired': tc.expected.entryOnError.fired,
      });
    }
  }, [selectedModule]);

  return (
    <div className="sdk-de-root">
      <div className="sdk-de-header">
        <span className="sdk-de-title">SDK v2.4 · setData / onError Tests</span>
        <span className="sdk-de-location">Location: {locationType}</span>
      </div>

      {availableModules.length === 0 && (
        <div className="sdk-de-description" style={{ color: '#b45309' }}>
          No test modules for content type <code>{currentCtUid ?? 'unknown'}</code>.
          Open an entry from one of the sdk_tc_* content types.
        </div>
      )}

      {availableModules.length > 0 && (
        <>
          <div className="sdk-de-controls">
            <label className="sdk-de-label" htmlFor="sdk-de-module-select">Module</label>
            <select
              id="sdk-de-module-select"
              data-test-id="sdk-de-module-select"
              className="sdk-de-select"
              value={selectedModuleId}
              onChange={onModuleChange}
            >
              {availableModules.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>

            <label className="sdk-de-label" htmlFor="sdk-de-testcase-select">Test Case</label>
            <select
              id="sdk-de-testcase-select"
              data-test-id="sdk-de-testcase-select"
              className="sdk-de-select"
              value={selectedTestCaseId}
              onChange={onTestCaseChange}
            >
              {(selectedModule?.testCases ?? []).map(tc => (
                <option key={tc.id} value={tc.id}>{tc.id} · {tc.name}</option>
              ))}
            </select>
          </div>

          {selectedModule && selectedTestCase && (
            <TestCaseRunner
              key={`${selectedModuleId}::${selectedTestCaseId}`}
              sdk={appSdk}
              testCase={selectedTestCase}
              module={selectedModule}
            />
          )}
        </>
      )}
    </div>
  );
};

export default SdkDataErrors;
