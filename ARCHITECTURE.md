# Architecture — mapping the 45-section spec to code

This document maps every concept from the design spec to a concrete file so the
implementation is auditable.

| Spec § | Concept | Implementation |
|---|---|---|
| 1 | Goal: cloud-only build | `apps/web` is a PWA; all logic in `services/*` |
| 2 | Full architecture | `README.md` diagram; `services/api` orchestrates |
| 3 | Google login | `services/api/src/router.ts` → `POST /auth/google` |
| 4 | Connection center | `services/api/src/router.ts` → `GET /connections`; `apps/web/app/connections` |
| 5 | GitHub App fine-grained perms | `database/migrations` `connected_accounts.scopes`; documented in `apps/web/app/connections` |
| 6 | Token Vault | `packages/security/src/index.ts` `TokenVault` (AES-256-GCM) |
| 7 | Repository Manager | `apps/web/app/dashboard` (paste URL / pick) |
| 8 | Project Analyzer | `services/analyzer/src/detect.ts` `detectFrameworks` |
| 9 | Health Report | `services/analyzer/src/analyzer.ts` + `cli.ts` |
| 10 | Issue classification | `collectIssues()` severities `required/recommended/optional/good` |
| 11 | Suggestion system | `ProjectSuggestion` + `PatchProposal` |
| 12 | Compatibility Engine | `services/analyzer/src/compatibility.ts` |
| 13 | Build Environment Registry (GHCR) | `environments/*/Dockerfile` |
| 14 | Build Router | `services/orchestrator/src/router.ts` `BuildRouter` |
| 15 | Route 1 — EAS | `builders/expo/build.sh` (uses `EXPO_TOKEN`) |
| 16 | Route 2 — GitHub Actions | `.github/workflows/build-apk.yml` |
| 17 | Route 3 — Cloudflare Builds | `QuotaManager` provider `cloudflare-builds` |
| 18 | Cache Strategy | Docker layers + GHCR images (no SDK in git) |
| 19 | AI Router | `services/repair-agent/src/ai-router.ts` (small/medium/strong) |
| 20 | Build Knowledge Base | `services/repair-agent/src/knowledge.ts` + `knowledge/errors/known.json` |
| 21 | Repair Engine (4 levels) | `services/repair-agent/src/repair-engine.ts` |
| 22 | Never edit main | `applyPatch` writes to branch; UI shows diff + approval |
| 23 | Retry Engine | `services/orchestrator/src/orchestrator.ts` `MAX_ATTEMPTS=3` |
| 24 | APK Validation | `services/validator/src/index.ts` `ApkValidator` |
| 25 | Real device test | documented hook `Validator` → emulator (future stage 6) |
| 26 | Security Scanner | `packages/security/src/index.ts` `scanForSecrets` |
| 27 | Artifact Storage | `wrangler.toml` R2 binding; `ArtifactMeta` |
| 28 | Dashboard | `apps/web/app/dashboard` |
| 29 | Build page | `apps/web/app/projects/[id]` |
| 30 | Webhooks | `services/api/src/router.ts` `POST /webhooks/github` |
| 31 | Resource management | `BuildBackend.cleanup`; quota consumption |
| 32 | Sandbox | `RepoSource` reads manifests only; no project code executed |
| 33 | Database | `database/migrations/0001_init.sql` (20 tables) |
| 34 | Audit Log | `audit_logs` table; `apps/web` logs actions |
| 35 | Free-Tier Manager | `services/quota-manager` `pickFreeRoute` |
| 36 | No build before fix | `score.buildReadiness` gating; `android-package-missing` required |
| 37 | Scoring system | `services/analyzer/src/score.ts` |
| 38 | Repo split | monorepo layout exactly as specified |
| 39 | Frontend pages | `apps/web/app/*` (all routes) |
| 40 | Backend API | `services/api/src/router.ts` (all endpoints) |
| 41 | Service distribution | `wrangler.toml` + `README.md` table |
| 42 | Free strategy | `QuotaManager` + `BuildRouter` fallback |
| 43 | CPAAutomator example | reproduced end-to-end by `npm run analyze:fixture` |
| 44 | Build phases | README roadmap |
| 45 | Final product | this repository |

## Data flow

```
GitHub repo (files)
  → Analyzer.detect + compatibility + score           → ProjectHealth
  → Orchestrator.run
       loop (max 3):
         BuildRouter.select(provider order by quota)
         Backend.submit + poll
         on fail → RepairAgent.plan (knowledge → AI) → applyPatch (safe) / propose (branch)
  → Validator.validate(apk)                            → ApkValidation
  → NotificationService.publish                        → webhook/email/console
  → Store.put(build, attempts, artifacts)              → Supabase
```

## Stage 8 additions (advanced)

| Spec | Concept | Implementation |
|---|---|---|
| 22 | Auto Fix PR on isolated branch | `services/repair-agent/src/branch.ts` `RepairBranchService` (applies safe patches only, excludes high-risk) |
| 25 | Real-device smoke test | `services/validator/src/smoke.ts` `planSmokeTest` + `staticSmokeTest` |
| 26 | Dangerous-permission scanner | `packages/security/src/index.ts` `scanDangerousPermissions` (wired into Analyzer) |
| 30 | Scheduled builds | `services/quota-manager/src/cron.ts` `parseCron`/`matchesCron`/`nextRun` |
| 34 | Audit log | `services/api/src/audit.ts` `AuditService` + `GET /audit` |
| 35 | Usage tracking | `services/quota-manager/src/usage.ts` `UsageService` (fed by `QuotaManager.onConsume`) + `GET /usage` |
| 44 | Auto versioning | `services/build-core/src/version.ts` `bumpVersion` |
| 44 | Auto signing | `packages/build-core/src/signing.ts` `generateSigningConfig` + `createKeystore` + vault-sealed keystore |
| 44 | iOS pipeline | `builders/ios/build.sh` + `BuildTarget.ios` |
| 44 | GitHub App integration | `services/github/src/index.ts` `GithubClient` (repos/PR/webhook/dispatch) |
| 44 | Play Store distribution | `services/api/src/deploy.ts` `PlayStoreClient` (edits/bundles/tracks) |
| 41 | Deploy | `.github/workflows/deploy.yml` (Pages + Wrangler) |

## Zero-Manual-Config additions

| Spec | Concept | Implementation |
|---|---|---|
| 3 | Real GitHub OAuth (authorization-code) | `services/api/src/oauth-github.ts` `GithubOAuth`; routes `/auth/github/start` + `/auth/github/callback` |
| 3 | Stateless signed sessions + OAuth state | `services/api/src/session.ts` `SessionService` (HMAC-SHA256, Web Crypto) |
| 4 | Connection center with live probes | `services/api/src/setup.ts` `connectionsView` + `probeGithub`; `GET /connections?probe=1`, `DELETE /connections/:p` |
| 6 | Secrets manager (user/project/connection scope) | `services/api/src/secrets.ts` `SecretsService` (vault-sealed, masked previews, `envFor()` build injection) |
| 7 | Repository import from GitHub | `GithubClient.fetchAnalysisSnapshot` (manifests only, §32) → `POST /projects/import`, `GET /github/repos` |
| 22 | Diff preview + approval before any patch | `services/repair-agent/src/diff.ts` `previewPatches`/`unifiedDiff`; `GET/POST /projects/:id/repairs/preview`, `POST …/repairs/apply`; `apps/web/components/DiffPreview.tsx` |
| 27 | R2 artifact storage + signed temporary URLs | `services/api/src/storage.ts` `R2ArtifactStore`/`ArtifactSigner`/`ArtifactService`; `GET /artifacts/:key?exp&sig`, `POST /artifacts/refresh` |
| 30 | Webhook signature verification | `setup.ts` `verifyGithubSignature` (X-Hub-Signature-256) |
| 44 | Zero-config release signing | `packages/build-core/src/signing.ts` `SigningService` (sealed passwords, keystore sealed after first build, rotate/export) + `builders/common/sign.sh` (keytool + Gradle init script) |
| 44 | Setup wizard + platform status | `setup.ts` `platformStatus`/`userChecklist`; `GET /setup/status`, `GET /setup/checklist`; `apps/web/app/setup`, `/status`; `scripts/setup.mjs` (`npm run setup`) |
| 41 | Web on Cloudflare Workers | `apps/web/open-next.config.ts` + `apps/web/wrangler.jsonc` (OpenNext adapter, Next 15) |
| 33 | Persistence for the above | `database/migrations/0002_zero_config.sql` (`project_signing`, `secrets`) + `SupabaseStore` |

## Why it is resilient

The `BuildBackend` interface (`packages/build-core`) is the only contract the
orchestrator knows. EAS, GitHub Actions, Cloudflare Builds and the local Docker
backend all implement it, so swapping or adding a route never touches the
platform — exactly the "don't depend on one service" principle (§45).
