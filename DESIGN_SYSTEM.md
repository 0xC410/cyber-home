# cyber-home Design System

Personal visual standard combining **Tech Minimal (Bento Dark)** with **Cyber-Minimal & ASCII/TUI**.
Designed to be highly legible, consistent across views, and easy to maintain.

---

## 1. Core Tokens (Current State)

Defined in `styles.css` (`:root`) and applied across the entire interface.

### Base Colors
| Token | Hex / Value | Usage |
|---|---|---|
| `--bg-canvas` | `#09090b` | Main page / window background |
| `--bg-surface` | `#111114` | Cards, panels, inputs, modals, and badges |
| `--bg-surface-alt` | `#161917` | Hover states, subtle active items, and secondary surfaces |
| `--border-subtle` | `#27272a` | Default `1px` borders |
| `--border-accent` | `rgba(34, 197, 94, 0.35)` | Focused borders or highlighted panels (varies by theme) |
| `--text-primary` | `#fafafa` | Headings and primary text |
| `--text-secondary` | `#a1a1aa` | Subtitles, descriptions, and metadata |
| `--text-muted` | `#8b8b95` | Placeholders, secondary labels, and separators (WCAG AA on `#09090b` and `#111114`) |
| `--danger` | `#ef4444` | Destructive actions, offline status, and timer alarm |
| `--danger-soft` | `rgba(239, 68, 68, 0.14)` | Subtle background for error/alarm states |
| `--border-danger` | `rgba(239, 68, 68, 0.42)` | Border for destructive/alarm states |

### Accent Palettes (`body[data-theme="..."]`)
| Theme | `--accent` | `--accent-soft` | `--accent-fg` |
|---|---|---|---|
| `green` *(default)* | `#22c55e` | `rgba(34, 197, 94, 0.14)` | `#052e16` |
| `amber` | `#f59e0b` | `rgba(245, 158, 11, 0.14)` | `#271502` |
| `cyan` | `#06b6d4` | `rgba(6, 182, 212, 0.14)` | `#04242b` |
| `violet` | `#c084fc` | `rgba(192, 132, 252, 0.16)` | `#1d0736` |

### Dynamic States (`data-online`, `data-alarm`, `data-zen`)
- `body[data-online="false"]`: switches `--accent` to `--danger` and displays `SYS // OFFLINE` in the topbar.
- `body[data-alarm="true"]`: scopes `--danger` to `#timer-page-view` and `#nav-timer-btn` with a border pulse (respecting `prefers-reduced-motion: reduce`).
- `body[data-zen="true"]`: hides the topbar, directory, notepad/checklist, and footer, centering the ASCII clock (`.zen-ascii-clock`) and command panel.

### Geometry & Spacing
- **Border Radius (`--radius`):** `2px` (sharp/industrial corners across panels, cards, buttons, inputs, and badges).
- **Borders:** `1px solid` (no heavy shadows; hierarchy relies on surface and border contrast).
- **Container:** `max-width: 1120px`, centered, `gap: 20px` between main sections.
- **Scrollbars:** hidden (`scrollbar-width: none`) to preserve a clean terminal aesthetic.

### Typography & Scale (`body[data-font-size="..."]`)
- **UI / Reading (`--font-sans`):** `Inter`, `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `sans-serif`.
- **Technical / TUI / Data (`.mono`):** `JetBrains Mono`, `Fira Code`, `ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, `monospace` — always with `font-variant-ligatures: none`.
- **Scales:**
  - `sm` (Compact): `14px`
  - `md` (Default): `16px`
  - `lg` (Large): `18px`
- **Minimum effective size:** `max(12px, ...)` for labels, badges, metadata, and the ASCII clock.

---

## 2. Implemented Components & Patterns (`Mode A`)

The project uses **Mode A — Modern TUI (`btop` / Neovim)** as the active default (`body[data-mode="A"]`):

- **Topbar (`.topbar`):**
  - Left: `.status-badge` (`SYS // ONLINE` / `SYS // OFFLINE`) + `.page-switcher` (`HOME`, `FOCUS TIMER` with live `.nav-timer-badge`).
  - Right: `.weather-badge`, `.datetime-badge` (with `tabular-nums`), and `⚙ CONFIG` button.
- **TUI Panels (`.panel` / `.panel-accent`):**
  - `1px solid` bordered boxes with a `.tui-legend` (`<h2>`) label placed over the top border (e.g., `[ 01. COMMAND / SEARCH ]`, `[ 02. WORKSPACE DIRECTORY ]`).
  - `.panel-accent` highlights its border on `:focus-within`.
- **Command Bar (`.search-form`):**
  - `❯` prompt prefix, borderless monospace input (`role="combobox"`), suggestions (`:` internal commands / `@` bookmark filter), feedback (`aria-live="polite"`), and `.kbd` indicator (`CTRL+K`).
- **Workspace Directory (`.bookmarks-grid` / `.bookmark-card`):**
  - Unified category-tab organization with numbered cards (`1–9` keyboard shortcuts), title, hostname, and inline editing with drag-and-drop reordering.
- **Notepad & Checklist (`.bento-eval-grid`):**
  - 2-column grid below the directory: `[ 03. NOTEPAD ]` (multi-tab `.notepad-segmented` notes, double-click rename, `COPY`, `CLEAR`, and `Ctrl+Z` snapshot undo) and `[ 04. CHECKLIST ]` (`[ ]` / `[✓]` tasks with `CLEAR DONE`), both persisted in `localStorage`.
- **Focus Timer (`#timer-page-view`):**
  - Dedicated view with `Countdown Timer` / `Stopwatch` toggle, presets (`25m`–`120m` + custom), Web Audio API alarm, and `.btn-accent` / `.btn-ghost` controls.
- **Settings Modal (`#settings-modal`):**
  - Numbered sections (`01.` to `03.`) for theme, font scale, weather location, and JSON backup/reset with focus trapping and `Escape` dismissal.

---

## 3. Optional System Modes (Reference)

- **Mode A — Modern TUI (Active):** Continuous CSS borders + `.tui-legend` over the top border. 100% responsive.
- **Mode B — FIGlet + Clean Bento:** ASCII block-art header (`█`, `╔`, `═`, `╚`) on top + clean cards below.
- **Mode C — Pure Terminal:** Monospace `<pre>` blocks with box-drawing characters (`┌─┬─┐ │ └─┴─┘`) and tables aligned via `.padEnd()`.

---

## 4. Golden Rules (Anti-Break)

1. **Never use ligatures** in ASCII/TUI blocks (`.mono` keeps `font-variant-ligatures: none`).
2. **Preserve whitespace** in ASCII art and matrices (`white-space: pre` + `overflow-x: auto`).
3. **Programmatic alignment:** In Mode C tables, use `.padEnd()` instead of manual spacing.
4. **Responsiveness:** Prefer **Mode A** `.panel` containers for blocks that need to adapt to any width.
5. **Restrained accent usage (`--accent`):** Reserve the accent color for focus, active status, primary actions, and subtle highlights; keep the rest neutral (`#09090b`, `#111114`, `#fafafa`, `#a1a1aa`).
