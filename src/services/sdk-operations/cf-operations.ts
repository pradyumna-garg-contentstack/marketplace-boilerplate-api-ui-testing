import { 
  SdkTestOperation, 
  TestCategory, 
  ContentTypeOperationResult, 
  ApiErrorResponse, 
  WorkerInfo 
} from '../../types/sdk-testing.types';
import UiLocation from '@contentstack/app-sdk/dist/src/uiLocation';

let lastChangedFieldData: any = null;
let lastSavedFieldData: any = null;

export const registerCallbacks = (sdk: UiLocation) => {
  sdk.location?.CustomField?.entry?.onChange((data: any) => {
    console.log('CustomField onChange callback', data);
    lastChangedFieldData = data;
  });

  sdk.location?.CustomField?.entry?.onSave((data: any) => {
    console.log('CustomField onSave callback', data);
    lastSavedFieldData = data;
  });
};

export const cfOperations: SdkTestOperation[] = [
  {
    id: 'cf-field-read',
    name: 'Get Field Data',
    description: 'Read current field data from Custom Field',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-field-data',
    resultTestId: 'sdk-cf-field-data-result',
    execute: async (sdk) => {
      const field = sdk?.location?.CustomField?.field;
      if (!field) {
        throw new Error('Field object not available at CustomField');
      }
      
      const data = await field.getData();
      return data;
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result !== null && result !== undefined,
  },
  {
    id: 'cf-field-update',
    name: 'Set Field Data',
    description: 'Update current field data in Custom Field',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-field-update',
    resultTestId: 'sdk-cf-field-update-result',
    execute: async (sdk) => {
      const field = sdk?.location?.CustomField?.field;
      if (!field) {
        throw new Error('Field object not available at CustomField');
      }
      
      const newData = new Date().toISOString();
      await field.setData(newData);
      return { 
        status: 'success', 
        message: 'Field data updated successfully', 
        newData: newData 
      };
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result?.status === 'success',
  },
  {
    id: 'cf-field-schema',
    name: 'Get Field Schema',
    description: 'Get the current field schema information',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-field-schema',
    resultTestId: 'sdk-cf-field-schema-result',
    execute: async (sdk) => {
      const field = sdk?.location?.CustomField?.field;
      if (!field) {
        throw new Error('Field object not available at CustomField');
      }
      
      try {
        // Try to get schema information if available
        const schema = field.schema || null;
        const uid = field.uid || null;
        const dataType = field.data_type || null;
        
        return { 
          schema,
          uid,
          dataType,
          message: 'Field schema information retrieved'
        };
      } catch (error) {
        return {
          message: 'Schema information not directly accessible',
          error: (error as Error).message
        };
      }
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result !== null,
  },
  {
    id: 'cf-entry-data',
    name: 'Get Entry Data',
    description: 'Get the current entry data from Custom Field location',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-entry-data',
    resultTestId: 'sdk-cf-entry-data-result',
    execute: async (sdk) => {
      const entry = sdk?.location?.CustomField?.entry;
      if (!entry) {
        throw new Error('Entry object not available at CustomField');
      }
      
      const entryData = await entry.getData();
      return {
        uid: entryData.uid,
        title: entryData.title,
        content_type_uid: entryData.content_type_uid,
        locale: entryData.locale,
        updated_at: entryData.updated_at
      };
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => typeof result?.uid === 'string' && result.uid.length > 0,
  },
  {
    id: 'cf-last-changed',
    name: 'Get Last Changed Data',
    description: 'Get the data from the last onChange callback',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-last-changed',
    resultTestId: 'sdk-cf-last-changed-result',
    execute: async () => {
      return lastChangedFieldData || { message: 'No onChange callback triggered yet' };
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result !== null,
  },
  {
    id: 'cf-last-saved',
    name: 'Get Last Saved Data',
    description: 'Get the data from the last onSave callback',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-last-saved',
    resultTestId: 'sdk-cf-last-saved-result',
    execute: async () => {
      return lastSavedFieldData || { message: 'No onSave callback triggered yet' };
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result !== null,
  },
  {
    id: 'cf-stack-details',
    name: 'Get Stack Details',
    description: 'Get the details of the stack',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-stack-details',
    resultTestId: 'sdk-cf-stack-details-result',
    execute: async (sdk) => {
      const stackDetails = sdk?.location?.CustomField?.stack.getData();
      if (!stackDetails) {
        throw new Error('Stack details not available at CustomField');
      }
      return { status: 'success', stackDetails: stackDetails };
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result?.status === 'success',
  },
  {
    id: 'cf-frame-height',
    name: 'Get Frame Height',
    description: 'Get the height of the frame',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-frame-height',
    resultTestId: 'sdk-cf-frame-height-result',
    execute: async (sdk) => {
      const frameHeight = sdk?.location?.CustomField?.frame._height;
      if (!frameHeight) {
        throw new Error('Frame height not available at CustomField');
      }
      return { status: 'success', frameHeight: frameHeight };
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result?.status === 'success',
  },
  {
    id: 'cf-update-frame-height',
    name: 'Update Frame Height',
    description: 'Update the height of the frame',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-update-frame-height',
    resultTestId: 'sdk-cf-update-frame-height-result',
    execute: async (sdk) => {
      const frameHeight = sdk?.location?.CustomField?.frame._height;
      if (!frameHeight) {
        throw new Error('Frame height not available at CustomField');
      }
      const newFrameHeight = frameHeight + 100;
      await sdk?.location?.CustomField?.frame.updateHeight(newFrameHeight);
      return { status: 'success', frameHeight: newFrameHeight };
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result?.status === 'success',
  },
  {
    id: 'cf-create-content-type',
    name: 'Create Content Type (CMA)',
    description: 'Create content type using CMA from Custom Field location',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-create-content-type',
    resultTestId: 'sdk-cf-create-content-type-result',
    execute: async (sdk, context) => {
      if (!context?.cmsInstance || !context?.stackApiKey) {
        throw new Error('CMS instance or API key not available');
      }
      
      // Generate unique content type UID to prevent race conditions in parallel tests
      const timestamp = Date.now();
      const workerInfo = (globalThis as any).__playwright_worker_info as WorkerInfo | undefined;
      const workerIndex = workerInfo?.parallelIndex ?? Math.floor(Math.random() * 1000);
      const contentTypeUid = `test_content_type_cf_w${workerIndex}_t${timestamp}`;
      const contentTypeTitle = `Test Content Type CF (Worker ${workerIndex})`;
      
      const stack = context.cmsInstance.stack({ api_key: context.stackApiKey });
      try {
        const ct = await stack
          .contentType()
          .create({
            content_type: {
              title: contentTypeTitle,
              uid: contentTypeUid,
              schema: [
                {
                  display_name: 'Title',
                  uid: 'title',
                  data_type: 'text',
                  field_metadata: { _default: true },
                  mandatory: true,
                  multiple: false,
                  unique: false,
                },
                {
                  display_name: 'Description',
                  uid: 'description',
                  data_type: 'text',
                  field_metadata: { _default: true },
                  multiple: false,
                  unique: false,
                },
              ],
              options: {
                is_page: false,
                singleton: false,
                title: contentTypeTitle,
                sub_title: ['Test Content Type Description'],
              },
            },
          });
        return { status: 'created', uid: ct?.uid ?? contentTypeUid, contentTypeUid };
      } catch (error: unknown) {
        const apiError = (error as { data?: ApiErrorResponse })?.data ?? {};
        const errorCode = apiError.error_code;
        const errors = apiError.errors;
        // Handle error code 115: validation errors with "not unique" messages
        if (errorCode === 115 || 
            (errors && Object.values(errors).some((err: string[]) => 
              Array.isArray(err) && err.some(e => e.toLowerCase().includes('not unique'))
            ))) {
          return { status: 'exists', uid: contentTypeUid, contentTypeUid };
        }
        
        throw error;
      }
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: unknown): result is ContentTypeOperationResult => {
      const ctResult = result as ContentTypeOperationResult;
      return !!(ctResult && (ctResult.status === 'created' || ctResult.status === 'exists'));
    },
  },
  {
    id: 'cf-update-other-field',
    name: 'Update Other Field',
    description: 'Get another field (content) and update it using Custom Field',
    category: 'cf' as TestCategory,
    testId: 'sdk-cf-update-other-field',
    resultTestId: 'sdk-cf-update-other-field-result',
    execute: async (sdk) => {
      const entry = sdk?.location?.CustomField?.entry;
      if (!entry) {
        throw new Error('Entry object not available at CustomField');
      }
      
      // Get the 'content' field
      const contentField = entry.getField('content');
      if (!contentField) {
        throw new Error('Field "content" not found in entry');
      }
      
      // Get current data before update
      const oldData = await contentField.getData();
      
      // Update the field
      const updateValue = 'Updated using custom field';
      await contentField.setData(updateValue);
      
      // Verify the update by getting the data back
      const newData = await contentField.getData();
      
      // Check if update was successful by comparing values
      const isUpdated = typeof newData === 'string' 
        ? newData === updateValue 
        : JSON.stringify(newData) === JSON.stringify(updateValue);
      
      return {
        status: 'success',
        fieldUid: 'content',
        oldData: oldData,
        newData: newData,
        updateValue: updateValue,
        isUpdated: isUpdated
      };
    },
    formatResult: (result: unknown) => JSON.stringify(result, null, 2),
    validateResult: (result: any) => result?.status === 'success' && result?.isUpdated === true,
  },
  
];
