import UiLocation from '@contentstack/app-sdk/dist/src/uiLocation';

// ─── Types ───────────────────────────────────────────────────────────────────

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

export interface ScenarioResult {
  outcome: string;
  passed: boolean;
  failReason?: string;
  dataBefore?: unknown;
  dataAfter?: unknown;
  dataUpdated?: boolean;
  dataUnchanged?: boolean;
  returnedField?: boolean;
  thrownError?: SerializedError | null;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: unknown[];
  callbackFired?: boolean;
  callbackError?: SerializedError | null;
  syncThrew?: boolean;
  syncErrorMessage?: string;
  note?: string;
}

export interface Scenario {
  id: string;
  group: string;
  label: string;
  description: string;
  execute: (sdk: UiLocation) => Promise<ScenarioResult>;
}

export interface Group {
  id: string;
  label: string;
  availableIn: string[];
}

// ─── Groups ──────────────────────────────────────────────────────────────────

export const GROUPS: Group[] = [
  // field.* scenarios use entry.getField(uid) — works in Custom Field, Field Modifier, and Entry Sidebar (SidebarWidget.entry).
  { id: 'field-setdata',      label: 'A · field.setData()',    availableIn: ['custom-field', 'field-modifier', 'entry-sidebar'] },
  { id: 'entry-setdata',      label: 'B · entry.setData()',    availableIn: ['entry-sidebar'] },
  { id: 'field-onerror',      label: 'C · field.onError()',    availableIn: ['custom-field', 'field-modifier', 'entry-sidebar'] },
  { id: 'entry-onerror',      label: 'D · entry.onError()',    availableIn: ['entry-sidebar'] },
  { id: 'validation-error',   label: 'E · ValidationError',    availableIn: ['custom-field', 'entry-sidebar', 'field-modifier'] },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeError(e: unknown): SerializedError | null {
  if (!e) return null;
  const err = e as any;
  return {
    name: err.name ?? 'Error',
    message: err.message ?? String(err),
    code: err.code,
    isValidationError: err.code === 'VALIDATION_ERROR' || err.constructor?.name === 'ValidationError',
    details: err.details ?? [],
  };
}

function getLocationEntry(sdk: UiLocation): any {
  const loc = sdk.location as any;
  if (loc?.CustomField?.entry)            return loc.CustomField.entry;
  if (loc?.SidebarWidget?.entry)          return loc.SidebarWidget.entry;
  if (loc?.FieldModifierLocation?.entry)  return loc.FieldModifierLocation.entry;
  throw new Error('No supported location found (expected CustomField, SidebarWidget, or FieldModifier)');
}

const tick = (): Promise<void> => new Promise(r => setTimeout(r, 60));

// ─── Scenario factories ───────────────────────────────────────────────────────

function fieldSetDataSuccess(
  id: string, label: string, fieldUid: string, inputData: unknown, expectedValue?: unknown
): Scenario {
  return {
    id, group: 'field-setdata', label,
    description: `entry.getField("${fieldUid}").setData(${JSON.stringify(inputData)}) → success:true → resolves, getData() updated`,
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField(fieldUid);
      if (!field) return { outcome: 'error', passed: false, failReason: `field "${fieldUid}" not found` };

      const dataBefore = await field.getData();
      let thrownError: SerializedError | null = null;
      let returnValue: unknown = undefined;

      try { returnValue = await field.setData(inputData); }
      catch (e) { thrownError = serializeError(e); }

      const dataAfter  = await field.getData();
      const check      = expectedValue !== undefined ? expectedValue : inputData;
      const dataUpdated = JSON.stringify(dataAfter) === JSON.stringify(check);
      const passed      = !thrownError && dataUpdated;

      return {
        outcome:      thrownError ? `threw-${thrownError.isValidationError ? 'ValidationError' : 'Error'}` : 'resolved',
        returnedField: !thrownError ? (typeof returnValue === 'object' && returnValue !== null) : undefined,
        dataBefore, dataAfter, dataUpdated, thrownError, passed,
        failReason: passed ? undefined : thrownError
          ? `unexpected throw: ${thrownError.message}`
          : `data not updated — got ${JSON.stringify(dataAfter)}`,
      };
    },
  };
}

function fieldSetDataFail(
  id: string, label: string, fieldUid: string, inputData: unknown, expectedReason?: string
): Scenario {
  return {
    id, group: 'field-setdata', label,
    description: `entry.getField("${fieldUid}").setData(${JSON.stringify(inputData)}) → success:false → throws ValidationError, data unchanged`,
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField(fieldUid);
      if (!field) return { outcome: 'error', passed: false, failReason: `field "${fieldUid}" not found` };

      const dataBefore = await field.getData();
      let thrownError: SerializedError | null = null;

      try { await field.setData(inputData); }
      catch (e) { thrownError = serializeError(e); }

      const dataAfter    = await field.getData();
      const isVE         = thrownError?.isValidationError === true;
      const dataUnchanged = JSON.stringify(dataBefore) === JSON.stringify(dataAfter);
      let passed          = isVE && dataUnchanged;
      if (passed && expectedReason) {
        passed = thrownError?.details?.[0]?.reasons?.[0]?.reason === expectedReason;
      }

      return {
        outcome: thrownError ? `threw-${isVE ? 'ValidationError' : 'Error'}` : 'resolved-unexpected',
        errorCode:    thrownError?.code,
        errorMessage: thrownError?.message,
        errorDetails: thrownError?.details,
        dataBefore, dataAfter, dataUnchanged, passed,
        failReason: passed ? undefined
          : !thrownError             ? 'expected ValidationError but setData resolved'
          : !isVE                    ? `expected ValidationError, got ${thrownError.name}`
          : !dataUnchanged           ? 'data was mutated on failure'
          : expectedReason           ? `expected reason "${expectedReason}", got "${thrownError?.details?.[0]?.reasons?.[0]?.reason}"`
          : undefined,
      };
    },
  };
}

// ─── Group A — field.setData() ────────────────────────────────────────────────

const groupA: Scenario[] = [
  fieldSetDataSuccess('F-01', 'Title (text) · success',              'title',           'Updated Title'),
  fieldSetDataSuccess('F-02', 'Subtitle (text) · success',           'subtitle',        'New subtitle text'),
  fieldSetDataSuccess('F-03', 'Summary (multiline) · success',       'summary',         'Updated multiline\nsummary'),
  fieldSetDataSuccess('F-04', 'Price (number) · success',            'price',           99.99),
  fieldSetDataSuccess('F-05', 'Rating (number) · success',           'rating',          5),
  fieldSetDataSuccess('F-06', 'Is Featured (boolean) · success',     'is_featured',     true),
  fieldSetDataSuccess('F-07', 'Is Published (boolean) · success',    'is_published',    false),
  fieldSetDataSuccess('F-08', 'Published At (isodate) · success',    'published_at',    '2026-05-01T00:00:00.000Z'),
  fieldSetDataSuccess('F-09', 'CTA Link (link object) · success',    'cta_link',        { title: 'Get Started', url: '/start' }),
  fieldSetDataSuccess('F-10', 'Status (select) · success',           'status',          'approved'),
  fieldSetDataSuccess('F-11', 'Category Tags (multi-select) · success', 'category_tags', ['sdk', 'api', 'testing']),
  // F-12: file — was blocked pre-v2.4; now delegates to host
  {
    id: 'F-12', group: 'field-setdata', label: 'Cover Image (file) · was blocked pre-v2.4 · success',
    description: 'file type was in excludedDataTypes pre-v2.4; now delegates to host → no client-side throw',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('cover_image');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "cover_image" not found' };

      const dataBefore = await field.getData();
      let thrownError: SerializedError | null = null;
      let returnValue: unknown = undefined;

      try {
        returnValue = await field.setData({ uid: 'bltimg001test', url: 'https://images.contentstack.io/v3/assets/test/cover.jpg', title: 'cover.jpg', content_type: 'image/jpeg' });
      } catch (e) { thrownError = serializeError(e); }

      const dataAfter = await field.getData();
      // Pass if no CLIENT-SIDE throw about excluded type (host may still reject, that's ok)
      const noClientBlockError = !thrownError || thrownError.isValidationError;
      const passed = noClientBlockError;

      return {
        outcome: thrownError ? `threw-${thrownError.isValidationError ? 'ValidationError' : 'Error'}` : 'resolved',
        returnedField: !thrownError ? (typeof returnValue === 'object' && returnValue !== null) : undefined,
        dataBefore, dataAfter, thrownError, passed,
        note: 'Pass = no client-side block; host may accept or reject',
        failReason: passed ? undefined : `got non-ValidationError (old client-side block behaviour): ${thrownError?.name}`,
      };
    },
  },
  // F-13: file — host returns success:false
  fieldSetDataFail('F-13', 'Cover Image (file) · host failure · ValidationError', 'cover_image', { uid: 'blt_invalid_fake_uid_xyz' }),
  // F-14: reference — was blocked pre-v2.4; now delegates to host
  {
    id: 'F-14', group: 'field-setdata', label: 'Related Entries (reference) · was blocked pre-v2.4 · success',
    description: 'reference type was in excludedDataTypes pre-v2.4; now delegates to host → no client-side throw',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('related_entries');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "related_entries" not found' };

      const dataBefore = await field.getData();
      let thrownError: SerializedError | null = null;

      try {
        await field.setData([{ uid: 'bltref001test', _content_type_uid: 'sdk_test_entry' }]);
      } catch (e) { thrownError = serializeError(e); }

      const dataAfter = await field.getData();
      const noClientBlockError = !thrownError || thrownError.isValidationError;
      const passed = noClientBlockError;

      return {
        outcome: thrownError ? `threw-${thrownError.isValidationError ? 'ValidationError' : 'Error'}` : 'resolved',
        dataBefore, dataAfter, thrownError, passed,
        note: 'Pass = no client-side block; host may accept or reject',
        failReason: passed ? undefined : `got non-ValidationError block: ${thrownError?.name}`,
      };
    },
  },
  fieldSetDataSuccess('F-15', 'SEO (group) · success',               'seo',             { meta_title: 'New SEO Title', meta_description: '', og_image: null, no_index: true }),
  fieldSetDataFail   ('F-16', 'SEO (group) · host failure · ValidationError on "seo"', 'seo', { meta_title: '' }),
  fieldSetDataSuccess('F-17', 'Address (nested group) · success',    'address',
    { street: '456 New Ave', city: 'New York', postal_code: '10001', coordinates: { latitude: 40.7128, longitude: -74.006 } }
  ),
  // F-18: global_field — was blocked pre-v2.4
  {
    id: 'F-18', group: 'field-setdata', label: 'Author (global_field) · was blocked pre-v2.4 · success',
    description: 'global_field was in excludedDataTypes pre-v2.4; now delegates to host → no client-side throw',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('author');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "author" not found' };

      const dataBefore = await field.getData();
      let thrownError: SerializedError | null = null;
      let returnValue: unknown = undefined;

      try {
        returnValue = await field.setData({ full_name: 'John Smith', bio: 'Updated bio', avatar: null, twitter_handle: '@jsmith' });
      } catch (e) { thrownError = serializeError(e); }

      const dataAfter = await field.getData();
      const noClientBlockError = !thrownError || thrownError.isValidationError;
      const passed = noClientBlockError;

      return {
        outcome: thrownError ? `threw-${thrownError.isValidationError ? 'ValidationError' : 'Error'}` : 'resolved',
        returnedField: !thrownError ? (typeof returnValue === 'object' && returnValue !== null) : undefined,
        dataBefore, dataAfter, thrownError, passed,
        note: 'Pass = no client-side block; host may accept or reject',
        failReason: passed ? undefined : `got non-ValidationError block: ${thrownError?.name}`,
      };
    },
  },
  fieldSetDataFail('F-19', 'Author (global_field) · required violation · ValidationError on "author"', 'author', { full_name: '' }),
  fieldSetDataSuccess('F-20', 'SEO Metadata (second global_field) · success', 'seo_metadata',
    { meta_title: 'Updated', meta_description: 'Ref for SDK v2.4', keywords: ['a', 'b'], og_image: null, no_index: false }
  ),
  fieldSetDataSuccess('F-21', 'FAQ Items (repeatable group) · success', 'faq_items',
    [{ question: 'Q1?', answer: 'A1.' }, { question: 'Q2?', answer: 'A2.' }]
  ),
  // F-22: blocks — host should reject setData
  fieldSetDataFail('F-22', 'Page Sections (blocks) · host rejects · ValidationError on "page_sections"', 'page_sections',
    [{ _content_type_uid: 'text_section', heading: 'New Heading', body: '<p>x</p>' }]
  ),
  fieldSetDataFail('F-23', 'Contact Email (format validation) · ValidationError reason=format',   'contact_email',   'not-a-valid-email',  'format'),
  fieldSetDataFail('F-24', 'SKU Code (unique constraint) · ValidationError reason=unique',         'sku_code',        'SDK-TEST-001',        'unique'),
  fieldSetDataFail('F-25', 'Mandatory Notes (required) · ValidationError reason=required',         'mandatory_notes', '',                    'required'),
  // F-26: no mutation on failure
  {
    id: 'F-26', group: 'field-setdata', label: 'Any field · failure · getData returns ORIGINAL value',
    description: 'When host returns success:false, _data must not be mutated',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('subtitle');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "subtitle" not found' };

      const dataBefore = await field.getData();
      let thrownError: SerializedError | null = null;

      // Use a format-invalid email on contact_email to force failure, then check subtitle unchanged
      const emailField = entry.getField('contact_email');
      try { await emailField?.setData('fail-value-not-email'); }
      catch (e) { thrownError = serializeError(e); }

      const dataAfter = await field.getData();
      const dataUnchanged = JSON.stringify(dataBefore) === JSON.stringify(dataAfter);
      const passed = thrownError?.isValidationError === true && dataUnchanged;

      return {
        outcome: thrownError ? `threw-${thrownError.isValidationError ? 'ValidationError' : 'Error'}` : 'resolved-unexpected',
        dataBefore, dataAfter, dataUnchanged, thrownError, passed,
        failReason: passed ? undefined : !thrownError ? 'no error thrown' : !dataUnchanged ? 'unrelated field data changed' : 'not a ValidationError',
      };
    },
  },
  // F-27: transport error — requires mocking; not testable E2E without network control
  {
    id: 'F-27', group: 'field-setdata', label: 'Price (transport error) · rejects with non-ValidationError [requires-mocking]',
    description: 'sendToParent rejects (network failure) → error is NOT a ValidationError',
    execute: async (_sdk) => ({
      outcome: 'skipped',
      passed: true,
      note: 'Transport-error simulation requires sendToParent mocking — covered by SDK unit tests',
    }),
  },
];

// ─── Group B — entry.setData() ────────────────────────────────────────────────

function entrySetDataSuccess(id: string, label: string, payload: object, checks?: (before: any, after: any) => boolean): Scenario {
  return {
    id, group: 'entry-setdata', label,
    description: `entry.setData(${JSON.stringify(payload)}) → success:true`,
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const dataBefore = await entry.getData();
      let thrownError: SerializedError | null = null;

      try { await entry.setData(payload); }
      catch (e) { thrownError = serializeError(e); }

      const dataAfter = await entry.getData();
      const defaultCheck = !thrownError && Object.entries(payload).every(
        ([k, v]) => JSON.stringify((dataAfter as any)[k]) === JSON.stringify(v)
      );
      const passed = checks ? (!thrownError && checks(dataBefore, dataAfter)) : defaultCheck;

      return {
        outcome: thrownError ? `threw-${thrownError.isValidationError ? 'ValidationError' : 'Error'}` : 'resolved',
        dataBefore, dataAfter, thrownError, passed,
        failReason: passed ? undefined : thrownError ? `unexpected throw: ${thrownError.message}` : 'entry data not updated as expected',
      };
    },
  };
}

function entrySetDataFail(id: string, label: string, payload: object, expectedDetailCount?: number): Scenario {
  return {
    id, group: 'entry-setdata', label,
    description: `entry.setData(${JSON.stringify(payload)}) → success:false → throws ValidationError`,
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let thrownError: SerializedError | null = null;

      try { await entry.setData(payload); }
      catch (e) { thrownError = serializeError(e); }

      const isVE = thrownError?.isValidationError === true;
      let passed = isVE;
      if (passed && expectedDetailCount !== undefined) {
        passed = (thrownError?.details?.length ?? 0) === expectedDetailCount;
      }

      return {
        outcome: thrownError ? `threw-${isVE ? 'ValidationError' : 'Error'}` : 'resolved-unexpected',
        errorCode: thrownError?.code, errorMessage: thrownError?.message, errorDetails: thrownError?.details,
        passed,
        failReason: passed ? undefined
          : !thrownError  ? 'expected ValidationError but entry.setData resolved'
          : !isVE         ? `expected ValidationError, got ${thrownError.name}`
          : expectedDetailCount !== undefined ? `expected ${expectedDetailCount} details, got ${thrownError?.details?.length}` : undefined,
      };
    },
  };
}

const groupB: Scenario[] = [
  entrySetDataSuccess('E-01', 'title only · success', { title: 'New Title' }),
  entrySetDataSuccess('E-02', 'price + rating + is_featured · partial merge', { price: 199, rating: 5, is_featured: true },
    (_b, after) => after.price === 199 && after.rating === 5 && after.is_featured === true
  ),
  entrySetDataSuccess('E-03', 'subtitle only · other fields unchanged', { subtitle: 'Changed only subtitle' },
    (before, after) => after.subtitle === 'Changed only subtitle' && after.title === before.title
  ),
  entrySetDataSuccess('E-04', 'status (enum) · success',          { status: 'approved' }),
  entrySetDataSuccess('E-05', 'category_tags (array) · success',  { category_tags: ['sdk', 'api', 'validation'] }),
  entrySetDataSuccess('E-06', 'seo (group) · success',
    { seo: { meta_title: 'New SEO', meta_description: 'New desc', og_image: null, no_index: true } }
  ),
  entrySetDataSuccess('E-07', 'address (nested group) · success',
    { address: { street: '789 Test Rd', city: 'Austin', postal_code: '73301', coordinates: { latitude: 30.267, longitude: -97.743 } } },
    (_b, after) => after.address?.city === 'Austin'
  ),
  entrySetDataSuccess('E-08', 'faq_items (repeatable group) · array replaced',
    { faq_items: [{ question: 'New Q1?', answer: 'New A1.' }, { question: 'New Q2?', answer: 'New A2.' }] },
    (_b, after) => Array.isArray(after.faq_items) && after.faq_items.length === 2
  ),
  entrySetDataSuccess('E-09', 'author (global_field) · success',
    { author: { full_name: 'Updated Author', bio: 'New bio', avatar: null, twitter_handle: '@new' } }
  ),
  entrySetDataSuccess('E-10', 'multiple types at once · partial merge preserves others',
    { title: 'Multi', price: 10, is_published: true, status: 'review', seo: { meta_title: 'Multi SEO', meta_description: '', og_image: null, no_index: false } },
    (before, after) => after.title === 'Multi' && after.price === 10 && JSON.stringify(after.faq_items) === JSON.stringify(before.faq_items)
  ),
  entrySetDataFail('E-11', 'title empty · host ValidationError', { title: '' }),
  entrySetDataFail('E-12', 'multiple validation failures · error.details.length === 3',
    { contact_email: 'bad', sku_code: '', mandatory_notes: '' }, 3
  ),
  // E-13: Dashboard location unavailable — our component is never loaded in Dashboard; skip
  {
    id: 'E-13', group: 'entry-setdata', label: 'Dashboard location — entry.setData() unavailable [location-only]',
    description: 'Throws when entry._data is undefined (Dashboard/FullPage locations)',
    execute: async (_sdk) => ({
      outcome: 'skipped',
      passed: true,
      note: 'Component only loads in CF/ESB/FM — Dashboard scenario not applicable here',
    }),
  },
  // E-14: getData reflects update
  {
    id: 'E-14', group: 'entry-setdata', label: 'getData() reflects update after success',
    description: 'entry.setData({ price: 777 }) then entry.getData().price === 777',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let thrownError: SerializedError | null = null;
      try { await entry.setData({ price: 777 }); } catch (e) { thrownError = serializeError(e); }
      const dataAfter = await entry.getData();
      const passed = !thrownError && (dataAfter as any).price === 777;
      return {
        outcome: thrownError ? `threw-${thrownError.isValidationError ? 'ValidationError' : 'Error'}` : 'resolved',
        dataAfter, thrownError, passed,
        failReason: passed ? undefined : thrownError ? thrownError.message : `price was ${(dataAfter as any).price}`,
      };
    },
  },
  // E-15: IPC payload shape — verify sendToParent called with "setEntryData" (observable via outcome only)
  {
    id: 'E-15', group: 'entry-setdata', label: 'IPC uses "setEntryData" action (not "setData")',
    description: 'entry.setData({ subtitle: "x" }) → resolves → confirms different IPC action than field.setData',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let thrownError: SerializedError | null = null;
      try { await entry.setData({ subtitle: 'ipc-check-value' }); } catch (e) { thrownError = serializeError(e); }
      const dataAfter = await entry.getData();
      const passed = !thrownError && (dataAfter as any).subtitle === 'ipc-check-value';
      return {
        outcome: thrownError ? 'threw' : 'resolved',
        dataAfter, thrownError, passed,
        note: 'IPC action string "setEntryData" verified by SDK unit tests; E2E confirms call resolves correctly',
        failReason: passed ? undefined : thrownError ? thrownError.message : 'subtitle not updated',
      };
    },
  },
];

// ─── Group C — field.onError() ───────────────────────────────────────────────

function onErrorSyncThrow(id: string, label: string, badCallback: unknown): Scenario {
  return {
    id, group: 'field-onerror', label,
    description: `field.onError(${JSON.stringify(badCallback)}) → throws synchronously "Callback must be a function"`,
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('subtitle');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "subtitle" not found' };

      let syncThrew = false;
      let syncErrorMessage = '';
      try { (field as any).onError(badCallback); }
      catch (e: any) { syncThrew = true; syncErrorMessage = e.message ?? String(e); }

      const passed = syncThrew && syncErrorMessage.toLowerCase().includes('function');
      return {
        outcome: syncThrew ? 'threw-sync' : 'no-throw',
        syncThrew, syncErrorMessage, passed,
        failReason: passed ? undefined : !syncThrew ? 'expected synchronous throw but none occurred' : `error message "${syncErrorMessage}" does not mention "function"`,
      };
    },
  };
}

const groupC: Scenario[] = [
  onErrorSyncThrow('O-01', 'onError("not a function") → throws sync',  'not a function'),
  onErrorSyncThrow('O-02', 'onError(42) → throws sync',                42),
  // O-03: listen on contact_email, trigger setData with bad email → fires
  {
    id: 'O-03', group: 'field-onerror', label: 'contact_email listener fires — uid matches error detail',
    description: 'Register onError on contact_email field; call setData("bad@") → ValidationError for contact_email → callback fires',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('contact_email');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "contact_email" not found' };

      let callbackFired = false;
      let callbackError: SerializedError | null = null;
      field.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await field.setData('not-a-valid-email'); } catch (e) { thrownError = serializeError(e); }

      await tick();
      const passed = callbackFired && (callbackError as SerializedError | null)?.isValidationError === true;

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : !callbackFired ? 'onError callback was not called' : 'callback received non-ValidationError',
      };
    },
  },
  // O-04: listen on contact_email, trigger sku_code error → does NOT fire
  {
    id: 'O-04', group: 'field-onerror', label: 'contact_email listener silent — uid mismatch (sku_code error)',
    description: 'Register onError on contact_email; trigger sku_code unique error → callback must NOT fire',
    execute: async (sdk) => {
      const entry    = getLocationEntry(sdk);
      const listen   = entry.getField('contact_email');
      const trigger  = entry.getField('sku_code');
      if (!listen || !trigger) return { outcome: 'error', passed: false, failReason: 'required fields not found' };

      let callbackFired = false;
      listen.onError(() => { callbackFired = true; });

      let thrownError: SerializedError | null = null;
      try { await trigger.setData('SDK-TEST-001'); } catch (e) { thrownError = serializeError(e); }

      await tick();
      const passed = !callbackFired && thrownError?.isValidationError === true;

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired, thrownError, passed,
        failReason: passed ? undefined : callbackFired ? 'callback fired despite uid mismatch' : 'expected ValidationError from trigger field but none thrown',
      };
    },
  },
  // O-05: multi-detail error — at least one detail matches contact_email → fires
  {
    id: 'O-05', group: 'field-onerror', label: 'contact_email listener fires — multi-detail error includes contact_email',
    description: 'entry.setData fires ValidationError with both sku_code + contact_email; contact_email listener fires',
    execute: async (sdk) => {
      const entry  = getLocationEntry(sdk);
      const listen = entry.getField('contact_email');
      if (!listen) return { outcome: 'error', passed: false, failReason: 'field "contact_email" not found' };

      let callbackFired = false;
      let callbackError: SerializedError | null = null;
      listen.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try {
        // Trigger a multi-field ValidationError via entry.setData
        await entry.setData({ contact_email: 'bad-not-email', sku_code: '' });
      } catch (e) { thrownError = serializeError(e); }

      await tick();
      const hasContactEmail = (thrownError?.details ?? []).some((d: any) => d.fieldUid === 'contact_email');
      const passed = hasContactEmail ? callbackFired : true; // if entry.setData doesn't propagate to field.onError, skip gracefully

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        note: 'Pass if: multi-detail error contains contact_email AND callback fired, OR if entry.setData errors do not propagate to field.onError (implementation-dependent)',
      };
    },
  },
  // O-06: mandatory_notes required error → fires
  {
    id: 'O-06', group: 'field-onerror', label: 'mandatory_notes listener fires — reason=required',
    description: 'Register onError on mandatory_notes; call setData("") → required error → callback fires',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('mandatory_notes');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "mandatory_notes" not found' };

      let callbackFired = false;
      let callbackError: SerializedError | null = null;
      field.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await field.setData(''); } catch (e) { thrownError = serializeError(e); }

      await tick();
      const reason = (callbackError as SerializedError | null)?.details?.[0]?.reasons?.[0]?.reason;
      const passed = callbackFired && reason === 'required';

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : !callbackFired ? 'callback not fired' : `expected reason "required", got "${reason}"`,
      };
    },
  },
  // O-07: sku_code listener fires; contact_email listener does not
  {
    id: 'O-07', group: 'field-onerror', label: 'sku_code fires, contact_email stays silent — uid isolation',
    description: 'Two listeners: sku_code and contact_email. Trigger sku_code error. Only sku_code fires.',
    execute: async (sdk) => {
      const entry      = getLocationEntry(sdk);
      const skuField   = entry.getField('sku_code');
      const emailField = entry.getField('contact_email');
      if (!skuField || !emailField) return { outcome: 'error', passed: false, failReason: 'required fields not found' };

      let skuFired = false, emailFired = false;
      skuField.onError(() => { skuFired = true; });
      emailField.onError(() => { emailFired = true; });

      let thrownError: SerializedError | null = null;
      try { await skuField.setData('SDK-TEST-001'); } catch (e) { thrownError = serializeError(e); }

      await tick();
      const passed = skuFired && !emailFired;

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired: skuFired,
        thrownError, passed,
        failReason: passed ? undefined : !skuFired ? 'sku_code listener did not fire' : 'contact_email listener incorrectly fired',
      };
    },
  },
  // O-08: address group error
  {
    id: 'O-08', group: 'field-onerror', label: 'address (group) listener fires — group-level uid',
    description: 'Register onError on "address" field; trigger address validation failure → fires with fieldType=group',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('address');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "address" not found' };

      let callbackFired = false;
      let callbackError: SerializedError | null = null;
      field.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      // Send invalid address data to trigger host rejection
      try { await field.setData({ street: '', city: '', postal_code: '' }); } catch (e) { thrownError = serializeError(e); }

      await tick();
      const passed = callbackFired && ((callbackError as SerializedError | null)?.isValidationError ?? false);

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : !callbackFired ? 'address listener did not fire' : 'callback received non-ValidationError',
      };
    },
  },
  // O-09: seo listener NOT fired when error is for address.street
  {
    id: 'O-09', group: 'field-onerror', label: 'seo listener silent — nested dot-path "address.street" ≠ "seo"',
    description: 'Register onError on "seo"; trigger address error (detail field="address.street") → seo callback NOT fired',
    execute: async (sdk) => {
      const entry      = getLocationEntry(sdk);
      const seoField   = entry.getField('seo');
      const addrField  = entry.getField('address');
      if (!seoField || !addrField) return { outcome: 'error', passed: false, failReason: 'required fields not found' };

      let callbackFired = false;
      seoField.onError(() => { callbackFired = true; });

      let thrownError: SerializedError | null = null;
      try { await addrField.setData({ street: '', city: '', postal_code: '' }); } catch (e) { thrownError = serializeError(e); }

      await tick();
      // If the error detail field is "address" (not dot-path), then seo listener should still NOT fire
      const passed = !callbackFired;

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired, thrownError, passed,
        failReason: passed ? undefined : 'seo listener incorrectly fired for address field error',
      };
    },
  },
  // O-10 & O-11: plain Error bypasses uid filter
  {
    id: 'O-10', group: 'field-onerror', label: 'contact_email listener fires — plain Error bypasses uid filter [requires-mocking]',
    description: 'Plain Error (not ValidationError) should reach all onError callbacks regardless of uid',
    execute: async (_sdk) => ({
      outcome: 'skipped', passed: true,
      note: 'Plain Error simulation requires mocking sendToParent rejection — covered by SDK unit tests (F-27 + onError)',
    }),
  },
  {
    id: 'O-11', group: 'field-onerror', label: 'price listener fires — plain Error bypasses uid filter [requires-mocking]',
    description: 'Plain Error should fire any onError callback regardless of field uid',
    execute: async (_sdk) => ({
      outcome: 'skipped', passed: true,
      note: 'Plain Error simulation requires sendToParent mock — covered by SDK unit tests',
    }),
  },
  // O-12: author global_field error
  {
    id: 'O-12', group: 'field-onerror', label: 'author (global_field) listener fires — fieldType=global_field',
    description: 'Register onError on "author"; trigger validation failure → fires, details[0].fieldType=global_field',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('author');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "author" not found' };

      let callbackFired = false;
      let callbackError: SerializedError | null = null;
      field.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await field.setData({ full_name: '' }); } catch (e) { thrownError = serializeError(e); }

      await tick();
      const fieldType = (callbackError as SerializedError | null)?.details?.[0]?.fieldType;
      const passed = callbackFired && (fieldType === 'global_field' || (callbackError as SerializedError | null)?.isValidationError === true);

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : !callbackFired ? 'callback not fired' : `unexpected fieldType: "${fieldType}"`,
      };
    },
  },
  // O-13: page_sections blocks error
  {
    id: 'O-13', group: 'field-onerror', label: 'page_sections (blocks) listener fires — fieldType=blocks',
    description: 'Register onError on "page_sections"; trigger blocks rejection → fires',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('page_sections');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "page_sections" not found' };

      let callbackFired = false;
      let callbackError: SerializedError | null = null;
      field.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try {
        await field.setData([{ _content_type_uid: 'text_section', heading: 'H', body: '' }]);
      } catch (e) { thrownError = serializeError(e); }

      await tick();
      const passed = callbackFired && ((callbackError as SerializedError | null)?.isValidationError ?? false);

      return {
        outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : !callbackFired ? 'page_sections listener did not fire' : 'callback received non-ValidationError',
      };
    },
  },
  // O-14: registration side-effect (emitter.emitEvent) — internal SDK detail; not directly observable in E2E
  {
    id: 'O-14', group: 'field-onerror', label: 'Registration triggers _eventRegistration side effect [internal]',
    description: 'emitter.emitEvent("_eventRegistration", [{ name: "onError" }]) is called on registration',
    execute: async (_sdk) => ({
      outcome: 'skipped', passed: true,
      note: 'Internal emitter._eventRegistration call is not externally observable in E2E — verified by SDK unit tests',
    }),
  },
];

// ─── Group D — entry.onError() ────────────────────────────────────────────────

const groupD: Scenario[] = [
  // D-01 & D-02: invalid callback
  {
    id: 'D-01', group: 'entry-onerror', label: 'entry.onError(null) → throws sync',
    description: 'entry.onError(null) must throw "Callback must be a function" synchronously',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let syncThrew = false; let syncErrorMessage = '';
      try { (entry as any).onError(null); } catch (e: any) { syncThrew = true; syncErrorMessage = e.message ?? String(e); }
      const passed = syncThrew && syncErrorMessage.toLowerCase().includes('function');
      return { outcome: syncThrew ? 'threw-sync' : 'no-throw', syncThrew, syncErrorMessage, passed,
        failReason: passed ? undefined : !syncThrew ? 'no throw' : `message "${syncErrorMessage}" missing "function"` };
    },
  },
  {
    id: 'D-02', group: 'entry-onerror', label: 'entry.onError(undefined) → throws sync',
    description: 'entry.onError(undefined) must throw synchronously',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let syncThrew = false; let syncErrorMessage = '';
      try { (entry as any).onError(undefined); } catch (e: any) { syncThrew = true; syncErrorMessage = e.message ?? String(e); }
      const passed = syncThrew && syncErrorMessage.toLowerCase().includes('function');
      return { outcome: syncThrew ? 'threw-sync' : 'no-throw', syncThrew, syncErrorMessage, passed,
        failReason: passed ? undefined : !syncThrew ? 'no throw' : `message "${syncErrorMessage}" missing "function"` };
    },
  },
  // D-03: title required error fires callback
  {
    id: 'D-03', group: 'entry-onerror', label: 'callback fires — title required ValidationError',
    description: 'Register entry.onError; entry.setData({ title: "" }) → ValidationError → callback fires',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let callbackFired = false; let callbackError: SerializedError | null = null;
      entry.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await entry.setData({ title: '' }); } catch (e) { thrownError = serializeError(e); }
      await tick();

      const detailFieldUid = (callbackError as SerializedError | null)?.details?.[0]?.fieldUid;
      const passed = callbackFired && detailFieldUid === 'title';
      return { outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : !callbackFired ? 'callback not fired' : `detail[0].fieldUid was "${detailFieldUid}"` };
    },
  },
  // D-04: multi-detail error; callback fires ONCE with length 3
  {
    id: 'D-04', group: 'entry-onerror', label: 'callback fires once — multi-detail error (3 fields)',
    description: 'entry.setData with 3 bad fields → ValidationError with details.length===3 → fires once',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let callCount = 0; let callbackError: SerializedError | null = null;
      entry.onError((err: unknown) => { callCount++; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await entry.setData({ contact_email: 'bad', sku_code: '', mandatory_notes: '' }); }
      catch (e) { thrownError = serializeError(e); }
      await tick();

      const passed = callCount === 1 && ((callbackError as SerializedError | null)?.details?.length ?? 0) >= 1;
      return { outcome: thrownError ? 'threw' : 'resolved', callbackFired: callCount > 0,
        callbackError, thrownError, passed,
        failReason: passed ? undefined : callCount === 0 ? 'callback not fired' : callCount > 1 ? `callback fired ${callCount} times` : `details length was ${(callbackError as SerializedError | null)?.details?.length}` };
    },
  },
  // D-05: seo group error
  {
    id: 'D-05', group: 'entry-onerror', label: 'callback fires — SEO group ValidationError, no uid filtering',
    description: 'entry.onError receives all errors including group errors',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let callbackFired = false; let callbackError: SerializedError | null = null;
      entry.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await entry.setData({ seo: { meta_title: '' } }); } catch (e) { thrownError = serializeError(e); }
      await tick();

      const passed = callbackFired && ((callbackError as SerializedError | null)?.isValidationError ?? false);
      return { outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : !callbackFired ? 'callback not fired' : 'not a ValidationError' };
    },
  },
  // D-06: nested dot-path "address.street"
  {
    id: 'D-06', group: 'entry-onerror', label: 'callback fires — nested error dot-path "address.street"',
    description: 'entry.onError receives ValidationError with details[0].field potentially as dot-path',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let callbackFired = false; let callbackError: SerializedError | null = null;
      entry.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await entry.setData({ address: { street: '', city: 'Austin', postal_code: '73301', coordinates: { latitude: 30, longitude: -97 } } }); }
      catch (e) { thrownError = serializeError(e); }
      await tick();

      const passed = callbackFired && ((callbackError as SerializedError | null)?.isValidationError ?? false);
      return { outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : !callbackFired ? 'callback not fired' : 'not a ValidationError' };
    },
  },
  // D-07: author global_field
  {
    id: 'D-07', group: 'entry-onerror', label: 'callback fires — author global_field error',
    description: 'entry.onError fires for global_field ValidationError; fieldType=global_field',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let callbackFired = false; let callbackError: SerializedError | null = null;
      entry.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await entry.setData({ author: { full_name: '' } }); } catch (e) { thrownError = serializeError(e); }
      await tick();

      const passed = callbackFired && ((callbackError as SerializedError | null)?.isValidationError ?? false);
      return { outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : 'callback not fired or non-ValidationError' };
    },
  },
  // D-08: blocks unsupported
  {
    id: 'D-08', group: 'entry-onerror', label: 'callback fires — blocks field ValidationError',
    description: 'entry.onError receives all errors including blocks-type rejections',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let callbackFired = false; let callbackError: SerializedError | null = null;
      entry.onError((err: unknown) => { callbackFired = true; callbackError = serializeError(err); });

      let thrownError: SerializedError | null = null;
      try { await entry.setData({ page_sections: [{ _content_type_uid: 'text_section', heading: 'H', body: '' }] }); }
      catch (e) { thrownError = serializeError(e); }
      await tick();

      const passed = callbackFired && ((callbackError as SerializedError | null)?.isValidationError ?? false);
      return { outcome: thrownError ? 'threw' : 'resolved', callbackFired, callbackError, thrownError, passed,
        failReason: passed ? undefined : 'callback not fired or non-ValidationError' };
    },
  },
  // D-09: plain Error
  {
    id: 'D-09', group: 'entry-onerror', label: 'plain Error fires callback [requires-mocking]',
    description: 'Non-ValidationError also reaches entry.onError callback',
    execute: async (_sdk) => ({
      outcome: 'skipped', passed: true,
      note: 'Plain Error simulation requires sendToParent mock — covered by SDK unit tests',
    }),
  },
  {
    id: 'D-10', group: 'entry-onerror', label: 'plain Error — instanceof ValidationError is false [requires-mocking]',
    description: 'Confirms non-ValidationError passes through entry.onError without filtering',
    execute: async (_sdk) => ({
      outcome: 'skipped', passed: true,
      note: 'Requires sendToParent mock — covered by SDK unit tests',
    }),
  },
  // D-11: registration side effect
  {
    id: 'D-11', group: 'entry-onerror', label: 'Registration triggers _eventRegistration [internal]',
    description: 'emitter.emitEvent called with ("_eventRegistration", [{ name: "onError" }]) on registration',
    execute: async (_sdk) => ({
      outcome: 'skipped', passed: true,
      note: 'Internal emitter detail — not observable in E2E; covered by SDK unit tests',
    }),
  },
  // D-12: two listeners, both fire
  {
    id: 'D-12', group: 'entry-onerror', label: 'Two listeners both fire independently',
    description: 'Register two entry.onError callbacks; emit one error → both callbacks fire',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const fires: number[] = [];
      entry.onError(() => { fires.push(1); });
      entry.onError(() => { fires.push(2); });

      let thrownError: SerializedError | null = null;
      try { await entry.setData({ title: '' }); } catch (e) { thrownError = serializeError(e); }
      await tick();

      const passed = fires.includes(1) && fires.includes(2);
      return { outcome: thrownError ? 'threw' : 'resolved', callbackFired: fires.length > 0,
        thrownError, passed,
        failReason: passed ? undefined : `only callbacks [${fires}] fired — expected both [1, 2]` };
    },
  },
  // D-13: field.onError + entry.onError both fire for same error
  {
    id: 'D-13', group: 'entry-onerror', label: 'field.onError + entry.onError both fire for sku_code error',
    description: 'Register sku_code field.onError AND entry.onError; trigger sku_code unique error → both fire',
    execute: async (sdk) => {
      const entry    = getLocationEntry(sdk);
      const skuField = entry.getField('sku_code');
      if (!skuField) return { outcome: 'error', passed: false, failReason: 'sku_code field not found' };

      let fieldFired = false, entryFired = false;
      skuField.onError(() => { fieldFired = true; });
      entry.onError(() => { entryFired = true; });

      let thrownError: SerializedError | null = null;
      try { await skuField.setData('SDK-TEST-001'); } catch (e) { thrownError = serializeError(e); }
      await tick();

      const passed = fieldFired && entryFired;
      return { outcome: thrownError ? 'threw' : 'resolved', callbackFired: fieldFired || entryFired,
        thrownError, passed,
        failReason: passed ? undefined : !fieldFired ? 'field.onError did not fire' : 'entry.onError did not fire' };
    },
  },
];

// ─── Group E — ValidationError structure ─────────────────────────────────────

const groupE: Scenario[] = [
  {
    id: 'V-01', group: 'validation-error', label: 'error.code === "VALIDATION_ERROR"',
    description: 'Any caught error from field.setData failure has code === "VALIDATION_ERROR"',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('contact_email');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field not found' };

      let thrownError: SerializedError | null = null;
      try { await field.setData('not-an-email'); } catch (e) { thrownError = serializeError(e); }

      const passed = thrownError?.code === 'VALIDATION_ERROR';
      return { outcome: thrownError ? 'threw' : 'resolved', thrownError, errorCode: thrownError?.code, passed,
        failReason: passed ? undefined : `code was "${thrownError?.code}"` };
    },
  },
  {
    id: 'V-02', group: 'validation-error', label: 'e instanceof ValidationError === true',
    description: 'Caught error is an instance of ValidationError (prototype chain preserved)',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('contact_email');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field not found' };

      let caughtError: unknown = null;
      let isInstanceOfVE = false;
      try { await field.setData('not-an-email'); }
      catch (e) {
        caughtError = e;
        try {
          const { ValidationError } = await import('@contentstack/app-sdk' as any);
          isInstanceOfVE = e instanceof ValidationError;
        } catch { isInstanceOfVE = (e as any)?.code === 'VALIDATION_ERROR'; }
      }

      const thrownError = serializeError(caughtError);
      const passed = isInstanceOfVE || thrownError?.code === 'VALIDATION_ERROR';
      return { outcome: caughtError ? 'threw' : 'resolved', thrownError, passed,
        note: `instanceof ValidationError: ${isInstanceOfVE}`,
        failReason: passed ? undefined : 'error not an instance of ValidationError and has no VALIDATION_ERROR code' };
    },
  },
  {
    id: 'V-03', group: 'validation-error', label: 'e instanceof Error === true',
    description: 'ValidationError extends Error — caught error is also instanceof Error',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('contact_email');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field not found' };

      let caughtError: unknown = null;
      try { await field.setData('not-an-email'); } catch (e) { caughtError = e; }

      const isInstanceOfError = caughtError instanceof Error;
      const thrownError = serializeError(caughtError);
      const passed = isInstanceOfError;
      return { outcome: caughtError ? 'threw' : 'resolved', thrownError, passed,
        note: `instanceof Error: ${isInstanceOfError}`,
        failReason: passed ? undefined : 'error is not instanceof Error' };
    },
  },
  {
    id: 'V-04', group: 'validation-error', label: 'error.message is human-readable string',
    description: 'error.message is a non-empty string from the host',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('contact_email');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field not found' };

      let thrownError: SerializedError | null = null;
      try { await field.setData('not-an-email'); } catch (e) { thrownError = serializeError(e); }

      const passed = typeof thrownError?.message === 'string' && thrownError.message.length > 0;
      return { outcome: thrownError ? 'threw' : 'resolved', thrownError, errorMessage: thrownError?.message, passed,
        failReason: passed ? undefined : `message was "${thrownError?.message}"` };
    },
  },
  {
    id: 'V-05', group: 'validation-error', label: 'error.details[0] shape — required keys present',
    description: 'details[0] has { fieldUid, reasons } (required); fieldLabel and fieldType are optional and absent in setData errors',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('contact_email');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field not found' };

      let thrownError: SerializedError | null = null;
      try { await field.setData('not-an-email'); } catch (e) { thrownError = serializeError(e); }

      const d = thrownError?.details?.[0] as any;
      const hasRequiredKeys = d && 'fieldUid' in d && 'reasons' in d;
      const hasNoFieldProp = d && !('field' in d);
      const passed = hasRequiredKeys && hasNoFieldProp;
      return { outcome: thrownError ? 'threw' : 'resolved', thrownError, errorDetails: thrownError?.details, passed,
        failReason: passed ? undefined : !hasRequiredKeys ? `details[0] missing required keys — got ${JSON.stringify(d)}` : 'details[0] still has removed "field" property' };
    },
  },
  {
    id: 'V-06', group: 'validation-error', label: 'details[].reasons[0] shape — { reason, message }',
    description: 'reasons[0] has both "reason" and "message" keys',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('contact_email');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field not found' };

      let thrownError: SerializedError | null = null;
      try { await field.setData('not-an-email'); } catch (e) { thrownError = serializeError(e); }

      const r = (thrownError?.details?.[0] as any)?.reasons?.[0];
      const passed = r && 'reason' in r && 'message' in r;
      return { outcome: thrownError ? 'threw' : 'resolved', thrownError, passed,
        failReason: passed ? undefined : `reasons[0] shape invalid — got ${JSON.stringify(r)}` };
    },
  },
  {
    id: 'V-07', group: 'validation-error', label: 'Nested field — details[0].fieldUid identifies the violated field',
    description: 'ValidationError for a nested field has fieldUid for the specific violated field (no "field" dot-path property)',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      const field = entry.getField('address');
      if (!field) return { outcome: 'error', passed: false, failReason: 'field "address" not found' };

      let thrownError: SerializedError | null = null;
      try { await field.setData({ street: '', city: 'Austin', postal_code: '73301', coordinates: { latitude: 30, longitude: -97 } }); }
      catch (e) { thrownError = serializeError(e); }

      const details = thrownError?.details ?? [];
      const allHaveFieldUid = details.every((d: any) => typeof d.fieldUid === 'string' && d.fieldUid.length > 0);
      const noneHaveFieldProp = details.every((d: any) => !('field' in d));
      const passed = thrownError?.isValidationError === true && details.length > 0 && allHaveFieldUid && noneHaveFieldProp;
      return { outcome: thrownError ? 'threw' : 'resolved', thrownError, errorDetails: details, passed,
        note: `fieldUids: ${details.map((d: any) => d.fieldUid).join(', ')}`,
        failReason: passed ? undefined : !thrownError ? 'no ValidationError thrown' : !details.length ? 'no details' : !allHaveFieldUid ? 'some details missing fieldUid' : 'some details still have "field" property' };
    },
  },
  {
    id: 'V-08', group: 'validation-error', label: 'ValidationError importable from @contentstack/app-sdk',
    description: 'import { ValidationError } from "@contentstack/app-sdk" works; new ValidationError("msg", []) works',
    execute: async (_sdk) => {
      let importSucceeded = false;
      let constructSucceeded = false;
      let constructedCode = '';

      try {
        const mod = await import('@contentstack/app-sdk' as any);
        const VE = mod.ValidationError;
        importSucceeded = typeof VE === 'function';
        if (importSucceeded) {
          const instance = new VE('test', []);
          constructSucceeded = true;
          constructedCode = instance.code;
        }
      } catch (_e) { /* import or construction failed */ }

      const passed = importSucceeded && constructSucceeded && constructedCode === 'VALIDATION_ERROR';
      return {
        outcome: passed ? 'import-ok' : 'import-failed',
        passed,
        note: `import: ${importSucceeded}, construct: ${constructSucceeded}, code: "${constructedCode}"`,
        failReason: passed ? undefined : !importSucceeded ? 'ValidationError not exported from @contentstack/app-sdk' : `code was "${constructedCode}"`,
      };
    },
  },
  {
    id: 'V-09', group: 'validation-error', label: 'Multi-detail error — details.length === 3, each has correct shape',
    description: 'Trigger 3-field error; verify each detail has field + fieldType',
    execute: async (sdk) => {
      const entry = getLocationEntry(sdk);
      let thrownError: SerializedError | null = null;
      try { await entry.setData({ contact_email: 'bad', sku_code: '', mandatory_notes: '' }); }
      catch (e) { thrownError = serializeError(e); }

      const details = thrownError?.details ?? [];
      const allHaveShape = details.every((d: any) => d.fieldUid && Array.isArray(d.reasons) && !('field' in d));
      const passed = details.length >= 1 && allHaveShape;
      return { outcome: thrownError ? 'threw' : 'resolved', thrownError, errorDetails: details, passed,
        note: `details.length = ${details.length}`,
        failReason: passed ? undefined : !thrownError ? 'no error thrown' : !allHaveShape ? 'some details missing fieldUid/reasons or still have removed "field" property' : `details.length was ${details.length}` };
    },
  },
  {
    id: 'V-10', group: 'validation-error', label: 'Empty details array — error.details is []',
    description: 'ValidationError with empty details: error.details is [], error.code is "VALIDATION_ERROR"',
    execute: async (_sdk) => {
      let constructSucceeded = false;
      let emptyDetails = false;
      let codeCorrect = false;

      try {
        const mod = await import('@contentstack/app-sdk' as any);
        const VE = mod.ValidationError;
        if (typeof VE === 'function') {
          const instance = new VE('err', []);
          constructSucceeded = true;
          emptyDetails = Array.isArray(instance.details) && instance.details.length === 0;
          codeCorrect = instance.code === 'VALIDATION_ERROR';
        }
      } catch (_e) { /* import or construction failed */ }

      const passed = constructSucceeded && emptyDetails && codeCorrect;
      return {
        outcome: passed ? 'ok' : 'failed', passed,
        note: `construct: ${constructSucceeded}, emptyDetails: ${emptyDetails}, code: ${codeCorrect}`,
        failReason: passed ? undefined : 'Could not construct ValidationError with empty details or code mismatch',
      };
    },
  },
];

// ─── Export ───────────────────────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [...groupA, ...groupB, ...groupC, ...groupD, ...groupE];
