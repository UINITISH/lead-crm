/**
 * One-time import of scripts/data/imported-project-catalog.json — a real
 * project/inventory catalog (project name, location, unit configurations,
 * sizes, price ranges, possession dates) exported from a spreadsheet, one
 * sheet per Bangalore locality. It has no lead/contact data at all, so this
 * only ever touches `projects` and `project_unit_types` — never `leads`.
 *
 * Developer matching is deliberately conservative: a project only gets
 * linked to an existing developer when its name contains an unambiguous
 * brand keyword (e.g. "GODREJ", "SOBHA"). Everything else is inserted with
 * developer_id = NULL — an "independent" project, same concept the manual
 * lead-entry form already supports — rather than guessing at a developer
 * name the sheet never actually provided. Those show up in the CRM's
 * Developers & Projects page under "Independent / other projects".
 *
 * Safe to re-run: findOrCreateProject upserts by (name, developer_id) and
 * replaceUnitTypes replaces a project's configuration rows wholesale.
 *
 * Usage:  node scripts/import-project-catalog.js
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/migrate.js';
import { findOrCreateDeveloper, findOrCreateProject, replaceUnitTypes } from '../src/developers.js';
import { closeDb } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(here, 'data', 'imported-project-catalog.json');

// Only brands unambiguous enough to auto-link. Order matters where one
// keyword is a substring of another's match space.
const BRAND_KEYWORDS = [
  { keyword: 'TOTAL ENVIRONMENT', developer: 'Total Environment' },
  { keyword: 'PURAVANKARA', developer: 'Puravankara' },
  { keyword: 'PRESTIGE', developer: 'Prestige Group' },
  { keyword: 'SOBHA', developer: 'Sobha Limited' },
  { keyword: 'GODREJ', developer: 'Godrej Properties' },
  { keyword: 'BIRLA', developer: 'Birla Estates' },
  { keyword: 'ASSETZ', developer: 'Assetz Property Group' },
  { keyword: 'SATTVA', developer: 'Sattva Group' },
  { keyword: 'SUMADHURA', developer: 'Sumadhura Group' },
  { keyword: 'BRIGADE', developer: 'Brigade Group' },
  { keyword: 'PURVA', developer: 'Puravankara' },
  { keyword: 'EMBASSY', developer: 'Embassy Group' },
  { keyword: 'SHRIRAM', developer: 'Shriram Properties' },
  { keyword: 'SHILPITHA', developer: 'Maithri Developers' },
  { keyword: 'SNN', developer: 'SNN Builders (SNN Raj Corp)' },
];

function matchDeveloper(projectName) {
  const upper = projectName.toUpperCase();
  const hit = BRAND_KEYWORDS.find(({ keyword }) => upper.includes(keyword));
  return hit ? hit.developer : null;
}

async function main() {
  await migrate();

  const raw = await readFile(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(raw);

  let matched = 0;
  let independent = 0;
  let unitRows = 0;
  const unmatchedNames = [];

  for (const entry of catalog) {
    const developerName = matchDeveloper(entry.name);
    let developerId = null;
    if (developerName) {
      const dev = await findOrCreateDeveloper(developerName);
      developerId = dev.id;
      matched++;
    } else {
      independent++;
      unmatchedNames.push(entry.name);
    }

    const project = await findOrCreateProject(entry.name, developerId, {
      location: entry.location,
      inventory_notes: entry.details,
      area: entry.area,
      possession: entry.possession,
    });

    const n = await replaceUnitTypes(project.id, entry.unit_types);
    unitRows += n;
  }

  console.log(`\n[import] ${catalog.length} projects processed`);
  console.log(`[import]   ${matched} linked to an existing developer`);
  console.log(`[import]   ${independent} left independent (no confident brand match)`);
  console.log(`[import]   ${unitRows} unit-type rows written`);
  if (unmatchedNames.length) {
    console.log(`[import] independent projects: ${unmatchedNames.join(', ')}`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error('[import] failed:', err);
  process.exit(1);
});
