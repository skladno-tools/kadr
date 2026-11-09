# Decisions

Why Kadr is the way it is. Add an entry when a decision is made; change an entry only when the decision itself changes, and say what replaced it.

## Product

- **Goal.** A simple, stylish tool for making and presenting slide decks. A small set of genuinely useful features instead of everything a full office suite offers, beautiful defaults, and animations that need almost no effort.
- **JSON and CLI first.** The first users are scripts and AI tools that generate decks from JSON. The visual editor for everyone else comes later and builds on the same format, so it adds features to the interface without changing the format.
- **A static website.** Everything runs in the browser with no server, so it can be hosted on GitHub Pages and works offline. The CLI is a separate Node package in this repository that uses the same rendering core.
- **What 0.1 leaves out.** Master slides, SmartArt-style diagrams, macros and hand-made motion paths: almost nobody uses them. Tables, charts and video are planned as later element types.

## Format

- **Fixed canvas, 1920x1080 by default.** People and AI think more easily in pixels, and presenting scales the canvas to the screen anyway. The canvas size is set once per deck (16:9, 4:3, square...), never per slide.
- **Two layers.** Content lives on the canvas, which is fitted and centered; the background always fills the whole screen. Wide screens get no bars.
- **Layouts with slots, and free placement.** A slide can name a layout and fill its slots (easiest for AI), place elements by hand, or both.
- **Morphing by `id`.** Elements with the same `id` on consecutive slides flow into each other. Slot elements take the slot name as their `id`, so layout slides morph with no effort. This is the main way Kadr makes animation effortless.
- **A version in every file** (`"kadr": "0.1"`), with an upgrade function for every format change.
- **Strict schema.** Unknown fields are errors, so typos are caught at once. Fields starting with `x-` are the escape hatch for extensions.
- **Colors from the theme.** A color is a theme name (`accent`, `muted`...) or hex; names like `red` are rejected, so a deck stays within one color system.
- **`alt` is required, not empty, and never drawn.** It is for screen readers and AI tools and shows only if the image fails to load. A visible caption is separate content. Purely decorative images go in the background, which has no `alt`.
- **Errors only where they are.** The schema chooses every variant by a discriminator (an element's `type`, string or object for a slot) and lists each variant's fields explicitly. A mistake is then reported in its own place, and correct fields next to it are never called unknown; an AI tool following a false "unknown field" would delete good content. `tests/schema/` checks the exact places.
- **Markup by CommonMark rules.** Text uses a small subset of Markdown, and markup works only where it is obvious: `5 * 3` stays as it is. People and AI tools already know these rules, and almost no text needs escapes.
- **Images a browser shows natively:** PNG, JPEG, WebP, AVIF, GIF and SVG, so a deck looks the same when presenting and in PDF. Remote images only over `https://`: a deck served over HTTPS cannot load `http://` images reliably.
- **Hidden slides do not exist while presenting.** The slides around one flow into each other directly, because that is what the audience sees. Going back plays the transition in reverse; a jump to a distant slide fades.
- **Bundled fonts only.** 44 families under the SIL Open Font License 1.1, all with Latin and Cyrillic, so a deck looks the same everywhere and works offline. The schema accepts exactly the bundled families; `tools/fonts/build.mjs` keeps them in sync. Files are split by script, so the size of the library does not slow a deck down.

## Repository

- **Organization `skladno-tools`.** It holds Kadr and Chistovik, a separate project that formats documents to a strict standard.
- **Kadr and Chistovik share no code.** Kadr is about expressive freedom; Chistovik is about strict compliance. A shared core would pull both in opposite directions. If real duplication appears later, it can be moved into a shared library then.
- **One browser origin for both sites.** On GitHub Pages, `skladno-tools.github.io/kadr` and `skladno-tools.github.io/chistovik` share an origin and can read each other's storage (the same issue found in the Pips security audit). Every storage key Kadr uses starts with `kadr:`, and its service worker's scope is `/kadr/`. If either project ever holds private data, give the projects their own subdomains on a custom domain.
- **Branches.** `unstable` for day-to-day work; `main` is published. Changes reach `main` only through a pull request from `unstable` that the owner merges.
- **English** for code and documentation, so people and AI tools everywhere can use it.
- **Plain ASCII.** Command output, test output, messages and documentation use plain ASCII: words like `error` and `warning`, marks like `[+]` and `[-]` where a mark is needed, `1920x1080` and `...` rather than typographic signs. No emoji or pictographs. Content that is about other scripts, such as Cyrillic sample text, is the exception.
- **Few dependencies.** Node 24 or newer; JavaScript with types checked by TypeScript through JSDoc, so there is no build step. Tests use Node's own runner. The only dependency so far is Ajv, pinned to an exact version.
- **License.** Apache 2.0 for code and documentation; fonts keep their own licenses.
- **Schema address.** Each format version keeps its own address: `https://skladno-tools.github.io/kadr/schema/<version>/kadr.schema.json`.

## Next

1. **Settle the open questions in `docs/cli.md`**, then implement `check`, including the checks beyond the schema in `docs/format.md` section 15.
2. **Design the four themes** (`aurora`, `paper`, `ink`, `studio`): colors, font pairs, text sizes per role.
3. **Layout geometry:** where each layout puts its slots on the canvas.
4. **The player:** rendering, steps, transitions, morphing and presenter view.
