import { SdkTestOperation } from "../../types/sdk-testing.types";

// Store test data between operations
const TEST_CONFIG_KEY = 'e2e_test_config';
const TEST_CONFIG_VALUE = { testKey: 'testValue', timestamp: Date.now() };

export const appConfigOperations: SdkTestOperation[] = [
  {
    id: 'sdk-appcfg-get-install',
    name: 'Get Installation Data',
    description: 'Read installation data using installation.getInstallationData()',
    testId: 'sdk-appcfg-get-install',
    resultTestId: 'sdk-appcfg-get-install-result',
    execute: async (sdk) => {
      const installationData = await sdk.location.AppConfigWidget?.installation.getInstallationData();
      if (!installationData) {
        throw new Error('Installation data not found');
      }
      return installationData;
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => result !== null && typeof result === 'object'
  },
  {
    id: 'sdk-appcfg-set-install',
    name: 'Set Installation Data',
    description: 'Write installation config using installation.setInstallationData()',
    testId: 'sdk-appcfg-set-install',
    resultTestId: 'sdk-appcfg-set-install-result',
    execute: async (sdk) => {
      await sdk.location.AppConfigWidget?.installation.setInstallationData({
        configuration: {
          [TEST_CONFIG_KEY]: TEST_CONFIG_VALUE
        },
        serverConfiguration: {}
      });
      return { 
        status: 'success', 
        message: 'Installation data set successfully',
        data: { [TEST_CONFIG_KEY]: TEST_CONFIG_VALUE }
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string };
      return typedResult?.status === 'success';
    }
  },
  {
    id: 'sdk-appcfg-set-validity',
    name: 'Set Validity',
    description: 'Set validation state using installation.setValidity()',
    testId: 'sdk-appcfg-set-validity',
    resultTestId: 'sdk-appcfg-set-validity-result',
    execute: async (sdk) => {
      // Set to true to indicate valid configuration
      await sdk.location.AppConfigWidget?.installation.setValidity(true);
      return { 
        status: 'success', 
        message: 'Validity set to true',
        isValid: true
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string; isValid?: boolean };
      return typedResult?.status === 'success' && typedResult?.isValid === true;
    }
  },
  {
    id: 'sdk-appcfg-stack',
    name: 'Get Stack Instance',
    description: 'Expose stack instance using installation.stack()',
    testId: 'sdk-appcfg-stack',
    resultTestId: 'sdk-appcfg-stack-result',
    execute: async (sdk) => {
      const stack = await sdk.location.AppConfigWidget?.installation.stack();
      if (!stack) {
        throw new Error('Stack instance not found');
      }
      // Return basic stack info to verify it's accessible
      return {
        status: 'success',
        message: 'Stack instance retrieved',
        hasStack: true,
        stackType: typeof stack
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string; hasStack?: boolean };
      return typedResult?.status === 'success' && typedResult?.hasStack === true;
    }
  },
  {
    id: 'sdk-appcfg-api',
    name: 'Call sdk.api',
    description: 'Fetch content types using sdk.api()',
    testId: 'sdk-appcfg-api',
    resultTestId: 'sdk-appcfg-api-result',
    execute: async (sdk) => {
      if (!sdk?.endpoints?.CMA) {
        throw new Error('CMA endpoint not available');
      }
      const res = await sdk.api(`${sdk.endpoints.CMA}/v3/content_types?limit=1`, {
        method: 'GET',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error_message || 'Failed to fetch content types');
      }
      const json = await res.json() as Record<'content_types', unknown[]>;
      return {
        status: 'success',
        count: json?.content_types?.length || 0,
      };
    },
    formatResult: (result) => JSON.stringify(result, null, 2),
    validateResult: (result) => {
      const typedResult = result as { status?: string; count?: number };
      return typedResult?.status === 'success' && typeof typedResult?.count === 'number';
    },
  },
];