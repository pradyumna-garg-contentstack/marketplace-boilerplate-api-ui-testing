/**
 * File-field fixtures use fixed placeholder UIDs. Stack validation needs real assets.
 * Only the allowlisted placeholders are replaced — not every `blt*` string
 * (reference tests use fake entry UIDs like bltabc123).
 *
 * Replacement UID: REACT_APP_SDK_DATA_ERRORS_ASSET_UID if set, else first asset from CMA (on the fly).
 */

const SDK_TEST_FILE_ASSET_PLACEHOLDER_UIDS = new Set([
  'blt1234abcd5678ef00',
  'bltaaa111',
  'bltbbb222',
  'bltccc333',
]);

export function getTestAssetUidFromEnv(): string {
  return (process.env.REACT_APP_SDK_DATA_ERRORS_ASSET_UID ?? '').trim();
}

async function getAnyAssetUid(sdk: any, cmaBase: string): Promise<string> {
  const res = await sdk.api(`${cmaBase}/v3/assets?limit=1`, { method: 'GET' });
  if (!res.ok) return '';
  const json = await res.json().catch(() => ({}));
  return json?.assets?.[0]?.uid ?? '';
}

/** Prefer env; otherwise fetch one asset from the stack (same session as the app). */
export async function resolveTestAssetUid(sdk: any, cmaBase: string | undefined): Promise<string> {
  const fromEnv = getTestAssetUidFromEnv();
  if (fromEnv) return fromEnv;
  if (!cmaBase) return '';
  return getAnyAssetUid(sdk, cmaBase);
}

function isSdkTestFileAssetPlaceholder(value: string): boolean {
  return SDK_TEST_FILE_ASSET_PLACEHOLDER_UIDS.has(value);
}

export function hydrateEntryWithAssetUid(entry: any, assetUid: string): any {
  if (!assetUid) return entry;
  if (entry === null || entry === undefined) return entry;

  if (typeof entry === 'string') {
    return isSdkTestFileAssetPlaceholder(entry) ? assetUid : entry;
  }
  if (Array.isArray(entry)) return entry.map((v) => hydrateEntryWithAssetUid(v, assetUid));
  if (typeof entry === 'object') {
    const obj: any = entry;
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'uid' && typeof v === 'string' && isSdkTestFileAssetPlaceholder(v)) {
        out[k] = assetUid;
      } else {
        out[k] = hydrateEntryWithAssetUid(v, assetUid);
      }
    }
    return out;
  }
  return entry;
}

/** Reference fixtures use `uid: "self_uid"` for self-references (see reference-field.json). */
const SELF_UID_PLACEHOLDER = 'self_uid';

export function hydrateSelfUid(value: any, entryUid: string): any {
  if (!entryUid) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value === SELF_UID_PLACEHOLDER ? entryUid : value;
  }
  if (Array.isArray(value)) return value.map((v) => hydrateSelfUid(v, entryUid));
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = hydrateSelfUid(v, entryUid);
    }
    return out;
  }
  return value;
}

export function hydrateSdkDataErrorsPayload(value: any, assetUid: string, entryUid: string): any {
  return hydrateSelfUid(hydrateEntryWithAssetUid(value, assetUid), entryUid);
}
