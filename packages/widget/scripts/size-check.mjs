import { readFileSync } from 'node:fs';

import { BUNDLES } from './bundles.mjs';
import {
  LAZY_CHUNK_BUDGET_BYTES,
  LOCAL_WIDGET_BUDGET_BYTES,
  WIDGET_BUDGET_BYTES,
  checkBudget,
  formatBudget,
  gzipSize,
} from './size-budget.mjs';

let allOk = true;

function budgetFor(bundle) {
  if (bundle.chunk) return LAZY_CHUNK_BUDGET_BYTES;
  return bundle.local ? LOCAL_WIDGET_BUDGET_BYTES : WIDGET_BUDGET_BYTES;
}

for (const bundle of BUNDLES) {
  const path = new URL(`../${bundle.outfile}`, import.meta.url);
  const result = checkBudget(gzipSize(readFileSync(path)), budgetFor(bundle));

  console.log(`${bundle.outfile}: ${formatBudget(result)}`);
  allOk = allOk && result.ok;
}

process.exit(allOk ? 0 : 1);
