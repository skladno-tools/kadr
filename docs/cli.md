# Kadr CLI

Design. Nothing here is implemented yet.

## 1. Principles

1. **One reader for people and AI tools.** Every command speaks plain text by default and JSON with `--json`. Both carry the same information; the JSON form is stable and documented, so a script never has to parse the text.
2. **Every problem in one pass.** `check` reports all errors and warnings it can find, not the first one, each with where it is and what to do about it.
3. **Predictable.** The same input gives the same output, byte for byte: no timestamps or random names in built files, diagnostics in file order. This is what makes builds diffable and tests simple.
4. **No surprises on disk.** A command writes only the file it was asked to write. `new` never replaces an existing file without `--force`. `build` and `pdf` replace their output only when Kadr made it, which they can tell from a mark in the file (a `generator` meta tag in HTML, the producer field in PDF); any other file in the way needs `--force`. `upgrade` changes a deck only with `--write`.
5. **Light by default.** Checking and building need only Node. A browser is needed only for what really needs one: PDF export and measuring laid-out text (section 7).

## 2. Commands

```
kadr new <file> [--theme <name>] [--title <text>] [--force]
kadr check <file>... [--layout] [--strict]
kadr build <file> [-o <file.html>] [--force]
kadr pdf <file> [-o <file.pdf>] [--force]
kadr upgrade <file> [-o <file> | --write] [--force]
kadr schema [<version>]
kadr docs
kadr fonts
```

Global options: `--json`, `--no-color`, `--help`, `--version`. `-` as a file name reads the deck from standard input; relative image paths are then taken from the current directory.

### `kadr new`

Writes a short starter deck: a title slide and a content slide, with `"$schema"` set to the published schema so editors suggest fields at once. Refuses an existing file without `--force`.

### `kadr check`

Validates against the schema of the file's version, then runs the checks beyond the schema (`docs/format.md` section 15). With `--layout`, it also lays the deck out in a browser and reports text that overflows its box (section 7). `--strict` turns warnings into errors, for CI.

`--layout` is never turned on by itself, even when a browser is found: the same command must give the same result on every machine. Overflowing text is a common mistake for AI tools, so `kadr docs` and the hints advise running `check --layout` whenever a browser is available.

### `kadr build`

Makes one self-contained HTML file that presents the deck in any modern browser, offline: the player, the deck, its images and only the font files it uses (the families it names, split by the scripts its text actually contains). Runs `check` first and writes nothing if there are errors. Default output: next to the deck, `talk.kadr.json` -> `talk.html`. The file carries a `generator` meta tag, so the next build may replace it; a file without the mark is replaced only with `--force`.

Remote `https://` images are left as links, with a `remote-image` warning: the built file then needs the network for them. Build never downloads anything.

### `kadr pdf`

One page per slide, at the exact canvas size, each slide in its final state (all steps shown). Live backgrounds become a still frame. Runs `check --layout` first. The PDF names Kadr as its producer, so the next export may replace it; another file is replaced only with `--force`.

### `kadr upgrade`

Brings a deck to the newest format version this CLI knows, using the format's upgrade functions. By default it prints the result to standard output and changes nothing; `--write` rewrites the deck in place, and `-o` writes to another file, which must not exist unless `--force` is given. The output is formatted with two-space indentation. With 0.1 as the only version it changes nothing, but the command exists from the start so the contract does not change later.

### `kadr schema`

Prints the JSON Schema of the newest format version, or of the given one. The quickest way for an AI tool to learn the format.

### `kadr docs`

Prints the description of the newest format version (`docs/format.md`), so an AI tool that has only the CLI learns the format in prose as well as from the schema. With `--json`, the text comes as the `docs` field.

### `kadr fonts`

Lists the bundled families with their category, weight range and italics, from `fonts/catalog.json`. The schema says which names are allowed; this says which are meant for headings, body text or code.

## 3. Reading the output

### Text

```
$ kadr check talk.kadr.json
talk.kadr.json
  14:9   error    slide 2, slot "image": alt is empty                        alt-empty
                  Describe what the image shows; it is never drawn on the slide.
  31:17  error    slide 4, element "tagline": unknown field "aling"          unknown-field
                  Did you mean "align"?
  40:5   warning  slide 5, element "note": text is 18 px, hard to read       text-too-small
                  Use at least 24 px on a 1080 px tall canvas, or the role "caption".

2 errors, 1 warning
```

- Each line gives line:column, severity, where in the deck in human terms, the message and a stable code. The hint below it says what to do.
- Slides are numbered from 1, as a person counts them; the slide's `id` is shown too when it has one.
- Diagnostics go to standard output; progress and the summary of a long command to standard error.
- Color only on a terminal, and never with `NO_COLOR` set or `--no-color`.

### JSON

```json
{
  "output": 1,
  "ok": false,
  "files": [
    {
      "file": "talk.kadr.json",
      "version": "0.1",
      "diagnostics": [
        {
          "severity": "error",
          "code": "unknown-field",
          "message": "unknown field \"aling\"",
          "hint": "Did you mean \"align\"?",
          "path": "/slides/3/elements/0/aling",
          "where": "slide 4, element \"tagline\"",
          "line": 31,
          "column": 17
        }
      ]
    }
  ],
  "errors": 1,
  "warnings": 0
}
```

- `output` is the version of this JSON shape. New fields may appear in the same version; renaming or removing one is a new version.
- `path` is a JSON Pointer into the deck (counted from 0, as JSON is). `line` and `column` are counted from 1. A column counts characters as a person sees them (Unicode code points): a Cyrillic letter, an emoji or a tab is one column. Editors that count UTF-16 units differ only after an emoji or another rare character on the same line.
- With `--json`, standard output carries exactly one JSON document and nothing else. `build`, `pdf`, `new` and `upgrade` add the path of the file they wrote.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. Warnings may have been reported. |
| 1 | The deck has errors (or warnings, with `--strict`). Nothing was written. |
| 2 | The command could not run: wrong options, a file that cannot be read or written, no browser for `pdf` or `--layout`. |
| 3 | A bug in Kadr. The message asks for an issue with the input attached. |

## 4. Diagnostic codes

Codes are part of the contract: once released, a code keeps its meaning and is never reused. A new check gets a new code.

**Reading the file** (errors):

| Code | When |
|---|---|
| `json-syntax` | The file is not valid JSON. |
| `json-duplicate-key` | An object has the same key twice. Plain JSON parsers keep the last one silently; Kadr refuses it. |
| `version-missing` | No `"kadr"` field. |
| `version-invalid` | `"kadr"` is not a version string of the form `"0.1"`: the number `0.1`, `"1"`, `"v0.1"`. |
| `version-unknown` | A well-formed version that Kadr never had, such as `"0.0"`. |
| `version-newer` | The file is from a newer format version than this CLI knows. The hint says to update Kadr. |

With any of the four version codes, the schema is not run: which schema would apply is unknown, and one clear diagnostic is better than dozens of follow-on errors.

**Schema** (errors). The schema chooses every variant by a discriminator (an element's `type`, a background's `type`, string or object for a slot or a theme), so a mistake is reported only where it is, and correct fields next to it are never called unknown. `tests/schema/` holds this to account. `check` turns the validator's output into one diagnostic per place.

| Code | When |
|---|---|
| `unknown-field` | A field the format does not have. Suggests the closest known name. |
| `missing-field` | A required field is absent. |
| `wrong-type` | A string where a number is expected, and so on. |
| `bad-value` | A value outside the allowed set or range. Lists or suggests the allowed values. |
| `bad-color` | Neither a theme color name nor hex. |
| `unknown-font` | A family that is not in the library. Suggests the closest name. |
| `unknown-slot` | A slot the slide's layout does not have. Lists the layout's slots. |
| `slots-without-layout` | `slots` on a slide with no `layout`. |
| `alt-empty` | An image whose `alt` is empty. A missing `alt` is `missing-field`. |
| `image-address` | An image address that is not a path inside the deck's folder, `https://` or `data:image/`. The hint names what was found: `..`, an absolute path, a scheme such as `file:`. |
| `image-insecure` | An `http://` image: a deck served over HTTPS cannot load it reliably. The hint suggests `https://`. Reported instead of `image-address`. |

**Beyond the schema** (`docs/format.md` section 15):

| Code | Severity | When |
|---|---|---|
| `duplicate-id` | error | Two elements on one slide share an `id`, slot names included. |
| `duplicate-slide-id` | error | Two slides share an `id`. |
| `morph-type-mismatch` | error | Elements with one `id` on consecutive slides have different types. Hidden slides are skipped, as when presenting. |
| `type-effect-not-text` | error | The `type` entrance on an element that is not text. |
| `image-missing` | error | An image file that does not exist. |
| `image-format` | error | An image file whose extension is not that of PNG, JPEG, WebP, AVIF, GIF or SVG. For an `https://` address, the extension of its path, leaving out `?...` and `#...`. |
| `image-format-unknown` | warning | An `https://` address with no extension, so its format cannot be checked. |
| `off-canvas` | warning | An element lies entirely outside the canvas. |
| `line-zero-length` | warning | A line with both `w` and `h` equal to 0. |
| `list-one-number` | warning | A numbered list of one item: usually a sentence that starts with a number. The hint shows the escape: `2024\.`, written `2024\\.` in JSON. |
| `text-too-small` | warning | Text below 24 px for a 1080 px tall canvas (scaled for other sizes). |
| `display-font-body-text` | warning | A display or handwriting family on long body text. |
| `font-no-italic` | warning | Italic text (`*...*`) in a family without italics: it is shown upright. The hint names families of the same kind that have italics. |
| `font-weight-missing` | warning | A `weight` the family does not have: the nearest weight it has is used. The hint lists its weights. |
| `remote-image` | warning | An `https://` image: the built deck will need the network. |
| `text-overflow` | warning | Text taller than its box. Only with `--layout`. |
| `valign-without-height` | warning | `valign` on text without `h`: a box that fits its content has nothing to align in. |
| `reveal-without-list` | warning | `reveal: "items"` on text that has no list: the whole text appears at once. |

## 5. In the repository

```
package.json        the package @skladno-tools/kadr, with the command kadr
src/format/         reading with positions, schema validation, checks, upgrades
src/player/         the player (later)
src/cli/            the commands
schema/<version>/   schemas, shipped in the package
docs/format.md      the format description, shipped in the package for kadr docs
fonts/              the font library, shipped in the package
tests/
```

`src/format/` uses no Node and no DOM APIs, so the browser editor will run exactly the same checks as the CLI. Only `src/cli/` touches the file system.

The package needs Node 24 or newer. It is written in JavaScript with types checked by TypeScript (`// @ts-check` and JSDoc), so there is no build step between the source and what runs. Dependencies are kept few: a JSON Schema validator (Ajv) for `check`, and `playwright-core` for the browser (section 7). The JSON reader is our own: it keeps line and column for every value and catches duplicate keys.

## 6. Tests

- Every diagnostic code has a deck that triggers it and the expected output, text and JSON, kept as files next to each other. A change in wording shows up as a diff in review.
- The schema has its own suite in `tests/schema/`: valid decks that must pass with no errors, and invalid ones with the exact problems the schema must find, each a place and a kind (`missing`, `unknown`, `value`...). An invalid case passes only if the schema finds exactly those problems, no fewer and no more.
- `build` is run twice on the example and the outputs must be identical.

## 7. The browser

Text height depends on real font shaping and line breaking, so the only trustworthy measure is the same browser engine that presents the deck. Kadr does not guess it in Node.

`pdf` and `check --layout` use a Chromium-based browser through `playwright-core`, which downloads nothing by itself. Kadr looks for Chrome, Chromium or Edge installed on the system, or the one named in `KADR_BROWSER`. If there is none, it stops with exit code 2 and says how to get one (`npx playwright install chromium`).

## 8. Later

- **`kadr present <file>`**: serves the deck locally and reloads it on every save, for writing a deck with the result in view. It comes with the player; the name is reserved now so the set of commands does not change shape later.
