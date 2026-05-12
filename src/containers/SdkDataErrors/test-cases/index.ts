import textMultiple from './text-multiple.json';
import textConstrained from './text-constrained.json';
import textInGroup from './text-in-group.json';
import textInRepeatableGroup from './text-in-repeatable-group.json';
import textInModularBlocks from './text-in-modular-blocks.json';
import textInGlobalField from './text-in-global-field.json';
import textNestedGroups from './text-nested-groups.json';
import numberField from './number-field.json';
import booleanField from './boolean-field.json';
import dateField from './date-field.json';
import fileField from './file-field.json';
import linkField from './link-field.json';
import referenceField from './reference-field.json';
import selectField from './select-field.json';
import groupFieldComplex from './group-field-complex.json';
import globalFieldComplex from './global-field-complex.json';
import customExtensionField from './custom-extension-field.json';
import taxonomyField from './taxonomy-field.json';
import jsonRteField from './json-rte-field.json';
import allFieldsComplex from './all-fields-complex.json';

export const allModules = [
  textMultiple,
  textConstrained,
  textInGroup,
  textInRepeatableGroup,
  textInModularBlocks,
  textInGlobalField,
  textNestedGroups,
  numberField,
  booleanField,
  dateField,
  fileField,
  linkField,
  referenceField,
  selectField,
  groupFieldComplex,
  globalFieldComplex,
  customExtensionField,
  taxonomyField,
  jsonRteField,
  allFieldsComplex,
] as const;

export type TestModule = (typeof allModules)[number];
