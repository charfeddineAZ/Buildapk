import { describe, it, expect, vi } from "vitest";
import { GithubClient } from "./index.js";

describe("GithubClient", () => {
  function mockFetch(handler: (url: string, init: any) => any) {
    (globalThis as any).fetch = vi.fn(async (url: string, init: any) => handler(url, init));
  }

  it("opens a pull request with the right payload", async () => {
    let captured: any;
    mockFetch((url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ number: 7, html_url: "https://github.com/o/r/pull/7" }), { status: 201 });
    });
    const gh = new GithubClient("tok");
    const pr = await gh.createPullRequest("o", "r", "fix-branch", "main", "Fix", "body");
    expect(pr.number).toBe(7);
    expect(captured.url).toBe("https://api.github.com/repos/o/r/pulls");
    expect(captured.body).toEqual({ head: "fix-branch", base: "main", title: "Fix", body: "body" });
  });

  it("registers a push/release webhook", async () => {
    let captured: any;
    mockFetch((url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response("{}", { status: 201 });
    });
    const gh = new GithubClient("tok");
    await gh.createWebhook("o", "r", "https://x/hook", "sec");
    expect(captured.url).toBe("https://api.github.com/repos/o/r/hooks");
    expect(captured.body.events).toEqual(["push", "release"]);
    expect(captured.body.config.secret).toBe("sec");
  });

  it("dispatches a workflow with ref + inputs", async () => {
    let captured: any;
    mockFetch((url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response(null, { status: 204 });
    });
    const gh = new GithubClient("tok");
    await gh.dispatchWorkflow("o", "r", "build-apk.yml", "main", { framework: "expo" });
    expect(captured.url).toBe("https://api.github.com/repos/o/r/actions/workflows/build-apk.yml/dispatches");
    expect(captured.body).toEqual({ ref: "main", inputs: { framework: "expo" } });
  });

  it("lists installation repositories", async () => {
    mockFetch((url) =>
      new Response(JSON.stringify({ repositories: [{ full_name: "o/r", default_branch: "main", private: false }] }), { status: 200 }),
    );
    const gh = new GithubClient("tok");
    const repos = await gh.listRepositories(123);
    expect(repos[0].fullName).toBe("o/r");
  });
});
