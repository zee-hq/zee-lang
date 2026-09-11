# Zee editor (JetBrains)

IntelliJ / CLion / Android Studio client for `.zee` files. Syntax is the same
TextMate grammar as VS Code. Semantics come from **`zee lsp`** via
[LSP4IJ](https://plugins.jetbrains.com/plugin/23229-lsp4ij) — not a second
Kotlin frontend. Format and rename are the same LSP methods as VS Code.

Interpreter stepping is DAP (`zee debug`) in VS Code / Cursor, not a second
JetBrains debugger.

## Install (development)

1. Install the Zee CLI (`npm link` in the `zee-lang` repo root) so `zee lsp` is on `PATH`.
2. Install [LSP4IJ](https://plugins.jetbrains.com/plugin/23229-lsp4ij).
3. Open this directory as a Gradle project and run the plugin, or add the
   TextMate bundle under `src/main/resources/textmate/zee` in
   **Settings → Editor → TextMate Bundles**.

Open a `zee.toml` project and a `.zee` file. Hover, complete, go to definition,
format, rename, and checker diagnostics should match VS Code.

## Marketplace

`JETBRAINS_MARKETPLACE_TOKEN` on the GitHub `publish-editor` workflow runs
`gradle publishPlugin`. Without the token, the job builds the plugin zip only.

```
src/main/kotlin/dev/zee/lang/ZeeLanguageServerFactory.kt
src/main/resources/META-INF/plugin.xml
src/main/resources/textmate/zee/   # shared TextMate grammar
```
