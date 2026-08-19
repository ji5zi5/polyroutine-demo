#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const allowed = Object.freeze({
  client: ["pwa", "cross_platform", "native_ios", "native_android"],
  recipe: ["study_note_photo_v1"],
  readiness: ["omit", "shadow", "qualitative_ui"],
  capture: ["server_guided_challenge_10m", "simple_capture"],
  feed: ["atomic_immutable_prediction_insert"],
  reputation: ["completion_10_strict_no_majority_success_5"],
  retention: ["terminal_24h_pending_report_legal_hold_7d_metadata_90d"],
  verdict: ["bounded_operator_review"]
});
const clientRoots = Object.freeze({ pwa: "apps/web", cross_platform: "apps/mobile", native_ios: "apps/ios", native_android: "apps/android" });

function validate(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["document must be a JSON object"];
  const allowedKeys = new Set([...Object.keys(allowed), "client_root", "recipe_version", "monthly_cost_cap", "adult_only", "readiness_release_gate"]);
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) errors.push(`unexpected field: ${key}`);
  for (const [field, choices] of Object.entries(allowed)) {
    if (typeof value[field] !== "string" || !choices.includes(value[field])) errors.push(`${field} must be exactly one of: ${choices.join(", ")}`);
  }
  if (value.client_root !== clientRoots[value.client]) errors.push("client_root must match the selected client");
  if (value.recipe_version !== 1) errors.push("recipe_version must equal 1");
  if (value.adult_only !== true) errors.push("adult_only must equal true");
  const cap = value.monthly_cost_cap;
  if (!cap || typeof cap !== "object" || Array.isArray(cap)) {
    errors.push("monthly_cost_cap must be a finite money object");
  } else {
    if (!Number.isFinite(cap.amount) || cap.amount <= 0) errors.push("monthly_cost_cap.amount must be a positive finite number");
    if (cap.currency !== "KRW") errors.push("monthly_cost_cap.currency must equal KRW");
  }
  if (value.readiness === "qualitative_ui") {
    const gate = value.readiness_release_gate;
    if (!gate || gate.minimum_eventual_labels < 500 || gate.minimum_brier_improvement < 0.02 || gate.fallback !== "shadow_or_omit") errors.push("qualitative_ui requires the fixed readiness release gate");
  }
  const text = JSON.stringify(value).toLowerCase();
  for (const phrase of ["tbd", "나중에 결정", "unbounded", "unlimited"]) if (text.includes(phrase)) errors.push(`forbidden unresolved value: ${phrase}`);
  return [...new Set(errors)];
}

async function checkFile(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const errors = validate(parsed);
    return { file: path, valid: errors.length === 0, errors };
  } catch (error) {
    return { file: path, valid: false, errors: [`invalid JSON: ${error.message}`] };
  }
}

async function runFixtures(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  if (names.length === 0) throw new Error("fixture directory contains no JSON files");
  const fixtures = [];
  for (const name of names) {
    const result = await checkFile(resolve(directory, name));
    const expectedValid = name.startsWith("valid-");
    fixtures.push({ ...result, expected_valid: expectedValid, exit_code: result.valid ? 0 : 1, passed: result.valid === expectedValid });
  }
  const output = { valid: fixtures.every((fixture) => fixture.passed), mode: "fixtures", fixtures };
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = output.valid ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === "--fixtures") {
  if (!args[1] || args.length !== 2) throw new Error("usage: validate-decisions.mjs --fixtures <directory>");
  await runFixtures(resolve(args[1]));
} else {
  if (!args[0] || args.length !== 1) throw new Error("usage: validate-decisions.mjs <decisions.json>");
  const result = await checkFile(resolve(args[0]));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
}
