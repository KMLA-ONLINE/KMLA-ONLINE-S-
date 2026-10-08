// The comparison behind `check-client-compat.mjs` and `bump-client-compat.mjs`.
// It reads two copies of the generated `database.types.ts` and lists what an app
// built against the first would find gone or changed in the second.

import ts from "typescript";

export const TYPES_PATH = "app/shared/supabase/database.types.ts";
export const VERSION_PATH = "app/features/app-version/model/client-version.ts";
export const SCHEMA_PATH = "supabase/schemas/01-foundation.sql";

export const MIN_CLIENT_VERSION_BODY =
  /(FUNCTION "public"\."min_client_version"\(\)[\s\S]*?\$\$\s*select\s+)(\d+)(\s*;\s*\$\$)/i;

export function readVersion(source) {
  const match = /CLIENT_COMPAT_VERSION\s*=\s*(\d+)/.exec(source ?? "");
  return match ? Number(match[1]) : 0;
}

export function readSchemaVersion(sql) {
  const match = MIN_CLIENT_VERSION_BODY.exec(sql);
  return match ? Number(match[2]) : null;
}

// ── Contract extraction ────────────────────────────────────────────────────

function text(node) {
  return node.getText().replace(/\s+/g, "");
}

function propertyName(member) {
  return member.name.getText().replace(/^"|"$/g, "");
}

/** `{ a: T; b?: U }` → Map(name → { type, optional, node }). */
function fields(node) {
  const map = new Map();
  if (!node || !ts.isTypeLiteralNode(node)) return map;
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    map.set(propertyName(member), {
      type: member.type,
      optional: Boolean(member.questionToken),
    });
  }
  return map;
}

function findDatabase(sourceFile) {
  let found = null;
  sourceFile.forEachChild((node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "Database") {
      found = node.type;
    }
  });
  return found;
}

export function parseContract(source) {
  const sourceFile = ts.createSourceFile(
    "database.types.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const publicSchema = fields(findDatabase(sourceFile)).get("public")?.type;
  const sections = fields(publicSchema);
  const section = (name) => fields(sections.get(name)?.type);
  return {
    Tables: section("Tables"),
    Views: section("Views"),
    Functions: section("Functions"),
    Enums: section("Enums"),
    CompositeTypes: section("CompositeTypes"),
  };
}

// ── Comparison ─────────────────────────────────────────────────────────────

/** Columns an old reader expects: none may vanish or change type. */
function compareRead(label, before, after, problems) {
  for (const [name, old] of before) {
    const next = after.get(name);
    if (!next) problems.push(`${label}.${name} 삭제`);
    else if (text(old.type) !== text(next.type))
      problems.push(`${label}.${name} 타입 변경`);
  }
}

/** Fields an old writer sends or omits: none may vanish, none may become required. */
function compareWrite(label, before, after, problems) {
  for (const [name, old] of before) {
    const next = after.get(name);
    if (!next) problems.push(`${label}.${name} 삭제`);
    else if (text(old.type) !== text(next.type))
      problems.push(`${label}.${name} 타입 변경`);
    else if (old.optional && !next.optional)
      problems.push(`${label}.${name} 필수로 바뀜`);
  }
  for (const [name, next] of after) {
    if (!before.has(name) && !next.optional)
      problems.push(`${label}.${name} 필수 항목 추가`);
  }
}

/** `{...}` or `{...}[]` → its fields; anything else → null (compare as text). */
function rowFields(node) {
  if (!node) return null;
  if (ts.isArrayTypeNode(node)) return rowFields(node.elementType);
  return ts.isTypeLiteralNode(node) ? fields(node) : null;
}

function compareFunction(name, before, after, problems) {
  const label = `함수 ${name}`;
  const oldParts = fields(before.type);
  const newParts = fields(after.type);
  if (oldParts.size === 0 || newParts.size === 0) {
    // Overloads come out as a union; compare those whole.
    if (text(before.type) !== text(after.type))
      problems.push(`${label} 시그니처 변경`);
    return;
  }

  compareWrite(
    `${label} 인자`,
    fields(oldParts.get("Args")?.type),
    fields(newParts.get("Args")?.type),
    problems,
  );

  const oldReturns = oldParts.get("Returns")?.type;
  const newReturns = newParts.get("Returns")?.type;
  const oldRow = rowFields(oldReturns);
  const newRow = rowFields(newReturns);
  const sameShape =
    oldRow &&
    newRow &&
    ts.isArrayTypeNode(oldReturns) === ts.isArrayTypeNode(newReturns);
  if (sameShape) compareRead(`${label} 반환`, oldRow, newRow, problems);
  else if (text(oldReturns) !== text(newReturns))
    problems.push(`${label} 반환 타입 변경`);
}

function enumValues(node) {
  if (!node) return new Set();
  const members = ts.isUnionTypeNode(node) ? node.types : [node];
  return new Set(members.map(text));
}

export function findBreakingChanges(beforeSource, afterSource) {
  const before = parseContract(beforeSource);
  const after = parseContract(afterSource);
  const problems = [];

  for (const kind of ["Tables", "Views"]) {
    const label = kind === "Tables" ? "테이블" : "뷰";
    for (const [name, old] of before[kind]) {
      const next = after[kind].get(name);
      if (!next) {
        problems.push(`${label} ${name} 삭제`);
        continue;
      }
      const oldParts = fields(old.type);
      const newParts = fields(next.type);
      compareRead(
        `${label} ${name}`,
        fields(oldParts.get("Row")?.type),
        fields(newParts.get("Row")?.type),
        problems,
      );
      for (const part of ["Insert", "Update"]) {
        if (!oldParts.has(part)) continue;
        compareWrite(
          `${label} ${name} ${part}`,
          fields(oldParts.get(part)?.type),
          fields(newParts.get(part)?.type),
          problems,
        );
      }
    }
  }

  for (const [name, old] of before.Functions) {
    const next = after.Functions.get(name);
    if (!next) problems.push(`함수 ${name} 삭제`);
    else compareFunction(name, old, next, problems);
  }

  for (const [name, old] of before.Enums) {
    const next = after.Enums.get(name);
    if (!next) {
      problems.push(`enum ${name} 삭제`);
      continue;
    }
    const values = enumValues(next.type);
    for (const value of enumValues(old.type)) {
      if (!values.has(value)) problems.push(`enum ${name} 값 ${value} 삭제`);
    }
  }

  for (const [name, old] of before.CompositeTypes) {
    const next = after.CompositeTypes.get(name);
    if (!next) problems.push(`복합 타입 ${name} 삭제`);
    else
      compareRead(
        `복합 타입 ${name}`,
        fields(old.type),
        fields(next.type),
        problems,
      );
  }

  return problems;
}
