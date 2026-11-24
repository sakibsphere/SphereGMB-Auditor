---
name: release-checklist
description: "Steps to cut a SphereGMB release: version bump in all three places, verification, packaging the zip, changelog, and Chrome Web Store notes. Use when the user asks to release, tag, package or publish the extension."
---

# Release checklist

1. **Version**, bump the same number in `manifest.json` (`version`), `package.json` (`version`) and the popup label in `popup/popup.html` (`vX.Y.Z`).
2. **Verify**, `npm run verify` (lint + syntax/manifest check + all tests) must pass with zero errors.
3. **Live checks**, `npm run test:smoke`, `npm run test:smoke:mobile`, `node tests/e2e/live-interactions.js`, `node tests/e2e/live-trusted-wheel.js`. Record results in `docs/QA_REPORT.md`; state plainly anything not run (e.g. Search behind a CAPTCHA).
4. **Package**, `npm run package` writes `dist/sphere-gmb-vX.Y.Z.zip` containing only what Chrome needs (manifest, background, content, lib, pages, popup, assets, LICENSE, README). The script fails if any file the manifest, service worker or pages load is missing from the zip.
5. **Changelog**, add a section to `CHANGELOG.md`: what users will notice, permission changes called out first.
6. **Permissions**, if `manifest.json` permissions changed, update the README permissions table and explain why. Chrome Web Store reviewers reject unexplained permissions; `debugger` needs a clear justification (trusted wheel for review export).
7. **Privacy check**, before any push: no personal paths, emails, IPs or screenshots in tracked files (`test-results/` is ignored), and commits use the GitHub no-reply email.
8. **Tag and release**, push only when the user asks: `git tag vX.Y.Z` then `git push origin vX.Y.Z`. `.github/workflows/release.yml` re-runs the tests, checks the tag matches `manifest.json`, builds the zip and publishes the GitHub Release with `sphere-gmb.zip`, which `install.ps1`, `install.sh` and the README "latest" link download.
