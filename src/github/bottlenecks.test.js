// @ts-check
import { afterEach, describe, expect, it, vi } from "vitest";
import { slack, timeRun } from "./bottlenecks.js";

afterEach(() => vi.unstubAllGlobals());

/** @typedef {Parameters<typeof timeRun>[0][number]["card"]} Card */

const T0 = Date.parse("2026-01-01T00:00:00Z");

/**
 * Serves each job's GitHub header from [status, start, end] in seconds after T0.
 * @param {Record<string, [string, number, number]>} jobs by job id
 */
function stubHeaders(jobs) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (/** @type {string} */ url) => {
      const [status, start, end] =
        jobs[url.match(/\/runs\/(\d+)\//)?.[1] ?? ""];
      const finished = new Date(T0 + end * 1000).toISOString();
      return new Response(
        `${status} <relative-time datetime="${finished}"></relative-time> in ${end - start}s`,
      );
    }),
  );
}

/** @param {string} label @returns {Card} */
const card = (label) => ({ label, matrix: false, jobs: [], from: [], to: [] });

/** @param {Card} from @param {Card} to */
function link(from, to) {
  from.to.push(to);
  to.from.push(from);
}

/** @param {Card} c @param {string} id */
const entry = (c, id) => ({
  card: c,
  ref: { href: `/o/r/actions/runs/1/job/${id}`, name: c.label },
});

describe("CI bottlenecks", () => {
  it("follows the latest-finishing needs and ignores late skipped jobs", async () => {
    const build = card("build");
    const lint = card("lint");
    const test = card("test");
    const labelled = card("labelled");
    link(build, lint);
    link(build, test);
    stubHeaders({
      1: ["succeeded", 0, 60],
      2: ["succeeded", 70, 90],
      3: ["succeeded", 65, 200],
      4: ["skipped", 500, 500],
    });

    const run = await timeRun([
      entry(build, "1"),
      entry(lint, "2"),
      entry(test, "3"),
      entry(labelled, "4"),
    ]);

    expect(run.wall).toBe(200);
    expect(run.path.map((job) => job.name)).toEqual(["build", "test"]);
    expect(run.jobs.map((job) => job.name)).not.toContain("labelled");
    expect(slack(lint.jobs[0], run.wall)).toBe(110);
    expect(slack(test.jobs[0], run.wall)).toBe(0);
    expect(slack(build.jobs[0], run.wall)).toBe(0);
  });
});
