# 구조

`comfy_FLA` 패키지 전체의 구성과, 노드를 새로 만들 때 알아야 할 공통 사항입니다.

---

## 파일 구성

```
comfy_FLA/
├─ __init__.py                 노드 등록 (여기에 새 노드를 추가)
├─ api.py                      프론트엔드용 HTTP 라우트
│
├─ nodes.py                    FLALoraTheme
├─ presets.py                  프리셋 파일 저장소
│
├─ nodes_resolution.py         FLAResolution
├─ resolutions.py              해상도 목록 저장소
├─ resolutions_default.json    기본 해상도 (배포용, 영어)
├─ resolutions.json            사용자 해상도 (자동 생성)
│
├─ nodes_checklist.py          FLAChecklist
├─ checklist.py                체크리스트 항목 정리 (파일 저장 없음)
│
├─ presets/                    사용자 프리셋 (자동 생성)
│   └─ <테마>/<프리셋>.json
│
├─ locales/                    ComfyUI 번역
│   ├─ ko/nodeDefs.json
│   └─ zh/nodeDefs.json
│
├─ web/                        ComfyUI가 자동으로 읽어감
│   ├─ fla_i18n.js             JS 공용 번역
│   ├─ fla_lora_theme.js
│   ├─ fla_resolution.js
│   └─ fla_checklist.js
│
├─ CONTRIBUTING.md             개발 규칙 (먼저 읽을 것)
└─ docs/                       노드별 문서
```

---

## 노드 추가하기

1. `nodes_<이름>.py` 에 클래스와 `NODE_CLASS_MAPPINGS` 를 만듭니다
2. `__init__.py` 에서 합칩니다

```python
from .nodes_myfeature import (
    NODE_CLASS_MAPPINGS as _MY_NODES,
    NODE_DISPLAY_NAME_MAPPINGS as _MY_NAMES,
)
NODE_CLASS_MAPPINGS = {**_LORA_NODES, **_RES_NODES, **_MY_NODES}
NODE_DISPLAY_NAME_MAPPINGS = {**_LORA_NAMES, **_RES_NAMES, **_MY_NAMES}
```

3. UI가 필요하면 `web/fla_<이름>.js` 를 만듭니다. `web/` 안의 `.js` 는 **전부 자동으로 로드**됩니다
4. `locales/ko`, `locales/zh` 에 번역을 추가합니다
5. `docs/<클래스명>.md` 를 만듭니다

---

## 데이터 저장 위치

| 데이터 | 위치 | 범위 |
|---|---|---|
| 프리셋 목록 | `presets/` | 전역 (모든 워크플로 공유) |
| 해상도 목록 | `resolutions.json` | 전역 |
| 체크리스트 항목 | 워크플로 `.json` | 노드별 (노드마다 다름) |
| 노드가 고른 값 | 워크플로 `.json` | 노드별 |

**전역이냐 노드별이냐** — 여러 노드가 같은 목록을 돌려 쓰면 파일에 두고(`presets/`), 노드마다 내용이 달라야 하면 위젯에 JSON으로 담아 워크플로에 저장합니다(`FLAChecklist`). 후자는 API도 저장소 모듈도 필요 없습니다.

**기본/사용자 분리** — 배포용 기본 파일은 `_default` 를 붙이고 절대 쓰지 않습니다. 사용자 파일이 없을 때만 복사합니다. 그래야 노드를 갱신해도 사용자가 고친 내용이 남습니다.

---

## ComfyUI 위젯 저장 방식

가장 많이 문제를 일으킨 부분입니다.

```
저장: for (i, w) of widgets.entries()
        if (w.serialize === false) continue      ← 건너뛰지만 인덱스는 유지
        widgets_values[i] = w.value

복원: for i in 0..widgets_values.length
        widgets[i].value = widgets_values[i]     ← 건너뛰지 않음
```

**비대칭입니다.** 여기서 두 규칙이 나옵니다.

- JS로 만든 위젯에는 **반드시 `serialize = false`**
- 순서를 바꿔야 하면 저장·복원 때 **원래 순서로 되돌리기**

`fla_lora_theme.js` 의 `flaOriginalOrder`, `onSerialize`, `onConfigure` 를 참고하세요.

### 증상으로 원인 찾기

| 증상 | 원인 |
|---|---|
| 프롬프트 칸에 프리셋 이름이 들어감 | 위젯 인덱스가 밀림 |
| 토글이 항상 켜진 채로 복원됨 | 위와 같음 |
| 새로고침하면 값이 사라짐 | `serialize:false` 누락 또는 순서 문제 |

---

## 커스텀 캔버스 위젯

`type: "custom"` 으로 만들고 `draw` / `mouse` / `computeSize` 를 씁니다. rgthree 의 Power Lora Loader 방식과 같습니다.

```javascript
const row = {
    type: "custom",
    name: "my_row",
    serialize: false,
    bounds: { btn: null },              // 클릭 판정 영역
    computeSize() { return [0, 22]; },  // 폭은 0 (사용자 폭 유지)
    draw(ctx, node, widgetWidth, posY, height) {
        const width = node.size?.[0] ?? widgetWidth;   // 인자 대신 노드 폭
        // … 그리면서 bounds 갱신
    },
    mouse(event, pos) {
        const t = event.type;
        if (t === "pointerdown" || t === "mousedown") return true;
        if (t !== "pointerup" && t !== "mouseup") return false;
        // 실제 동작
    },
};
```

주의할 점입니다.

- **폭은 `node.size[0]`** 을 씁니다. `draw` 인자로 오는 폭은 버전마다 다릅니다
- **`computeSize` 는 폭 `0`** 을 돌려줍니다. 값을 주면 최소 폭이 되어 노드를 좁힐 수 없습니다
- **마우스는 `pointerup`** 에서 처리합니다
- **툴팁**은 `widget.tooltip` 에 넣으면 됩니다 (`element` 가 없는 위젯만)

---

## 번역

두 갈래입니다.

**노드 정의** — 파이썬에 영어로 쓰고 `locales/<lang>/nodeDefs.json` 에 번역을 넣습니다. ComfyUI가 알아서 적용합니다.

**캔버스 글자** — 번역 시스템이 닿지 않습니다. `web/fla_i18n.js` 의 `t()` 를 씁니다.

```javascript
import { t } from "./fla_i18n.js";
ctx.fillText(t("save"), x, y);
```

문구를 추가할 때 `en`, `ko`, `zh` 세 곳을 모두 채웁니다. 자세한 규칙은 [CONTRIBUTING.md](../CONTRIBUTING.md) 를 보세요.

---

## 언어 중립 상수

파이썬과 JS가 **값으로 비교**하는 것은 번역하지 않습니다.

```python
NONE = "-"      # presets.py
```
```javascript
const NONE = "-";   // 파이썬 presets.NONE 과 같아야 한다
```

번역하면 비교가 깨져서 "선택 없음" 판정이 틀어집니다.
