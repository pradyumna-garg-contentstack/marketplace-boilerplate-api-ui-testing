import { Button } from '@contentstack/venus-components';
import React, { useCallback, useEffect, useState } from 'react';
import { useAppSdk } from '../../common/hooks/useAppSdk';
import { SdkTestTable } from '../../components/SdkTestTable/SdkTestTable';
import { useSdkTesting } from '../../hooks/useSdkTesting';
import { SDK_TEST_CATEGORIES } from '../../services/sdk-operations';
import { allModules } from '../SdkDataErrors/test-cases/index';
import { hydrateEntryWithAssetUid, resolveTestAssetUid } from '../SdkDataErrors/hydrate-asset-uids';
import { ContentTypeModule } from '../SdkDataErrors/test-runner';
import '../index.css';
import './FullPage.css';

const ALL_MODULES: ContentTypeModule[] = [...(allModules as unknown as ContentTypeModule[])];

interface ModuleStatus {
  state: 'checking' | 'idle' | 'creating' | 'deleting' | 'ready' | 'error';
  entryUid?: string;
  error?: string;
}

type ContentTypeSchemaField = {
  uid?: string;
  data_type?: string;
  reference_to?: string;
  display_name?: string;
  taxonomies?: unknown;
  extension_uid?: string;
  schema?: ContentTypeSchemaField[];
  [k: string]: unknown;
};

let cachedFieldExtensionUid = '';

async function getEnabledFieldExtensionUid(sdk: any, cmaBase: string): Promise<string> {
  if (cachedFieldExtensionUid) return cachedFieldExtensionUid;

  const desiredName: string =
    // Optional override for local/dev environments (CRA-style env var).
    (process.env.REACT_APP_SDK_DATA_ERRORS_EXTENSION_NAME as string | undefined) ||
    // Default expected extension/app name in Contentstack.
    'Set Data';

  // Use the same query as provided by the user (CMA extensions listing).
  // NOTE: cmaBase already includes `/api` in most environments; we append `/v3/...`.
  const query = encodeURIComponent(JSON.stringify({ type: 'field', enable: true }));
  const url =
    `${cmaBase}/v3/extensions` +
    `?skip=0&limit=30&include_count=true&query=${query}` +
    `&include_marketplace_extensions=true&desc=updated_at`;

  const res = await sdk.api(url, { method: 'GET' });
  if (!res.ok) return '';

  const json = await res.json().catch(() => ({}));
  const list: any[] = Array.isArray(json?.extensions)
    ? json.extensions
    : Array.isArray(json?.extensions?.items)
      ? json.extensions.items
      : [];

  const desired = desiredName.trim().toLowerCase();
  const match = desired
    ? list.find((e) => {
        const title = String(e?.title ?? e?.name ?? '').trim().toLowerCase();
        return title === desired || title.includes(desired) || desired.includes(title);
      })
    : null;

  const uid: string = match?.uid ?? list?.[0]?.uid ?? '';

  cachedFieldExtensionUid = uid;
  return uid;
}

function hydrateContentTypeWithExtensionUid(contentType: any, extensionUid: string) {
  if (!extensionUid) return contentType;
  const schema: ContentTypeSchemaField[] = Array.isArray(contentType?.schema) ? contentType.schema : [];

  const nextSchema = schema.map((f) => {
    const fm = (f as any)?.field_metadata;
    if (fm && typeof fm === 'object' && fm.extension === true) {
      return { ...f, extension_uid: extensionUid };
    }
    return f;
  });

  return { ...contentType, schema: nextSchema };
}

async function ensureTaxonomyExists(sdk: any, cmaBase: string, taxonomyUid: string) {
  if (!taxonomyUid) return;

  const getRes = await sdk.api(`${cmaBase}/v3/taxonomies/${taxonomyUid}`, { method: 'GET' });
  if (getRes.ok) return;

  const createRes = await sdk.api(`${cmaBase}/v3/taxonomies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      taxonomy: {
        uid: taxonomyUid,
        name: taxonomyUid,
        description: 'SDK test taxonomy (auto-created)',
      },
      terms: [],
    },
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err?.error_message || `Failed to create taxonomy: ${taxonomyUid}`);
  }
}

async function ensureTaxonomyTermExists(
  sdk: any,
  cmaBase: string,
  taxonomyUid: string,
  termUid: string,
) {
  if (!taxonomyUid || !termUid) return;

  const getRes = await sdk.api(`${cmaBase}/v3/taxonomies/${taxonomyUid}/terms/${termUid}`, {
    method: 'GET',
  });
  if (getRes.ok) return;

  const createRes = await sdk.api(`${cmaBase}/v3/taxonomies/${taxonomyUid}/terms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      term: {
        uid: termUid,
        name: termUid,
        parent_uid: null,
      },
    },
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(
      err?.error_message || `Failed to create taxonomy term: ${termUid} (${taxonomyUid})`,
    );
  }
}

function extractTaxonomyUids(field: ContentTypeSchemaField): string[] {
  // CMA accepts "taxonomies" as an array of objects like { taxonomy_uid: string, ... } for taxonomy fields.
  const tx = field?.taxonomies;
  if (!Array.isArray(tx)) return [];
  const uids = tx
    .map((t: any) => (typeof t?.taxonomy_uid === 'string' ? t.taxonomy_uid : ''))
    .filter(Boolean);
  return Array.from(new Set(uids));
}

async function ensureReferencedTaxonomiesExist(sdk: any, cmaBase: string, contentType: any) {
  const schema: ContentTypeSchemaField[] = Array.isArray(contentType?.schema) ? contentType.schema : [];
  const taxonomyFields = schema.filter(f => f?.data_type === 'taxonomy');

  const taxonomyUids = Array.from(new Set(taxonomyFields.flatMap(extractTaxonomyUids)));
  for (const uid of taxonomyUids) {
    // Safety: only auto-create test taxonomies (avoid polluting real stacks).
    if (!uid.startsWith('sdk_tc_') && !uid.startsWith('taxonomy_')) continue;
    await ensureTaxonomyExists(sdk, cmaBase, uid);
    // Ensure common test terms exist so test cases can use stable term_uids.
    await ensureTaxonomyTermExists(sdk, cmaBase, uid, 'term_test1');
    await ensureTaxonomyTermExists(sdk, cmaBase, uid, 'term_test2');
  }
}

async function ensureGlobalFieldExists(
  sdk: any,
  cmaBase: string,
  globalFieldUid: string,
  schema: ContentTypeSchemaField[] = [],
  title?: string,
) {
  if (!globalFieldUid) return;

  const getRes = await sdk.api(`${cmaBase}/v3/global_fields/${globalFieldUid}`, { method: 'GET' });
  if (getRes.ok) return;

  const createRes = await sdk.api(`${cmaBase}/v3/global_fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      global_field: {
        uid: globalFieldUid,
        title: title || globalFieldUid,
        schema,
      },
    },
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err?.error_message || `Failed to create global field: ${globalFieldUid}`);
  }
}

async function ensureReferencedGlobalFieldsExist(sdk: any, cmaBase: string, contentType: any) {
  const schema: ContentTypeSchemaField[] = Array.isArray(contentType?.schema) ? contentType.schema : [];
  const globalFields = schema.filter(f => f?.data_type === 'global_field' && typeof f?.reference_to === 'string');

  for (const gf of globalFields) {
    await ensureGlobalFieldExists(
      sdk,
      cmaBase,
      String(gf.reference_to),
      Array.isArray(gf.schema) ? gf.schema : [],
      typeof gf.display_name === 'string' ? gf.display_name : undefined,
    );
  }
}

async function deleteReferencedGlobalFields(sdk: any, cmaBase: string, contentType: any) {
  const schema: ContentTypeSchemaField[] = Array.isArray(contentType?.schema) ? contentType.schema : [];
  const globalFields = schema.filter(f => f?.data_type === 'global_field' && typeof f?.reference_to === 'string');
  const uids = Array.from(new Set(globalFields.map(gf => String(gf.reference_to)).filter(Boolean)));

  const failures: Array<{ uid: string; message: string }> = [];
  for (const uid of uids) {
    // Safety: only clean up test artifacts we own.
    if (!uid.startsWith('sdk_tc_')) continue;

    try {
      const res = await sdk.api(`${cmaBase}/v3/global_fields/${uid}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        failures.push({ uid, message: err?.error_message || `Failed to delete global field: ${uid}` });
      }
    } catch (e: any) {
      failures.push({ uid, message: e?.message ?? String(e) });
    }
  }

  return failures;
}

const ModuleManager: React.FC = () => {
  const appSdk = useAppSdk();
  const [moduleStatuses, setModuleStatuses] = useState<Record<string, ModuleStatus>>(() =>
    Object.fromEntries(ALL_MODULES.map(m => [m.id, { state: 'checking' }])),
  );

  const setStatus = useCallback((moduleId: string, status: ModuleStatus) => {
    setModuleStatuses(prev => ({ ...prev, [moduleId]: status }));
  }, []);

  useEffect(() => {
    if (!appSdk) return;
    const sdk = appSdk as any;
    const cmaBase = sdk.endpoints?.CMA;
    if (!cmaBase) return;

    ALL_MODULES.forEach(async mod => {
      try {
        const ctRes = await sdk.api(`${cmaBase}/v3/content_types/${mod.contentType.uid}`, {
          method: 'GET',
        });
        if (!ctRes.ok) {
          setStatus(mod.id, { state: 'idle' });
          return;
        }

        // CT exists — also fetch the first entry to recover its UID
        const entriesRes = await sdk.api(
          `${cmaBase}/v3/content_types/${mod.contentType.uid}/entries?limit=1`,
          { method: 'GET' },
        );
        const entriesJson = entriesRes.ok ? await entriesRes.json() : {};
        const entryUid: string = entriesJson?.entries?.[0]?.uid ?? '';
        setStatus(mod.id, { state: 'ready', entryUid });
      } catch {
        // network error — fall back to idle so the user can still attempt create
        setStatus(mod.id, { state: 'idle' });
      }
    });
  }, [appSdk, setStatus]);

  const createModule = useCallback(
    async (moduleId: string) => {
      if (!appSdk) return;
      const mod = ALL_MODULES.find(m => m.id === moduleId);
      if (!mod) return;

      setStatus(moduleId, { state: 'creating' });
      try {
        const sdk = appSdk as any;
        const cmaBase = sdk.endpoints.CMA;

        await ensureReferencedTaxonomiesExist(sdk, cmaBase, mod.contentType);
        await ensureReferencedGlobalFieldsExist(sdk, cmaBase, mod.contentType);

        const fieldExtensionUid = await getEnabledFieldExtensionUid(sdk, cmaBase);
        const hydratedContentType = hydrateContentTypeWithExtensionUid(mod.contentType, fieldExtensionUid);

        const ctRes = await sdk.api(`${cmaBase}/v3/content_types`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { content_type: hydratedContentType },
        });
        if (!ctRes.ok) {
          const err = await ctRes.json();
          throw new Error(err?.error_message || 'Failed to create content type');
        }

        const entryRes = await sdk.api(
          `${cmaBase}/v3/content_types/${mod.contentType.uid}/entries`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: {
              entry: hydrateEntryWithAssetUid(mod.baseline, await resolveTestAssetUid(sdk, cmaBase)),
            },
          },
        );
        if (!entryRes.ok) {
          const err = await entryRes.json();
          throw new Error(err?.error_message || 'Failed to create entry');
        }
        const entryJson = await entryRes.json();
        const entryUid: string = entryJson?.entry?.uid ?? entryJson?.uid ?? '';
        setStatus(moduleId, { state: 'ready', entryUid });
      } catch (e: any) {
        setStatus(moduleId, { state: 'error', error: e?.message ?? String(e) });
      }
    },
    [appSdk, setStatus],
  );

  const deleteModule = useCallback(
    async (moduleId: string) => {
      if (!appSdk) return;
      const mod = ALL_MODULES.find(m => m.id === moduleId);
      if (!mod) return;

      setStatus(moduleId, { state: 'deleting' });
      try {
        const sdk = appSdk as any;
        const cmaBase = sdk.endpoints.CMA;

        const res = await sdk.api(
          `${cmaBase}/v3/content_types/${mod.contentType.uid}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err?.error_message || 'Failed to delete content type');
        }

        const gfFailures = await deleteReferencedGlobalFields(sdk, cmaBase, mod.contentType);
        if (gfFailures.length > 0) {
          setStatus(moduleId, {
            state: 'error',
            error:
              `Content type deleted, but failed to delete global fields: ` +
              gfFailures.map(f => `${f.uid} (${f.message})`).join(', '),
          });
          return;
        }

        setStatus(moduleId, { state: 'idle' });
      } catch (e: any) {
        setStatus(moduleId, { state: 'error', error: e?.message ?? String(e) });
      }
    },
    [appSdk, setStatus],
  );

  const goToEntry = useCallback(
    (moduleId: string) => {
      if (!appSdk) return;
      const sdk = appSdk as any;
      const mod = ALL_MODULES.find(m => m.id === moduleId);
      const entryUid = moduleStatuses[moduleId]?.entryUid;
      if (!mod || !entryUid) return;

      const stackApiKey: string = sdk.ids?.apiKey ?? sdk.ids?.stack ?? '';
      const branch: string = sdk.stack?.getCurrentBranch?.()?.uid ?? 'main';
      const appOrigin =
        window.location.ancestorOrigins?.[0] ??
        (document.referrer ? new URL(document.referrer).origin : 'https://app.contentstack.com');
      const url = `${appOrigin}/#!/stack/${stackApiKey}/content-type/${mod.contentType.uid}/en-us/entry/${entryUid}/edit?branch=${branch}`;
      window.open(url, '_blank');
    },
    [appSdk, moduleStatuses],
  );

  return (
    <div data-test-id="module-manager" className="sdk-test-table-container">
      <h3>SDK Test Module Manager</h3>
      <table className="venus-enhanced-table">
        <tbody>
          {ALL_MODULES.map(mod => {
            const status = moduleStatuses[mod.id] ?? { state: 'idle' };
            const busy = status.state === 'creating' || status.state === 'deleting';
            const isReady = status.state === 'ready';

            return (
              <tr key={mod.id} data-test-id={`module-manager-row-${mod.id}`} className="venus-table-row">
                <td className="venus-table-cell">
                  <div className="sdk-test-name-cell">
                    <div className="sdk-test-name">{mod.name}</div>
                    <div className="sdk-test-description" style={{ fontFamily: 'monospace' }}>
                      {mod.contentType.uid as string}
                    </div>
                  </div>
                </td>

                <td className="venus-table-cell">
                  {status.state === 'checking' ? null : !isReady ? (
                    <Button
                      buttonType="primary"
                      size="small"
                      onClick={() => createModule(mod.id)}
                      disabled={busy}
                      data-test-id={`module-manager-create-${mod.id}`}
                    >
                      {status.state === 'creating' ? 'Creating...' : 'Create'}
                    </Button>
                  ) : (
                    <Button
                      buttonType="danger"
                      size="small"
                      onClick={() => deleteModule(mod.id)}
                      disabled={busy}
                      data-test-id={`module-manager-delete-${mod.id}`}
                    >
                      {status.state === 'deleting' ? 'Deleting...' : 'Delete'}
                    </Button>
                  )}
                </td>

                <td className="venus-table-cell venus-table-cell--status">
                  <span data-test-id={`module-manager-status-${mod.id}`} style={{ display: 'none' }}>
                    {status.state}
                  </span>
                  {status.state === 'checking' && (
                    <div className="loading-pill">Checking…</div>
                  )}
                  {busy && (
                    <div className="loading-pill">
                      {status.state === 'creating' ? 'Creating…' : 'Deleting…'}
                    </div>
                  )}
                  {isReady && <div className="success-pill">Ready</div>}
                  {status.state === 'idle' && <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>Not created</div>}
                  {status.state === 'error' && (
                    <div className="error-pill" title={status.error}>Error</div>
                  )}
                </td>

                <td className="venus-table-cell">
                  {isReady && status.entryUid && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        data-test-id={`module-manager-entry-uid-${mod.id}`}
                        style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#495057' }}
                      >
                        {status.entryUid}
                      </span>
                      <Button
                        buttonType="secondary"
                        size="small"
                        onClick={() => goToEntry(mod.id)}
                        data-test-id={`module-manager-goto-${mod.id}`}
                      >
                        Go to Entry ↗
                      </Button>
                    </div>
                  )}
                  {status.state === 'error' && (
                    <span style={{ fontSize: '0.8rem', color: '#dc2626' }}>{status.error}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const FullPageExtension: React.FC = () => {
  const appSdk = useAppSdk();
  const { state, executeOperation, getFormattedResult, isReady } = useSdkTesting();

  if (!isReady) {
    return (
      <div className="layout-container">
        <div className="ui-location">
          <div className="ui-container">
            <p>Initializing SDK...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout-container">
      <div className="ui-location">
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>SDK Testing Playground</h1>

        {state.globalError && (
          <div
            className="error-banner"
            data-test-id="sdk-error"
            style={{
              padding: '12px',
              marginBottom: '16px',
              backgroundColor: '#ffebee',
              color: '#c62828',
              borderRadius: '4px',
              border: '1px solid #ef5350',
            }}
          >
            {state.globalError}
          </div>
        )}

        <div style={{ width: '100%' }}>
          <SdkTestTable
            title={SDK_TEST_CATEGORIES.CORE.name}
            operations={SDK_TEST_CATEGORIES.CORE.operations}
            results={state.results}
            onExecute={executeOperation}
            getFormattedResult={getFormattedResult}
          />

          <SdkTestTable
            title={SDK_TEST_CATEGORIES.CMA.name}
            operations={SDK_TEST_CATEGORIES.CMA.operations}
            results={state.results}
            onExecute={executeOperation}
            getFormattedResult={getFormattedResult}
          />

          {appSdk && SDK_TEST_CATEGORIES.FRAME.condition?.(appSdk) && (
            <SdkTestTable
              title={SDK_TEST_CATEGORIES.FRAME.name}
              operations={SDK_TEST_CATEGORIES.FRAME.operations}
              results={state.results}
              onExecute={executeOperation}
              getFormattedResult={getFormattedResult}
            />
          )}

          <SdkTestTable
            title={SDK_TEST_CATEGORIES.CRUD.name}
            operations={SDK_TEST_CATEGORIES.CRUD.operations}
            results={state.results}
            onExecute={executeOperation}
            getFormattedResult={getFormattedResult}
          />

          <SdkTestTable
            title={SDK_TEST_CATEGORIES.API.name}
            operations={SDK_TEST_CATEGORIES.API.operations}
            results={state.results}
            onExecute={executeOperation}
            getFormattedResult={getFormattedResult}
          />

          <SdkTestTable
            title={SDK_TEST_CATEGORIES.STORE.name}
            operations={SDK_TEST_CATEGORIES.STORE.operations}
            results={state.results}
            onExecute={executeOperation}
            getFormattedResult={getFormattedResult}
          />

          <SdkTestTable
            title={SDK_TEST_CATEGORIES.METADATA.name}
            operations={SDK_TEST_CATEGORIES.METADATA.operations}
            results={state.results}
            onExecute={executeOperation}
            getFormattedResult={getFormattedResult}
          />
        </div>

        <ModuleManager />
      </div>
    </div>
  );
};

export default FullPageExtension;
