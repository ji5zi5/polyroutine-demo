import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const cleanupScript = fileURLToPath(new URL("../scripts/qa-cleanup.mjs", import.meta.url))

function runCleanup(t, mode) {
  const root = mkdtempSync(join(tmpdir(), "poly-routine-cleanup-test-"))
  t.after(() => rmSync(root, { force: true, recursive: true }))
  const bin = join(root, "bin")
  mkdirSync(bin)
  if (process.platform === "win32") {
    copyFileSync(process.execPath, join(bin, "docker.exe"))
    writeFileSync(
      join(bin, "rm"),
      `process.exit(process.env.FAKE_DOCKER_MODE === "present" ? 0 : 1)\n`,
    )
    writeFileSync(
      join(bin, "container"),
      `if (process.env.FAKE_DOCKER_MODE === "present") { process.stdout.write("stale-container"); process.exit(0) }\n` +
        `process.stderr.write("Error: No such container: stale-container"); process.exit(1)\n`,
    )
  } else {
    const fakeDocker = join(bin, "fake-docker.mjs")
    writeFileSync(
      fakeDocker,
      `const command = process.argv[2]\n` +
        `if (command === "rm") process.exit(process.env.FAKE_DOCKER_MODE === "present" ? 0 : 1)\n` +
        `if (command === "container" && process.argv[3] === "inspect") {\n` +
        `  if (process.env.FAKE_DOCKER_MODE === "present") { process.stdout.write("stale-container"); process.exit(0) }\n` +
        `  process.stderr.write("Error: No such container: stale-container"); process.exit(1)\n` +
        `}\n` +
        `process.exit(2)\n`,
    )
    const executable = join(bin, "docker")
    writeFileSync(executable, `#!/bin/sh\nexec node "${fakeDocker}" "$@"\n`)
    chmodSync(executable, 0o755)
  }
  const registry = join(root, "registry.json")
  const report = join(root, "report.json")
  writeFileSync(
    registry,
    `${JSON.stringify({ browserPids: [], containerIds: ["stale-container"], pids: [], ports: [], tempDirs: [] })}\n`,
  )
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  )

  const result = spawnSync(
    process.execPath,
    [cleanupScript, "--registry", registry, "--report", report],
    {
      cwd: bin,
      encoding: "utf8",
      env: {
        ...inheritedEnvironment,
        FAKE_DOCKER_MODE: mode,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      },
    },
  )
  return {
    report: JSON.parse(readFileSync(report, "utf8")),
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}

test("Given a stale registry entry, when cleanup finds no container, then cleanup succeeds", (t) => {
  // Given
  const mode = "missing"

  // When
  const result = runCleanup(t, mode)

  // Then
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.equal(result.report.clean, true)
})

test("Given misleading remove output, when the container still exists, then cleanup fails", (t) => {
  // Given
  const mode = "present"

  // When
  const result = runCleanup(t, mode)

  // Then
  assert.equal(result.status, 1)
  assert.deepEqual(result.report.remaining.containers, ["stale-container"])
})
