"""FLA 체크리스트 노드."""

import os
import random

import folder_paths
import comfy.sd
import comfy.utils

from . import checklist
from . import wildcards


class FLAChecklist:
    """토글로 켠 항목만 프롬프트에 넣는 노드.

    항목 목록은 노드가 직접 들고 있다(items_data). 노드마다 체크리스트가
    다르므로 파일로 공유하지 않고 워크플로에 함께 저장된다.
    항목에 로라를 달아두면 그 항목을 켤 때 함께 적용된다.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "items_data": ("STRING", {
                    "default": "[]",
                    "multiline": False,
                    "tooltip": "Checklist items as JSON. Managed by the UI.",
                }),
                "delimiter": ("STRING", {
                    "default": ", ",
                    "tooltip": "Text placed between the prompts of checked items.",
                }),
                "prompt_enabled": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Off drops this node's prompt and passes through the incoming one. LoRAs still apply.",
                }),
                "loras_enabled": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Off skips every LoRA. Each item keeps its own on/off state.",
                }),
                # 펼쳐진 항목의 프롬프트를 담는 칸. ComfyUI 기본 여러 줄 위젯을
                # 그대로 쓰려고 파이썬에 둔다. 실제 값은 items_data 가 정본이라
                # 실행에는 쓰지 않는다.
                #
                # 맨 뒤에 둬야 한다. 앞에 끼우면 기존 워크플로의
                # widgets_values 인덱스가 밀려 값이 엉뚱한 칸에 들어간다.
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "Prompt of the item whose settings are open. Edited by the UI.",
                }),
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
    DESCRIPTION = "Builds a prompt from the checked items and applies their LoRAs."

    def apply(self, items_data, prompt="", delimiter=", ",
              prompt_enabled=True, loras_enabled=True, wildcard_seed=0,
              model=None, clip=None, prompt_in=None):
        # prompt 는 UI 편집칸일 뿐이다. 실제 내용은 items_data 안에 들어 있다.
        items = checklist.parse(items_data)

        available = set(folder_paths.get_filename_list("loras"))
        out_model, out_clip = model, clip
        missing = []

        wanted = checklist.active_loras(items)

        # model/clip 이 없으면 적용할 대상이 없으므로 로라를 건너뛴다.
        # 프롬프트만 쓰려고 연결하지 않은 경우다.
        can_apply = loras_enabled and model is not None and clip is not None

        # loras_enabled 가 꺼지면 개별 켜짐 상태와 무관하게 전부 건너뛴다(바이패스).
        for item in (wanted if can_apply else []):
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
        if loras_enabled and wanted and (model is None or clip is None):
            print(f"[FLM] Skipping {len(wanted)} LoRA(s): model/clip not connected.")

        # 프롬프트를 끄면 앞 노드 것만 통과시킨다(바이패스).
        if prompt_enabled:
            combined = checklist.compose(items, prompt_in, delimiter)
        else:
            combined = prompt_in.strip() if isinstance(prompt_in, str) else ""

        # 와일드카드(__이름__, {a|b|c})를 실제 값으로 바꾼다.
        missing = []
        combined = wildcards.expand(combined, random.Random(wildcard_seed), missing)
        if missing:
            print(f"[FLM] Wildcard not found: {missing}")

        return (out_model, out_clip, combined)


NODE_CLASS_MAPPINGS = {
    "SN1000Checklist": FLAChecklist,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SN1000Checklist": "SN1000 Lora Checklist",
}
