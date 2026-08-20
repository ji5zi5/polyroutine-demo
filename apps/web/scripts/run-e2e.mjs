import { spawnSync } from "node:child_process"

const packageManager = process.env.npm_execpath
if (packageManager === undefined) {
  throw new TypeError("The E2E runner must be invoked from a pnpm package script")
}

const playwrightArguments = []
const input = process.argv.slice(2)

for (let index = 0; index < input.length; index += 1) {
  const argument = input[index]
  if (argument === "--filter") {
    const value = input[index + 1]
    if (value === undefined) throw new TypeError("--filter requires a value")
    playwrightArguments.push("--grep", value)
    index += 1
  } else if (argument !== undefined) {
    playwrightArguments.push(argument)
  }
}

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
