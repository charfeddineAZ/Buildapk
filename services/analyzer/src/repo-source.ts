/**
 * Abstraction over a repository's file system so the analyzer can run against
 * a real checkout (DiskRepoSource) or an in-memory tree (MemoryRepoSource)
 * used by tests and by the API when analyzing a freshly cloned repo.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface RepoSource {
  readText(rel: string): Promise<string | null>;
  exists(rel: string): Promise<boolean>;
  listPaths(): Promise<string[]>;
  isDirectory(rel: string): Promise<boolean>;
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "build" || e.name === "dist") continue;
    const abs = path.join(dir, e.name);
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) await walk(abs, rel, out);
    else out.push(rel);
  }
}

export class DiskRepoSource implements RepoSource {
  constructor(private readonly root: string) {}

  async readText(rel: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.root, rel), "utf8");
    } catch {
      return null;
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.root, rel));
      return true;
    } catch {
      return false;
    }
  }

  async listPaths(): Promise<string[]> {
    const out: string[] = [];
    await walk(this.root, "", out);
    return out;
  }

  async isDirectory(rel: string): Promise<boolean> {
    try {
      return (await fs.stat(path.join(this.root, rel))).isDirectory();
    } catch {
      return false;
    }
  }
}

export class MemoryRepoSource implements RepoSource {
  constructor(private readonly files: Record<string, string> = {}) {}

  async readText(rel: string): Promise<string | null> {
    return rel in this.files ? this.files[rel] : null;
  }

  async exists(rel: string): Promise<boolean> {
    return rel in this.files;
  }

  async listPaths(): Promise<string[]> {
    return Object.keys(this.files);
  }

  async isDirectory(rel: string): Promise<boolean> {
    return false;
  }
}
