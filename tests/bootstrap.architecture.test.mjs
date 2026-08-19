import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const registryPath = new URL("../apps/server/src/modules/index.ts", import.meta.url)
const serverPackagePath = new URL("../apps/server/package.json", import.meta.url)
const appsPath = new URL("../apps", import.meta.url)
const moduleNames = [
  "accounts",
  "goals",
  "predictions",
  "evidence",
  "moderation",
  "settlement",
  "analytics",
]

test("Given the V1 domain modules, when the server graph is inspected, then one registry owns every module", () => {
  // Given
  const source = ts.createSourceFile(
    "index.ts",
    readFileSync(registryPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const imports = source.statements
    .filter(ts.isImportDeclaration)
    .map(({ moduleSpecifier }) =>
      ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined,
    )

  // When
  const importedModules = moduleNames.filter((name) => imports.includes(`./${name}/index.js`))

  // Then
  assert.deepEqual(importedModules, moduleNames)
})

test("Given the HTTP and worker entrypoints, when deployment ownership is inspected, then one server package owns both", () => {
  // Given
  const serverPackage = JSON.parse(readFileSync(serverPackagePath, "utf8"))

  // When
  const applicationRoots = readdirSync(appsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort()

  // Then
  assert.deepEqual(applicationRoots, ["server", "web"])
  assert.match(serverPackage.scripts.start, /dist\/main\.js$/)
  assert.match(serverPackage.scripts["start:worker"], /dist\/worker\.js$/)
})
