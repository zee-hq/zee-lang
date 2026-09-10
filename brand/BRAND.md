# Zee — identidade visual v0

Base: README.md, docs/DIRECTION.md e o vscode extension já existentes no repo `zee-lang`. Identidade própria da linguagem, não herdada da marca do ecossistema Z — na linha de como Go, Rust e Elixir têm marca independente da empresa por trás.

## Símbolo

Um "Z" sólido, monoline, desenhado como um traço único (`M24,26 L76,26 L24,74 L76,74`, stroke-width 16, cantos retos — `square`/`miter`, sem curvas). Não é um bloco preenchido nem uma flecha estilizada.

**Por quê:** a linguagem se define por ausência de ambiguidade — "no implicit conversions, no null" — e por uma sintaxe única em todo ambiente. Um traço reto, sem curvas nem gradientes, comunica isso na marca antes de qualquer texto. Também é barato: dois segmentos retos reproduzem perfeitamente em 16px (favicon, tree view do editor) sem perder legibilidade, o que um símbolo mais ilustrativo não sustentaria.

**Trade-off:** é uma marca "fria"/técnica de propósito — não tem calor de mascote (tipo o gopher do Go). Se em algum momento a Zee quiser presença em conteúdo mais casual (memes, comunidade, swag), vale desenhar um mascote secundário depois; não é este pacote.

## Cor

| Token | Hex | Uso |
|---|---|---|
| Ink | `#0B0E14` | texto, fundo dark mode, mark monocromático |
| Paper | `#FAFAF8` | fundo light mode |
| Signal (accent primário) | `#14E0B4` | teal/verde-sinal — CTA, links, "válido/type-checked", ícone de arquivo `.zee` |
| Amber (accent secundário) | `#F5A623` | usar só em `panic`/erro/callout de atenção — nunca decorativo |

**Por quê:** ink+paper de alto contraste em vez de cinza médio — remete a terminal/spec doc, não a "produto SaaS genérico". Um único accent forte (teal) em vez de uma paleta ampla facilita achar cor livre de conflito com as linguagens já estabelecidas (Rust é laranja, Go é ciano-azulado, Kotlin/Elixir ocupam roxo) e fecha um significado direto: teal = "isso compila/é válido", âmbar = "isso é panic/atenção". Isso já nasce reaproveitável na UI da doc (badges de status, blocos de erro do compiler).

**Trade-off:** dois accents é deliberadamente pouco. Resista à tentação de adicionar uma terceira cor "decorativa" — se aparecer necessidade de mais uma categoria semântica (ex: "deprecated"), prefira variar opacidade/tom do ink antes de introduzir cor nova.

## Tipografia

- Títulos/UI: **Space Grotesk** (geométrica, técnica, menos batida que Inter em site de linguagem)
- Corpo de texto: **Inter**
- Código e wordmark: **JetBrains Mono** (bold no wordmark)

**Por quê:** o wordmark "zee" é setado em monoespaçada, não em display font — a própria linguagem usa `.zee` como extensão e um REPL como ponto de entrada; a marca deveria parecer algo que se digita, não algo que se desenha.

**Trade-off:** os SVGs de wordmark entregues usam `<text>` com fallback de fontes (não converti pra path/outline). Renderiza certo em qualquer app que tenha a fonte instalada ou em contexto web (a landing page carrega a fonte via Google Fonts). Pra uso em impresso/merch onde a fonte pode não estar disponível, converta o texto pra outline no Figma/Illustrator antes de exportar — é um passo de 30 segundos, não fiz aqui pra não fixar um outline antes de você validar o texto/kerning.

## Pacote de ícones entregue

```
logo/
  zee-mark-teal.svg        símbolo sozinho, cor accent
  zee-mark-ink.svg         símbolo sozinho, monocromático (ink)
  zee-mark-white.svg       símbolo sozinho, monocromático (branco, pra fundo escuro)
  zee-favicon.svg          símbolo + tile arredondado ink — favicon/app icon
  zee-wordmark-light.svg   símbolo + "zee", pra fundo claro
  zee-wordmark-dark.svg    símbolo + "zee", pra fundo escuro (tile ink embutido)

icons/            10 ícones conceituais, 24x24, stroke 1.7, currentColor
  module, controller, service, resource, interface,
  enum, struct-class, match, defer-panic, cli-generate

file-icons/
  zee-file-icon.svg         ícone de arquivo .zee (teal)
  zee-spec-file-icon.svg    ícone de arquivo .spec.zee (ink + badge de check teal)
  icon-theme.snippet.json   fragmento de VS Code icon theme já mapeando as duas extensões
```

**Por que o icon set tem traço arredondado e o símbolo não:** o símbolo é a assinatura única da marca — pode ser mais rígido. Um set de 10 ícones de uso frequente em UI (docs, CLI, extensão) precisa de conforto visual em tamanho pequeno; traço arredondado lê melhor em 16–24px que o miter reto do mark. É o mesmo padrão que marcas como a própria Nest/Angular usam (logo anguloso, iconografia de produto mais macia). Ambos compartilham só a cor e a grossura relativa do traço.

## Ícone de arquivo no editor

O tema **Zee** (`editor/vscode/file-icons/zee-icon-theme.json`) distingue o **papel do arquivo** pela cor, não pelo desenho. Dois tipos só: **Z** (fonte) e **tubo + Z** (teste), cada um na cor do suffixo (`controller` azure, `service` violeta, …). `.spec.zee` usa o mesmo Z da fonte.

O estilo antigo — folha com dog-ear, glyphs por papel, badge de spec/test — fica em `editor/vscode/file-icons/page/` para não jogar fora.

VS Code só vê o que vem depois de um ponto. Por isso spec/test no explorer são `.spec.zee` / `.test.zee`, não `foo_test.zee` (um ponto só → ícone genérico `.zee`). A lib de teste ainda não existe; os ícones já estão prontos.

Regenerar: `npm run editor:icons`.

### Paleta do explorer (só file icons)

Chrome da marca continua ink / signal / amber. No tree view cada tipo precisa de uma cor própria para varrer o disco.

| Papel | Arquivo | Cor | Hex |
|---|---|---|---|
| fonte Zee | `*.zee` | Signal | `#14E0B4` |
| module | `*.module.zee` | Pine | `#0FAE8C` |
| controller | `*.controller.zee` | Azure | `#4C8DFF` |
| action | `*.action.zee` | Ember | `#F97316` |
| service | `*.service.zee` | Violet | `#8B7CFF` |
| resource | `*.resource.zee` | Aqua | `#2EC4B6` |
| repository | `*.repository.zee` | Moss | `#65A30D` |
| model | `*.model.zee` | Honey | `#CA8A04` |
| api | `*.api.zee` | Indigo | `#6366F1` |
| struct | `*.struct.zee` | Mint | `#3DDC97` |
| class | `*.class.zee` | Coral | `#FF6B6B` |
| data | `*.data.zee` | Sky | `#38BDF8` |
| enum | `*.enum.zee` | Orchid | `#C084FC` |
| interface | `*.interface.zee` | Ice | `#7DD3FC` |
| newtype | `*.newtype.zee` | Rose | `#F472B6` |
| error | `*.error.zee` | Amber | `#F5A623` |
| main | `main.zee` | Signal + Z | `#14E0B4` |
| manifest | `zee.toml` / `libs.toml` | Muted | `#8B93A1` |
| lock | `zee.lock` | Amber | `#F5A623` |
| pasta vazia / root | Catppuccin Mocha | — | `_folder` / `_root` |
| cache `.zee/` | folder Catppuccin + Z signal | Signal | `#14E0B4` |
| other languages / named folders | Catppuccin Mocha | — | [vscode-icons](https://github.com/catppuccin/vscode-icons) |

O tema de ícones do VS Code **substitui** o Seti/Material (não mistura). Arquivos Zee usam o Z da marca (cor = papel). O resto (TypeScript, JSON, Markdown, pastas `src/`…) vem dos [Catppuccin Icons](https://github.com/catppuccin/vscode-icons) (Mocha, MIT), em `editor/vscode/file-icons/catppuccin/`. Atualizar: `npm run editor:icons:vendor && npm run editor:icons`.

Badge **spec** deixou de existir no explorer — é o mesmo Z da fonte.  
Teste: tubo de ensaio + Z (como o `typescript-test` do Catppuccin), na cor do papel — `users.module.test.zee`.

Os glyphs por papel (módulo = grafo, class = dois retângulos, …) ficam em `brand/icons/` e no arquivo `page/` — docs e marca, não o explorer.
