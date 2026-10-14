import { readFileSync } from 'node:fs';

import { BUNDLES } from './bundles.mjs';
import { checkBudget, formatBudget, gzipSize } from './size-budget.mjs';

let allOk = true;

for (const bundle of BUNDLES) {
  const path = new URL(`../${bundle.outfile}`, import.meta.url);
  const result = checkBudget(gzipSize(readFileSync(path)));

  console.log(`${bundle.outfile}: ${formatBudget(result)}`);
  allOk = allOk && result.ok;
}

process.exit(allOk ? 0 : 1);
