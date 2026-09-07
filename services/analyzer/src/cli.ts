#!/usr/bin/env tsx
/**
 * CLI helper: analyze a local repository and print the health report.
 *   tsx services/analyzer/src/cli.ts --path /abs/path --name CPAAutomator --org charfeddine
 */
import { DiskRepoSource, ProjectAnalyzer } from "./index.js";
import { Logger } from "@apk-factory/logger";
import path from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const get = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repoPath = get("--path") ?? ".";
  const repoName = get("--name") ?? path.basename(path.resolve(repoPath));
  const org = get("--org") ?? "appfactory";

  const repo = new DiskRepoSource(path.resolve(repoPath));
  const analyzer = new ProjectAnalyzer(new Logger("analyzer-cli"));
  const analysis = await analyzer.analyze(repo, { repositoryId: "cli", repoName, org });

  const bar = (n: number) => "█".repeat(Math.round(n / 10)).padEnd(10, "░");
  console.log("\n══════════ PROJECT HEALTH ══════════");
  console.log(`Framework : ${analysis.primaryFramework} (${analysis.language})`);
  if (analysis.versions.expo) console.log(`Expo     : ${analysis.versions.expo}`);
  if (analysis.versions.reactNative) console.log(`RN        : ${analysis.versions.reactNative}`);
  console.log(`\nScore: ${analysis.score.overall}/100`);
  console.log(`  Build readiness : ${bar(analysis.score.buildReadiness)} ${analysis.score.buildReadiness}`);
  console.log(`  Dependencies    : ${bar(analysis.score.dependencies)} ${analysis.score.dependencies}`);
  console.log(`  Android         : ${bar(analysis.score.android)} ${analysis.score.android}`);
  console.log(`  Security        : ${bar(analysis.score.security)} ${analysis.score.security}`);
  console.log(`  Assets          : ${bar(analysis.score.assets)} ${analysis.score.assets}`);
  console.log(`  Signing         : ${bar(analysis.score.signing)} ${analysis.score.signing}`);
  console.log(`  Compatibility   : ${bar(analysis.score.compatibility)} ${analysis.score.compatibility}`);
  console.log(`\nEnvironment: ${analysis.compatibleEnvironments.join(", ")}`);

  const blockers = analysis.issues.filter((i) => i.severity === "required");
  const recs = analysis.issues.filter((i) => i.severity === "recommended");
  console.log(`\n🔴 Required (${blockers.length})`);
  blockers.forEach((i) => console.log(`   - ${i.title}`));
  console.log(`🟠 Recommended (${recs.length})`);
  recs.forEach((i) => console.log(`   - ${i.title}`));
  console.log(`\n💡 Suggestions (${analysis.suggestions.length})`);
  analysis.suggestions.forEach((s) => console.log(`   - [${s.severity}] ${s.title} → ${s.recommendedValue ?? "(manual)"}`));
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
