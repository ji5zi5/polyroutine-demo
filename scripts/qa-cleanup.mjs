#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"

const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : args[index + 1]
}
const registryPath = path.resolve(valueAfter("--registry", ".omo/evidence/qa-resources.json"))
const reportPath = path.resolve(valueAfter("--report", ".omo/evidence/cleanup.json"))

const emptyRegistry = {
  browserPids: [],
  containerIds: [],
  pids: [],
  ports: [],
  tempDirs: [],
}

function parseRegistry(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("QA registry must be a JSON object")
  }
  const readArray = (key, predicate) => {
    const value = input[key]
    if (!Array.isArray(value) || !value.every(predicate)) {
      throw new TypeError(`QA registry field ${key} is invalid`)
    }
    return value
  }
  return {
    browserPids: readArray("browserPids", Number.isSafeInteger),
    containerIds: readArray(
      "containerIds",
      (value) => typeof value === "string" && /^[a-zA-Z0-9_.-]+$/.test(value),
    ),
    pids: readArray("pids", Number.isSafeInteger),
    ports: readArray("ports", (value) => Number.isSafeInteger(value) && value > 0 && value < 65536),
    tempDirs: readArray("tempDirs", (value) => typeof value === "string"),
  }
}

function terminate(pid) {
  if (pid === process.pid) throw new TypeError("QA cleanup cannot terminate itself")
  const result =
    process.platform === "win32"
      ? spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
      : spawnSync("kill", ["-TERM", String(pid)], { stdio: "ignore" })
  return result.status === 0
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true
    return false
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port })
    socket.setTimeout(750)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
    socket.once("timeout", () => {
      socket.destroy()
      resolve(false)
    })
  })
}

const rawRegistry = existsSync(registryPath)
  ? JSON.parse(await readFile(registryPath, "utf8"))
  : emptyRegistry
const registry = parseRegistry(rawRegistry)
const allPids = [...new Set([...registry.pids, ...registry.browserPids])]
const terminatedPids = allPids.filter(terminate)

const removedContainers = registry.containerIds.filter((containerId) => {
  const result = spawnSync("docker", ["rm", "--force", containerId], { stdio: "ignore" })
  return result.status === 0
})
await Promise.all(
  registry.tempDirs.map((directory) =>
    rm(path.resolve(directory), { force: true, recursive: true }),
  ),
)

const remainingPids = allPids.filter(processExists)
const portStates = await Promise.all(
  registry.ports.map(async (port) => ({ open: await isPortOpen(port), port })),
)
const remainingPorts = portStates.filter(({ open }) => open).map(({ port }) => port)
const remainingContainers = registry.containerIds.filter((containerId) => {
  const result = spawnSync("docker", ["container", "inspect", containerId], {
    encoding: "utf8",
  })
  if (result.status === 0) return true
  return !`${result.stdout ?? ""}\n${result.stderr ?? ""}`.includes("No such container")
})
const clean =
  remainingPids.length === 0 && remainingPorts.length === 0 && remainingContainers.length === 0

const report = {
  clean,
  cleaned: {
    containers: removedContainers,
    pids: terminatedPids,
    tempDirs: registry.tempDirs,
  },
  remaining: {
    containers: remainingContainers,
    pids: remainingPids,
    ports: remainingPorts,
  },
}
await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
console.log(JSON.stringify(report, null, 2))
process.exitCode = clean ? 0 : 1
