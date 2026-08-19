#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const [mode, ...args] = process.argv.slice(2)
const filterIndex = args.indexOf("--filter")
const filter = filterIndex === -1 ? undefined : args[filterIndex + 1]
const reporter = args.find((argument) => argument.startsWith("--reporter="))
const seedArgument = args.find((argument) => argument.startsWith("--seed="))
const seed = seedArgument?.slice("--seed=".length)
const packageManagerPath = process.env.npm_execpath
if (packageManagerPath === undefined) {
  throw new TypeError("run tests through the package manager")
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(process.execPath, [packageManagerPath, "--filter", "./packages/**", "build"])

switch (mode) {
  case "unit":
    run(process.execPath, [
      "--test",
      "tests/bootstrap.architecture.test.mjs",
      "tests/qa-cleanup.test.mjs",
    ])
    if (filter === undefined) {
      run(process.execPath, [packageManagerPath, "exec", "vitest", "run"])
    } else if (filter !== "bootstrap") {
      run(process.execPath, [packageManagerPath, "exec", "vitest", "run", filter])
    }
    break
  case "integration":
    run(process.execPath, [
      packageManagerPath,
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      ...(reporter === undefined ? [] : [reporter]),
      filter === undefined ? "apps/server/test" : `apps/server/test/${filter}.integration.test.ts`,
    ])
    break
  case "race":
    run(process.execPath, [
      "--test",
      "--test-concurrency=4",
      "tests/bootstrap.architecture.test.mjs",
    ])
    if (filter === "predictions" || filter === "prediction-insert" || filter === undefined) {
      run(process.execPath, [
        packageManagerPath,
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.integration.config.ts",
        ...(reporter === undefined ? [] : [reporter]),
        ...(seed === undefined ? [] : ["--sequence.shuffle", `--sequence.seed=${seed}`]),
        "apps/server/test/predictions.race.test.ts",
      ])
    } else {
      run(process.execPath, [packageManagerPath, "exec", "vitest", "run"])
    }
    break
  default:
    throw new TypeError(`unknown test mode: ${String(mode)}`)
}
