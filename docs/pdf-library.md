# Reading: focused PDF homework with private Git workspaces

Manny chose Git as the actual storage medium on October 1, 2026, replacing the
unfinished direct-Drive setup. Static MegaApp remains on GitHub Pages. The separate
private `MannyFluss/MegaApp-library` repository holds complete original PDF bytes
and small metadata files. No new backend, Google API, cloud runtime, Git LFS, or
OAuth app registration is required for this prototype. Existing Google resources
remain unused; cleanup is a separate decision in `cloud-scope-correction.md`.

## Connect and try two devices

1. Open https://mannyfluss.github.io/MegaApp-pages/#reading.
2. Follow the in-app [key and storage guide](../reading/git-guide.html). Create a
   fine-grained GitHub key restricted to **Only select repositories →
   MegaApp-library**, with **Contents read/write** and a sensible expiry. Metadata
   read is automatic; do not add workflow or account permissions.
3. Paste the key in **Repository key**, then **Connect library**. The app clears
   the input and keeps access only in memory for at most one hour.
4. Open the document menu, add a PDF, and write on it or in the surrounding blank
   scratch space. Work autosaves locally. **Sync** verifies/uploads the original
   PDF and commits the complete editable workspace.
5. On another device, connect the same repository, **Refresh library**, and select
   its workspace to download and cache it. **Sync** explicitly pulls later changes.
   **Export PDF** includes your marks inside the original page boundaries.

## Read, write, and return

The active PDF owns the screen. A compact tool strip provides Pen, freehand
Highlight, partial Eraser, Move, and Undo/Redo. Pencil draws while fingers pan and
pinch; enable finger drawing explicitly when needed. Mouse input follows the
selected tool. Color/size options appear for the chosen drawing tool.

Original pages form a vertical stack. Their outlines separate printed paper from
the surrounding blank scratch area. Export keeps original page sizes, order,
source text and graphics, adding transparent ink only inside each page. A stroke
crossing an outline prints only its inside portion; scratch remains editable in
the workspace. Erasing removes your own ink, never the imported PDF.

The document menu holds library/setup, Sync, exports, and New copy. Importing the
same PDF resumes its existing work by default; New copy creates a separate clean
attempt. Editable JSON export backs up the complete drawing and view state.

Opening the app again restores the last app; opening Reading restores its current
document, marks, scratch, tool, undo/redo history and viewing position. The shared
shell stays hidden until Meta is summoned using its button, **Cmd/Ctrl+Shift+M**,
or a leftward swipe starting just inside the right edge. System settings, app
switching and updates live in Meta. AI and submission-page composition are deferred.

The repository link alone grants no access. Generate keys yourself and keep them
in a password manager for reconnecting. Reload/disconnect forgets the session
key. Revoking a key in GitHub ends its access everywhere. The reader accepts only
fine-grained `github_pat_` keys, not broad classic tokens. Read-only keys may read
papers but cannot upload; GitHub enforces token permissions and branch rules.

## Environment location vs assets vs secrets

`src/reading-config.js` provides this public default:

```
MEGAAPP_ASSET_REPOSITORY=https://github.com/MannyFluss/MegaApp-library
```

Reading seeds the same **string variable** in the existing State lab. Its public
location travels with State JSON export/import. Change it in State, then open
Reading, or save it in Reading's repository setup. Changing the location ends the
connection. This is a browser configuration variable, not a server process env
var or a new production environment schema. No key is stored by Reading in State,
localStorage, IndexedDB, service-worker caches, source, commits, or exports.

Cached PDF bytes and complete editable workspace state live in the existing isolated
`megaapp-reading-assets-v1` IndexedDB database, separately from ordinary State.
The previous local sample/imports are preserved across the provider switch.
Last-opened ID is a small localStorage reference. GitHub identity binds uploads
and cached remote versions to a stable repository ID. Cached papers remain
readable when disconnected; browser-profile users can access these local copies.

## Repository format and synchronization

```
papers/<SHA-256>.pdf
library/<SHA-256>.json
workspaces/<workspace-UUID>.json
```

Each metadata record contains exactly the portable fields `version: 1`, `hash`,
`path`, original `name`, and byte `size`. Git's own SHA-1 blob identifiers identify
immutable versions returned by the API; SHA-256 separately checks PDF bytes.
PDFs are ordinary Git blobs, not pointers to another storage service.

Workspace records contain `version: 1`, `id`, `pdfHash`, `name`, and `workspace`.
The workspace contains plain stroke/eraser operations, an undo cursor, tool state,
viewport and timestamp. Coordinates are displayed PDF points at scale 1, with a
fixed page stack independent of screen size. Multiple workspace UUIDs can share
one immutable original PDF. Tokens are excluded from all these records.

`src/reading-git.js` uses GitHub's REST Git database API. Upload creates the PDF
blob, adds PDF and metadata in one tree based on the current head, makes a commit
with that head as its sole parent, and updates the branch with `force: false`.
Concurrent writers retry up to four times using the new head/tree, preserving all
unrelated paths. No global index has to be overwritten. Identical bytes share a
path; the first original name is retained. Repeated uploads and lost confirmations
verify the existing file rather than adding another copy/commit. Failed attempts
may leave unreferenced Git objects; cached originals remain intact.

Listing uses a consistent commit/tree snapshot and bounded metadata downloads.
Malformed metadata, symlinks, inconsistent sizes/paths, truncated trees, or
changed PDF hashes fail visibly instead of silently claiming a complete library.
Downloads fetch raw Git blobs by immutable SHA, check size, PDF header, and hash
before entering the cache. External removal preserves cached originals. The app
adds/verifies original papers and never replaces or deletes them. Editable
workspace JSON is updated through non-forced commits with a checked baseline.

Sync is explicit and foreground. iPadOS suspension or a closed app does not
continue uploads. Autosave is local; no implicit cloud write occurs while drawing.
Sync compares the workspace's saved Git blob identifier with the current version.
If both devices edited it, both complete versions remain available until you
choose the device or GitHub version. Resolution first preserves the losing version
as another locally editable workspace with the original PDF; that copy can be
exported or synced independently. Stale browser tabs also preserve their draft.
Self-hosting can preserve the Git
repository and portable metadata; it still needs an adapter for the new server's
API/authentication. Changing a URL alone cannot switch protocols.

## Security and bounds

- Connect rejects public repositories. Upload rechecks privacy and repository ID
  before sending PDF bytes. Keep the library private; never use MegaApp-pages as
  the asset repository. Repository privacy can also be changed outside the app.
- Contents write permits changing/deleting any file inside the selected repo,
  although this reader only adds/verifies papers. A scoped key is still a secret.
- Token headers go only to the fixed `https://api.github.com/repos/<owner>/<repo>`
  API prefix. References reject credentials, alternate hosts, query strings, and
  arbitrary paths. Redirects fail; requests omit cookies and bypass HTTP caches.
- Masking a field does not isolate its value from trusted browser code. Same-origin
  MegaApp code shares the trust boundary; generated/untrusted apps need a separate
  origin/sandbox before receiving capabilities. This prototype does not claim to
  hide a connected credential from privileged code, an extension, or an agent
  authorized to inspect its browser. Keys are never deliberately sent to agents.
- Session access expires at one hour even if the GitHub key has a longer lifetime.
  A backgrounded page checks expiry on its next request; reload/disconnect forgets
  it. GitHub's own expiration/revocation may end access sooner.
- 25 MiB per PDF, 100 MiB total local cache, at most 1,000 indexed papers and 10,000
  tree entries. Streamed PDF and metadata responses are bounded. JSON/base64
  upload uses extra memory and is not resumable; retry checks the same fingerprint.
- Browser quota/eviction may remove cached copies. Keep uploaded originals or
  exported backups. In-memory fallback clearly reports session-only storage.
- Git retains binary history after normal deletion; this is a modest paper library,
  not a promise of unlimited media storage. GitHub blocks regular files over
  100 MiB and recommends small repositories. Large frequently edited media may
  need object storage or Git LFS later.
- PDF.js is pinned and bundled. Scripting/eval and XFA are disabled; page text is
  plain text and PDF actions are not executed. Rendering is pixel-bounded.

## Verification

Run `npm run check`, `npm test`, and `node tests/pdf-workspace-browser.mjs` (set
`PLAYWRIGHT_MODULE_PATH` to the bundled installation if needed). Tests cover
atomic commits, preservation of unrelated paths, racing writers, deduplication,
lost acknowledgements, malformed/corrupt assets, private-repo checks, credential
scope/expiry boundaries, and repository-bound local cache operations.

Additional browser checks: `node tests/meta-browser.mjs` and
`node tests/pdf-export-browser.mjs`. Export verification reloads actual annotated
PDFs, checks source text/page sizes/rotation, and inspects pen/highlighter/eraser
pixels and boundary clipping in Chromium and WebKit. Sync protocol tests use two
independent stores sharing a GitHub fixture and verify conflict/race recovery.
Fixtures establish client behavior, not physical iPad or live fine-grained-token
acceptance. Live GitHub API evidence and release status are in reading-progress.md.

## Inspect editable state from the CLI

Download a workspace JSON through `gh` or the browser's editable export, then use
the same validation/model functions as the editor:

```sh
npm run workspace -- inspect homework.json
npm run workspace -- validate homework.json
npm run workspace -- undo homework.json --output homework-revised.json
npm run workspace -- redo homework.json --output homework-revised.json
npm run workspace -- add homework.json stroke.json --output homework-revised.json
```

`stroke.json` contains `kind` (`pen`, `highlight`, `erase`), hex `color`, positive
`width` in PDF points, and `points: [{"x": 100, "y": 120}, ...]`. The command
generates an operation ID. All mutations require an explicit output file.
Ordinary Git/`gh` operations inspect version history and recover synced files.

## Sources

- [GitHub cross-origin API access](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)
- [Fine-grained keys](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Git blobs](https://docs.github.com/en/rest/git/blobs), [trees](https://docs.github.com/en/rest/git/trees), [commits](https://docs.github.com/en/rest/git/commits), [refs](https://docs.github.com/en/rest/git/refs)
- [GitHub file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
