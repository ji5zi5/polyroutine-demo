import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { VerificationServiceError } from "./errors.js"
import {
  createVerificationWorkHandler,
  MalformedVerificationJobError,
  VerificationJobInterruptedError,
} from "./worker.js"

async function sourceFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : []
    }),
  )
  return nested.flat()
}

describe("bounded verification worker", () => {
  it("rejects malformed jobs before touching the review queue", async () => {
    // Given
    let calls = 0
    const handler = createVerificationWorkHandler({
      promoteJob: async () => {
        calls += 1
        return true
      },
    })

    // When
    const result = handler([
      { data: { evidenceId: crypto.randomUUID() }, signal: new AbortController().signal },
    ])

    // Then
    await expect(result).rejects.toBeInstanceOf(MalformedVerificationJobError)
    expect(calls).toBe(0)
  })

  it("propagates queue failures instead of converting them to evidence rejection", async () => {
    // Given
    const queueFailure = new VerificationServiceError("OPERATOR_QUEUE_SATURATED", 503)
    const handler = createVerificationWorkHandler({
      promoteJob: async () => {
        throw queueFailure
      },
    })

    // When
    const result = handler([
      {
        data: { verificationJobId: crypto.randomUUID() },
        signal: new AbortController().signal,
      },
    ])

    // Then
    await expect(result).rejects.toBe(queueFailure)
  })

  it("stops an interrupted job before any database effect", async () => {
    // Given
    let calls = 0
    const controller = new AbortController()
    controller.abort()
    const handler = createVerificationWorkHandler({
      promoteJob: async () => {
        calls += 1
        return true
      },
    })

    // When
    const result = handler([
      { data: { verificationJobId: crypto.randomUUID() }, signal: controller.signal },
    ])

    // Then
    await expect(result).rejects.toBeInstanceOf(VerificationJobInterruptedError)
    expect(calls).toBe(0)
  })

  it("contains no dormant provider or readiness adapter declarations", async () => {
    // Given
    const roots = [
      join(import.meta.dirname, "../../../../../../packages/contracts/src"),
      join(import.meta.dirname, "../../.."),
    ]
    const prohibited = new Set(["EvidenceVerifier", "ReadinessProvider", "VisionProvider"])

    // When
    const declarations = new Set<string>()
    for (const file of (await Promise.all(roots.map(sourceFiles))).flat()) {
      const source = ts.createSourceFile(
        file,
        await readFile(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      )
      for (const node of source.statements) {
        if (
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)
        ) {
          if (node.name !== undefined) declarations.add(node.name.text)
        }
      }
    }

    // Then
    expect([...prohibited].filter((symbol) => declarations.has(symbol))).toEqual([])
  })
})
