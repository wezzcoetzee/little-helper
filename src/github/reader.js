// @ts-check

import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import css from "./reader.css" with { type: "text" };

export function setupReader() {
  const MARKDOWN = /\.(md|markdown)$/i;
  const BLOB = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/;
  const PULL = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)/;

  /** @typedef {"added" | "changed"} Change */
  /** @typedef {Map<number, Change>} LineChanges keyed by 1-based line in the new file */

  /**
   * @typedef {object} FileDiff
   * @property {LineChanges} changes
   * @property {Map<number, string[]>} removed runs of removed lines, keyed by the new-file line they sat before
   * @property {boolean} created the PR adds the file, so every line is new and none are marked
   */

  /** @typedef {{ path: string, id: string, diff: FileDiff }} PullFile */

  /**
   * @typedef {object} Source
   * @property {string} title
   * @property {FileDiff} [diff] only for files in a PR
   * @property {() => Promise<{ raw: string, blob: string }>} locate raw URL to fetch, blob URL to resolve relative links against
   */

  /** @typedef {"diff" | "bars" | "off"} ChangesMode */
  /** @typedef {{ theme: "docs" | "editorial", changes: ChangesMode }} Settings */

  /** @type {Settings} */
  const DEFAULT_SETTINGS = { theme: "docs", changes: "diff" };
  /** @type {ChangesMode[]} */
  const CHANGES_MODES = ["diff", "bars", "off"];

  // ---------------------------------------------------------------------------
  // Fetching

  /** @param {string} url */
  async function fetchText(url) {
    const absolute = new URL(url, location.origin).href;
    const response = await chrome.runtime.sendMessage({
      type: "github:text",
      url: absolute,
    });
    if (typeof response?.text !== "string")
      throw new Error(response?.error ?? "Fetch failed");
    return /** @type {string} */ (response.text);
  }

  /**
   * Caches a load by key, forgetting failures so the next attempt retries.
   * @template T
   * @param {Map<string, Promise<T>>} cache
   * @param {string} key
   * @param {() => Promise<T>} load
   */
  function memo(cache, key, load) {
    let value = cache.get(key);
    if (!value) {
      value = load();
      cache.set(key, value);
      value.catch(() => cache.delete(key));
    }
    return value;
  }

  /** @type {Map<string, Promise<PullFile[]>>} */
  const pullFiles = new Map();
  /** @type {Map<string, Promise<string>>} */
  const pullHeads = new Map();

  /** @param {string} pull e.g. "/owner/repo/pull/12" */
  function loadPullFiles(pull) {
    return memo(pullFiles, pull, async () => {
      const files = parseDiff(await fetchText(`${pull}.diff`));
      return Promise.all(
        [...files].map(async ([path, diff]) => ({
          path,
          id: await diffId(path),
          diff,
        })),
      );
    });
  }

  /**
   * The .patch lists every commit in order, so the last one is the head.
   * @param {string} pull
   */
  function loadPullHead(pull) {
    return memo(pullHeads, pull, async () => {
      const patch = await fetchText(`${pull}.patch`);
      const head = [...patch.matchAll(/^From ([0-9a-f]{40}) /gm)].at(-1)?.[1];
      if (!head) throw new Error("No commits found");
      return head;
    });
  }

  /**
   * Lines each markdown file gained and lost in the PR. A "+" line paired with a
   * preceding "-" line is a change; an unpaired one is an addition.
   * @param {string} diff
   */
  function parseDiff(diff) {
    /** @type {Map<string, FileDiff>} */
    const files = new Map();
    /** @type {FileDiff | undefined} */
    let file;
    let inHeader = false;
    let created = false;
    let line = 0;
    let unpaired = 0;

    for (const text of diff.split("\n")) {
      if (text.startsWith("diff --git ")) {
        inHeader = true;
        created = false;
        file = undefined;
        continue;
      }
      if (inHeader) {
        if (text === "--- /dev/null") created = true;
        if (text.startsWith("+++ b/") && MARKDOWN.test(text)) {
          file = { changes: new Map(), removed: new Map(), created };
          files.set(text.slice(6), file);
        }
        if (!text.startsWith("@@")) continue;
        inHeader = false;
      }
      if (!file) continue;

      const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunk) {
        line = Number(hunk[1]);
        unpaired = 0;
      } else if (text[0] === "-") {
        const run = file.removed.get(line) ?? [];
        file.removed.set(line, run);
        run.push(text.slice(1));
        unpaired++;
      } else if (text[0] === "+") {
        file.changes.set(line++, unpaired > 0 ? "changed" : "added");
        if (unpaired > 0) unpaired--;
      } else if (text[0] === " ") {
        line++;
        unpaired = 0;
      }
    }
    return files;
  }

  /**
   * GitHub's anchor id for a file in a PR diff, in both the classic and React views.
   * @param {string} path
   */
  async function diffId(path) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(path),
    );
    return `diff-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  // ---------------------------------------------------------------------------
  // Rendering

  const markdown = new MarkdownIt({ html: true, linkify: true });

  // Placeholders like `<title>` or `<signal>` parse as tags. Raw-text tags (GFM's tagfilter)
  // would swallow the rest of the file, and unknown ones get stripped by DOMPurify, so both
  // are escaped to show as the literal text the author wrote.
  const RAW_TEXT_TAGS = new Set([
    "title",
    "textarea",
    "style",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "script",
    "plaintext",
  ]);
  const TAG_OPEN = /<(?=\/?([a-z][a-z0-9-]*)[\s/>])/gi;
  const LEADING_TAG = /^<\/?([a-z][a-z0-9-]*)[\s/>]/i;
  /** @param {string} name */
  const isPlaceholderTag = (name) =>
    RAW_TEXT_TAGS.has(name.toLowerCase()) ||
    document.createElement(name) instanceof HTMLUnknownElement;
  /** @param {string} html */
  const escapePlaceholders = (html) =>
    html.replace(TAG_OPEN, (open, name) =>
      isPlaceholderTag(name) ? "&lt;" : open,
    );

  // A line opening with a placeholder like `<Added after the intent is merged.>` is a valid
  // tag, so it would start an HTML block and swallow the lines under it as raw HTML. It's
  // prose, so it's left to parse as a paragraph instead.
  const htmlBlock = markdown.block.ruler.__rules__.find(
    (rule) => rule.name === "html_block",
  )?.fn;
  if (htmlBlock) {
    markdown.block.ruler.at(
      "html_block",
      (state, startLine, endLine, silent) => {
        const start = state.bMarks[startLine] + state.tShift[startLine];
        const tag = state.src
          .slice(start, state.eMarks[startLine])
          .match(LEADING_TAG)?.[1];
        return (
          !(tag && isPlaceholderTag(tag)) &&
          htmlBlock(state, startLine, endLine, silent)
        );
      },
    );
  }

  markdown.renderer.rules.html_inline = (tokens, index) =>
    escapePlaceholders(tokens[index].content);
  // Raw HTML has no tag of markdown-it's own to hold attributes, so the change markers go
  // on the block's first element.
  markdown.renderer.rules.html_block = (tokens, index, options, env, self) => {
    const html = escapePlaceholders(tokens[index].content);
    const attrs = self.renderAttrs(tokens[index]);
    return attrs
      ? html.replace(/^\s*<[a-z][a-z0-9-]*/i, (open) => open + attrs)
      : html;
  };

  /** @param {string} html */
  function sanitize(html) {
    return DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ["style"],
    });
  }

  /**
   * Front matter is metadata, not content. It's blanked rather than cut so line numbers
   * still line up with the PR diff.
   * @param {string} text
   */
  function blankFrontMatter(text) {
    const frontMatter = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0];
    return frontMatter
      ? frontMatter.replace(/[^\n]/g, "") + text.slice(frontMatter.length)
      : text;
  }

  /**
   * @param {string} text
   * @param {Source} source
   * @param {string} blob
   */
  function render(text, source, blob) {
    const tokens = markdown.parse(blankFrontMatter(text), {});
    const plan =
      source.diff &&
      !source.diff.created &&
      planChanges(tokens, text.split("\n"), source.diff);
    const fragment = sanitize(
      markdown.renderer.render(tokens, markdown.options, {}),
    );

    // Before the changes go in, so deleted words stay out of the ids and titles.
    /** @type {Map<string, number>} */
    const slugs = new Map();
    for (const heading of fragment.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      if (!(heading instanceof HTMLElement)) continue;
      heading.id = uniqueSlug(heading.textContent ?? "", slugs);
      heading.dataset.title = heading.textContent?.replace(/\s+/g, " ").trim();
    }
    if (plan) applyChanges(fragment, plan);

    for (const img of fragment.querySelectorAll("img[src]")) {
      if (!(img instanceof HTMLImageElement)) continue;
      const url = new URL(img.getAttribute("src") ?? "", blob);
      // Relative images resolve to a blob page; the raw URL is the image itself.
      if (url.origin === location.origin) {
        url.pathname = url.pathname.replace(
          /^(\/[^/]+\/[^/]+)\/blob\//,
          "$1/raw/",
        );
      }
      img.src = url.href;
    }
    for (const link of fragment.querySelectorAll("a[href]")) {
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.getAttribute("href")?.startsWith("#")
      )
        continue;
      link.href = new URL(link.getAttribute("href") ?? "", blob).href;
      link.target = "_blank";
      link.rel = "noopener";
    }
    return fragment;
  }

  // ---------------------------------------------------------------------------
  // Changes

  /** @typedef {import("markdown-it").Token} Token */

  /**
   * A top-level block, list item or table row: what changes are marked on, so one edit
   * doesn't flag a whole list or table. Lines are 1-based and inclusive.
   * @typedef {{ id: number, token: Token, kind: "block" | "item" | "row", start: number, end: number, table?: Token }} Unit
   */

  /**
   * @typedef {object} ChangePlan
   * @property {string[]} oldLines the file before the PR
   * @property {{ unit: Unit, olds: Unit[] }[]} edits changed units in the new file, with the old units they replace
   * @property {{ unit: Unit, anchor?: Unit, after: boolean, inline: boolean }[]} removals old units that are gone; inline ones go next to an item or row of their own kind
   */

  /** @param {Token[]} tokens */
  function findUnits(tokens) {
    /** @type {Unit[]} */
    const units = [];
    /** @type {Token | undefined} */
    let table;
    for (const token of tokens) {
      if (token.type === "table_open") table = token;
      if (!token.map || token.nesting === -1) continue;
      const kind =
        token.level === 0 &&
        !/^(bullet_list|ordered_list|table)_open$/.test(token.type)
          ? "block"
          : token.type === "list_item_open" && token.level === 1
            ? "item"
            : token.type === "tr_open" && token.level === 2
              ? "row"
              : undefined;
      if (kind)
        units.push({
          id: units.length,
          token,
          kind,
          start: token.map[0] + 1,
          end: token.map[1],
          table,
        });
    }
    return units;
  }

  /**
   * Rebuilds the file as it was before the PR, mapping each old line to the new line it
   * became. Removed lines map to the added lines they were paired with, if any.
   * @param {string[]} lines
   * @param {FileDiff} diff
   */
  function oldVersion(lines, { changes, removed }) {
    /** @type {string[]} */
    const old = [];
    /** @type {Map<number, number>} */
    const toNew = new Map();
    for (let line = 1; line <= lines.length + 1; line++) {
      for (const [i, text] of (removed.get(line) ?? []).entries()) {
        old.push(text);
        if (changes.get(line + i) === "changed")
          toNew.set(old.length, line + i);
      }
      if (line <= lines.length && !changes.has(line)) {
        old.push(lines[line - 1]);
        toNew.set(old.length, line);
      }
    }
    return { old, toNew };
  }

  /**
   * Matches the old file's units to the new file's through the lines they share, to find
   * what each changed unit replaced and which old units were removed outright. Tags the
   * new tokens so the rendered elements can be found again.
   * @param {Token[]} tokens
   * @param {string[]} lines
   * @param {FileDiff} diff
   * @returns {ChangePlan}
   */
  function planChanges(tokens, lines, diff) {
    const { old: oldLines, toNew } = oldVersion(lines, diff);
    const units = findUnits(tokens);
    const oldUnits = findUnits(
      markdown.parse(blankFrontMatter(oldLines.join("\n")), {}),
    );
    const containing = (/** @type {number} */ line) =>
      units.find((unit) => unit.start <= line && line <= unit.end);

    /** @type {Map<Unit, Change>} */
    const changed = new Map();
    for (const unit of units) {
      /** @type {Change | undefined} */
      let change;
      for (
        let line = unit.start;
        line <= unit.end && change !== "changed";
        line++
      ) {
        change = diff.changes.get(line) ?? change;
      }
      if (change) changed.set(unit, change);
    }

    /** The new line nearest an old one, searching from it in one direction. */
    const nearest = (
      /** @type {number} */ from,
      /** @type {1 | -1} */ step,
    ) => {
      for (
        let line = from;
        line >= 1 && line <= oldLines.length;
        line += step
      ) {
        const target = toNew.get(line);
        if (target !== undefined) return target;
      }
    };

    /** @type {Map<Unit, Unit[]>} */
    const olds = new Map();
    /** @type {ChangePlan["removals"]} */
    const removals = [];
    for (const oldUnit of oldUnits) {
      /** @type {Set<Unit>} */
      const counterparts = new Set();
      let lostText = false;
      for (let line = oldUnit.start; line <= oldUnit.end; line++) {
        // Blank lines say nothing about where text went, and a list item's trailing one
        // can land in a different item.
        if (oldLines[line - 1].trim() === "") continue;
        const target = toNew.get(line);
        const unit = target === undefined ? undefined : containing(target);
        if (unit) counterparts.add(unit);
        lostText ||= target === undefined;
      }
      for (const unit of counterparts) {
        olds.set(unit, [...(olds.get(unit) ?? []), oldUnit]);
        // A unit that only lost lines has nothing marked "+" in the diff.
        if (lostText && !changed.has(unit)) changed.set(unit, "changed");
      }
      if (counterparts.size) continue;

      const nextLine = nearest(oldUnit.end + 1, 1);
      const prevLine = nearest(oldUnit.start - 1, -1);
      const next =
        nextLine === undefined
          ? undefined
          : units.find((unit) => unit.end >= nextLine);
      const prev =
        prevLine === undefined
          ? undefined
          : units.findLast((unit) => unit.start <= prevLine);
      const sameKind = (/** @type {Unit | undefined} */ unit) =>
        oldUnit.kind !== "block" && unit?.kind === oldUnit.kind;
      removals.push(
        sameKind(next)
          ? { unit: oldUnit, anchor: next, after: false, inline: true }
          : sameKind(prev)
            ? { unit: oldUnit, anchor: prev, after: true, inline: true }
            : next
              ? { unit: oldUnit, anchor: next, after: false, inline: false }
              : { unit: oldUnit, anchor: prev, after: true, inline: false },
      );
    }

    for (const [unit, change] of changed) {
      unit.token.attrSet("data-change", change);
      unit.token.attrSet("data-unit", String(unit.id));
    }
    for (const { anchor } of removals)
      anchor?.token.attrSet("data-unit", String(anchor.id));
    return {
      oldLines,
      edits: [...changed.keys()].map((unit) => ({
        unit,
        olds: olds.get(unit) ?? [],
      })),
      removals,
    };
  }

  /**
   * Renders one unit of the old file on its own. A row needs its table's header to parse.
   * @param {Unit} unit
   * @param {string[]} lines
   */
  function renderUnit({ kind, start, end, table }, lines) {
    const source = lines.slice(start - 1, end);
    if (kind === "row" && table?.map)
      source.unshift(...lines.slice(table.map[0], table.map[0] + 2));
    const fragment = sanitize(markdown.render(source.join("\n")));
    const element =
      kind === "item"
        ? fragment.querySelector("li")
        : kind === "row"
          ? [...fragment.querySelectorAll("tr")].at(-1)
          : undefined;
    return { fragment, element: element ?? undefined };
  }

  /**
   * Marks the words each changed unit gained and lost, and puts removed units back in.
   * Everything stays in the DOM; CSS shows what the current changes mode wants.
   * @param {DocumentFragment} fragment
   * @param {ChangePlan} plan
   */
  function applyChanges(fragment, { oldLines, edits, removals }) {
    const find = (/** @type {Unit | undefined} */ unit) =>
      unit && fragment.querySelector(`[data-unit="${unit.id}"]`);

    for (const { unit, olds } of edits) {
      const element = find(unit);
      // Diff marks inside a diagram's source would break the diagram.
      if (!element || element.matches("code.language-mermaid")) continue;
      const before = olds.flatMap((old) => {
        const { fragment, element } = renderUnit(old, oldLines);
        return words(element ?? fragment);
      });
      markWords(element, before);
    }

    /** @type {Map<Element, Element>} the last removal put after each anchor, to keep their order */
    const placed = new Map();
    for (const { unit, anchor, after, inline } of removals) {
      const rendered = renderUnit(unit, oldLines);
      const removal =
        inline && rendered.element
          ? rendered.element
          : document.createElement("div");
      if (removal !== rendered.element) removal.append(rendered.fragment);
      removal.setAttribute("data-change", "removed");

      let target = find(anchor);
      if (target && !inline) target = topLevel(target, fragment);
      if (!target) {
        fragment.append(removal);
      } else if (after) {
        (placed.get(target) ?? target).after(removal);
        placed.set(target, removal);
      } else {
        target.before(removal);
      }
    }

    for (const element of fragment.querySelectorAll("[data-unit]"))
      element.removeAttribute("data-unit");
  }

  /**
   * @param {Element} element
   * @param {Node} root
   */
  function topLevel(element, root) {
    let top = element;
    while (top.parentElement && top.parentNode !== root)
      top = top.parentElement;
    return top;
  }

  /**
   * A word or run of punctuation, split apart so "errors." still matches "errors".
   * `spaced` is whether whitespace came before it.
   * @typedef {{ node: Text, start: number, end: number, text: string, spaced: boolean }} Word
   */

  /** @param {Node} root */
  function words(root) {
    /** @type {Word[]} */
    const found = [];
    let previous = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (const match of text.matchAll(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu)) {
        const start = match.index;
        const spaced = /\s/.test(start > 0 ? text[start - 1] : previous);
        found.push({
          node: /** @type {Text} */ (node),
          start,
          end: start + match[0].length,
          text: match[0],
          spaced,
        });
      }
      previous = text.at(-1) ?? previous;
    }
    return found;
  }

  /**
   * Longest-common-subsequence diff of two word lists, after trimming their shared ends.
   * Returns the indexes of inserted words in `after`, and the indexes of deleted words in
   * `before` keyed by the index in `after` they sat before. Edits too long for the table
   * count as one replacement.
   * @param {string[]} before
   * @param {string[]} after
   */
  function diffWords(before, after) {
    let start = 0;
    while (
      start < before.length &&
      start < after.length &&
      before[start] === after[start]
    )
      start++;
    // Trimming the end too can pull an addition's last word onto an earlier match, like
    // the ";" of a new code line, so it's only done when the table would be too big.
    let endBefore = before.length;
    let endAfter = after.length;
    while (
      (endBefore - start) * (endAfter - start) > 250_000 &&
      endBefore > start &&
      endAfter > start &&
      before[endBefore - 1] === after[endAfter - 1]
    ) {
      endBefore--;
      endAfter--;
    }
    const a = before.slice(start, endBefore);
    const b = after.slice(start, endAfter);

    // lcs[i * width + j] is the LCS length of a[i:] and b[j:]; it's at most 500 here.
    const small = a.length * b.length <= 250_000;
    const width = b.length + 1;
    const lcs = new Uint16Array(small ? (a.length + 1) * width : 0);
    if (small) {
      for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
          lcs[i * width + j] =
            a[i] === b[j]
              ? lcs[(i + 1) * width + j + 1] + 1
              : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
        }
      }
    }

    /** @type {Set<number>} */
    const inserted = new Set();
    /** @type {Map<number, number[]>} */
    const deleted = new Map();
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (small && i < a.length && j < b.length && a[i] === b[j]) {
        i++;
        j++;
      } else if (
        j >= b.length ||
        (i < a.length &&
          (!small || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]))
      ) {
        const run = deleted.get(start + j) ?? [];
        deleted.set(start + j, run);
        run.push(start + i++);
      } else {
        inserted.add(start + j++);
      }
    }
    return { inserted, deleted };
  }

  /**
   * Wraps inserted words in <ins> and puts deleted ones back in <del>, inside the existing
   * text nodes so the unit keeps its formatting.
   * @param {Element} element
   * @param {Word[]} before
   */
  function markWords(element, before) {
    const after = words(element);
    const { inserted, deleted } = diffWords(
      before.map((word) => word.text),
      after.map((word) => word.text),
    );
    const mark = (
      /** @type {"ins" | "del"} */ tag,
      /** @type {string} */ text,
    ) =>
      Object.assign(document.createElement(tag), {
        className: "diff",
        textContent: text,
      });

    // Collected in document order, then applied backwards so splitting a text node never
    // moves an offset still to come.
    /** @type {(() => void)[]} */
    const edits = [];
    for (let i = 0; i <= after.length; i++) {
      const gone = deleted.get(i)?.map((index) => before[index]);
      if (gone) {
        // Rebuilt with the old spacing, which lives inside <del> so it hides with it. It
        // goes after the previous word when that's in the same text, or before
        // punctuation, so "errors" + " now" + "." reads right; otherwise before the next
        // word, so it stays in the next word's table cell.
        const text = gone
          .map((word, k) => (k && word.spaced ? " " : "") + word.text)
          .join("");
        const previous = after[i - 1];
        const next = after[i];
        if (
          previous &&
          (!next ||
            next.node === previous.node ||
            !/^[\p{L}\p{N}_]/u.test(next.text))
        ) {
          const del = mark("del", (gone[0].spaced ? " " : "") + text);
          edits.push(() => previous.node.splitText(previous.end).before(del));
        } else if (next) {
          const del = mark("del", `${text} `);
          edits.push(() => next.node.splitText(next.start).before(del));
        } else {
          edits.push(() => element.append(mark("del", text)));
        }
      }
      if (!inserted.has(i)) continue;

      let last = i;
      while (
        inserted.has(last + 1) &&
        !deleted.has(last + 1) &&
        after[last + 1].node === after[i].node
      )
        last++;
      const { node, start } = after[i];
      const { end } = after[last];
      edits.push(() => {
        const text = node.splitText(start);
        text.splitText(end - start);
        const ins = mark("ins", "");
        text.replaceWith(ins);
        ins.append(text);
      });
      i = last;
    }
    for (const edit of edits.reverse()) edit();
  }

  /** @type {Promise<typeof import("./diagrams.js")> | undefined} */
  let diagrams;

  /**
   * Swaps mermaid code blocks for their diagrams, leaving the code with the error
   * under it when one doesn't parse.
   * @param {Element} doc
   */
  async function renderDiagrams(doc) {
    const blocks = [...doc.querySelectorAll("pre > code.language-mermaid")];
    if (!blocks.length) return;
    diagrams ??= import(chrome.runtime.getURL("github-diagrams/diagrams.js"));
    const { renderDiagram } = await diagrams;

    for (const code of blocks) {
      const pre = /** @type {HTMLElement} */ (code.parentElement);
      try {
        const figure = document.createElement("figure");
        figure.className = "diagram";
        figure.innerHTML = await renderDiagram(code.textContent ?? "");
        const change = code.getAttribute("data-change");
        if (change) figure.setAttribute("data-change", change);
        pre.replaceWith(figure);
      } catch (error) {
        const message = document.createElement("p");
        message.className = "diagram-error";
        message.textContent = `Diagram error: ${error instanceof Error ? error.message : error}`;
        pre.after(message);
      }
    }
  }

  /**
   * GitHub's heading anchors: lowercased, punctuation dropped, spaces to dashes, with
   * -1, -2 suffixes for repeats.
   * @param {string} text
   * @param {Map<string, number>} seen
   */
  function uniqueSlug(text, seen) {
    const slug = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  }

  // ---------------------------------------------------------------------------
  // Dialog

  /** @type {ReturnType<typeof createReader> | undefined} */
  let reader;

  function getReader() {
    // Turbo navigation can swap out <body>, taking the host with it.
    if (!reader?.host.isConnected) reader = createReader();
    return reader;
  }

  /**
   * Lives in a shadow root so GitHub's markdown styles don't leak in, and ours don't
   * leak out.
   */
  function createReader() {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
    <style>${css}</style>
    <dialog tabindex="-1">
      <header class="bar">
        <span class="title"></span>
        <span class="summary"></span>
        <span class="switch">
          <button type="button" data-theme-option="editorial">editorial</button>
          <button type="button" data-theme-option="docs">docs</button>
          <kbd>v</kbd>
        </span>
        <span class="switch changes">
          ${CHANGES_MODES.map((mode) => `<button type="button" data-changes-option="${mode}">${mode}</button>`).join("")}
          <kbd>x</kbd>
        </span>
        <button type="button" class="close">esc</button>
      </header>
      <div class="scroll">
        <nav class="toc"></nav>
        <article class="doc"></article>
      </div>
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
      changes: find(".changes"),
      scroll: find(".scroll"),
      toc: find(".toc"),
      doc: find(".doc"),
    };

    for (const option of root.querySelectorAll(
      "[data-theme-option], [data-changes-option]",
    )) {
      if (!(option instanceof HTMLElement)) continue;
      const { themeOption, changesOption } = option.dataset;
      option.addEventListener("click", () =>
        updateSettings(
          themeOption
            ? { theme: /** @type {Settings["theme"]} */ (themeOption) }
            : { changes: /** @type {ChangesMode} */ (changesOption) },
        ),
      );
    }
    find(".close").addEventListener("click", () => parts.dialog.close());

    parts.dialog.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = KEY_ACTIONS[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });

    // In-page anchors, in the document and the table of contents, scroll within the
    // dialog instead of navigating the page.
    parts.scroll.addEventListener("click", (event) => {
      const link =
        event.target instanceof Element && event.target.closest('a[href^="#"]');
      if (!link) return;
      event.preventDefault();
      const id = decodeURIComponent(link.getAttribute("href")?.slice(1) ?? "");
      root.getElementById(id.replace(/^user-content-/, ""))?.scrollIntoView();
    });

    parts.scroll.addEventListener("scroll", highlightToc, { passive: true });
    return parts;
  }

  /** @type {Record<string, () => void>} */
  const KEY_ACTIONS = {
    v: toggleTheme,
    x: toggleChanges,
    n: nextChange,
  };

  /** @type {Settings} */
  let settings = DEFAULT_SETTINGS;
  chrome.storage.sync.get("github_reader").then((stored) => {
    const saved = stored.github_reader;
    if (!saved || typeof saved !== "object") return;
    if (
      "theme" in saved &&
      (saved.theme === "docs" || saved.theme === "editorial")
    )
      settings.theme = saved.theme;
    if (
      "changes" in saved &&
      (saved.changes === "diff" ||
        saved.changes === "bars" ||
        saved.changes === "off")
    )
      settings.changes = saved.changes;
  });

  /**
   * Keeps the block at the top of the view in place, since the themes reflow the text
   * and the diff mode shows removed blocks.
   * @param {Partial<Settings>} update
   */
  function updateSettings(update) {
    const { doc, scroll } = getReader();
    const top = scroll.getBoundingClientRect().top;
    const anchor = [...doc.children].find(
      (el) => el.getBoundingClientRect().bottom > top,
    );
    settings = { ...settings, ...update };
    chrome.storage.sync.set({ github_reader: settings });
    applySettings();
    if (scroll.scrollTop > 0) anchor?.scrollIntoView({ block: "start" });
  }

  function toggleTheme() {
    updateSettings({ theme: settings.theme === "docs" ? "editorial" : "docs" });
  }

  /** Cycles diff, bars, off. */
  function toggleChanges() {
    if (getReader().changes.hidden) return;
    const index = CHANGES_MODES.indexOf(settings.changes);
    updateSettings({
      changes: CHANGES_MODES[(index + 1) % CHANGES_MODES.length],
    });
  }

  function applySettings() {
    const { dialog, root, changes } = getReader();
    dialog.dataset.theme = settings.theme;
    dialog.dataset.changes = changes.hidden ? "off" : settings.changes;
    for (const option of root.querySelectorAll(
      "[data-theme-option], [data-changes-option]",
    )) {
      if (!(option instanceof HTMLElement)) continue;
      const { themeOption, changesOption } = option.dataset;
      option.ariaPressed = String(
        themeOption === settings.theme || changesOption === settings.changes,
      );
    }
  }

  /** Fenced code puts the marker on <code>; the visible block is its <pre>. */
  function changedBlocks() {
    return [...getReader().doc.querySelectorAll("[data-change]")].map(
      (el) => el.closest("pre") ?? el,
    );
  }

  function nextChange() {
    if (settings.changes === "off") return;
    const { scroll } = getReader();
    const top = scroll.getBoundingClientRect().top + 1;
    // Removed blocks are hidden outside the diff mode.
    const blocks = changedBlocks().filter((el) => el.getClientRects().length);
    const next =
      blocks.find((el) => el.getBoundingClientRect().top > top + 40) ??
      blocks[0];
    next?.scrollIntoView({ block: "start" });
  }

  /**
   * The headings the table of contents lists, leaving out ones the PR removed.
   * @param {Element} doc
   */
  function tocHeadings(doc) {
    return [...doc.querySelectorAll("h2, h3")].filter(
      /** @returns {heading is HTMLElement} */
      (heading) =>
        heading instanceof HTMLElement &&
        !heading.closest('[data-change="removed"]'),
    );
  }

  function buildToc() {
    const { doc, toc } = getReader();
    toc.replaceChildren(
      ...tocHeadings(doc).map((heading) => {
        const link = document.createElement("a");
        link.href = `#${heading.id}`;
        link.textContent = heading.dataset.title ?? "";
        link.className = heading.localName;
        return link;
      }),
    );
  }

  /** Marks the last heading scrolled past as current. */
  function highlightToc() {
    const { doc, toc, scroll } = getReader();
    const line = scroll.getBoundingClientRect().top + 80;
    const headings = tocHeadings(doc);
    const current =
      headings.findLast((h) => h.getBoundingClientRect().top <= line) ??
      headings[0];
    for (const link of toc.children) {
      link.toggleAttribute(
        "aria-current",
        link.getAttribute("href") === `#${current?.id}`,
      );
    }
  }

  let openCount = 0;

  /** @param {Source} source */
  async function openReader(source) {
    const parts = getReader();
    const opened = ++openCount;
    parts.title.textContent = source.title;
    parts.summary.textContent = "";
    parts.changes.hidden = !source.diff;
    parts.doc.textContent = "Loading…";
    parts.toc.replaceChildren();
    applySettings();
    parts.dialog.showModal();
    parts.dialog.focus();
    parts.scroll.scrollTop = 0;

    try {
      const { raw, blob } = await source.locate();
      const text = await fetchText(raw);
      if (opened !== openCount) return;
      parts.doc.replaceChildren(render(text, source, blob));
    } catch (error) {
      if (opened !== openCount) return;
      parts.doc.textContent = `Couldn't load ${source.title}: ${error instanceof Error ? error.message : error}`;
      return;
    }

    buildToc();
    highlightToc();
    const changed = changedBlocks().length;
    parts.changes.hidden = changed === 0;
    if (source.diff?.created) parts.summary.textContent = "new file";
    else if (changed)
      parts.summary.textContent = `${changed} changed ${changed === 1 ? "block" : "blocks"} · n next`;
    applySettings();
    renderDiagrams(parts.doc);
  }

  // ---------------------------------------------------------------------------
  // Buttons on GitHub's pages

  /**
   * @param {Element} target
   * @param {"beforebegin" | "afterend"} position
   * @param {() => Source} source
   */
  function addButton(target, position, source) {
    const sibling =
      position === "afterend"
        ? target.nextElementSibling
        : target.previousElementSibling;
    if (sibling?.classList.contains("ghmd-read")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghmd-read btn btn-sm";
    button.textContent = "Read";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openReader(source());
    });
    target.insertAdjacentElement(position, button);
  }

  /** Strips whitespace and the invisible direction marks GitHub puts in file paths. */
  function normalize(/** @type {string} */ text) {
    return text.replace(/[\s​-‏⁠]/g, "");
  }

  /**
   * Finds the element showing a file's path in a PR file header, without relying on
   * GitHub's class names, which differ between the classic and React views.
   * @param {Element} container
   * @param {string} path
   */
  function findPathLabel(container, path) {
    const fullPath = normalize(path);
    const name = normalize(path.split("/").at(-1) ?? path);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    // The header comes first; this stops it scanning a whole diff when there's no match.
    for (
      let i = 0, node = walker.nextNode();
      node && i < 200;
      i++, node = walker.nextNode()
    ) {
      if (!normalize(node.textContent ?? "").endsWith(name)) continue;
      for (
        let el = node.parentElement;
        el && el !== container;
        el = el.parentElement
      ) {
        if (normalize(el.textContent ?? "").endsWith(fullPath))
          return el.closest("a") ?? el;
      }
    }
  }

  /** @param {RegExpMatchArray} match */
  function syncBlob([, owner, repo, rest]) {
    const filePath = decodeURIComponent(rest);
    // Matched on its path rather than a test id; it's "/raw/refs/heads/main/…" for "/blob/main/…".
    const raw = [
      ...document.querySelectorAll(`a[href*="/${owner}/${repo}/raw/"]`),
    ].find(
      (link) =>
        link instanceof HTMLAnchorElement &&
        decodeURIComponent(link.pathname).endsWith(filePath),
    );
    if (!(raw instanceof HTMLAnchorElement)) return;
    addButton(raw, "beforebegin", () => ({
      title: `${owner}/${repo} · ${filePath}`,
      locate: async () => ({ raw: raw.href, blob: location.href }),
    }));
  }

  /** @param {RegExpMatchArray} match */
  async function syncPull([, owner, repo, number]) {
    const pull = `/${owner}/${repo}/pull/${number}`;
    const files = await loadPullFiles(pull).catch(() => []);
    for (const { path, id, diff } of files) {
      const anchor = document.getElementById(id);
      if (!anchor) continue;
      const label =
        findPathLabel(anchor, path) ??
        (anchor.parentElement && findPathLabel(anchor.parentElement, path));
      if (!label) continue;
      addButton(label, "afterend", () => ({
        title: `${owner}/${repo} · ${path} · #${number}`,
        diff,
        locate: async () => {
          const head = await loadPullHead(pull);
          const encoded = path.split("/").map(encodeURIComponent).join("/");
          return {
            raw: `/${owner}/${repo}/raw/${head}/${encoded}`,
            blob: `${location.origin}/${owner}/${repo}/blob/${head}/${encoded}`,
          };
        },
      }));
    }
  }

  function sync() {
    const blob = location.pathname.match(BLOB);
    if (blob && MARKDOWN.test(blob[3])) return syncBlob(blob);
    const pull = location.pathname.match(PULL);
    if (pull) syncPull(pull);
  }

  // GitHub re-renders file headers freely and navigates without reloading, so re-check
  // at most once a frame whenever the page changes.
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

  return {
    hasMarkdown: () => Boolean(findVisibleReadButton()),
    openVisible: () => {
      const button = findVisibleReadButton();
      if (button instanceof HTMLButtonElement) button.click();
      return Boolean(button);
    },
  };

  function findVisibleReadButton() {
    return [...document.querySelectorAll("button.ghmd-read")].find(
      (element) =>
        element instanceof HTMLButtonElement &&
        element.getClientRects().length > 0,
    );
  }
}
