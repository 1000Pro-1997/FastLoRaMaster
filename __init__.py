from .nodes import (
    NODE_CLASS_MAPPINGS as _LORA_NODES,
    NODE_DISPLAY_NAME_MAPPINGS as _LORA_NAMES,
)
from .nodes_resolution import (
    NODE_CLASS_MAPPINGS as _RES_NODES,
    NODE_DISPLAY_NAME_MAPPINGS as _RES_NAMES,
)
from .nodes_checklist import (
    NODE_CLASS_MAPPINGS as _CHK_NODES,
    NODE_DISPLAY_NAME_MAPPINGS as _CHK_NAMES,
)
from . import api  # noqa: F401  API 라우트 등록

# 노드가 늘어나면 여기에 모아서 등록한다.
NODE_CLASS_MAPPINGS = {**_LORA_NODES, **_RES_NODES, **_CHK_NODES}
NODE_DISPLAY_NAME_MAPPINGS = {**_LORA_NAMES, **_RES_NAMES, **_CHK_NAMES}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
