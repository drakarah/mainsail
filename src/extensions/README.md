# Fork extensions

Everything this fork adds on top of upstream Mainsail lives in this folder. Upstream files only contain
generic one-line hooks into [registry.ts](registry.ts), so merging a new upstream release should only ever
touch the lines listed below.

## Adding an extension

1. Create `src/extensions/<name>/index.ts` that default-exports a `MainsailExtension` (see [types.ts](types.ts)).
2. Add it to the `extensions` array in [registry.ts](registry.ts).
3. Put translations in `<name>/locales/<lang>.json`, using the same key structure as `src/locales/en.json`.
   They are deep-merged into the upstream locale, so never edit upstream locale files.

Always reference components lazily (`() => import('./X.vue')`) from `index.ts`: the registry is imported by
`store/variables.ts`, so static component imports cause import cycles.

Components inside `src/components` are still auto-resolved in templates (e.g. `<panel>`, `<spool-icon>`),
but components inside `src/extensions` must be imported explicitly.

## Hook points in upstream files

| Upstream file                                 | Hook                                                             |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `src/main.ts`                                 | `installExtensions(Vue)` registers panels and `<extension-slot>` |
| `src/routes/index.ts`                         | `routes.push(...extensionRoutes)`                                |
| `src/components/mixins/navigation.ts`         | `isExtensionRouteVisible()` in `showInNavi`                      |
| `src/store/variables.ts`                      | `allowedMetadata` / `allDashboardPanels` push                    |
| `src/store/gui/getters.ts`                    | `isExtensionPanelVisible()` in `getAllPossiblePanels`            |
| `src/plugins/i18n.ts`                         | `mergeExtensionLocales()` after loading a locale                 |
| `src/components/dialogs/StartPrintDialog.vue` | `<extension-slot name="start-print-dialog">`                     |

To list them: `git diff <upstream-tag> -- src ':!src/extensions'`.

When an extension needs a new place in the UI, add a new `<extension-slot name="...">` to the upstream
component rather than editing it directly.
