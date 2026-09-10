# Zee editor (VS Code / Cursor)

Language support for `.zee` files: syntax, the Zee file icon, **check on save** (Problems panel), snippets, and **Zee: Run File**.

The mark and file icons come from [`brand/`](../../brand/BRAND.md).

## Install (development)

From the `zee-lang` repo:

```bash
npm run editor:link
```

That symlinks this folder into `~/.cursor/extensions/zee-hq.zee-0.1.0` and `~/.vscode/extensions/zee-hq.zee-0.1.0`. Reload the window, then open `examples/hello.zee`.

To see role-colored `.zee` glyphs in the explorer, set **File Icon Theme → Zee**.

Color in the editor: **Color Theme → Zee Dark** (or **Zee Light**). The setting id is the same string as the label (`workbench.colorTheme`: `"Zee Dark"`). Class names are coral, structs mint, enums orchid — the same hex as the file icon.

Reload the window after `npm run editor:link`. If the workspace setting does not apply in Cursor, pick **Preferences: Color Theme → Zee Dark** once (writes the user setting).

| File | Icon |
|---|---|
|---|---|
| `hello.zee` | generic Z (teal) |
| `users.module.zee` | module (pine) |
| `users.controller.zee` | controller (azure) |
| `users.service.zee` | service (violet) |
| `point.struct.zee` / `user.class.zee` / `row.data.zee` | type roles |
| `status.enum.zee` / `io.interface.zee` / `id.newtype.zee` | type roles |
| `fail.error.zee` | error (amber) |
| `*.spec.zee` | same glyph + teal check |
| `*.test.zee` | same glyph + lime T |
| `main.zee` / `zee.toml` | entry / manifest |

Regenerate SVGs: `npm run editor:icons` (from repo root). See [`brand/BRAND.md`](../../brand/BRAND.md).

## Commands

| Command | Default |
|---|---|
| Zee: Run File | ⌘⇧R / Ctrl+Shift+R |
| Zee: Check File | Command Palette |

Save a `.zee` file to type-check it. Turn that off with `zee.checkOnSave`.

The checker uses this repository’s `src/cli.ts` when the workspace is `zee-lang`. In a package created with `zee new`, it uses `zee` on your `PATH` (`npm link` in the repo root).
