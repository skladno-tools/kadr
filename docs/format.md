# Kadr format 0.1

Draft. Machine-readable schema: [`schema/0.1/kadr.schema.json`](../schema/0.1/kadr.schema.json). Example: [`examples/hello.kadr.json`](../examples/hello.kadr.json).

## 1. Principles

1. **One file, one presentation.** Everything needed to present is described in one JSON file; images sit next to it or are embedded.
2. **Content is separate from styling.** Colors and fonts come from the theme by name (`accent`, `heading`) instead of being repeated in every element.
3. **Short for simple things, detailed for complex ones.** A slide can be a layout and two lines of text, or every element can be placed by hand.
4. **Strict.** An unknown field is an error, not something silently ignored, so typos by people and AI are caught right away.
5. **Predictable.** The same file gives the same result in the browser, in the CLI and in PDF. This is why fonts are bundled rather than taken from the system.

## 2. File

- Extension: `.kadr.json`. Encoding: UTF-8.
- A `"$schema"` field is allowed, so editors can suggest fields and flag errors. The published schema for this version lives at `https://skladno-tools.github.io/kadr/schema/0.1/kadr.schema.json`; each version keeps its own address, so older files stay valid against their own schema.
- Resource paths (`src`) are relative to the presentation file. `https://` URLs and embedded `data:` URIs are also allowed. `http://` is not: a deck served over HTTPS, as on GitHub Pages, cannot load such images reliably.
- Images may be PNG, JPEG, WebP, AVIF, GIF or SVG: every browser shows them natively, so a deck looks the same when presenting and in PDF. The format is taken from the file extension (case does not matter: `.png`, `.jpg` or `.jpeg`, `.webp`, `.avif`, `.gif`, `.svg`) or, for a `data:` URI, from its media type.
- An SVG is drawn as a picture: scripts in it do not run and it cannot load other files, so it must be self-contained.

## 3. Version

The `"kadr": "0.1"` field is required.

- While the version starts with `0.`, the format may change. Every change ships with a function that upgrades older files, so old presentations keep working.
- After `1.0`, a change in the second number only adds features; a change in the first may change existing behavior and always ships with an upgrade.
- A tool opens files of its own version and older. It refuses a file from a newer version and suggests updating the tool.

## 4. Top level

| Field | Required | Description |
|---|---|---|
| `kadr` | yes | Format version. |
| `slides` | yes | List of slides, at least one. |
| `meta` | | `title`, `author`, `description`, `lang` (e.g. `"en"`). |
| `canvas` | | Canvas size: `width`, `height`. Default 1920x1080. |
| `theme` | | Theme (section 6). Default `"aurora"`. |
| `background` | | Background of all slides (section 5). Default: the theme background. |
| `defaults` | | Defaults: `transition`, `duration`, `enter`. |

## 5. Canvas and background

A presentation is shown as two layers:

- **The canvas** holds all slide content. Positions and sizes are in canvas pixels, with (0, 0) at the top left. When presenting, the canvas is scaled to fit the screen and centered; nothing is cropped.
- **The background** always fills the entire screen, whatever its shape. Wide screens get no bars.

The background is set for the presentation and can be overridden per slide:

```json
"background": "#101820"
"background": { "type": "color", "color": "surface" }
"background": { "type": "gradient", "colors": ["#1b1440", "accent"], "angle": 120, "kind": "linear" }
"background": { "type": "image", "src": "assets/sea.jpg", "dim": 0.4, "blur": 8, "focus": { "x": 0.5, "y": 0.3 } }
"background": { "type": "live", "preset": "aurora", "colors": ["accent", "accent2"], "speed": 1 }
```

- `dim` darkens the background from 0 to 1, so text stays readable over a photo.
- `focus` is the point of the image that stays visible when it is cropped.
- Live backgrounds: `aurora`, `mesh`, `particles`, `waves`. In print and PDF they become a still frame. When the system asks for reduced motion, they stop moving.

Background images are decorative and have no `alt`. An image that carries meaning belongs on the canvas as an `image` element.

## 6. Themes, colors and fonts

Built-in themes: `aurora`, `paper`, `ink`, `studio`. A theme can be adjusted; `extends` names the theme to start from and defaults to `aurora`:

```json
"theme": {
  "extends": "paper",
  "colors": { "accent": "#e4572e" },
  "fonts": { "heading": "Unbounded", "body": "Onest" }
}
```

**Theme colors** (their names can be used anywhere a color is expected):

| Name | Purpose |
|---|---|
| `bg` | main background |
| `surface` | panels and cards |
| `text` | main text |
| `muted` | secondary text |
| `accent` | main accent |
| `accent2` | second accent |

A color is a name from this table or a hex value (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`). Names like `red` are not supported, so all colors stay within one system.

**Theme fonts:** `heading`, `body`, `mono`. Each one is a family from the bundled font library (section 14). Elements choose between them with `font`; they never name a family directly, so changing the theme changes the whole presentation consistently.

**Text sizes by role:** `display`, `title`, `heading`, `body`, `caption`. The theme sets their pixel values.

## 7. Slide

| Field | Description |
|---|---|
| `id` | Slide identifier (for links and the CLI). |
| `layout` | Layout (section 8). |
| `slots` | Content of the layout's slots. Not allowed without `layout`. |
| `elements` | Freely placed elements (section 9). Drawn above the slots. |
| `background` | Background of this slide. |
| `transition` | How this slide appears: `morph`, `fade`, `push`, `none`. |
| `duration` | Transition length, ms. |
| `notes` | Speaker notes. |
| `hidden` | Skip this slide when presenting. |

An empty slide `{}` is valid.

## 8. Layouts and slots

A layout places its slots on the canvas by itself; styling comes from the theme.

| Layout | Slots |
|---|---|
| `title` | `title`, `subtitle` |
| `section` | `kicker`, `title` |
| `content` | `title`, `body` |
| `split` | `title`, `body`, `image` |
| `image` | `image`, `caption` |
| `quote` | `quote`, `author` |
| `number` | `value`, `label` |

The value of a text slot is a string (the text) or an object that refines the slot's text element with the same fields as elements (section 9), except `type`: move it, recolor it, reveal it step by step.

The value of an `image` slot is an object with at least `src` and `alt`, plus any other image fields.

A slot element gets an `id` equal to the slot name (`title`, `body`...) unless one is given. This makes consecutive layout slides morph with no extra effort: one slide's title flows into the next one's.

## 9. Elements

### Common fields

| Field | Description |
|---|---|
| `type` | `text`, `image`, `shape`, `code`. |
| `id` | Needed for morphing. Unique within the slide. |
| `x`, `y` | Top left corner, canvas pixels. |
| `w`, `h` | Width and height, greater than 0 (a line is the exception, see `shape`). Height is optional for text: it then fits the content. |
| `rotate` | Rotation in degrees. |
| `opacity` | Opacity from 0 to 1. |
| `step` | Step at which the element appears (section 11). Default 0: immediately. |
| `enter` | Entrance effect (section 11). |

### `text`

| Field | Description |
|---|---|
| `content` | Text with light markup (section 10). Required. |
| `size` | Pixels or a role: `display`, `title`, `heading`, `body`, `caption`. |
| `color` | Color. |
| `font` | `heading`, `body` or `mono`. |
| `weight` | 300-900, in steps of 100. |
| `align` | `left`, `center`, `right`. |
| `valign` | `top`, `middle`, `bottom` (when a height is set). |
| `lineHeight` | Line spacing, as a multiplier. |
| `reveal` | `all`: the whole text at once; `items`: list items one by one. |

### `image`

| Field | Description |
|---|---|
| `src` | Path or URL. Required. |
| `alt` | Text alternative. Required and not empty. |
| `fit` | `cover`: fill and crop; `contain`: fit entirely. |
| `focus` | The point that stays visible when cropping. |
| `radius` | Corner radius. |

**`alt` is never drawn on the slide.** Screen readers read it, AI tools use it to understand the presentation, and it appears only if the image fails to load. A visible caption is separate content: the `caption` slot of the `image` layout, or a text element.

### `shape`

| Field | Description |
|---|---|
| `shape` | `rect`, `ellipse`, `line`. Required. A line runs from (`x`, `y`) to (`x + w`, `y + h`), so its `w` and `h` may be zero or negative: `h: 0` is a horizontal line, `w: 0` a vertical one. |
| `fill`, `stroke` | Fill and stroke colors. |
| `strokeWidth` | Stroke width. |
| `radius` | Corner radius of a rectangle. |

### `code`

| Field | Description |
|---|---|
| `code` | Source code. Required. |
| `lang` | Language for highlighting: `js`, `python`, `rust`... |
| `size` | Font size. |

## 10. Text markup

A small subset of Markdown. It follows the rules of CommonMark, so markup works only where it is obvious, and a character that does not form markup stays an ordinary character.

- **Paragraphs.** A blank line separates paragraphs; a single newline is a line break within a paragraph.
- **Emphasis.** `**bold**` and `*italic*`. An opening `*` must be followed by a character that is not a space, and a closing one preceded by such a character. Any other `*` is just an asterisk: `5 * 3`, `price*`. Bold and italic can contain each other, code and links.
- **Code.** `` `code` ``. Everything between the backticks is shown as it is, with no markup and no escapes. A backtick without a closing one is just a backtick. Text cannot show a backtick inside code; use a `code` element for that.
- **Links.** `[text](https://...)`, with an `https://` or `http://` address. A `[` that does not start this exact form is just a bracket.
- **Lists.** Lines starting with `- ` or a number and a dot (`1. `). Nest with two spaces per level.

**Escapes.** A backslash before an ASCII punctuation character makes it ordinary: `\*`, `` \` ``, `\[`, `\-`, `\\`. This is only needed where the character would otherwise form markup, such as a line that starts with a year: `2024\. A good year` is a paragraph, not a list. A backslash before any other character is just a backslash. In JSON, the backslash itself is written twice: `"2024\\. A good year"`.

There are no headings, tables or images inside text: size comes from `size`, and images are separate elements.

## 11. Steps and entrances

Each slide has steps. Pressing "next" shows the next step; when there are no more steps, it moves to the next slide. The number of steps is the last step at which something appears, counting list items revealed one by one.

- An element with `step: 0` is visible right after the transition.
- An element with `step: N` appears on the N-th press.
- Text with `reveal: "items"` shows top-level list items one by one: the first at `step`, the next at `step + 1`, and so on.

`enter` sets the entrance effect: `none`, `fade`, `rise`, `drop`, `zoom`, `blur`, `type` (typed letter by letter, text only). Full form: `{ "effect": "rise", "duration": 500, "delay": 100 }`. Default: `defaults.enter` of the deck, or `fade`.

Going back to the previous slide shows it in its final state, with all steps revealed.

## 12. Transitions and morphing

A slide's `transition` sets how it appears after the previous one, and `duration` how long it takes. Defaults: `defaults.transition` and `defaults.duration` of the deck, or `morph`.

**Morphing.** When going from slide A to slide B:

1. Elements with the same `id` on A and B form a pair and flow smoothly: position, size, rotation, opacity, colors, corner radius and font size. If the pair has different text, the text cross-fades while the shape keeps flowing.
2. Elements only on A fade out.
3. Elements only on B that are visible immediately (`step: 0`) play their `enter` effect at the same time as the morph.
4. Paired elements ignore `enter`: they are already on screen.
5. Slide backgrounds cross-fade.

Both elements of a pair must have the same type: the same `id` on a text and an image is an error.

Other transitions: `fade` cross-fades the whole slide, `push` slides it in, `none` switches instantly.

**Navigation.**

- **Forward** to the next slide plays that slide's transition.
- **Back** plays the transition of the slide being left, in reverse: a morph flows back, a push slides the other way. The previous slide appears in its final state (section 11).
- **A jump** to a slide that is not next or previous (from the overview, by number) always fades, whatever the transitions: morph pairs between distant slides rarely mean anything.
- **Hidden slides** do not exist while presenting. In A, hidden, B, slide A is followed directly by B: B's transition plays, and morph pairs form between A and B. The checks look at pairs in the same order.

## 13. Extensions

Fields starting with `x-` are allowed at the top level, in `meta`, on slides, on elements and in the object form of a slot. Tools ignore extensions they do not know. This gives editors and other tools a place for their own data without loosening the rest of the format.

## 14. Font library

Kadr ships its own fonts, so a presentation looks the same everywhere and works offline. Every family covers Latin and Cyrillic, and all are licensed under the SIL Open Font License 1.1.

- `fonts/catalog.json` lists each family: name, category, weight range, italic support, scripts and license.
- `fonts/fonts.css` declares all families. Font files are split by script, so a browser downloads only the parts a presentation actually uses.
- The schema accepts exactly the families in the catalog. `tools/fonts/build.mjs` rebuilds the library from pinned packages and keeps the schema in sync.

| Category | Families |
|---|---|
| Sans | Inter, Manrope, Onest, Golos Text, Geologica, Commissioner, Rubik, Nunito, Mulish, Open Sans, Noto Sans, IBM Plex Sans, Montserrat, Raleway, Jost, Exo 2, Wix Madefor Text, Wix Madefor Display, PT Sans |
| Serif | Literata, Source Serif 4, Lora, Merriweather, Noto Serif, EB Garamond, Cormorant, Alegreya, Playfair Display, PT Serif |
| Display | Unbounded, Oswald, Comfortaa, Tektur, Russo One, Yeseva One, Press Start 2P |
| Handwriting | Caveat, Lobster, Pacifico |
| Mono | JetBrains Mono, Fira Code, Source Code Pro, Roboto Mono, IBM Plex Mono |

Display and handwriting families are meant for headings and large numbers, not body text.

## 15. Checks beyond the schema

The schema catches typos and invalid values. The CLI `check` command also reports:

- **errors:** duplicate `id`s on a slide (slot names included); a morph pair of different element types, in presenting order; the `type` effect on a non-text element; a missing image file; an image in a format other than those in section 2; an `http://` image;
- **warnings:** text that overflows its box; an element entirely outside the canvas; a line of zero length; text too small to read on a screen; a display or handwriting family used for long body text; a numbered list of one item, which is usually a sentence that starts with a number; an `https://` image, which a built deck can show only online.

## 16. Not in 0.1

Tables, charts, video, element groups, master slides, custom motion paths, links between slides. The format is designed so these can be added as new element types without changing existing ones.
