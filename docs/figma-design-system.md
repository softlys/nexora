# Figma and the design system

NEXORA's design system lives in code. `tokens/tokens.json` is the single source of truth; Figma receives a copy of it through the Tokens Studio for Figma plugin. **There is no live Figma connection**, and none is claimed in the app.

## Tokens

`tokens/tokens.json` uses the W3C design tokens format (`$type`, `$value`):

| Group | Contents |
| --- | --- |
| `color.neutral`, `color.accent`, `color.success/warning/danger/info` | Primitive palettes (one indigo accent) |
| `semantic.light`, `semantic.dark` | Semantic colors that alias primitives: background, surface, border, text, accent, status, `chart-1…5` |
| `font` | Families (Geist, Geist Mono), sizes 12–24 px with line heights, weights 400/500/600 |
| `spacing` | 4 px grid |
| `radius`, `border`, `shadow`, `motion` | Shape, elevation and timing |

`npm run tokens:build` generates `src/styles/tokens.css`. Every component reads CSS variables from it, for example `--nx-surface` and `--nx-accent`. A unit test fails if the CSS is out of date.

The chart colors (`chart-1…5`) were checked with a palette validator for lightness, chroma, separation under color-vision deficiency, and contrast, against both the light (#ffffff) and dark (#141619) chart surfaces.

## Living style guide

`/ui-kit` (**Figma & UI Kit** in the sidebar) renders the design system from the real tokens and components:
- principles
- color, typography, spacing, radius and shadows
- buttons and their states
- inputs and validation
- tables and status badges
- modals, drawers, confirmations and toasts
- navigation
- cards, and empty and loading states
- charts
- responsive rules
- accessibility

Toggle the theme in the top bar to review dark mode.

## Export to Figma (Tokens Studio)

The page offers two downloads:

| File | Format |
| --- | --- |
| `/ui-kit/tokens-studio.json` | Tokens Studio for Figma, single file with token sets and themes |
| `/ui-kit/tokens.json` | The source file (W3C format) |

The Tokens Studio file contains three sets:
- `core` (primitives, typography, spacing, radius, shadows)
- `light` (semantic colors)
- `dark` (semantic colors)

It also defines two themes, **Light** and **Dark**, each using `core` as a source plus one mode set. Aliases such as `{color.accent.600}` are kept, so Figma variables stay linked.

The converter (`src/domain/design/tokens-studio.ts`) makes a few format adjustments, because Figma cannot read CSS variables:
- Font families become plain font names (`Geist`, `Geist Mono`).
- Shadows become Tokens Studio box-shadow objects.
- Motion tokens use the `other` type.

### Import steps

1. Download **Tokens Studio JSON** from `/ui-kit`.
2. In Figma, install and open the **Tokens Studio for Figma** plugin.
3. Under **Settings → Token storage**, choose **Local document**.
4. Under **Tools → Load from file/folder**, select `nexora-tokens-studio.json`. The sets `core`, `light` and `dark` and the themes Light and Dark appear.
5. Under **Styles & Variables → Export styles & variables to Figma**, select both themes and export. Figma gets a variable collection with a Light and a Dark mode, plus text and effect styles.

Plugin menus change between versions. If a label differs, look for "Load from file" and "Export to Figma variables".

## Recommended Figma file structure

| Page | Contents |
| --- | --- |
| 01 Foundations | Variables (from tokens), color, type scale, spacing, radius, elevation, icons (Lucide) |
| 02 Components | Button, IconButton, Input, Select, Combobox, Checkbox, Switch, DatePicker, StatusBadge, Tabs, Dialog, Sheet, Toast, DataTable, KpiCard, ChartContainer, EmptyState |
| 03 CRM | Companies, contacts, leads lists and record pages |
| 04 Sales Pipeline | Kanban board, deal card, deal drawer, lost-reason dialog |
| 05 Orders | Order list, order editor, payments |
| 06 Automation Studio | Workflow list, editor, run history |
| 07 Analytics | Overview dashboard, analytics page, chart patterns |
| 08 Responsive Layouts | Mobile (390), tablet (768), desktop (1440) frames of the main screens |

Name components exactly as in code, for example `StatusBadge` with a `tone` property, so designers and developers talk about the same thing.

## Keeping Figma and code in sync

1. Change tokens in code (`tokens/tokens.json`), run `npm run tokens:build`, and commit.
2. Download the Tokens Studio file again and load it in Figma. Tokens Studio updates the existing variables in place.
3. Design changes go the other way only through a code change to `tokens.json`. Figma is a consumer, not a second source of truth.
4. Review `/ui-kit` after each token change, in both themes.
