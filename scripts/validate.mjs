import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const actionFiles = [
  "actions/hypixel-worker.openapi.json",
  "actions/minecraft-username.openapi.json",
  "actions/skycofl.openapi.json",
];
const errors = [];

const walkSchema = (value, path, document) => {
  if (!value || typeof value !== "object") return;
  if (value.type === "array" && !value.items) {
    errors.push(`${path}: array schema is missing items`);
  }
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/schemas/")) {
    const schemaName = value.$ref.split("/").at(-1);
    if (!document.components?.schemas?.[schemaName]) {
      errors.push(`${path}: unresolved schema reference ${value.$ref}`);
    }
  }
  for (const [key, child] of Object.entries(value)) {
    walkSchema(child, `${path}.${key}`, document);
  }
};

for (const relativePath of actionFiles) {
  const document = JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
  if (document.openapi !== "3.1.0") {
    errors.push(`${relativePath}: openapi must be exactly 3.1.0`);
  }
  const operations = [];
  for (const [path, pathItem] of Object.entries(document.paths || {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      operations.push(operation.operationId);
      if (typeof operation.operationId !== "string" || !operation.operationId.trim()) {
        errors.push(`${relativePath} ${method.toUpperCase()} ${path}: missing operationId`);
      }
      if ((operation.description || "").length > 300) {
        errors.push(`${relativePath} ${operation.operationId}: description exceeds 300 characters`);
      }
      for (const parameter of operation.parameters || []) {
        if (typeof parameter.name !== "string" || !parameter.name.trim()) {
          errors.push(`${relativePath} ${operation.operationId}: parameter has no inline string name`);
        }
      }
    }
  }
  if (operations.length > 30) {
    errors.push(`${relativePath}: ${operations.length} operations exceeds ChatGPT's limit of 30`);
  }
  if (new Set(operations).size !== operations.length) {
    errors.push(`${relativePath}: duplicate operationId values`);
  }
  walkSchema(document, relativePath, document);
}

const instructions = readFileSync(resolve(root, "gpt/instructions.md"), "utf8");
if (instructions.length > 8_000) {
  errors.push(`gpt/instructions.md: ${instructions.length} characters exceeds 8000`);
}

try {
  execFileSync(process.execPath, ["--check", resolve(root, "src/worker.js")], { stdio: "pipe" });
} catch (error) {
  errors.push(`src/worker.js: JavaScript syntax check failed\n${error.stderr?.toString() || error.message}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  success: true,
  instruction_characters: instructions.length,
  actions: actionFiles.map((relativePath) => {
    const document = JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
    return {
      file: relativePath,
      operations: Object.values(document.paths || {}).reduce(
        (total, pathItem) => total + ["get", "post", "put", "patch", "delete"].filter((method) => pathItem?.[method]).length,
        0,
      ),
    };
  }),
}));

