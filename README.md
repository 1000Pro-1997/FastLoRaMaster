# SmartNode1000

**Prompt and LoRA management for ComfyUI, done in the graph.**

SmartNode1000 keeps your LoRAs, prompts, wildcards and resolutions where you actually
work — on the canvas. Pair a LoRA with the prompt it belongs to, save it once, and reuse
it in every workflow. No more copy-pasting trigger words or hunting for the right strength.

Available in **English, 한국어, 中文** — the UI follows your ComfyUI language setting.

---

## Why

A LoRA is never just a file. It comes with trigger words, a strength that works, and a
prompt fragment that makes it sing. ComfyUI stores none of that — you keep it in your head,
or in a text file next to the monitor.

SmartNode1000 stores the **pair**: prompt + LoRA, together, as one preset.
Check a box, and both go in. That's the whole idea.

---

## Nodes

| Node | What it does |
|---|---|
| **SN1000 Lora Theme** | Theme/preset library shared across every workflow, stored as JSON |
| **SN1000 Lora Checklist** | Multi-select checklist stored inside the node itself |
| **SN1000 Resolution** | Resolution picker with ratio lock and favourites |

---

## Features

### Edit prompts right on the node

Pick a theme, pick a preset, and the prompt is right there — editable in place.
Change it, save it, and the change is live everywhere that preset is used.

![Editing a theme prompt](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/01-theme-prompt-edit.gif)

---

### Every preset carries its own LoRAs

This is the core of it. Each preset holds its own prompt **and** its own LoRA stack, so
they always travel together:

- a *crying* LoRA + a *crying* prompt
- a *smiling* LoRA + a *smiling* prompt
- a specific character's LoRA + that character's prompt

Switch the preset and both swap at once. You never load the wrong LoRA for the wrong prompt again.

![Per-preset LoRA sets](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/02-per-preset-loras.gif)

---

### Hover to preview, drag to tune

Hover any LoRA row to see its preview card without leaving the canvas.
Set strength however you like — **drag**, **scroll the wheel**, or **type the number**.
Save it into the preset and it comes back that way every time.

![LoRA preview and strength](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/03-lora-preview-strength.gif)

> **Where do the previews come from?**
> SmartNode1000 reads the standard sidecar files that sit next to your LoRA —
> `<lora>.preview.png` (also `.jpg`, `.jpeg`, `.webp`, `.mp4`, `.webm`) and the
> `<lora>.json` metadata file.
>
> If your LoRAs have no previews yet, use a dedicated LoRA manager such as
> [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager) to download
> the images, trigger words and metadata from Civitai in bulk. SmartNode1000 picks them
> up automatically — same files, no extra setup. You can also drop an image onto a LoRA
> here to set its preview by hand.

---

### Make a new theme in seconds

Themes are just folders of presets. Create one, name it, start filling it.
Nothing to configure and no file to hand-edit.

![Creating a new theme](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/04-new-theme.gif)

---

### Chain themes horizontally

One node handles one theme. Need several at once? Wire them in a row —
model, clip and prompt flow through, each node adding its own layer.

![Chaining theme nodes](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/05-chain-themes.gif)

---

### Wildcards with autocomplete

Full wildcard support: `__name__` for files and `{a|b|c}` for inline choices.
Type `__` in any prompt box and the list appears — arrow keys to pick, Tab or Enter to
insert, Esc to close. Favourites are pinned to the top with a star.

SmartNode1000 finds your wildcard folders automatically, wherever they live under
ComfyUI — `wildcards`, `wild cards`, `WildCard`, it doesn't care about spelling.

![Wildcard autocomplete](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/06-wildcard-autocomplete.gif)

---

### Browse and edit wildcards without leaving ComfyUI

A full picker with a folder tree, search, favourites and a live preview of each file's
contents. Read them, pick from the list, edit them on the spot.

![Wildcard picker](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/07-wildcard-manager.gif)

---

### The checklist works the same way

Every checklist item is its own prompt + LoRA pair. Tick the ones you want; the prompts
are appended and the LoRAs are applied, in order.

![Checklist with LoRAs](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/08-checklist-loras.gif)

---

### Add and remove checklist items freely

The gear opens a panel: rename the item, edit its prompt, attach or drop LoRAs.
An item can carry any number of LoRAs, or none at all — a pure prompt toggle is fine.

![Editing checklist items](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/09-checklist-edit.gif)

---

### Two kinds of storage, on purpose

**Themes are saved to JSON files.** Shared across everything — edit a preset once and
every workflow that uses it is updated. This is your permanent library.

**Checklists are saved inside the node.** Each node keeps its own items, so two
checklists in the same workflow can hold completely different things. This is your
per-workflow scratch space.

![JSON vs node storage](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/10-json-vs-node-storage.gif)

---

### Resolution with a real ratio lock

Set one side and let the other follow the aspect ratio, pick from a grouped list, or just
type both numbers. Outputs plain `width` / `height` integers, so it drops into any workflow.

![Resolution ratio lock](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/11-resolution-ratio.gif)

---

### Manage the resolution list yourself

Add the sizes you actually use, delete the ones you don't, star your favourites to pin
them at the top. Reset to defaults whenever you want — your list is never overwritten by
an update.

![Managing resolutions](https://raw.githubusercontent.com/1000Pro-1997/SmartNode1000/main/media/12-resolution-manage.gif)

---

## Install

### ComfyUI Manager

Search for **SmartNode1000** in ComfyUI Manager and install.

### Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/1000Pro-1997/SmartNode1000.git
```

Restart ComfyUI. **No extra dependencies** — nothing to `pip install`.

### Recommended companion

SmartNode1000 shows LoRA preview images from the standard sidecar files. To fetch those
previews, trigger words and metadata for your whole library at once, install a LoRA
manager such as [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager).
It is entirely optional — SmartNode1000 works without it, you just won't see preview
images until the files exist.

---

## Usage

1. Add **SN1000 Lora Theme** (or **SN1000 Lora Checklist**) to your graph.
2. Connect `model` and `clip` from your checkpoint loader.
3. Wire the `prompt` output into your text encoder.
4. Pick a theme and preset — or check the items you want.

`model` and `clip` are **optional**. Leave them unconnected and the node becomes a pure
prompt composer.

Both nodes let you **bypass the prompt and the LoRAs independently**, which makes A/B
testing a single change quick.

---

## Where things are stored

| What | Where | Shared across workflows |
|---|---|---|
| Theme presets | `presets/<theme>/<name>.json` | ✅ Yes |
| Resolution list | `resolutions.json` | ✅ Yes |
| Wildcard favourites | `wildcard_favorites.json` | ✅ Yes |
| Checklist items | the workflow file | ❌ No |
| Selected values | the workflow file | ❌ No |

`resolutions_default.json` ships with the package and is copied to `resolutions.json` on
first run. Your edits are never overwritten by an update.

Presets start empty — you build the library yourself.

---

## Feedback

Bug reports and feature requests are welcome on the
[issue tracker](https://github.com/1000Pro-1997/SmartNode1000/issues).

---

## License

MIT
