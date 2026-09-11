# Zee editor (VS Code / Cursor)

Language support for `.zee` files: syntax, the Zee file icon, **`zee lsp`** (hover, complete, go to definition, find references, inlay hints, semantic tokens, **format**, **rename**, checker diagnostics), snippets, interpreter **debugger**, and **Zee: Run File**.

The mark and file icons come from [`brand/`](../../brand/BRAND.md).

## Install

**Development** — from the `zee-lang` repo:

```bash
npm run editor:link
```

That symlinks this folder into `~/.cursor/extensions/zee-hq.zee-0.1.0` and `~/.vscode/extensions/zee-hq.zee-0.1.0`. Reload the window, then open `examples/hello.zee`.

**Marketplace** — same folder as `editor:link`. Package with `npm run editor:package` from the repo root. Publish (VS Code Marketplace + Open VSX) is the `publish-editor` GitHub workflow (`workflow_dispatch`). Needs `VSCE_PAT` and `OVSX_PAT` on the repo. Until those secrets exist, install the `.vsix` or keep using `editor:link`.

To see role-colored Z marks in the explorer, set **File Icon Theme → Zee**. Zee files are a colored **Z**; tests are a flask + Z. Empty folders and other languages use [Catppuccin Icons](https://github.com/catppuccin/vscode-icons) (Mocha). A `.zee/` folder is that Catppuccin folder with the signal Z. The older page-and-glyph set is in `file-icons/page/`.

Color in the editor: **Color Theme → Zee Dark** (or **Zee Light**). The setting id is the same string as the label (`workbench.colorTheme`: `"Zee Dark"`). Class names are coral (declaration and PascalCase uses), structs mint, enums orchid — the same hex as the file icon. User functions are azure; host builtins (`print`, `println`, `str`, `error`, `getenv`, …) are violet; `panic` is amber; `self` is gray.

Reload the window after `npm run editor:link`. If the workspace setting does not apply in Cursor, pick **Preferences: Color Theme → Zee Dark** once (writes the user setting).

| File | Icon |
|---|---|
| `hello.zee` | Z (teal) |
| `users.module.zee` | Z (pine) |
| `users.controller.zee` | Z (azure) |
| `users.action.zee` | Z (ember) |
| `users.service.zee` | Z (violet) |
| `users.resource.zee` | Z (aqua) |
| `users.repository.zee` | Z (moss) |
| `users.model.zee` | Z (honey) |
| `users.api.zee` | Z (indigo) |
| `point.struct.zee` / `user.class.zee` / `row.data.zee` | Z in the type-role color |
| `status.enum.zee` / `io.interface.zee` / `id.newtype.zee` | Z in the type-role color |
| `fail.error.zee` | Z (amber) |
| `*.spec.zee` | same colored Z as the source file |
| `*.test.zee` | flask + Z in that role color |
| `main.zee` / `zee.toml` | entry / manifest |
| `.zee/` | Catppuccin folder + signal Z |

Regenerate SVGs: `npm run editor:icons` (from repo root). See [`brand/BRAND.md`](../../brand/BRAND.md).

## Commands

| Command | Default |
|---|---|
| Zee: Run File | ⌘⇧R / Ctrl+Shift+R |
| Zee: Check File | Command Palette |
| Format Document | editor format (`zee fmt` / LSP) |
| Rename Symbol | F2 — updates the definition, call sites, and `import`s |
| Zee: Debug File | breakpoint + step on the TypeScript interpreter |

Save or edit a `.zee` file to type-check it through `zee lsp`. `zee.checkOnSave` is kept for compatibility.

The language server uses this repository’s `src/cli.ts` when the workspace is `zee-lang`. In a package created with `zee new`, it uses `zee lsp` / `zee debug` on your `PATH` (`npm link` in the repo root).
