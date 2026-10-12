// One-time/operator backfill for claims that predate migration 030.
// Future claim captures generate their row automatically in server/index.js.
import { db } from '../server/db.js';
import { backfillSalaryGuidance } from '../server/salaryGuidance.js';

const run = db.transaction(() => backfillSalaryGuidance(db));
const result = run();
console.log(JSON.stringify(result));
db.close();
