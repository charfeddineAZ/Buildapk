/**
 * AI Router — chooses the cheapest model that can do the job.
 *   classification → small model
 *   log analysis   → medium model
 *   code repair    → strong model
 *
 * We never send secrets to the AI (the analyzer already strips them). A
 * deterministic MockAiProvider lets the platform run/test without credentials;
 * WorkersAiProvider / OpenAiProvider call the real endpoints when configured.
 */

import { Logger } from "@apk-factory/logger";

export type AiTask = "classification" | "log-analysis" | "code-repair";

export interface AiMessage {
  role: "system" | "user";
  content: string;
}

export interface AiCompletion {
  text: string;
  model: string;
  provider: string;
}

export interface AiProvider {
  readonly name: string;
  readonly models: Record<AiTask, string>;
  complete(messages: AiMessage[], task: AiTask): Promise<AiCompletion>;
}

export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  readonly models: Record<AiTask, string> = {
    classification: "mock-small",
    "log-analysis": "mock-medium",
    "code-repair": "mock-strong",
  };
  constructor(private readonly log: Logger = new Logger("ai:mock")) {}

  async complete(messages: AiMessage[], task: AiTask): Promise<AiCompletion> {
    this.log.debug("mock completion", { task });
    const last = messages[messages.length - 1]?.content ?? "";
    if (task === "code-repair") {
      return {
        provider: this.name,
        model: this.models[task],
        text: `I cannot safely auto-patch source for this error without review. Suggested manual action:\n${last.slice(0, 200)}`,
      };
    }
    return {
      provider: this.name,
      model: this.models[task],
      text: `analysis: ${last.slice(0, 160)}`,
    };
  }
}

export class WorkersAiProvider implements AiProvider {
  readonly name = "workers-ai";
  readonly models: Record<AiTask, string> = {
    classification: "@cf/meta/llama-3.1-8b-instruct",
    "log-analysis": "@cf/meta/llama-3.1-8b-instruct",
    "code-repair": "@cf/meta/llama-3.3-70b-instruct",
  };
  constructor(private readonly accountId: string, private readonly apiToken: string, private readonly log: Logger = new Logger("ai:cf")) {}

  async complete(messages: AiMessage[], task: AiTask): Promise<AiCompletion> {
    if (!this.accountId || !this.apiToken) throw new Error("Workers AI not configured");
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.models[task]}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      },
    );
    const data = (await res.json()) as { result?: { response?: string } };
    return { provider: this.name, model: this.models[task], text: data.result?.response ?? "" };
  }
}

export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  readonly models: Record<AiTask, string> = {
    classification: "gpt-4o-mini",
    "log-analysis": "gpt-4o-mini",
    "code-repair": "gpt-4o",
  };
  constructor(private readonly apiKey: string, private readonly log: Logger = new Logger("ai:openai")) {}

  async complete(messages: AiMessage[], task: AiTask): Promise<AiCompletion> {
    if (!this.apiKey) throw new Error("OpenAI not configured");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.models[task], messages }),
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { provider: this.name, model: this.models[task], text: data.choices?.[0]?.message?.content ?? "" };
  }
}

export interface AiRouterConfig {
  workersAi?: { accountId: string; apiToken: string };
  openAi?: { apiKey: string };
}

export class AiRouter {
  private providers: AiProvider[] = [];

  constructor(config: AiRouterConfig = {}, private readonly log: Logger = new Logger("ai-router")) {
    this.providers.push(new MockAiProvider(log.child("mock")));
    if (config.workersAi?.accountId) this.providers.push(new WorkersAiProvider(config.workersAi.accountId, config.workersAi.apiToken, log.child("cf")));
    if (config.openAi?.apiKey) this.providers.push(new OpenAiProvider(config.openAi.apiKey, log.child("openai")));
  }

  /** Strongest provider first for code repair; cheapest first otherwise. */
  async route(task: AiTask, messages: AiMessage[]): Promise<AiCompletion> {
    const order = task === "code-repair" ? [...this.providers].reverse() : this.providers;
    let lastErr: unknown;
    for (const p of order) {
      try {
        return await p.complete(messages, task);
      } catch (e) {
        lastErr = e;
        this.log.warn("provider failed, trying next", { provider: p.name, task });
      }
    }
    throw lastErr ?? new Error("no AI provider available");
  }

  classify(logs: string): Promise<AiCompletion> {
    return this.route("classification", [{ role: "system", content: "Classify this build error briefly." }, { role: "user", content: logs }]);
  }

  analyze(logs: string): Promise<AiCompletion> {
    return this.route("log-analysis", [{ role: "system", content: "Analyze the build failure and list likely causes." }, { role: "user", content: logs }]);
  }

  repair(prompt: string): Promise<AiCompletion> {
    return this.route("code-repair", [{ role: "system", content: "You are an Android build repair agent. Propose a minimal, safe fix." }, { role: "user", content: prompt }]);
  }
}
