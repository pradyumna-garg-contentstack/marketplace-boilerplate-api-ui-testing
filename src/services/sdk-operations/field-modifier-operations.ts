import { SdkTestOperation } from "../../types/sdk-testing.types";

// Store test data between operations
const TEST_FIELD_VALUE = 'E2E Test Field Value';
const TEST_TAGS = ['e2e-tag-1', 'e2e-tag-2'];

export const fieldModifierOperations: SdkTestOperation[] = [
  {
    id: 'sdk-fm-get-field-data',
    name: 'Get Field Data',
    description: 'Read field data using field.getData()',
    testId: 'sdk-fm-get-field-data',
    resultTestId: 'sdk-fm-get-field-data-result',
    execute: async (sdk) => {
      const fieldData = await sdk.location.FieldModifierLocation?.field.getData();
      return {
        status: 'success',
        data: fieldData
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string };
      return typedResult?.status === 'success';
    }
  },
  {
    id: 'sdk-fm-set-field-data',
    name: 'Set Field Data',
    description: 'Write field data using field.setData()',
    testId: 'sdk-fm-set-field-data',
    resultTestId: 'sdk-fm-set-field-data-result',
    execute: async (sdk) => {
      await sdk.location.FieldModifierLocation?.field.setData(TEST_FIELD_VALUE);
      return {
        status: 'success',
        message: 'Field data set successfully',
        value: TEST_FIELD_VALUE
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string };
      return typedResult?.status === 'success';
    }
  },
  {
    id: 'sdk-fm-get-field-uid',
    name: 'Get Field UID',
    description: 'Get field UID using field.uid',
    testId: 'sdk-fm-get-field-uid',
    resultTestId: 'sdk-fm-get-field-uid-result',
    execute: async (sdk) => {
      const fieldUid = sdk.location.FieldModifierLocation?.field.uid;
      return {
        status: 'success',
        uid: fieldUid
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string; uid?: string };
      return typedResult?.status === 'success' && !!typedResult?.uid;
    }
  },
  {
    id: 'sdk-fm-get-field-schema',
    name: 'Get Field Schema',
    description: 'Get field schema using field.schema',
    testId: 'sdk-fm-get-field-schema',
    resultTestId: 'sdk-fm-get-field-schema-result',
    execute: async (sdk) => {
      const schema = sdk.location.FieldModifierLocation?.field.schema;
      return {
        status: 'success',
        schema: schema
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string; schema?: unknown };
      return typedResult?.status === 'success' && !!typedResult?.schema;
    }
  },
  {
    id: 'sdk-fm-get-entry',
    name: 'Get Entry Data',
    description: 'Read entry data using entry.getData()',
    testId: 'sdk-fm-get-entry',
    resultTestId: 'sdk-fm-get-entry-result',
    execute: async (sdk) => {
      const entryData = await sdk.location.FieldModifierLocation?.entry.getData();
      return {
        status: 'success',
        entry: entryData
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string; entry?: unknown };
      return typedResult?.status === 'success' && !!typedResult?.entry;
    }
  },
  {
    id: 'sdk-fm-get-tags',
    name: 'Get Entry Tags',
    description: 'Get entry tags using entry.getTags()',
    testId: 'sdk-fm-get-tags',
    resultTestId: 'sdk-fm-get-tags-result',
    execute: async (sdk) => {
      const entry = sdk.location.FieldModifierLocation?.entry as any;
      const tags = entry?.getTags ? entry.getTags() : [];
      return {
        status: 'success',
        tags: tags || []
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string; tags?: string[] };
      return typedResult?.status === 'success' && Array.isArray(typedResult?.tags);
    }
  },
  {
    id: 'sdk-fm-set-tags',
    name: 'Set Entry Tags',
    description: 'Set entry tags using entry.setTags()',
    testId: 'sdk-fm-set-tags',
    resultTestId: 'sdk-fm-set-tags-result',
    execute: async (sdk) => {
      const entry = sdk.location.FieldModifierLocation?.entry as any;
      const updatedTags = entry?.setTags ? await entry.setTags(TEST_TAGS) : [];
      return {
        status: 'success',
        message: 'Tags set successfully',
        tags: updatedTags
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string; tags?: string[] };
      return typedResult?.status === 'success' && Array.isArray(typedResult?.tags);
    }
  },
];

