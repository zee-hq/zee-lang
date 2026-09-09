# Zee editor (VS Code / Cursor)

Syntax highlighting for `.zee` files plus **Zee: Run File** / **Zee: Check File**.

## Install (development)

From the `zee-lang` repo:

```bash
mkdir -p ~/.cursor/extensions ~/.vscode/extensions
ln -sfn "$(pwd)/editor/vscode" ~/.cursor/extensions/zethsell.zee-0.1.0
ln -sfn "$(pwd)/editor/vscode" ~/.vscode/extensions/zethsell.zee-0.1.0
```

Reload the window, then open `examples/hello.zee`.

The Run command uses `zee` on your `PATH` when you have linked the CLI (`npm link` in the repo root). Otherwise it falls back to `npx tsx` against this repository.
