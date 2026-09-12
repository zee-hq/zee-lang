# json

Official Zee JSON encode/decode. JSON `null` is `None` — never a Zee `null`.

```bash
zee get json
```

Workspace `libs.toml` is still an overlay (path deps, private git, pin a different tag). Official names live in [catalog.json](https://github.com/zee-hq/zee-lang/blob/main/catalog.json).

```zee
import json

const text = json.encode(UserRow { id: 1, name: "ada" })
const (row, err) = json.decode<UserRow>(text)
if err != None {
  panic((err ?: panic("err")).message())
}
```

Invalid JSON and missing fields are `err` (dummy `T`), not panic. Encode `data` / `struct` by field names.

Releases are Git tags matching `[package] version` in `zee.toml` (`0.1.0`, not `v0.1.0`). Host builtins `jsonEncode` / `jsonDecode` live in [zee-lang](https://github.com/zee-hq/zee-lang). In-tree fixture: [`libs/json`](https://github.com/zee-hq/zee-lang/tree/main/libs/json).
