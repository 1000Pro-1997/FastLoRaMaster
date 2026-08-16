# FastLoRaMaster (FLM)

ComfyUI custom nodes for managing LoRA/prompt presets and picking resolutions.

Available in **English, 한국어, 中文** — the UI follows your ComfyUI language setting.

---

## Nodes

### FLM Lora Theme

Applies LoRAs and composes prompts from theme presets. One node handles one theme;
chain several of them to combine themes.

- Pick a theme and preset, edit the prompt, save it back to a file
- Manage LoRAs inline: toggle, strength, replace, remove
- Bypass the prompt and the LoRAs independently
- `model` / `clip` are optional — use it for prompts alone if you like

Details: [docs/FLALoraTheme.md](docs/FLALoraTheme.md)

### FLM Resolution

Picks a resolution and outputs `width` / `height` as integers.

- Choose from a grouped list, with favourites pinned on top
- Or set one side and let the other follow an aspect ratio
- Or type both values directly
- Edit the list in place: add, remove, favourite, reset to defaults

Details: [docs/FLAResolution.md](docs/FLAResolution.md)

### FLM Lora Checklist

Builds a prompt from the items you check, and applies the LoRAs attached to them.

- Toggle items on the left; every checked item is appended to the prompt
- The gear opens a panel to edit the title, prompt and LoRAs of that item
- Each item may carry any number of LoRAs, or none at all
- Items live in the node itself, so every node can hold a different checklist
- Bypass the prompt and the LoRAs independently

Details: [docs/FLAChecklist.md](docs/FLAChecklist.md)

---

## Install

Clone into `ComfyUI/custom_nodes/` and restart ComfyUI.

```
git clone <repo-url> ComfyUI/custom_nodes/comfy_FLA
```

No extra dependencies.

---

## Data

| What | Where | Shared across workflows |
|---|---|---|
| Presets | `presets/<theme>/<name>.json` | Yes |
| Resolution list | `resolutions.json` | Yes |
| Checklist items | the workflow file | No |
| Selected values | the workflow file | No |

`resolutions_default.json` ships with the package and is copied to
`resolutions.json` on first run. Your edits are never overwritten by updates.

Presets start empty — you create them yourself.

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. In short:

- **Update the docs in the same commit** as the code
- **Write English in code**, translate in `locales/` and `web/fla_i18n.js`
- Fill in all three languages (`en`, `ko`, `zh`) when adding a string
- Always set `serialize = false` on widgets added from JavaScript

Architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
