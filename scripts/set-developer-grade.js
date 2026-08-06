/**
 * Sets (or clears) a developer's grade in the directory — the "A-Grade" /
 * "B-Grade" / "Other" grouping shown in the Developer(s) picker on Add/Edit
 * lead. Generic and reusable, not a one-off tied to a single developer.
 *
 * Usage:
 *   node scripts/set-developer-grade.js --name "Truaquapolis" --grade B --confirm
 *   node scripts/set-developer-grade.js --name "Some Builder" --grade none --confirm   (moves it to "Other")
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--grade') out.grade = argv[++i];
  }
  return out;
}

const { name, grade: gradeArg, confirm } = parseArgs(process.argv.slice(2));
if (!name || !gradeArg) {
  console.error('Usage: node scripts/set-developer-grade.js --name "Truaquapolis" --grade B --confirm');
  process.exit(1);
}
const grade = gradeArg.toUpperCase() === 'NONE' ? null : gradeArg.toUpperCase();
if (grade !== null && grade !== 'A' && grade !== 'B') {
  console.error(`--grade must be A, B, or none (got "${gradeArg}")`);
  process.exit(1);
}

await initDb();

const dev = await query(`SELECT id, name, grade FROM developers WHERE LOWER(name) = LOWER($1)`, [name]);
if (!dev.rows.length) {
  console.error(`No developer found named "${name}"`);
  await closeDb();
  process.exit(1);
}
const row = dev.rows[0];
console.log(`\n"${row.name}": grade ${row.grade ?? '(none — "Other")'} -> ${grade ?? '(none — "Other")'}`);

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

await query(`UPDATE developers SET grade = $1 WHERE id = $2`, [grade, row.id]);
console.log(`Done.\n`);
await closeDb();
