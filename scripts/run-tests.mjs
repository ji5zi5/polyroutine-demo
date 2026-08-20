#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const [mode, ...args] = process.argv.slice(2)
const filterIndex = args.indexOf("--filter")
const filter = filterIndex === -1 ? undefined : args[filterIndex + 1]
const reporter = args.find((argument) => argument.startsWith("--reporter="))
const seedArgument = args.find((argument) => argument.startsWith("--seed="))
const seed = seedArgument?.slice("--seed=".length) ?? "20260819"
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
  case "integration": {
    const targets =
      filter === "settlement"
        ? ["settlement.integration.test.ts", "settlement-failures.integration.test.ts"]
        : filter === "funnel-events"
          ? ["funnel-events.integration.test.ts", "analytics-nonblocking.integration.test.ts"]
          : [filter === undefined ? "apps/server/test" : `${filter}.integration.test.ts`]
    for (const target of targets) {
      run(process.execPath, [
        packageManagerPath,
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.integration.config.ts",
        ...(reporter === undefined ? [] : [reporter]),
        target.startsWith("apps/") ? target : `apps/server/test/${target}`,
      ])
    }
    break
  }
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
        "--sequence.shuffle",
        `--sequence.seed=${seed}`,
        "apps/server/test/predictions.race.test.ts",
      ])
    }
    if (filter === "settlement-replay" || filter === undefined) {
      run(process.execPath, [
        packageManagerPath,
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.integration.config.ts",
        ...(reporter === undefined ? [] : [reporter]),
        "--sequence.shuffle",
        `--sequence.seed=${seed}`,
        "apps/server/test/settlement-replay.race.test.ts",
      ])
    }
    if (
      filter !== undefined &&
      filter !== "predictions" &&
      filter !== "prediction-insert" &&
      filter !== "settlement-replay"
    ) {
      run(process.execPath, [packageManagerPath, "exec", "vitest", "run"])
    }
    break
  default:
    throw new TypeError(`unknown test mode: ${String(mode)}`)
}
