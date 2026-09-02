import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { createEmbeddedPostgres } from "./embedded-postgres-utils.mjs";

// PostgreSQL `timestamp without time zone` columns are canonical UTC wall-clock
// values in this application. Force the pg driver's Date conversion to UTC so
// a transfer run from a workstation in Asia/Singapore cannot shift timestamps
// by eight hours while serializing rows through JSON.
process.env.TZ = "UTC";

const BUSINESS_ID = process.env.STAFF_ALLOWLIST_BUSINESS_ID ??
  "d917554b-9cff-4fff-8d81-898397f05cda";
const SOURCE_DATABASE = process.env.STAFF_ALLOWLIST_SOURCE_DB ?? "car_wash_crm_pos";
const TARGET_DATABASE = process.env.STAFF_ALLOWLIST_TARGET_DB ??
  "tetamu_canonical_local_20260829";
const MODE = process.argv[2] ?? "plan";
const SOURCE_URL = process.env.STAFF_ALLOWLIST_SOURCE_URL;
const TARGET_URL = process.env.STAFF_ALLOWLIST_TARGET_URL;
const OUTPUT_DIR = resolve(
  process.env.STAFF_ALLOWLIST_OUTPUT_DIR ??
    "artifacts/local-db-baseline/20260829/canonical-transfer",
);

const EXCLUDED_TABLES = new Set([
  "_prisma_migrations",
  "attendance_request_idempotency",
  "auth_sessions",
  "employee_otp_challenges",
  "notification_queue",
  "notification_queue_events",
  "notification_delivery_attempts",
  "notification_deliveries",
  "otp_rate_limits",
  "rate_limit_buckets",
  "sensitive_action_authorizations",
  "stock_count_sessions",
  "worker_leases",
]);

const DEPENDENCY_ONLY_TABLES = new Set([
  "employee_devices",
  "employee_sessions",
]);

const EXPLICIT_TABLES = new Set([
  "businesses",
  "branches",
  "business_group_audit_logs",
  "business_group_members",
  "business_group_user_business_access",
  "business_group_users",
  "business_groups",
  "users",
  "branch_attendance_settings",
  "business_module_entitlements",
  "business_statutory_profiles",
  "employee_accounts",
  "employee_attendance",
  "employee_devices",
  "employee_bank_account_versions",
  "employee_branch_assignments",
  "employee_business_memberships",
  "employee_claims",
  "employee_compensation_versions",
  "employee_cp38_instructions",
  "employee_leave_balances",
  "employee_leave_entitlements",
  "employee_lindung24_participation_versions",
  "employee_lindung24_refund_events",
  "employee_recurring_pay_components",
  "employee_recurring_pay_component_versions",
  "employee_roster_schedule_versions",
  "employee_sessions",
  "employee_statutory_participation_periods",
  "employee_statutory_profile_versions",
  "staff_levels",
  "staff_availability",
  "staff_breaks",
  "staff_role_profiles",
  "staff_time_off",
  "appointments",
  "customers",
  "service_categories",
  "service_staff_assignments",
  "services",
  "hr_approval_decisions",
  "hr_approval_policies",
]);

const DOMAIN_PREFIXES = [
  "appointment_",
  "attendance_",
  "business_group_",
  "claim_",
  "commission_",
  "leave_",
  "payroll_",
  "roster_",
];

const pg = SOURCE_URL || TARGET_URL ? null : createEmbeddedPostgres();
const source = SOURCE_URL
  ? createUrlClient(SOURCE_URL)
  : pg.getPgClient(SOURCE_DATABASE, "127.0.0.1");
const target = TARGET_URL
  ? createUrlClient(TARGET_URL)
  : pg.getPgClient(TARGET_DATABASE, "127.0.0.1");

await mkdir(OUTPUT_DIR, { recursive: true });
if (!SOURCE_URL && !TARGET_URL) await writeHistoricalRestoreExceptions();

try {
  await source.connect();
  await target.connect();
  await source.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

  const sourceMetadata = await loadMetadata(source);
  const targetMetadata = await loadMetadata(target);
  const metadata = retainCommonCanonicalMetadata(sourceMetadata, targetMetadata);
  const selected = new Map();
  const reasons = new Map();

  await addRootRows({ metadata, reasons, selected, source });
  await expandDependencyGraph({ metadata, reasons, selected, source });

  const plan = summarizeSelection(metadata, selected, reasons);
  await writeJson("allowlist-transfer-plan.json", {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    sourceDatabase: SOURCE_DATABASE,
    targetDatabase: TARGET_DATABASE,
    businessId: BUSINESS_ID,
    tableCount: plan.length,
    rowCount: plan.reduce((sum, item) => sum + item.rowCount, 0),
    tables: plan,
  });

  if (MODE === "plan") {
    printPlan(plan);
    await source.query("ROLLBACK");
    process.exitCode = 0;
  } else if (MODE === "transfer") {
    await assertTargetReady(target);
    try {
      const inserted = await transferRows({ metadata, selected, source, target, targetMetadata });
      const verification = await verifyTransfer({ metadata, selected, source, target, targetMetadata });
      await writeJson("allowlist-transfer-result.json", {
        generatedAt: new Date().toISOString(),
        sourceDatabase: SOURCE_DATABASE,
        targetDatabase: TARGET_DATABASE,
        businessId: BUSINESS_ID,
        inserted,
        verification,
      });
      printVerification(verification);
      if (verification.pass) {
        await target.query("COMMIT");
      } else {
        await target.query("ROLLBACK");
        process.exitCode = 1;
      }
      await source.query("ROLLBACK");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }
  } else if (MODE === "verify") {
    const verification = await verifyTransfer({ metadata, selected, source, target, targetMetadata });
    await writeJson("allowlist-reconciliation-result.json", {
      generatedAt: new Date().toISOString(),
      sourceDatabase: SOURCE_DATABASE,
      targetDatabase: TARGET_DATABASE,
      businessId: BUSINESS_ID,
      verification,
    });
    printVerification(verification);
    await source.query("ROLLBACK");
    if (!verification.pass) process.exitCode = 1;
  } else {
    throw new Error(`Unsupported mode: ${MODE}. Use plan, transfer or verify.`);
  }
} catch (error) {
  try {
    await source.query("ROLLBACK");
  } catch {
    // Connection may not have reached the transaction.
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([source.end(), target.end()]);
}

function isApprovedTable(tableName) {
  if (EXCLUDED_TABLES.has(tableName)) return false;
  if (tableName.startsWith("_")) return false;
  if (EXPLICIT_TABLES.has(tableName)) return true;
  if (DOMAIN_PREFIXES.some((prefix) => tableName.startsWith(prefix))) return true;
  return false;
}

function createUrlClient(connectionString) {
  const parsed = new URL(connectionString);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const remote = new EmbeddedPostgres({
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    port: Number(parsed.port || "5432"),
    persistent: true,
    onLog: () => undefined,
    onError: (error) => console.error(error.message),
  });
  return remote.getPgClient(database, parsed.hostname);
}

function retainCommonCanonicalMetadata(sourceMetadata, targetMetadata) {
  const retained = new Map();
  for (const [tableName, table] of sourceMetadata) {
    if (!targetMetadata.has(tableName) || !isApprovedTable(tableName)) continue;
    retained.set(tableName, {
      ...table,
      foreignKeys: table.foreignKeys.filter((foreignKey) =>
        targetMetadata.has(foreignKey.parentTable) && isApprovedTable(foreignKey.parentTable)),
      inboundForeignKeys: table.inboundForeignKeys.filter((foreignKey) =>
        targetMetadata.has(foreignKey.childTable) && isApprovedTable(foreignKey.childTable)),
    });
  }
  return retained;
}

async function loadMetadata(client) {
  const tableRows = await client.query(`
    SELECT tablename AS table_name
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `);
  const columnRows = await client.query(`
    SELECT table_name, column_name, ordinal_position, is_generated
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const primaryKeyRows = await client.query(`
    SELECT
      c.relname AS table_name,
      array_agg(a.attname ORDER BY key_column.ordinality) AS columns
    FROM pg_constraint constraint_row
    JOIN pg_class c ON c.oid = constraint_row.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key_column.attnum
    WHERE constraint_row.contype = 'p'
      AND n.nspname = 'public'
    GROUP BY c.relname
  `);
  const foreignKeyRows = await client.query(`
    SELECT
      constraint_row.conname AS constraint_name,
      child.relname AS child_table,
      parent.relname AS parent_table,
      ARRAY(
        SELECT attribute.attname
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
        ORDER BY key_column.ordinality
      ) AS child_columns,
      ARRAY(
        SELECT attribute.attname
        FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.confrelid
         AND attribute.attnum = key_column.attnum
        ORDER BY key_column.ordinality
      ) AS parent_columns
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
    JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
    WHERE constraint_row.contype = 'f'
      AND child_namespace.nspname = 'public'
      AND parent_namespace.nspname = 'public'
    ORDER BY child.relname, constraint_row.conname
  `);

  const tables = new Map(tableRows.rows.map(({ table_name: tableName }) => [
    tableName,
    { columns: [], foreignKeys: [], inboundForeignKeys: [], primaryKey: [] },
  ]));
  for (const row of columnRows.rows) {
    const table = tables.get(row.table_name);
    if (!table) continue;
    table.columns.push({
      name: row.column_name,
      generated: row.is_generated !== "NEVER",
    });
  }
  for (const row of primaryKeyRows.rows) {
    const table = tables.get(row.table_name);
    if (table) table.primaryKey = parsePgArray(row.columns);
  }
  for (const row of foreignKeyRows.rows) {
    const foreignKey = {
      name: row.constraint_name,
      childTable: row.child_table,
      parentTable: row.parent_table,
      childColumns: parsePgArray(row.child_columns),
      parentColumns: parsePgArray(row.parent_columns),
    };
    tables.get(row.child_table)?.foreignKeys.push(foreignKey);
    tables.get(row.parent_table)?.inboundForeignKeys.push(foreignKey);
  }
  return tables;
}

async function addRootRows({ metadata, reasons, selected, source }) {
  const business = await source.query(
    `SELECT * FROM public.${quoteIdentifier("businesses")} WHERE id = $1`,
    [BUSINESS_ID],
  );
  if (business.rowCount !== 1) {
    throw new Error(`Allowlisted Business ${BUSINESS_ID} was not found exactly once.`);
  }
  addRows({ metadata, reasons, rows: business.rows, selected, tableName: "businesses", reason: "approved-business-root" });

  for (const [tableName, table] of metadata) {
    if (!isApprovedTable(tableName) || tableName === "businesses") continue;
    if (DEPENDENCY_ONLY_TABLES.has(tableName)) continue;
    if (!table.columns.some((column) => column.name === "business_id")) continue;
    const result = await source.query(
      `SELECT * FROM public.${quoteIdentifier(tableName)} WHERE business_id = $1`,
      [BUSINESS_ID],
    );
    addRows({ metadata, reasons, rows: result.rows, selected, tableName, reason: "approved-business-scope" });
  }
}

async function expandDependencyGraph({ metadata, reasons, selected, source }) {
  const processedParents = new Set();
  const processedChildren = new Set();
  let addedInPass = true;

  while (addedInPass) {
    addedInPass = false;
    for (const [tableName, rowMap] of [...selected]) {
      const table = metadata.get(tableName);
      if (!table) continue;
      for (const [rowKey, row] of [...rowMap]) {
        for (const foreignKey of table.foreignKeys) {
          const workKey = `${tableName}|${rowKey}|parent|${foreignKey.name}`;
          if (processedParents.has(workKey)) continue;
          processedParents.add(workKey);
          const values = foreignKey.childColumns.map((column) => row[column]);
          if (values.some((value) => value == null)) continue;
          const parentRows = await selectByColumns(
            source,
            foreignKey.parentTable,
            foreignKey.parentColumns,
            values,
          );
          if (parentRows.length !== 1) {
            throw new Error(
              `Required parent ${foreignKey.parentTable} for ${tableName}.${foreignKey.name} was not found exactly once.`,
            );
          }
          if (addRows({
            metadata,
            reasons,
            rows: parentRows,
            selected,
            tableName: foreignKey.parentTable,
            reason: `required-parent:${tableName}.${foreignKey.name}`,
          })) addedInPass = true;
        }

        for (const foreignKey of table.inboundForeignKeys) {
          if (!isApprovedTable(foreignKey.childTable)) continue;
          if (DEPENDENCY_ONLY_TABLES.has(foreignKey.childTable)) continue;
          const workKey = `${tableName}|${rowKey}|child|${foreignKey.name}`;
          if (processedChildren.has(workKey)) continue;
          processedChildren.add(workKey);
          const values = foreignKey.parentColumns.map((column) => row[column]);
          const childTable = metadata.get(foreignKey.childTable);
          const extraFilter = childTable?.columns.some((column) => column.name === "business_id")
            ? { column: "business_id", value: BUSINESS_ID }
            : null;
          const childRows = await selectByColumns(
            source,
            foreignKey.childTable,
            foreignKey.childColumns,
            values,
            extraFilter,
          );
          if (addRows({
            metadata,
            reasons,
            rows: childRows,
            selected,
            tableName: foreignKey.childTable,
            reason: `approved-child:${tableName}.${foreignKey.name}`,
          })) addedInPass = true;
        }
      }
    }
  }
}

async function selectByColumns(client, tableName, columns, values, extraFilter = null) {
  const predicates = columns.map(
    (column, index) => `${quoteIdentifier(column)} IS NOT DISTINCT FROM $${index + 1}`,
  );
  const parameters = [...values];
  if (extraFilter) {
    parameters.push(extraFilter.value);
    predicates.push(
      `${quoteIdentifier(extraFilter.column)} IS NOT DISTINCT FROM $${parameters.length}`,
    );
  }
  const result = await client.query(
    `SELECT * FROM public.${quoteIdentifier(tableName)} WHERE ${predicates.join(" AND ")}`,
    parameters,
  );
  return result.rows;
}

function addRows({ metadata, reasons, rows, selected, tableName, reason }) {
  if (!rows.length) return false;
  const table = metadata.get(tableName);
  if (!table) throw new Error(`Missing metadata for table ${tableName}.`);
  if (!table.primaryKey.length) {
    throw new Error(`Table ${tableName} has selected rows but no primary key.`);
  }
  let added = false;
  let rowMap = selected.get(tableName);
  if (!rowMap) {
    rowMap = new Map();
    selected.set(tableName, rowMap);
  }
  for (const row of rows) {
    const key = rowKey(table.primaryKey, row);
    if (!rowMap.has(key)) {
      rowMap.set(key, row);
      added = true;
    }
    const reasonKey = `${tableName}|${key}`;
    const rowReasons = reasons.get(reasonKey) ?? new Set();
    rowReasons.add(reason);
    reasons.set(reasonKey, rowReasons);
  }
  return added;
}

async function assertTargetReady(client) {
  const migrationCount = await client.query(`SELECT count(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL`);
  if (migrationCount.rows[0].count !== 212) {
    throw new Error(`Target migration count is ${migrationCount.rows[0].count}, expected 212.`);
  }
  const existingBusiness = await client.query(`SELECT count(*)::int AS count FROM public.businesses WHERE id = $1`, [BUSINESS_ID]);
  if (existingBusiness.rows[0].count !== 0) {
    throw new Error("Allowlisted Business already exists in target; refusing non-idempotent transfer rerun.");
  }
}

async function transferRows({ metadata, selected, source, target, targetMetadata }) {
  const inserted = [];
  await target.query("BEGIN");
  try {
    await target.query("SET LOCAL session_replication_role = 'replica'");
    for (const tableName of [...selected.keys()].sort()) {
      const table = metadata.get(tableName);
      const targetColumnNames = new Set(
        targetMetadata.get(tableName).columns.map((column) => column.name),
      );
      const columns = table.columns
        .filter((column) => !column.generated && targetColumnNames.has(column.name))
        .map((column) => column.name);
      const quotedColumns = columns.map(quoteIdentifier).join(", ");
      const sourceJson = JSON.stringify(
        [...selected.get(tableName).values()].map((row) =>
          normalizeCanonicalTransferRow(tableName, row)),
        (_key, value) => {
          if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
          if (value?.type === "Buffer" && Array.isArray(value.data)) {
            return `\\x${Buffer.from(value.data).toString("hex")}`;
          }
          if (typeof value === "bigint") return value.toString();
          return value;
        },
      );
      const sql = `
        WITH source_rows AS (
          SELECT *
          FROM jsonb_populate_recordset(
            NULL::public.${quoteIdentifier(tableName)},
            $1::jsonb
          )
        )
        INSERT INTO public.${quoteIdentifier(tableName)} (${quotedColumns})
        OVERRIDING SYSTEM VALUE
        SELECT ${quotedColumns} FROM source_rows
        ON CONFLICT DO NOTHING
      `;
      const result = await target.query(sql, [sourceJson]);
      inserted.push({ table: tableName, rowCount: result.rowCount });
    }
    await target.query("SET LOCAL session_replication_role = 'origin'");
    return inserted;
  } catch (error) {
    await target.query("ROLLBACK");
    throw error;
  }
}

function normalizeCanonicalTransferRow(tableName, row) {
  if (tableName === "payroll_corrections" && row.apply_to_period_start) {
    const date = row.apply_to_period_start instanceof Date
      ? row.apply_to_period_start
      : new Date(row.apply_to_period_start);
    return {
      ...row,
      apply_to_period_start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
    };
  }

  if (tableName === "employee_sessions") {
    return {
      ...row,
      revoked_at: row.revoked_at ?? row.expires_at ?? row.last_active_at ?? row.created_at,
      revoke_reason: row.revoke_reason ?? "CANONICAL_TESTING_CUTOVER_HISTORICAL_EVIDENCE",
    };
  }

  if ([
    "attendance_monthly_timesheets",
    "attendance_timesheet_revisions",
  ].includes(tableName) && row.period_start) {
    const date = row.period_start instanceof Date
      ? row.period_start
      : new Date(row.period_start);
    return {
      ...row,
      period_start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
    };
  }

  if (tableName === "roster_periods" && row.week_start) {
    const date = row.week_start instanceof Date
      ? row.week_start
      : new Date(row.week_start);
    const day = date.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - daysSinceMonday);
    monday.setUTCHours(0, 0, 0, 0);
    return { ...row, week_start: monday };
  }

  if (![
    "employee_compensation_versions",
    "employee_recurring_pay_component_versions",
    "payroll_entry_components",
  ].includes(tableName)) return row;

  const normalized = { ...row };
  for (const column of ["effective_from_month", "effective_to_month"]) {
    const value = normalized[column];
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    normalized[column] = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      1,
    ));
  }
  return normalized;
}

async function selectRowJsonByColumns(client, tableName, columns, values) {
  const predicates = columns.map(
    (column, index) => `source_row.${quoteIdentifier(column)} IS NOT DISTINCT FROM $${index + 1}`,
  );
  const result = await client.query(
    `SELECT to_jsonb(source_row)::text AS row_json FROM public.${quoteIdentifier(tableName)} source_row WHERE ${predicates.join(" AND ")}`,
    values,
  );
  if (result.rowCount !== 1) {
    throw new Error(`Could not serialize exactly one ${tableName} source row.`);
  }
  return result.rows[0].row_json;
}

async function verifyTransfer({ metadata, selected, source, target, targetMetadata }) {
  const counts = [];
  for (const tableName of [...selected.keys()].sort()) {
    const table = metadata.get(tableName);
    const rows = [...selected.get(tableName).values()].map((row) =>
      normalizeCanonicalTransferRow(tableName, row));
    const expectedJson = JSON.stringify(rows, (_key, value) => {
      if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
      if (value?.type === "Buffer" && Array.isArray(value.data)) {
        return `\\x${Buffer.from(value.data).toString("hex")}`;
      }
      if (typeof value === "bigint") return value.toString();
      return value;
    });
    const join = table.primaryKey.map((column) =>
      `actual.${quoteIdentifier(column)} IS NOT DISTINCT FROM expected.${quoteIdentifier(column)}`
    ).join(" AND ");
    const matchedResult = await target.query(`
      WITH expected AS (
        SELECT *
        FROM jsonb_populate_recordset(
          NULL::public.${quoteIdentifier(tableName)},
          $1::jsonb
        )
      )
      SELECT count(*)::int AS count
      FROM expected
      JOIN public.${quoteIdentifier(tableName)} actual ON ${join}
    `, [expectedJson]);
    const matched = matchedResult.rows[0].count;
    const comparableColumns = table.columns
      .filter((column) => !column.generated && targetMetadata.get(tableName).columns.some((targetColumn) => targetColumn.name === column.name))
      .map((column) => column.name);
    const exactPredicates = comparableColumns.map((column) =>
      `actual.${quoteIdentifier(column)} IS NOT DISTINCT FROM expected.${quoteIdentifier(column)}`
    ).join(" AND ");
    const exactResult = await target.query(`
      WITH expected AS (
        SELECT *
        FROM jsonb_populate_recordset(
          NULL::public.${quoteIdentifier(tableName)},
          $1::jsonb
        )
      )
      SELECT count(*)::int AS count
      FROM expected
      JOIN public.${quoteIdentifier(tableName)} actual ON ${join}
      WHERE ${exactPredicates}
    `, [expectedJson]);
    const exactMatched = exactResult.rows[0].count;
    counts.push({
      table: tableName,
      expected: rows.length,
      matched,
      exactMatched,
      pass: rows.length === matched && rows.length === exactMatched,
    });
  }

  const orphanConstraints = [];
  const orphanQueries = [];
  for (const [tableName, table] of targetMetadata) {
    for (const foreignKey of table.foreignKeys) {
      const childNotNull = foreignKey.childColumns
        .map((column) => `child.${quoteIdentifier(column)} IS NOT NULL`)
        .join(" AND ");
      const join = foreignKey.childColumns
        .map((column, index) => `parent.${quoteIdentifier(foreignKey.parentColumns[index])} = child.${quoteIdentifier(column)}`)
        .join(" AND ");
      orphanQueries.push(`
        SELECT
          ${quoteLiteral(foreignKey.name)} AS constraint_name,
          ${quoteLiteral(tableName)} AS table_name,
          count(*)::int AS row_count
        FROM public.${quoteIdentifier(tableName)} child
        WHERE ${childNotNull}
          AND NOT EXISTS (
            SELECT 1 FROM public.${quoteIdentifier(foreignKey.parentTable)} parent
            WHERE ${join}
          )
      `);
    }
  }
  if (orphanQueries.length > 0) {
    const orphanResult = await target.query(orphanQueries.join("\nUNION ALL\n"));
    for (const row of orphanResult.rows) {
      if (row.row_count > 0) {
        orphanConstraints.push({
          constraint: row.constraint_name,
          table: row.table_name,
          rowCount: row.row_count,
        });
      }
    }
  }

  const reconciliation = {};
  for (const database of [
    { key: "source", client: source },
    { key: "target", client: target },
  ]) {
    const { rows } = await database.client.query(`
      SELECT
        (SELECT count(*)::int FROM public.businesses WHERE id = $1) AS businesses,
        (SELECT count(*)::int FROM public.branches WHERE business_id = $1) AS branches,
        (SELECT count(*)::int FROM public.employee_business_memberships WHERE business_id = $1) AS memberships,
        (SELECT count(*)::int FROM public.roster_periods WHERE business_id = $1) AS roster_periods,
        (SELECT count(*)::int FROM public.roster_published_assignments WHERE business_id = $1) AS roster_assignments,
        (SELECT count(*)::int FROM public.leave_requests WHERE business_id = $1) AS leave_requests,
        (SELECT count(*)::int FROM public.employee_claims WHERE business_id = $1) AS claims,
        (SELECT coalesce(sum(submitted_total), 0)::text FROM public.employee_claims WHERE business_id = $1) AS claim_submitted,
        (SELECT coalesce(sum(approved_total), 0)::text FROM public.employee_claims WHERE business_id = $1) AS claim_approved,
        (SELECT count(*)::int FROM public.payroll_runs WHERE business_id = $1) AS payroll_runs,
        (SELECT count(*)::int FROM public.payroll_entries WHERE business_id = $1) AS payroll_entries,
        (SELECT coalesce(sum(gross_pay), 0)::text FROM public.payroll_entries WHERE business_id = $1) AS payroll_gross,
        (SELECT coalesce(sum(amount), 0)::text FROM public.payroll_entry_components WHERE business_id = $1 AND type = 'DEDUCTION') AS payroll_deductions,
        (SELECT coalesce(sum(net_pay), 0)::text FROM public.payroll_entries WHERE business_id = $1) AS payroll_net,
        (SELECT count(*)::int FROM public.payroll_payslip_publications WHERE business_id = $1) AS payslips,
        (SELECT coalesce(sum(octet_length(document_bytes)), 0)::text FROM public.payroll_payslip_publications WHERE business_id = $1) AS payslip_bytes
    `, [BUSINESS_ID]);
    reconciliation[database.key] = rows[0];
  }

  return {
    pass: counts.every((item) => item.pass) &&
      orphanConstraints.length === 0 &&
      stableJson(reconciliation.source) === stableJson(reconciliation.target),
    counts,
    orphanConstraints,
    reconciliation,
  };
}

function summarizeSelection(metadata, selected, reasons) {
  return [...selected.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([tableName, rowMap]) => ({
    table: tableName,
    rowCount: rowMap.size,
    reasons: [...new Set([...rowMap.keys()].flatMap((key) => [...(reasons.get(`${tableName}|${key}`) ?? [])]))].sort(),
    primaryKey: metadata.get(tableName).primaryKey,
  }));
}

function printPlan(plan) {
  console.log(`Allowlist plan: ${plan.length} tables / ${plan.reduce((sum, item) => sum + item.rowCount, 0)} rows`);
  for (const item of plan) console.log(`${item.table}|${item.rowCount}`);
}

function printVerification(verification) {
  console.log(`Transfer verification: ${verification.pass ? "PASS" : "FAIL"}`);
  console.log(`Target orphan constraints: ${verification.orphanConstraints.length}`);
  console.log(JSON.stringify(verification.reconciliation, null, 2));
}

function rowKey(primaryKey, row) {
  return primaryKey.map((column) => normalizeKeyValue(row[column])).join("|");
}

function normalizeKeyValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function parsePgArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.startsWith("{") || !value.endsWith("}")) {
    throw new Error(`Unexpected PostgreSQL array value: ${String(value)}`);
  }
  const body = value.slice(1, -1);
  if (!body) return [];
  return body.split(",").map((item) => item.replace(/^"|"$/g, ""));
}

async function writeJson(fileName, value) {
  await writeFile(resolve(OUTPUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeHistoricalRestoreExceptions() {
  const auditPath = resolve("artifacts/local-db-baseline/20260829/public-fk-orphan-audit.txt");
  const lines = (await readFile(auditPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const exceptions = lines.map((line) => {
    const [constraint, table, parentTable, rowCount] = line.split("|");
    return {
      constraint,
      table,
      parentTable,
      affectedRowCount: Number(rowCount),
      ownerClassification: "ARCHIVE_ONLY",
      excludedFromCanonicalActiveMigration: true,
      originalPreservedInBackup: true,
    };
  }).filter((item) => item.affectedRowCount > 0);
  await writeJson("historical-restore-exceptions.json", {
    generatedAt: new Date().toISOString(),
    sourceDatabase: SOURCE_DATABASE,
    backupSha256: "CAD9E2D6C31512320DBD840B47B7005B29EFC663AD2D9B8A04F8A4982CDE56D9",
    ownerDecision: "ARCHIVE_ONLY / EXCLUDE FROM NEW ACTIVE DB",
    exceptionCount: exceptions.length,
    exceptions,
  });
}
