# Kadr

Beautiful, engaging slide decks with as little effort as possible.

You describe a presentation in one JSON file; Kadr lays it out, animates it and presents it. Elements that share an `id` on consecutive slides flow into each other by themselves, so a deck comes alive without hand-made animations. The format is strict and fully described by a schema, which makes Kadr easy to drive from scripts and AI tools.

> **Status: early design.** The format is a draft with a tested schema; there is no CLI or editor yet.

## What is here

| Path | Contents |
|---|---|
| [`docs/format.md`](docs/format.md) | The presentation format, version 0.1 (draft) |
| [`docs/cli.md`](docs/cli.md) | The command-line tool, design draft |
| [`docs/decisions.md`](docs/decisions.md) | Why things are the way they are, and what comes next |
| [`schema/0.1/kadr.schema.json`](schema/0.1/kadr.schema.json) | JSON Schema for `.kadr.json` files |
| [`examples/`](examples/) | Example presentations |
| [`tests/`](tests/) | Tests: the schema against valid decks and against mistakes |
| [`fonts/`](fonts/) | Bundled font library: 44 families, Latin and Cyrillic |
| [`tools/fonts/`](tools/fonts/) | Rebuilds the font library from pinned sources |

## A taste of the format

```json
{
  "kadr": "0.1",
  "theme": "aurora",
  "slides": [
    { "layout": "title", "slots": { "title": "Kadr", "subtitle": "Beautiful slides without the busywork" } },
    { "layout": "content", "slots": { "title": "The idea", "body": "- You write the content\n- Kadr makes it beautiful" } }
  ]
}
```

## Planned

- `kadr` CLI: create, check, build a self-contained HTML deck, export to PDF.
- Player with presenter view (notes, timer, next slide).
- Visual editor in the browser, hosted on GitHub Pages.

## Development

Needs Node 24 or newer.

```
npm install
npm test
```

## Branches

- `unstable`: day-to-day development.
- `main`: the published version. Changes reach it through pull requests from `unstable`.

## License

Code and documentation: [Apache License 2.0](LICENSE).
Fonts in [`fonts/`](fonts/) keep their own licenses (SIL Open Font License 1.1); see [`fonts/README.md`](fonts/README.md).
