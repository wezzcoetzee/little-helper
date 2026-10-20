# little-helper

One Chrome extension for page capture, GitHub reading and everyday browser tools. Built from GitHub Lightbox, SuperLevels and SnipSnapp, with a compact site-first toolbox and an original monochrome icon.

## Install

Requires Chrome 116 or newer and [Bun](https://bun.sh).

```sh
bun install --frozen-lockfile
bun run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's **`dist/`** folder.
3. Pin **little-helper** to the toolbar and reload existing website tabs.
4. Disable the original three extensions to avoid running their features twice.

The project root contains source files. Always load `dist/`, which contains the single combined manifest, scripts, dependencies and generated icons. Rebuild and reload the extension after updating it.

## Toolbox

- **This site:** Markdown clipping, relevant GitHub tools, dark mode, JavaScript, cookies, redirects, CSS and media actions.
- **Browser:** optional tab cleanup, excluded sites and recently auto-closed tabs.
- **All tools / Settings:** search and preferences for GitHub, YouTube/X focus, X dim palettes, JSON formatting and Google helpers.

Press `/` in the popup to search tools. Preferences save automatically except CSS and music credentials, which have explicit save buttons. Dark mode and custom CSS are per hostname; JavaScript settings apply to the current origin. Cookie dismissal, focus tools and formatting preferences apply across their supported sites. Reload open pages after changing global tool preferences.

### Page clipper

**Clip as Markdown** opens a side panel beside the active website:

- **Smart extract:** removes navigation and other surrounding content with Mozilla Readability.
- **Full page:** converts the page body into Markdown.
- **Pick element:** hover and click a page element; press Escape or Cancel to stop.
- Toggle YAML metadata, links and images; edit the output, copy it or download a `.md` file.
- Token counts are estimates using a GPT tokenizer, not guarantees for a particular model.

Right-click a page or selection to copy it as Markdown. **Alt+Shift+M** performs smart extraction to the clipboard. Configure the shortcut at `chrome://extensions/shortcuts`. If a site prevents clipboard access, open the page clipper and use **Copy Markdown**. Captures stay in the browser session and are scoped to their source tab and URL.

### GitHub

On `github.com` and `gist.github.com`, including private repositories:

- Open images and videos in a fullscreen lightbox; browse a page gallery, zoom and pan.
- Compare before/after images from a two-image table row.
- Copy, download or open the original media.
- Expand code, wide tables and GitHub's diagram dialogs.
- Read Markdown from the file browser or PR changed-files view, with word-level PR changes and locally rendered Mermaid diagrams.

| Where | Input | Action |
| --- | --- | --- |
| Lightbox | Left / right arrow | Previous / next media |
| Lightbox | Pinch or Ctrl+scroll | Zoom at cursor |
| Lightbox | Scroll / drag | Pan |
| Lightbox | Double-click | Reset zoom |
| Lightbox | `s` | Before/after comparison |
| Lightbox | `c` / `d` / `o` | Copy / download / open original |
| Reader | `v` | Docs / editorial style |
| Reader | `x` | Cycle word diff / change bars / off |
| Reader | `n` | Next changed block |
| Viewer or reader | Escape | Close |

Modifier-click and middle-click retain normal link behavior. Reader style and change-display preferences use Chrome sync storage; other settings remain local.

### Browser utilities

- **Cookies:** add, edit, delete and export current-site cookies, including SameSite, secure, HTTP-only, path and expiry. Bulk deletion asks inline before deleting. Store and partition information are preserved when editing existing cookies.
- **Redirects:** inspect captured HTTP redirect hops and status codes. Reload the site after installing to record a trace; an unrecorded response is not guessed as HTTP 200.
- **Dark mode:** optional filter-based dark mode, per-site override and brightness control.
- **JavaScript:** allow or block JavaScript for the current origin, then reload the tab.
- **Custom CSS:** preview, save and revert a stylesheet for the current hostname.
- **Focus:** remove YouTube/X feeds and recommendations; choose an X dim palette or custom hue.
- **Google helpers:** restore Maps links and View Image on supported Google search domains.
- **JSON formatter:** format raw JSON documents with collapsible structure, copy and raw views.
- **Picture in picture:** float a playing or largest video from the current page.
- **Tab cleanup:** starts **disabled**, with a 30-minute timeout when enabled. Protects active, pinned, audible, excluded and last-in-window tabs. Activity survives worker restarts. Up to 50 auto-closed tabs can be reopened; incognito URLs are excluded from history.
- **Music recognition:** opens a dedicated extension tab so recording survives closing the popup. Enter your own ACRCloud hostname, access key and secret there, then explicitly choose **Listen for 10 seconds**. Audio is sent to that ACRCloud host; cancel stops recording or the request. Recent matches link to YouTube search.

## Privacy and permissions

No backend, analytics or telemetry. Page conversion, token counting, media viewing and custom styles run locally. Settings and histories stay in your Chrome profile, except reader preferences synced by Chrome. Music credentials are local to the profile and are excluded from preference exports. Music identification is the only feature that uploads a recording, and only after pressing Listen. GitHub's reader and media tools fetch the requested files/images using your existing GitHub session.

| Permission | Purpose |
| --- | --- |
| HTTP/HTTPS host access | Run site tools and clipper, read current-site cookies, fetch requested GitHub assets and contact your configured ACRCloud host |
| `activeTab`, `tabs`, `scripting` | Access the active website, clipboard shortcuts, PiP and tab management |
| `storage` | Local preferences, session captures/activity/traces, synced reader preferences |
| `alarms` | Check enabled tab cleanup once per minute |
| `cookies` | Current-site cookie editor |
| `webRequest`, `webNavigation` | Observe main-frame navigation redirects |
| `contentSettings` | Per-origin JavaScript settings |
| `downloads` | Save GitHub media |
| `contextMenus`, `sidePanel`, `clipboardWrite` | Markdown capture menus, panel and clipboard |
| `tabCapture` | User-initiated music recording |

Cookie dismissal clicks known reject controls where supported and hides remaining known banners. Hiding a banner does not itself record a consent decision. Turn the feature off if it interferes with a site.

Chrome's internal pages, Chrome Web Store pages and other protected pages cannot be captured or modified. Browser-controlled capabilities such as tab audio capture, native side-panel opening and PiP require an unpacked Chrome verification; previewing the UI over HTTP cannot exercise them. Existing settings in the three separately installed extensions are not automatically migrated because each extension has its own storage identity.

## Development

```sh
bun install --frozen-lockfile
bun run dev          # Rebuild when source changes; reload in chrome://extensions
bun run format:check # Check source formatting
bun run typecheck    # Strict TypeScript and retained GitHub checkJs source
bun run test         # Focused conversion, lifecycle, cookie and settings regressions
bun run build        # Generate dist/ from source, including PNG icon sizes
bun run check:build  # Check packaged entrypoints, CSS, icons and Mermaid chunks
```

CI runs typechecking, tests, build and package validation. Dependencies are bundled locally; no CDN script loading. `dist/`, `node_modules/` and temporary files are ignored by Git. The original reference checkouts are no longer needed; all extension sources and upstream notices are included in this repository.

```text
manifest.json          Single Manifest V3 configuration
public/                Popup, side panel, music page and source icon
src/background/        Shared worker startup
src/browser/           Site enhancements, tab cleanup and redirect tracing
src/github/            Media viewer, reader and lazy diagram rendering
src/clipper/           Capture, HTML conversion, picker and messaging
src/ui/                Site toolbox and editing interfaces
scripts/               Bun build and package validation
licenses/              Preserved upstream notices
```

## Credits and license

MIT. Browser utility code is adapted from [SuperLevels by @levelsio](https://github.com/levelsio/superlevels), with its [MIT notice](licenses/SuperLevels-MIT.txt) retained. Markdown clipping is adapted from [SnipSnapp](https://github.com/wezzcoetzee/snipsnapp); GitHub media and reading tools come from the supplied GitHub Lightbox source. The new little-helper icon uses an original `l` and plus mark, not the GitHub logo. The build includes dependency license texts in `dist/third-party-notices.txt`.
