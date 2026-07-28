# Maven Packager

An Electron app for packaging multiple repos with one click. Check repos, pick an environment and
an install type, then run `mvn clean install` on all of them in parallel. Each repo gets its own
log tab with live output, and you can stop/restart individually or all at once. Also has built-in
Git branch switching / fetch, so you don't have to drop into a terminal.

> This is the English translation. The original (Traditional Chinese) doc is
> [README.md](README.md).

## Install & run

```bash
npm install
npm start
```

If you're behind a corporate proxy on Windows, `npm install` needs the Electron binary download
routed through it:

```bash
set ELECTRON_GET_USE_PROXY=true
npm install
```

## Config files (important: two separate files)

- **`repos.json`**: shareable, version-controlled deploy config. Each repo has an `id`,
  `displayName`, and `installTargets.bundle` / `installTargets.package`, each with a
  `workingModule` (the submodule to pass to `-pl`; leave `null` if not needed) and a `profile`
  (the deploy profile defined in that project's own `pom.xml`, e.g. `autoInstallBundle`,
  `autoInstallPackage`, `autoInstallSinglePackage`). **Contains no local paths**, so it can be
  shared/committed freely.
- **`repos.local.json`**: this machine's local checkout path for each repo
  (`{ "repoId": "C:\\path\\to\\repo" }`). Not version-controlled (already in `.gitignore`) — each
  person maintains their own paths.
- **`settings.local.json`**: local personal settings, currently just the GitHub root folder (see
  "Auto-detect paths" below). Also not version-controlled.

On startup the app merges `repos.json` + `repos.local.json`. Repos with no local path show up in
the sidebar as a row you can fill in directly.

### Three ways to fill in a path

1. Type the path into the "path not set" row in the sidebar and click Save.
2. Set a "GitHub root folder" at the top of the sidebar, then click "Auto-detect repo paths" — for
   every repo still missing a path it guesses `<root>\<repo id>` and fills it in if that folder
   exists (Windows paths are case-insensitive, so `g6` will match `G6`).
3. Click the ✎ next to a repo name to open the edit form and fill it in by hand. The edit/delete
   (✎/🗑) icons are hidden by default — hover the row (or focus it via keyboard) to reveal them;
   delete turns red on hover as a destructive-action cue.

### Add / edit a repo

Click "+ Add" in the sidebar to open the form: display name, local path, and Bundle/Package
`workingModule` + `profile` each (check that repo's own `pom.xml` for which `autoInstall*`
profiles exist and which module defines them — most projects need Bundle installs to target the
`core` module). Existing repos use the same form via ✎ (the `id` itself can't be changed).

## Usage

1. Check the repos to package on the left (multi-select, drag to reorder, or click "Select all").
2. Pick an "Environment (Maven profile)" at the top — a profile id from `~/.m2/settings.xml`
   (e.g. `testing`, `staging`). The default, "Local install (no profile needed)", skips
   settings.xml entirely and just uses whatever default each repo's own profile already sets.
   `adobe-public` is a repository/proxy profile, not a deploy target, so it's filtered out of the
   list. Next to it, "Java version" auto-scans installed JDKs under `C:\Program Files\Java`,
   `Eclipse Adoptium`, `Zulu`, `Microsoft`, and `BellSoft`; picking "System default" keeps the
   existing registry-lookup `JAVA_HOME` behavior unchanged.
3. Pick an "Install type": whole project ("Whole project", `autoInstallPackage` /
   `autoInstallSinglePackage`) or bundle only ("Bundle only", `autoInstallBundle`).
4. Optionally check "Skip tests" (adds `-DskipTests`) and/or fill in "Extra Maven arguments"
   (e.g. `-T 1C` for full-core parallel builds — appended verbatim to the command).
5. Click "▶ Start packaging". A log tab opens per repo with live `mvn` output; `[ERROR]` lines are
   red, `[WARNING]` lines are yellow.
6. Each tab has its own ▶ (start/restart, scoped to that repo) and ■ (stop that repo). You can
   check and start additional repos while others are still running — no need to wait. "■ Stop
   all" at the top stops everything currently running.
7. Status dots (on the sidebar row and the tab) — gray: queued, yellow (pulsing): running,
   green: success, red: failed.

Environment, install type, skip-tests, and extra-args selections are remembered in the browser's
`localStorage`, so they persist across app restarts.

### Git branch switching

When **exactly one** repo is checked on the left, a "Git branch" bar surfaces below the toolbar
(it stays hidden for zero or multiple selections — this is a per-repo action, kept visually
separate from the build settings above):

- The branch field auto-loads the repo's current branch and lists both local and remote branches
  (remote entries have the `origin/` prefix stripped); typing filters the list via the browser's
  native autocomplete.
- Click "Switch" to `git checkout` the typed branch. If it only exists on the remote, git
  auto-creates a local tracking branch.
- Click "⇣" to run `git fetch --all --prune`. Progress streams live into a log tab (which auto-
  activates), and a banner confirms completion (auto-dismisses after 4s).
- Checking "Auto-fetch on select" makes every repo selection on the left trigger a fetch before
  loading branches, so you don't need to click ⇣ manually (the preference is remembered in
  `localStorage`; off by default).
- Branch switching is blocked while that repo is currently packaging (enforced in both the IPC
  layer and the UI).

## Building a standalone exe

```bash
npm run dist
```

Uses `electron-builder` to produce a portable, install-free exe (`dist/Maven-Packager.exe`) you
can hand to teammates to double-click and run. On Windows you need "Developer Mode" enabled
(Settings → Privacy & security → For developers), otherwise the build tool's resource extraction
fails due to missing symlink permissions.

## Design notes

- **Environment list is read dynamically** from `~/.m2/settings.xml` — nothing is hardcoded, click
  ⟳ to reload the latest list.
- **JAVA_HOME is queried live from the registry** on every run (`HKCU\Environment` /
  `HKLM...\Environment`), instead of trusting `process.env.JAVA_HOME`, which gets frozen at
  Electron startup and can go stale.
- **Credentials never touch this tool** — host/port/user/password are read and applied by Maven
  from settings.xml; the Electron side never sees passwords.
- **No dependency ordering between repos** — everything runs in parallel today. If ordering is
  ever needed, add a `dependsOn` field to `repos.json` and implement a topological sort in
  `main.js`.
- On Windows, `spawn('mvn', ...)` uses `shell: true` to resolve `mvn.cmd`; stopping a process uses
  `taskkill /T /F` so child processes under `mvn.cmd` get killed too.
- **`git fetch` uses `spawn` instead of a blocking exec** so `--progress` output can stream to the
  UI live, instead of the whole interface freezing on an IPC call with no visible progress. The
  branch list merges `git branch` and `git branch -r` so remote branches not yet checked out
  locally still show up.

## Known limitations

- Assumes every repo has a standard Maven profile that completes the install via `-P{profile}`.
  If a repo ever needs a different mechanism (e.g. uploading through the AEM Package Manager
  API), that would need a separate branch next to `runMavenProcess` in `main.js`.
- No pause/resume — "■ Stop" kills the entire process tree outright.
- Restarting a "done" repo reuses the same log tab (clearing old output first), but if you try to
  restart while it's still running, the button is disabled, so you can't end up with two processes
  racing on the same repo.
- Git branch switching only works against a single checked repo at a time; the branch bar stays
  hidden when multiple repos are checked. If the target branch has uncommitted changes blocking
  `git checkout`, the tool just surfaces git's own error message — it doesn't force the switch or
  auto-stash.
