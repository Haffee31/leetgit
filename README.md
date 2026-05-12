# LeetGit

Phase-1 through phase-3 Chrome extension implementation for syncing LeetCode submissions to GitHub.

## Phase 1 setup

1. Open `chrome://extensions`, enable Developer mode, and load this folder as an unpacked extension.
2. Open the extension settings page.
3. Paste a GitHub fine-grained Personal Access Token, load repos, choose the repo, and save.
4. Solve a LeetCode problem on `leetcode.com/problems/*`.

`src/config.js` still works as a local development fallback. The primary configuration now lives in `chrome.storage.local`.

## Phase 2 surface

When you open a LeetCode problem page, LeetGit injects a small icon near the page header, falling back to the bottom-right corner if the header cannot be found.

The icon now shows:

- Gray idle state.
- Blue syncing state.
- Green success state.
- Red error state with details in the panel.

Clicking the icon opens the in-page panel with the latest syncs, GitHub file links, retry for the latest failed sync, and a custom commit-message prompt when that setting is enabled.

## Phase 3 setup

The settings page now includes repository connection, token show/hide, repo loading, branch/subfolder settings, sync status controls, duplicate skipping, commit-message behavior, notification toggles, export/import, and data wipe.

The onboarding page opens on first install and walks through repo choice, token generation, and connecting in settings.
