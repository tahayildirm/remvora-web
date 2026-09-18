# Remvora Web — operator and deployment guide

[English](GUIDE.en.md) · [Türkçe](GUIDE.tr.md)

## Purpose and components

Browser-based remote administration for authorized IT/support teams, schools, kiosks, small organizations and home labs. Install your own Remvora Server and one Remvora Agent per managed device. The web panel alone cannot manage a device. It contains no database or default account. Three separate repositories are used: [Server](https://github.com/tahayildirm/remvora-server) · [Web](https://github.com/tahayildirm/remvora-web) · [Agent](https://github.com/tahayildirm/remvora-agent).

The API repository’s guide explains database choice, migration, encrypted keys, first Owner bootstrap and recovery. The Agent guide explains enrollment and local permissions. This guide covers the panel. MIT source is free to use/modify/distribute subject to its notice; hosting, bandwidth and support are not included. Dependencies keep their own licenses.

## Build and publish

Use Node.js 24 and npm:

```sh
npm ci
npm run lint
npm test -- --watch=false
npm run build
```

Serve `dist/remvora-web/browser` using HTTPS. Do not expose `ng serve` to the Internet. Same-origin deployment routes `/api/`, `/ws/` and `/health` to the server, with static files at `/`. See `deploy/nginx.conf.example`; replace domain, paths, certificates and upstream. WSS requires HTTP upgrade forwarding and suitable idle limits. Deny private configuration, archive and dot-directory downloads. Serve `index.html` with revalidation; hashed JS/CSS may be cached. Do not add a caching service worker over authenticated API traffic.

For a separate API origin, insert a public metadata entry in the built index:

```html
<meta name="remvora-api-origin" content="https://api.example.com">
```

The URL must be HTTPS origin-only, without credentials, query or path. Configure API `Security__AllowedOrigin=https://rdp.example.com` exactly and `AllowedHosts` appropriately. Use same-site HTTPS subdomains for Strict cookies, or same-origin proxying. Arbitrary cross-site deployments are not guaranteed. Browser API requests include credentials; there are no authentication tokens in localStorage. Database credentials never belong in frontend assets.

Windows packaging: `python3 scripts/package-windows.py --api-origin https://api.example.com` after building; omit `--api-origin` for same-origin. Output is `dist/remvora-web-panel.zip`. Review IIS configuration before replacing an existing site’s web.config. Deployment archives belong in protected storage after extraction, not publicly downloadable paths.

Local development: `npm start -- --host localhost --port 4200 --proxy-config proxy.conf.json`. The supplied proxy targets a private development API on 5187. Use a trusted local HTTPS/proxy setup for secure cookies and browser APIs when testing full authentication; a reachable HTTP page alone does not prove production authentication works.

## First login, users and organization

There is no default email/password. The server operator first runs migrations, then `--bootstrap` once on the empty database with `REMVORA_ADMIN_EMAIL`, `REMVORA_ADMIN_PASSWORD` (8–256 characters) and `REMVORA_ORGANIZATION`. These are **Remvora credentials**, distinct from hosting, database and OS accounts.

Log in using email/password and TOTP/recovery code when enabled. Organization ID is not needed on the login form. **My profile / Organization** allows email/password changes with current-password verification, and switching to existing eligible organization accounts after reauthentication/MFA. It does not create a new organization. The current provisioning CLI supports only the first organization.

An authorized administrator creates subsequent accounts under **Users**, entering email, initial password and role. No email invitation or public signup/reset mail is sent automatically. Share the initial password privately; ask users to change it in their profile. Owner/Admin/Operator/Viewer and custom roles are permission-based. Grant only necessary access. Device-group restrictions are exact groups, not inherited descendants; Owner always has organization-wide scope. The last Owner is protected from demotion.

Owner can inspect all user management fields within their organization and edit email, set a new password, unlock and revoke sessions. Nobody can read another user’s current password or MFA secret. Owner is not a cross-organization superadmin. **Security** manages MFA/recovery and browser sessions. Store recovery codes privately; do not put them in screenshots/issues.

## Devices and inventory

Create device → obtain short-lived enrollment token → run Agent `enroll` → approve → Agent `activate` → start its service. Preserve state during upgrades. Enrollment status and live connectivity are different. Online, Busy, Offline and Unknown come from signaling presence; approval does not mean the device is connected. A device may allow only one remote session at a time.

Edit name/metadata and associate groups, tags, contacts and locations. Country choices and Turkish province/district lists are available; international local subdivisions are free text. Selected values can fill dependent fields; the app does not guarantee complete automatic geocoding or infer someone’s address.

Disable keeps identity and can be reversed. Revoke cancels trust. Permanent delete is separate and asks for two confirmations; it is not a connection-repair step. Reboot requires permission, exact device-code confirmation and the agent’s local reboot opt-in; a command acknowledgment is not proof the device finished rebooting.

## Desktop from computer, tablet or phone

Select **Desktop**. Connection progress and diagnostics identify P2P or WSS relay. Automatic transport tries P2P first, then relay when needed. Forced server mode is also available. NAT and network changes can affect direct connectivity; the same ISP or CGNAT label is not a definitive diagnosis.

On phones, direct touch is default: tap a target, drag with one finger, hold then release for right click. Optional **Touchpad / cursor** gives relative cursor control. Two-finger pinch zooms 1–4×; moving both fingers pans. This changes local viewing, not the remote resolution. The chosen input mode is kept on the browser. Automatic layout uses pointer/viewport heuristics; override Controls on hybrid devices if needed.

Tools are collapsed by default on touch layouts, at the bottom in portrait and right in landscape. Open the menu for quality, keyboard/clipboard, files, connection details and fullscreen. Fullscreen hides tools and asks supporting browsers to hide navigation UI. If unsupported, add Remvora to the home screen and open its icon; actual browser/OS behavior varies. This is standalone launch support, not an offline remote-access service.

Video controls include adaptive/manual quality, FPS, bitrate and size limits, saved for that device in the browser. Clearing browser storage, another browser/device or private browsing can lose local preferences. Low bandwidth requires lower quality; no setting can remove network latency.

Keyboard shortcuts depend on browser/OS reservations. Use on-screen buttons for intercepted combinations. Clipboard is explicit, text-only, requires agent permission and may need browser clipboard permission; no background reading. Pasted/dropped files use the shared-folder transfer, not the OS file clipboard. System audio is optional, starts muted and depends on agent platform support. There is no microphone capture mode.

## Mobile terminal

Select **Terminal** for the agent account’s real shell. The current directory/prompt comes from that shell. Commands execute with that account’s privileges. Terminal is not a sandbox.

Open tools for keyboard, fullscreen, input preferences and diagnostics. Portrait tools are below, landscape tools on the right. Hiding them maximizes terminal space. Opening the keyboard adjusts the viewport and terminal rows/columns. The text field’s **Send** sends text; the **↵** helper sends Enter. Ctrl/Alt apply to the next helper key (Ctrl then c interrupts, Ctrl then d sends EOF). Tab, Esc, arrows and Backspace are available. You can also use the terminal’s own input. Close the session when finished.

## File exchange and security boundaries

Agent `--file-root` must designate an existing protected shared directory and desktop must be enabled. Transfers support upload/download, SHA-256 verification, 100 MiB per file and a 500 MiB session budget; one transfer at a time. The flat directory excludes traversal/subdirectories/symlinks, does not overwrite existing names and cleans up incomplete uploads. The browser buffers bounded transfers in memory. Do not treat transfer as an unrestricted remote file manager or malware scanner.

WSS relay uses TLS per hop; the server can access payloads. A self-hosted operator must protect API/DB, accounts and backups. Never publish terminal output or screen images with private information. Remote transport changes require real-agent tests, not only unit tests.

## Troubleshooting, updates and contributions

- Server unreachable: check API DNS/TLS/health, API-origin metadata, exact allowed origin and cookies.
- No account: bootstrap on Server, not inside Web; subsequent users are created by an administrator.
- Offline device: inspect Agent service and WSS; Active enrollment is not online presence.
- Black screen/no input: check desktop login/display, OS permissions and local agent flags.
- Slow relay: inspect both networks and hosting capacity; reduce adaptive video settings.
- Missing clipboard/audio/files: check agent opt-ins and browser support; unavailable controls do not grant permission.
- Old page: close/reopen or refresh; compare the deployed hashed bundle. Keep the prior index/hashed files for rollback.

Update by building a compatible version, backing up the existing static entry/config, deploying static files and testing login plus a real session. API/agent upgrades are separate. Read [status](STATUS.md) for acceptance gaps, [release checklist](PUBLIC_RELEASE.md), SECURITY and CONTRIBUTING. Selected Raspberry/macOS flows were tested; full Windows, physical mobile IME, load/soak, independent security and signed release gates remain.


### Saved view preferences

Terminal tools include an 8–24 px text-size selector (default 14 px). Changing it refits the terminal and updates the remote rows/columns. Text size, audio mute and volume persist in this browser’s local storage across reconnects and page reloads. They are not synced between browsers; clearing site data resets them. Browser autoplay policy may still require a tap to start sound.
