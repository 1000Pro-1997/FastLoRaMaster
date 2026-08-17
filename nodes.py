"""FLA 로라 테마 노드."""

import json
import os
import random

import folder_paths
import comfy.sd
import comfy.utils

from . import presets
from . import wildcards


class FLALoraTheme:
    """테마 하나를 담당하는 노드.

    테마와 프리셋을 고르면 프롬프트와 로라 목록이 불러와지고,
    수정한 뒤 저장하면 파일에 반영된다.
    여러 테마를 쓰려면 노드를 여러 개 놓고 model/clip을 체인으로 잇는다.
    """

    @classmethod
    def INPUT_TYPES(cls):
        themes = presets.list_themes() or [presets.NONE]
        return {
            "required": {
                "theme": (themes, {
                    "tooltip": "Theme to use. Each sub-folder of presets/ is a theme.",
                }),
                "preset": ("STRING", {
                    "default": "",
                    "tooltip": "Selected preset name. Filled in by the UI.",
                }),
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "Prompt text of this preset.",
                }),
                "lora_data": ("STRING", {
                    "default": "[]",
                    "multiline": False,
                    "tooltip": "LoRA list as JSON. Managed by the UI.",
                }),
                "prompt_enabled": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Off drops this node's prompt and passes through the incoming one. LoRAs still apply.",
                }),
                "loras_enabled": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Off skips every LoRA. Each LoRA keeps its own on/off state.",
                }),
                # 맨 뒤에 둬야 한다. 앞에 끼우면 기존 워크플로의
                # widgets_values 인덱스가 밀려 값이 엉뚱한 칸에 들어간다.
                "wildcard_seed": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 0xFFFFFFFFFFFFFFFF,
                    # 이게 있어야 위젯에 randomize/increment 조절이 붙는다.
                    # 없으면 시드가 늘 그대로라 같은 값만 뽑힌다.
                    "control_after_generate": True,
                    "tooltip": "Seed for picking wildcard values. The same seed gives the same result.",
                }),
            },
            "optional": {
                # 연결하지 않아도 동작한다. 프롬프트만 쓰고 싶을 때를 위해서다.
                "model": ("MODEL", {
                    "tooltip": "Connect to apply LoRAs. Without it LoRAs are skipped.",
                }),
                "clip": ("CLIP", {
                    "tooltip": "Connect to apply LoRAs. Without it LoRAs are skipped.",
                }),
                "prompt_in": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Prompt from a previous node. Prepended when connected.",
                }),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "prompt")
    FUNCTION = "apply"
    CATEGORY = "SN1000"
    DESCRIPTION = "Applies LoRAs and composes prompts from theme presets."

    def apply(self, theme, preset, prompt, lora_data,
              prompt_enabled=True, loras_enabled=True, wildcard_seed=0,
              model=None, clip=None, prompt_in=None):
        try:
            parsed = json.loads(lora_data) if lora_data.strip() else []
        except ValueError:
            parsed = []

        entries = presets.normalize({"prompt": prompt, "loras": parsed})

        available = set(folder_paths.get_filename_list("loras"))
        out_model, out_clip = model, clip
        missing = []

        # model/clip 이 없으면 적용할 대상이 없으므로 로라를 건너뛴다.
        # 프롬프트만 쓰려고 연결하지 않은 경우다.
        can_apply = loras_enabled and model is not None and clip is not None

        # loras_enabled 가 꺼지면 개별 켜짐 상태와 무관하게 전부 건너뛴다(바이패스).
        for item in (entries["loras"] if can_apply else []):
            if not item["enabled"]:
                continue
            path = item["path"]
            if path not in available:
                missing.append(path)
                continue
            full = folder_paths.get_full_path("loras", path)
            if full is None or not os.path.isfile(full):
                missing.append(path)
                continue
            weights = comfy.utils.load_torch_file(full, safe_load=True)
            strength = item["strength"]
            out_model, out_clip = comfy.sd.load_lora_for_models(
                out_model, out_clip, weights, strength, strength
            )

        if missing:
            print(f"[FLM] {len(missing)} LoRA(s) not found: {missing}")

        # 로라를 켜뒀는데 model/clip 이 없으면 조용히 무시되므로 알려준다.
        if loras_enabled and (model is None or clip is None):
            want = [i for i in entries["loras"] if i["enabled"]]
            if want:
                print(f"[FLM] Skipping {len(want)} LoRA(s): model/clip not connected.")

        # 프롬프트를 끄면 앞 노드 것만 통과시킨다(바이패스).
        parts = []
        if prompt_in:
            parts.append(prompt_in.strip())
        if prompt_enabled and entries["prompt"].strip():
            parts.append(entries["prompt"].strip())
        combined = ", ".join(p for p in parts if p)

        # 와일드카드(__이름__, {a|b|c})를 실제 값으로 바꾼다.
        # 앞 노드에서 온 글도 함께 처리해야 체인 어디에 써도 똑같이 풀린다.
        missing = []
        combined = wildcards.expand(combined, random.Random(wildcard_seed), missing)
        if missing:
            print(f"[FLM] Wildcard not found: {missing}")

        return (out_model, out_clip, combined)


NODE_CLASS_MAPPINGS = {
    "SN1000LoraTheme": FLALoraTheme,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SN1000LoraTheme": "SN1000 Lora Theme",
}
