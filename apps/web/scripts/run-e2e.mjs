import { spawnSync } from "node:child_process"
import { normalizePlaywrightArguments } from "./run-e2e-arguments.mjs"

const packageManager = process.env.npm_execpath
if (packageManager === undefined) {
  throw new TypeError("The E2E runner must be invoked from a pnpm package script")
}

const playwrightArguments = normalizePlaywrightArguments(process.argv.slice(2))

function runPackageManager(argumentsList) {
  const result = spawnSync(process.execPath, [packageManager, ...argumentsList], {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
  })
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

const preparationStatus = runPackageManager(["run", "e2e:prepare"])
if (preparationStatus !== 0) process.exit(preparationStatus)

process.exit(runPackageManager(["exec", "playwright", "test", ...playwrightArguments]))
