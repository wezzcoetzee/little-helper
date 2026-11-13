// @ts-check

import css from "./bottlenecks.css" with { type: "text" };
import dialogCss from "./dialog.css" with { type: "text" };
import { memo } from "./memo.js";

/**
 * A workflow run's summary page, including a re-run attempt.
 * GitHub uses the same URL for other summaries, so the graph's presence is what's checked.
 */
const RUN = /^\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?\/?$/;
/** A run's summary or one of its job pages: the run's path, and the job's id. */
const RUN_PAGE =
  /^(\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?)(?:\/job\/(\d+))?\/?$/;
/** Any page of a pull request; its tabs link to the checks. */
const PULL = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

/** @typedef {"waterfall" | "graph" | "slack"} View */
/** Synced with the reader's display preferences. */
const VIEW_KEY = "github_bottlenecks_view";
/** @type {View[]} */
const VIEWS = ["waterfall", "graph", "slack"];

/**
 * One box in GitHub's graph. Usually a single job; a matrix, or jobs sharing the same
 * needs and dependents, share one. GitHub draws its arrows between these.
 * @typedef {object} Card
 * @property {string} label
 * @property {boolean} matrix
 * @property {Job[]} jobs
 * @property {Card[]} from cards it waits on
 * @property {Card[]} to cards waiting on it
 */

/**
 * Times are seconds since the run's first job started. On a PR, since the first job of
 * any of its workflows started.
 * @typedef {object} Job
 * @property {string} id
 * @property {string} name
 * @property {string} href
 * @property {string} status as GitHub words it: "succeeded", "failed", "skipped"…
 * @property {number} start
 * @property {number} end
 * @property {Card} card
 */

/**
 * @typedef {object} Run
 * @property {Job[]} jobs finished jobs, by start, less any skipped after the wall time
 * @property {Card[]} cards
 * @property {number} pending jobs still queued or running, so not in `jobs`
 * @property {number} wall
 * @property {Job[]} path the chain of jobs that decided the wall time, first to last
 */

// ---------------------------------------------------------------------------
// Reading GitHub's graph

/**
 * Same-origin, so unlike the reader's raw files these don't need the background worker.
 * GitHub's partials only answer requests marked as its own, and its full pages 404
 * when they are.
 * @param {string} url
 * @param {{ partial: boolean }} [options]
 */
async function fetchDocument(url, { partial } = { partial: true }) {
  const response = await fetch(
    url,
    partial ? { headers: { "X-Requested-With": "XMLHttpRequest" } } : {},
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

/**
 * Runs `load` over `items` with at most `limit` in flight, so a 200-job run doesn't
 * fire 200 requests at once.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} load
 */
async function mapLimit(items, limit, load) {
  /** @type {R[]} */
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await load(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** @param {string} text e.g. "1h 2m 3s", "5m 23s", "0s" */
function parseDuration(text) {
  let seconds = 0;
  for (const [, value, unit] of text.matchAll(/(\d+)([hms])/g)) {
    seconds +=
      Number(value) *
      { h: 3600, m: 60, s: 1 }[/** @type {"h" | "m" | "s"} */ (unit)];
  }
  return seconds;
}

/**
 * A job's header reads like "succeeded <relative-time datetime=…> in 5m 23s". The
 * finish time and the duration give the start, to the second. Some skipped jobs leave
 * the duration out.
 * @param {string} href the job's page
 */
async function loadTiming(href) {
  const id = href.match(/\/job\/(\d+)/)?.[1];
  const repo = href.match(/^\/[^/]+\/[^/]+/)?.[0];
  const doc = await fetchDocument(`${repo}/runs/${id}/header`);
  const finished = doc.querySelector("relative-time")?.getAttribute("datetime");
  const text = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  const status = text.split(" ")[0];
  const duration =
    text.match(/ in ((?:\d+h )?(?:\d+m )?\d+s)$/)?.[1] ??
    (status === "skipped" ? "0s" : undefined);
  if (!finished || !duration) return undefined;
  const end = Date.parse(finished) / 1000;
  return { status, start: end - parseDuration(duration), end };
}

/**
 * @param {Element} el a streaming-graph-job
 * @param {string} prefix put before the name, so a PR's workflows stay apart
 */
function jobRef(el, prefix) {
  const href = el.querySelector('a[href*="/job/"]')?.getAttribute("href");
  if (!href) return undefined;
  // The tooltip has the full name; the visible one drops the job inside a reusable workflow.
  const name =
    el.querySelector("tool-tip")?.textContent?.trim() ??
    el
      .querySelector('[data-target="streaming-graph-job.name"]')
      ?.textContent?.trim();
  return {
    href,
    name: prefix + (name || el.getAttribute("data-job-id") || href),
  };
}

/** @typedef {{ card: Card, ref: { href: string, name: string } }} Entry */

/**
 * Reads a graph's cards, their arrows and the jobs in each, without timings yet.
 * @param {Element} graph GitHub's <action-graph>, on this page or a fetched one
 * @param {string} [workflow] prefixes names, for a PR's view of several workflows
 * @returns {Promise<Entry[]>}
 */
async function readGraph(graph, workflow) {
  const prefix = workflow ? `${workflow} / ` : "";
  /** @type {Map<string, { card: Card, refs: Map<string, Entry["ref"]> }>} */
  const groups = new Map();
  /** @param {string} id */
  const group = (id) => {
    let entry = groups.get(id);
    if (!entry) {
      entry = {
        card: { label: "", matrix: false, jobs: [], from: [], to: [] },
        refs: new Map(),
      };
      groups.set(id, entry);
    }
    return entry;
  };
  /** @param {ParentNode} root */
  const collect = (root) => {
    for (const el of root.querySelectorAll(
      "streaming-graph-job[data-group-id]",
    )) {
      const ref = jobRef(el, prefix);
      if (ref)
        group(
          /** @type {string} */ (el.getAttribute("data-group-id")),
        ).refs.set(ref.href, ref);
    }
  };
  collect(graph);

  // Collapsed matrices only list their jobs once expanded, which GitHub loads on demand.
  await Promise.all(
    [...graph.querySelectorAll(".js-graph-matrix[data-url]")].map(
      async (el) => {
        const cardEl = el.closest('[id^="group-"]');
        if (!cardEl) return;
        const { card } = group(cardEl.id);
        card.matrix = true;
        const label = cardEl
          .querySelector(".WorkflowCard-heading--content")
          ?.textContent?.trim();
        card.label = label ? prefix + label : "";
        const url = new URL(
          /** @type {string} */ (el.getAttribute("data-url")),
          location.origin,
        );
        url.searchParams.set("expanded", "true");
        collect(await fetchDocument(url.pathname + url.search));
      },
    ),
  );

  for (const path of graph.querySelectorAll("[data-from][data-to]")) {
    const from = groups.get(
      /** @type {string} */ (path.getAttribute("data-from")),
    )?.card;
    const to = groups.get(
      /** @type {string} */ (path.getAttribute("data-to")),
    )?.card;
    if (!from || !to || from.to.includes(to)) continue;
    from.to.push(to);
    to.from.push(from);
  }

  return [...groups.values()].flatMap(({ card, refs }) =>
    [...refs.values()].map((ref) => ({ card, ref })),
  );
}

/**
 * The workflow runs a PR's checks tab lists for its head commit, by name. Checks from
 * apps other than Actions have no graph, so they're left out.
 * @param {string} pull e.g. "/owner/repo/pull/12"
 */
async function loadPullRuns(pull) {
  const doc = await fetchDocument(`${pull}/checks`, { partial: false });
  /** @type {Map<string, string>} */
  const runs = new Map();
  for (const link of doc.querySelectorAll('a[href*="/actions/runs/"]')) {
    const href = link.getAttribute("href") ?? "";
    if (RUN.test(href))
      runs.set(href, link.querySelector("span")?.textContent?.trim() || href);
  }
  return runs;
}

/** @param {string} href a run's summary page */
async function fetchGraph(href) {
  return (await fetchDocument(href, { partial: false })).querySelector(
    "action-graph",
  );
}

/**
 * One run. The summary page already has its graph; a job page fetches the summary's.
 * @param {string} path e.g. "/owner/repo/actions/runs/12"
 */
async function loadRun(path) {
  const graph =
    document.querySelector("action-graph") ?? (await fetchGraph(path));
  if (!graph) throw new Error("no job graph on the run's page");
  return timeRun(await readGraph(graph));
}

/**
 * Every workflow on the PR's head commit as one run, so the critical path is whichever
 * chain of jobs held up the last check to finish.
 * @param {string} pull e.g. "/owner/repo/pull/12"
 */
async function loadPull(pull) {
  const runs = [...(await loadPullRuns(pull))];
  if (!runs.length) throw new Error("no Actions runs on the head commit");
  const entries = await mapLimit(runs, 4, async ([href, name]) => {
    const graph = await fetchGraph(href);
    return graph ? readGraph(graph, name) : [];
  });
  return timeRun(entries.flat());
}

/**
 * Times each job from its header and finds the critical path.
 * @param {Entry[]} entries
 * @returns {Promise<Run>}
 */
export async function timeRun(entries) {
  const timings = await mapLimit(entries, 8, ({ ref }) =>
    loadTiming(ref.href).catch(() => undefined),
  );
  const t0 = Math.min(
    ...timings.flatMap((timing) => (timing ? [timing.start] : [])),
  );
  entries.forEach(({ card, ref }, index) => {
    const timing = timings[index];
    if (!timing) return;
    card.jobs.push({
      id: /** @type {string} */ (ref.href.match(/\/job\/(\d+)/)?.[1]),
      name: ref.name,
      href: ref.href,
      status: timing.status,
      start: timing.start - t0,
      end: timing.end - t0,
      card,
    });
  });

  const cards = [...new Set(entries.map(({ card }) => card))].filter(
    (card) => card.jobs.length,
  );
  const timed = cards
    .flatMap((card) => card.jobs)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  // A skipped job takes no runner, so it can't be what the run waited on. On a PR, a
  // workflow fired later by a label or an edit is often all skips; it shouldn't stretch
  // the wall time.
  const ran = timed.filter((job) => job.status !== "skipped");
  const last = (ran.length ? ran : timed).reduce(
    (a, b) => (b.end > a.end ? b : a),
    timed[0],
  );
  const wall = last?.end ?? 0;
  /** @type {Job[]} */
  const path = [];
  for (let job = /** @type {Job | undefined} */ (last); job; job = blocker(job))
    path.unshift(job);

  return /** @type {Run} */ ({
    jobs: timed.filter((job) => job.end <= wall),
    cards,
    pending: entries.length - timed.length,
    wall,
    path,
  });
}

// ---------------------------------------------------------------------------
// Analysis

/** @param {Job} job */
const needs = (job) => job.card.from.flatMap((card) => card.jobs);
/** @param {Job} job */
const dependents = (job) => job.card.to.flatMap((card) => card.jobs);
/** @param {Job} job */
const duration = (job) => job.end - job.start;

/**
 * The job this one waited on longest. GitHub starts a job once all its needs finish,
 * so that's the one that held it up.
 * @param {Job} job
 */
function blocker(job) {
  return needs(job).reduce(
    (/** @type {Job | undefined} */ a, b) => (!a || b.end > a.end ? b : a),
    undefined,
  );
}

/**
 * Time between the job's last need finishing and the job starting: queueing for a
 * runner plus GitHub's own handoff.
 * @param {Job} job
 */
function wait(job) {
  const before = blocker(job);
  return before ? Math.max(0, job.start - before.end) : 0;
}

/** @type {WeakMap<Job, number>} */
const slacks = new WeakMap();

/**
 * How much longer a job could have taken before the run finished later. Measured to
 * when each dependent's last need finished rather than to its start, since the wait
 * for a runner comes after either way.
 * @param {Job} job
 * @param {number} wall
 * @returns {number}
 */
export function slack(job, wall) {
  let value = slacks.get(job);
  if (value === undefined) {
    const after = dependents(job);
    value = Math.max(
      0,
      after.length
        ? Math.min(
            ...after.map(
              (next) =>
                (blocker(next)?.end ?? job.end) - job.end + slack(next, wall),
            ),
          )
        : wall - job.end,
    );
    slacks.set(job, value);
  }
  return value;
}

/** @param {number} seconds */
function formatDuration(seconds) {
  const s = Math.round(seconds);
  if (s >= 3600)
    return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  if (s >= 60)
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Rendering

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** @param {Job} job */
function statusClass(job) {
  if (job.status === "skipped") return "skipped";
  if (job.status === "failed" || job.status === "cancelled") return "failed";
  return "";
}

/** @param {number} span */
function axis(span) {
  const step =
    [10, 30, 60, 120, 300, 600, 900, 1800, 3600].find((s) => span / s <= 12) ??
    7200;
  const ticks = el("div", "ticks");
  for (let t = 0; t <= span; t += step) {
    const tick = el(
      "i",
      undefined,
      t && t % 3600 === 0
        ? `${t / 3600}h`
        : t && t % 60 === 0
          ? `${t / 60}m`
          : formatDuration(t),
    );
    tick.style.left = `${(t / span) * 100}%`;
    ticks.append(tick);
  }
  const row = el("div", "row axis");
  row.append(el("span"), ticks, el("span"));
  return row;
}

/**
 * Bars on a shared time axis, used for jobs and for a job's steps.
 * @param {{ label: Node, start: number, end: number, wait?: number, className: string }[]} rows
 * @param {number} span
 */
function bars(rows, span) {
  const box = el("div", "bars");
  box.append(axis(span));
  for (const { label, start, end, wait = 0, className } of rows) {
    const row = el("div", `row ${className}`);
    const track = el("div", "track");
    const waiting = el("i", "wait");
    waiting.style.cssText = `left:${((start - wait) / span) * 100}%;width:${(wait / span) * 100}%`;
    const running = el("i", "run");
    running.style.cssText = `left:${(start / span) * 100}%;width:${((end - start) / span) * 100}%`;
    track.append(waiting, running);
    const name = el("span", "name");
    name.append(label);
    row.append(
      name,
      track,
      el(
        "span",
        "time",
        className.includes("skipped") ? "skip" : formatDuration(end - start),
      ),
    );
    box.append(row);
  }
  return box;
}

/** @param {Job} job */
function jobLink(job, text = job.name) {
  const link = el("a", undefined, text);
  link.href = job.href;
  link.title = job.name;
  return link;
}

/**
 * @param {Run} run
 * @param {Job} job
 */
function jobClass(run, job) {
  return [run.path.includes(job) ? "critical" : "", statusClass(job)].join(" ");
}

/** @param {Run} run */
function legend(run) {
  const box = el("div", "legend");
  box.innerHTML = `<span><i class="critical"></i>critical path</span><span><i class="run"></i>running</span><span><i class="wait"></i>waiting to start</span>`;
  if (run.pending)
    box.append(
      el(
        "span",
        undefined,
        `${run.pending} still queued or running, not shown`,
      ),
    );
  return box;
}

/** @param {Run} run */
function renderWaterfall(run) {
  const view = el("section", "waterfall");
  view.append(
    bars(
      run.jobs.map((job) => ({
        label: jobLink(job),
        start: job.start,
        end: job.end,
        wait: wait(job),
        className: jobClass(run, job),
      })),
      run.wall,
    ),
    legend(run),
  );
  return view;
}

/**
 * GitHub's layout, top to bottom: each card sits one level below the deepest card it
 * waits on. A matrix shows as one node, timed by its slowest job.
 * @param {Run} run
 */
function renderGraph(run) {
  const view = el("section", "graph");
  /** @type {Map<Card, number>} */
  const depths = new Map();
  /** @param {Card} card @returns {number} */
  const depth = (card) => {
    let value = depths.get(card);
    if (value === undefined) {
      value = card.from.length
        ? 1 + Math.max(...card.from.filter((c) => c.jobs.length).map(depth), -1)
        : 0;
      depths.set(card, value);
    }
    return value;
  };

  /** @type {{ job: Job, label: string, card: Card }[][]} */
  const levels = [];
  for (const card of run.cards) {
    const members = card.matrix
      ? [card.jobs.reduce((a, b) => (duration(b) > duration(a) ? b : a))]
      : card.jobs;
    for (const job of members) {
      const label = card.matrix
        ? `${card.label || job.name} ×${card.jobs.length}`
        : job.name;
      (levels[depth(card)] ??= []).push({ job, label, card });
    }
  }

  const longest = Math.max(1, ...run.jobs.map(duration));
  const dag = el("div", "dag");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  dag.append(svg);
  /** @type {Map<Card, HTMLElement[]>} */
  const nodes = new Map();
  for (const level of levels) {
    if (!level) continue;
    const row = el("div", "level");
    for (const { job, label, card } of level.sort(
      (a, b) => a.job.start - b.job.start,
    )) {
      const node = el(
        "a",
        `node ${card.jobs.some((j) => run.path.includes(j)) ? "critical" : ""} ${statusClass(job)}`,
      );
      node.href = job.href;
      node.title = job.name;
      const head = el("span", "head");
      head.append(
        el("span", "name", label),
        el(
          "span",
          "time",
          statusClass(job) === "skipped"
            ? "skip"
            : formatDuration(duration(job)),
        ),
      );
      const meter = el("span", "meter");
      const fill = el("i");
      fill.style.width = `${(duration(job) / longest) * 100}%`;
      meter.append(fill);
      node.append(head, meter);
      row.append(node);
      nodes.set(card, [...(nodes.get(card) ?? []), node]);
    }
    dag.append(row);
  }

  const onPath = new Set(run.path.map((job) => job.card));
  const draw = () => {
    const box = dag.getBoundingClientRect();
    /** @type {SVGPathElement[]} */
    const lines = [];
    for (const card of run.cards) {
      for (const next of card.to) {
        const critical =
          onPath.has(card) &&
          onPath.has(next) &&
          run.path.some(
            (job, i) => job.card === card && run.path[i + 1]?.card === next,
          );
        for (const from of nodes.get(card) ?? []) {
          for (const to of nodes.get(next) ?? []) {
            const a = from.getBoundingClientRect();
            const b = to.getBoundingClientRect();
            const x1 = a.left + a.width / 2 - box.left;
            const y1 = a.bottom - box.top;
            const x2 = b.left + b.width / 2 - box.left;
            const y2 = b.top - box.top;
            const mid = (y1 + y2) / 2;
            const line = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "path",
            );
            line.setAttribute(
              "d",
              `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`,
            );
            if (critical) line.classList.add("critical");
            lines.push(line);
          }
        }
      }
    }
    // Critical lines last, so they draw on top.
    svg.replaceChildren(
      ...lines.sort(
        (a, b) =>
          Number(a.classList.contains("critical")) -
          Number(b.classList.contains("critical")),
      ),
    );
  };
  new ResizeObserver(draw).observe(dag);

  view.append(
    dag,
    el("h3", undefined, `Where the ${formatDuration(run.wall)} goes`),
    pathStrip(run),
    legend(run),
  );
  return view;
}

/**
 * The critical path laid end to end, so each job's share of the wall time is its width.
 * @param {Run} run
 */
function pathStrip(run) {
  const strip = el("div", "strip");
  let cursor = 0;
  /**
   * @param {string} className
   * @param {number} seconds
   * @param {string} name
   */
  const segment = (className, seconds, name) => {
    if (seconds <= 0) return;
    const part = el(
      "span",
      className,
      seconds / run.wall > 0.06
        ? `${name} ${formatDuration(seconds)}`.trim()
        : "",
    );
    part.style.flexGrow = String(seconds);
    part.title = `${name || "waiting"} ${formatDuration(seconds)}`;
    strip.append(part);
  };
  for (const job of run.path) {
    segment("wait", job.start - cursor, "");
    segment("critical", duration(job), job.name);
    cursor = job.end;
  }
  return strip;
}

/** @type {Map<string, Promise<{ name: string, start: number, end: number }[]>>} */
const stepCache = new Map();

/** @param {Job} job */
function loadSteps(job) {
  return memo(stepCache, job.href, async () => {
    const doc = await fetchDocument(job.href, { partial: false });
    return [
      ...doc.querySelectorAll("check-step[data-started-at][data-completed-at]"),
    ].map((step) => ({
      name: step.getAttribute("data-name") ?? "",
      start:
        Date.parse(
          /** @type {string} */ (step.getAttribute("data-started-at")),
        ) / 1000,
      end:
        Date.parse(
          /** @type {string} */ (step.getAttribute("data-completed-at")),
        ) / 1000,
    }));
  });
}

/** @param {Run} run */
function renderSlack(run) {
  const view = el("section", "slack");
  const ranked = run.jobs
    .filter((job) => job.status !== "skipped")
    .sort(
      (a, b) =>
        slack(a, run.wall) - slack(b, run.wall) || duration(b) - duration(a),
    );
  const longest = Math.max(1, ...ranked.map(duration));
  const table = el("table");
  table.innerHTML = `<thead><tr><th>Job</th><th class="n">Run</th><th class="n">Waited</th><th class="n">Slack</th></tr></thead>`;
  const body = el("tbody");
  const steps = el("div", "steps");

  /** @param {Job} job @param {HTMLElement} row */
  const select = async (job, row) => {
    for (const other of body.children) other.removeAttribute("aria-selected");
    row.setAttribute("aria-selected", "true");
    const heading = el("h3");
    heading.append(jobLink(job), ` steps`);
    steps.replaceChildren(heading, el("p", "note", "Loading…"));
    try {
      const list = (await loadSteps(job)).filter(
        (step) => step.end - step.start >= 1,
      );
      if (row.getAttribute("aria-selected") !== "true") return;
      const t0 = Math.min(...list.map((step) => step.start));
      steps.replaceChildren(
        heading,
        bars(
          list.map((step) => ({
            label: document.createTextNode(step.name),
            start: step.start - t0,
            end: step.end - t0,
            className: run.path.includes(job) ? "critical" : "",
          })),
          Math.max(1, ...list.map((step) => step.end - t0)),
        ),
      );
    } catch (error) {
      steps.replaceChildren(
        heading,
        el(
          "p",
          "note",
          `Couldn't load steps: ${error instanceof Error ? error.message : error}`,
        ),
      );
    }
  };

  for (const job of ranked) {
    const row = el("tr", jobClass(run, job));
    const name = el("td", "name");
    name.append(jobLink(job));
    const time = el("td", "n");
    const bar = el("i", "inline");
    bar.style.width = `${(duration(job) / longest) * 80}px`;
    time.append(bar, formatDuration(duration(job)));
    const left = slack(job, run.wall);
    row.append(
      name,
      time,
      el("td", "n", formatDuration(wait(job))),
      el(
        "td",
        `n ${left === 0 ? "zero" : ""}`,
        left === 0 ? "0" : formatDuration(left),
      ),
    );
    row.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a")) return;
      select(job, row);
    });
    body.append(row);
  }
  table.append(body);
  view.append(
    el(
      "p",
      "note",
      "Slack is how much longer a job could have taken without the run finishing later. Zero slack means speeding it up speeds up the run. Click a row for its steps.",
    ),
    table,
    steps,
  );
  const first = ranked.find((job) => job.id === focusJob) ?? ranked[0];
  const row = /** @type {HTMLElement | undefined} */ (
    body.children[ranked.indexOf(first)]
  );
  if (first && row) {
    select(first, row);
    // The view isn't on the page yet; scroll once it is.
    if (first.id === focusJob)
      requestAnimationFrame(() => row.scrollIntoView({ block: "center" }));
  }
  return view;
}

const RENDERERS = {
  waterfall: renderWaterfall,
  graph: renderGraph,
  slack: renderSlack,
};

// ---------------------------------------------------------------------------
// Dialog

/** @type {ReturnType<typeof createDialog> | undefined} */
let dialog;

function getDialog() {
  // Turbo navigation can swap out <body>, taking the host with it.
  if (!dialog?.host.isConnected) dialog = createDialog();
  return dialog;
}

function createDialog() {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>${dialogCss}${css}</style>
    <dialog tabindex="-1">
      <header class="bar">
        <span class="title"></span>
        <span class="summary"></span>
        <span class="switch">
          ${VIEWS.map((view) => `<button type="button" data-view="${view}">${view}</button>`).join("")}
          <kbd>1 2 3</kbd>
        </span>
        <button type="button" class="close">esc</button>
      </header>
      <div class="scroll"><div class="content"></div></div>
    </dialog>`;
  document.body.append(host);

  /** @param {string} selector */
  const find = (selector) =>
    /** @type {HTMLElement} */ (root.querySelector(selector));
  const parts = {
    host,
    root,
    dialog: /** @type {HTMLDialogElement} */ (find("dialog")),
    title: find(".title"),
    summary: find(".summary"),
    content: find(".content"),
  };

  for (const button of root.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () =>
      showView(/** @type {View} */ (button.getAttribute("data-view"))),
    );
  }
  find(".close").addEventListener("click", () => parts.dialog.close());
  parts.dialog.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const view = VIEWS[Number(event.key) - 1];
    if (!view) return;
    event.preventDefault();
    showView(view);
  });
  return parts;
}

/** @type {View} */
let currentView = "waterfall";

/** @type {Run | undefined} */
let shown;

/** The job the slack view selects first, when a job page's Steps button opened it. */
let focusJob = "";

/** @param {View} view */
function showView(view) {
  if (view !== currentView) chrome.storage.sync.set({ [VIEW_KEY]: view });
  currentView = view;
  const { root, content } = getDialog();
  for (const button of root.querySelectorAll("[data-view]")) {
    button.ariaPressed = String(button.getAttribute("data-view") === view);
  }
  if (shown) content.replaceChildren(RENDERERS[view](shown));
}

let openCount = 0;

/**
 * @param {string} title
 * @param {() => Promise<Run>} load
 * @param {string} [job] a job's id, to open the slack view on its steps
 */
async function openBottlenecks(title, load, job = "") {
  const parts = getDialog();
  const opened = ++openCount;
  shown = undefined;
  focusJob = job;
  // Not remembered, so the view picked last still opens next time.
  if (job) currentView = "slack";
  parts.title.textContent = title;
  parts.summary.textContent = "";
  parts.content.replaceChildren(el("p", "note", "Loading job timings…"));
  showView(currentView);
  parts.dialog.showModal();
  parts.dialog.focus();

  try {
    const run = await load();
    if (opened !== openCount) return;
    if (!run.jobs.length) throw new Error("no finished jobs yet");
    shown = run;
    const waited = run.path.reduce((total, job) => total + wait(job), 0);
    const runner = run.jobs.reduce((total, job) => total + duration(job), 0);
    parts.summary.textContent = [
      `${formatDuration(run.wall)} wall`,
      `${run.path.length} ${run.path.length === 1 ? "job" : "jobs"} on critical path`,
      `${formatDuration(waited)} waiting on it`,
      `${formatDuration(runner)} runner time`,
    ].join(" · ");
    showView(currentView);
  } catch (error) {
    if (opened !== openCount) return;
    parts.content.replaceChildren(
      el(
        "p",
        "note",
        `Couldn't load the run: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Buttons on GitHub's run and PR pages

/**
 * @param {string} label
 * @param {() => void} open
 */
function createButton(label, open) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghci-open btn btn-sm";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  return button;
}

/**
 * Puts a button in `container` unless one for the same key is already there, swapping
 * out one left from another run or job, as Turbo can keep the header between them.
 * @param {Element | null | undefined} container
 * @param {string} key
 * @param {() => HTMLButtonElement} create
 * @param {(button: HTMLButtonElement) => void} insert
 */
function place(container, key, create, insert) {
  if (!container) return;
  const existing = container.querySelector(".ghci-open");
  if (existing instanceof HTMLElement && existing.dataset.key === key) return;
  existing?.remove();
  const button = create();
  button.dataset.key = key;
  insert(button);
}

/**
 * Bottlenecks in the run's header, before Re-run all jobs, on the summary and every job
 * page. On a job page, Steps in the job's header opens the run on that job's steps.
 * Both are server-rendered, so unlike the PR page there's no React to upset.
 * @param {RegExpMatchArray} match
 */
function syncRun([, path, job]) {
  const title =
    document
      .querySelector(".PageHeader-parentLink-label")
      ?.textContent?.trim() ?? "";
  const actions = document.querySelector(".PageHeader-actions");
  // The actions sit in a row shown from medium widths, with a menu for narrower ones.
  const row = actions?.querySelector(".d-md-flex") ?? actions;
  place(
    row,
    path,
    () => {
      const button = createButton("Bottlenecks", () =>
        openBottlenecks(title, () => loadRun(path)),
      );
      // Re-run all jobs is a medium button.
      if (!row?.querySelector(".btn-sm")) button.classList.remove("btn-sm");
      return button;
    },
    (button) => row?.prepend(button),
  );

  if (!job) return;
  const heading = document.querySelector(
    ".CheckRun-header .CheckRun-log-title",
  );
  place(
    heading?.parentElement,
    job,
    () =>
      createButton("Steps", () =>
        openBottlenecks(title, () => loadRun(path), job),
      ),
    (button) => heading?.after(button),
  );
}

/**
 * The merge box's header actions in every state (open, draft, merged, closed), matched
 * by their whole text since React's class names are hashed. Whole, so a "Revert"
 * elsewhere on the page doesn't count; the merge buttons may end in "(squash)".
 */
const MERGE_ACTION =
  /^(update branch|(enable|disable) auto-merge|squash and merge|rebase and merge|merge pull request|merge when ready|ready for review|restore branch|delete branch|revert)( \(.+\))?$/i;

/**
 * The status line under the heading that shares a merge box section with its first
 * action, as in "Resolve the merge conflicts before this can merge." Searched only a
 * few levels up from the action, since further out the PR's own title is a heading too.
 */
function mergeBoxStatus() {
  const action = [...document.querySelectorAll("button")].find((button) =>
    MERGE_ACTION.test(button.textContent?.trim() ?? ""),
  );
  let el = action?.parentElement;
  for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
    const heading = el.querySelector("h2, h3, h4");
    if (!heading) continue;
    const status =
      heading.nextElementSibling ?? heading.parentElement?.nextElementSibling;
    return status && !status.contains(action ?? null) ? status : undefined;
  }
}

/** @type {HTMLButtonElement | undefined} */
let pullButton;

/**
 * Adds the button as a link at the end of the merge box's status line once it shows,
 * and floats it on <body> until then, or if GitHub changes their wording. It only goes
 * in next to nodes that already exist and never moves React's own: inserted among the
 * tabs before React had hydrated them, it blanked them. If React redraws the status
 * line and drops it, the next sync adds a new one. Follows GitHub's in-page navigation
 * between PRs.
 * @param {RegExpMatchArray | null} match
 */
function syncPull(match) {
  const pull = match && `/${match[1]}/${match[2]}/pull/${match[3]}`;
  if (
    pullButton &&
    (pullButton.dataset.pull !== pull || !pullButton.isConnected)
  ) {
    pullButton.remove();
    pullButton = undefined;
  }
  if (!match || !pull) return;
  if (pullButton?.classList.contains("ghci-link")) return;

  if (!pullButton) {
    const title = `${match[1]}/${match[2]} #${match[3]}`;
    pullButton = createButton("CI bottlenecks", () =>
      openBottlenecks(title, () => loadPull(pull)),
    );
    pullButton.dataset.pull = pull;
  }
  const status = mergeBoxStatus();
  pullButton.className = status
    ? "ghci-open ghci-link"
    : "ghci-open btn ghci-float";
  if (status) status.append(pullButton);
  else if (!pullButton.isConnected) document.body.append(pullButton);
}

function sync() {
  syncPull(location.pathname.match(PULL));
  const run = location.pathname.match(RUN_PAGE);
  if (run) syncRun(run);
}

export function setupBottlenecks() {
  chrome.storage.sync.get(VIEW_KEY).then((stored) => {
    currentView =
      VIEWS.find((view) => view === stored[VIEW_KEY]) ?? currentView;
  });

  // GitHub navigates without reloading and re-renders the graph as jobs update.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  sync();
}
