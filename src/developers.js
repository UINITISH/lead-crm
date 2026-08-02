/**
 * Developer (builder) + project directory.
 *
 * Backs manual lead entry. The list below is the Bangalore builder roster the
 * sales team actually works from — seeded once so the "Add lead" form has a
 * real dropdown on day one instead of an empty select box. New projects
 * launch faster than anyone updates a spreadsheet, so findOrCreate* lets the
 * form accept a typed name it doesn't recognise and creates it on the spot,
 * rather than blocking the lead on someone editing this file first.
 */
import { query } from './db.js';

export async function listDevelopers() {
  const res = await query(
    `SELECT d.*, COUNT(p.id)::int AS project_count
       FROM developers d
       LEFT JOIN projects p ON p.developer_id = d.id
      GROUP BY d.id
      ORDER BY d.grade NULLS LAST, d.name`,
  );
  return res.rows;
}

export async function listProjects({ developer_id } = {}) {
  const where = developer_id ? `WHERE p.developer_id = $1` : '';
  const params = developer_id ? [developer_id] : [];
  const res = await query(
    `SELECT p.*, d.name AS developer_name, d.grade AS developer_grade,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', u.id, 'configuration', u.configuration,
                        'dimension', u.dimension, 'price_range', u.price_range
                      ) ORDER BY u.sort_order)
                 FROM project_unit_types u WHERE u.project_id = p.id),
              '[]'
            ) AS unit_types
       FROM projects p
       LEFT JOIN developers d ON d.id = p.developer_id
       ${where}
      ORDER BY d.name NULLS LAST, p.name`,
    params,
  );
  return res.rows;
}

/** Find a developer by name (case-insensitive) or create it. */
export async function findOrCreateDeveloper(name, grade = null) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const res = await query(
    `INSERT INTO developers (name, grade) VALUES ($1, $2)
     ON CONFLICT (LOWER(name)) DO UPDATE SET name = developers.name
     RETURNING *`,
    [clean, grade],
  );
  return res.rows[0];
}

/**
 * Find a project by name under a developer, or create it. developerId may be
 * null (independent/unlisted project). `extra` fields are only ever
 * strengthened, never blanked out: a plain manual-entry call with no `extra`
 * won't wipe out location/price/notes a catalog import already filled in.
 */
export async function findOrCreateProject(name, developerId, extra = {}) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const res = await query(
    `INSERT INTO projects (name, developer_id, location, price_range, inventory_notes, area, possession)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (LOWER(name), developer_id) DO UPDATE SET
       name            = projects.name,
       location        = COALESCE(EXCLUDED.location, projects.location),
       price_range     = COALESCE(EXCLUDED.price_range, projects.price_range),
       inventory_notes = COALESCE(EXCLUDED.inventory_notes, projects.inventory_notes),
       area            = COALESCE(EXCLUDED.area, projects.area),
       possession      = COALESCE(EXCLUDED.possession, projects.possession)
     RETURNING *`,
    [
      clean, developerId,
      extra.location ?? null, extra.price_range ?? null, extra.inventory_notes ?? null,
      extra.area ?? null, extra.possession ?? null,
    ],
  );
  return res.rows[0];
}

/**
 * Replace a project's unit-type breakdown (1BHK/2BHK/... with size + price)
 * wholesale. Delete-then-insert rather than a diff — this only ever runs
 * from a catalog re-import, and a full replace can't leave a stale
 * configuration behind that the source sheet has since dropped.
 */
export async function replaceUnitTypes(projectId, unitTypes = []) {
  await query(`DELETE FROM project_unit_types WHERE project_id = $1`, [projectId]);
  let i = 0;
  for (const u of unitTypes) {
    await query(
      `INSERT INTO project_unit_types (project_id, configuration, dimension, price_range, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, u.configuration ?? null, u.dimension ?? null, u.price_range ?? null, i++],
    );
  }
  return unitTypes.length;
}

/**
 * One-time reference data load. Guarded on an empty table, not ON CONFLICT
 * alone, so it costs one COUNT(*) on every boot after the first rather than
 * re-running ~130 upserts every time the server restarts.
 */
export async function seedDeveloperDirectory() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM developers`);
  if (rows[0].n > 0) return { developers: 0, projects: 0, skipped: true };

  let devCount = 0;
  let projCount = 0;
  for (const [grade, builders] of Object.entries(DIRECTORY)) {
    for (const [devName, projects] of Object.entries(builders)) {
      const dev = await findOrCreateDeveloper(devName, grade);
      devCount++;
      for (const projName of projects) {
        await findOrCreateProject(projName, dev.id);
        projCount++;
      }
    }
  }
  console.log(`[developers] seeded ${devCount} developers, ${projCount} projects`);
  return { developers: devCount, projects: projCount, skipped: false };
}

const DIRECTORY = {
  A: {
    'Prestige Group': [
      'Prestige Southern Star (Begur Road)',
      'Prestige Raintree Park',
      'UB City',
      'Prestige Shantiniketan',
      'Prestige Golfshire',
      'The Forum',
    ],
    'Sobha Limited': [
      'Sobha Neopolis (Panathur Road)',
      'Sobha Victoria Park (Hennur Road)',
      'Sobha Altus (Outer Ring Road)',
      'Sobha Galera',
      'Sobha Athena (Thanisandra)',
      'Sobha Insignia (Bannerghatta Road)',
      'Sobha Crystal Meadows',
    ],
    'Brigade Group': [
      'Brigade Gateway',
      'Brigade Metropolis',
      'Brigade Cornerstone Utopia',
    ],
    'Puravankara': [
      'Purva Atmosphere (Thanisandra/Hebbal)',
      'Purva Zenium (Kogilu)',
      'Purva Aspire (Devanahalli)',
      'Purva Park Hill',
      'Purva Kensho',
      'Purva San Marco',
      'Provident Housing',
    ],
    'Godrej Properties': [],
    'Total Environment': [],
    'Embassy Group': [],
    'Assetz Property Group': [],
    'Birla Estates': [],
    'Sattva Group': [],
  },
  B: {
    'Shriram Properties': [
      'Shriram Songs of the Earth (Madiwala)',
      'Shriram 107 South East (Attibele)',
      'Shriram Serenity (Yelahanka)',
      'The Poem by Shriram Properties (Jalahalli)',
      'Shriram Southern Crest Phase 2',
      'Shriram Chirping Grove 2',
      'Shriram Blue',
      'Shriram Liberty Square',
      'Shriram Esquire',
    ],
    'Sumadhura Group': [
      'Sumadhura Eden Garden (Whitefield)',
      'Sumadhura Nandanam (Hoodi)',
      'Sumadhura Shikharam (Whitefield)',
    ],
    'Maithri Developers': [
      'Shilpitha Royal',
      'Shilpitha Sunflower',
      'Shilpitha Splendour Annex',
    ],
    'SNN Builders (SNN Raj Corp)': [
      'SNN Raj Serenity Phase II (Begur Road)',
      'SNN Raj Win Tower (Bilekahalli)',
      'SNN Felicity (Rachenahalli)',
    ],
    'ND Developers': [],
    'Nitesh': [],
    'Confident': [],
    'Concorde': [],
    'Jain Housing': [],
    'Vakil': [],
    'SJR': [],
    'HM Construction': [],
  },
};
