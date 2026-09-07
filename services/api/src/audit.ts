/**
 * Audit Log (section 34). Every security/state-changing action is recorded so
 * the platform is auditable: who, what, which provider, which project, result.
 * Stored in-memory here; the production Store persists it (audit_logs table).
 */

import { Logger } from "@apk-factory/logger";

export interface AuditEntry {
  id: string;
  user?: string;
  action: string;
  provider?: string;
  projectId?: string;
  ipHash?: string;
  result: "success" | "failure";
  detail?: string;
  at: string;
}

export class AuditService {
  private entries: AuditEntry[] = [];

  constructor(private readonly log: Logger = new Logger("audit")) {}

  record(e: Omit<AuditEntry, "id" | "at">): AuditEntry {
    const entry: AuditEntry = { ...e, id: `aud_${crypto.randomUUID().slice(0, 8)}`, at: new Date().toISOString() };
    this.entries.push(entry);
    this.log.info("audit", { action: e.action, result: e.result, projectId: e.projectId });
    return entry;
  }

  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit).reverse();
  }
}
