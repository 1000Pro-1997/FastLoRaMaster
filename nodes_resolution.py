"""해상도 노드."""

from math import gcd

from . import resolutions


def ratio_text(w, h):
    """1024x1024 → "1:1", 1920x1080 → "16:9" 처럼 약분해 보여준다.

    딱 떨어지지 않으면 소수(예: "1.78:1")로 대신한다.
    """
    if w <= 0 or h <= 0:
        return "-"
    g = gcd(int(w), int(h))
    rw, rh = int(w) // g, int(h) // g
    if rw <= 64 and rh <= 64:
        return f"{rw}:{rh}"
    return f"{w / h:.2f}:1"


class FLAResolution:
    """가로/세로를 정해 정수로 내보낸다.

    - width / height 가 실제 값이다. UI 는 이 두 값을 채워 넣는 도구일 뿐이다.
    - 목록에서 고르면 두 값이 한 번에 채워진다.
    - 비율 연동을 켜면 한쪽을 바꿀 때 반대쪽이 비율에 맞춰 따라온다(UI 담당).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 8,
                    "tooltip": "Width. May be filled in from the list or ratio.",
                }),
                "height": ("INT", {
                    "default": 1024, "min": 64, "max": 8192, "step": 8,
                    "tooltip": "Height.",
                }),
                "preset": ("STRING", {
                    "default": "",
                    "tooltip": "Selected list entry. Display only.",
                }),
                "group": ("STRING", {
                    "default": "",
                    "tooltip": "Current group name. Managed by the UI.",
                }),
                "ratio": ("STRING", {
                    "default": "1:1",
                    "tooltip": "Aspect ratio text, used by the UI when ratio link is on.",
                }),
                "link_ratio": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "On makes the other side follow the ratio when one side changes.",
                }),
                "swap": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "On swaps width and height on output.",
                }),
            },
        }

    RETURN_TYPES = ("INT", "INT", "STRING")
    RETURN_NAMES = ("width", "height", "info")
    FUNCTION = "pick"
    CATEGORY = "FLM"
    DESCRIPTION = "Picks a resolution and outputs width/height as integers."

    def pick(self, width, height, preset, group, ratio, link_ratio, swap):
        w, h = int(width), int(height)

        if swap:
            w, h = h, w

        # 8의 배수로 맞춘다. 대부분의 모델이 이 단위를 요구한다.
        w = max(64, (w // 8) * 8)
        h = max(64, (h // 8) * 8)

        name = preset.strip() if isinstance(preset, str) else ""
        label = name if name else "manual"
        info = f"{w} x {h}  ({ratio_text(w, h)})  {label}"
        return (w, h, info)


NODE_CLASS_MAPPINGS = {
    "FLAResolution": FLAResolution,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FLAResolution": "FLM Resolution",
}
