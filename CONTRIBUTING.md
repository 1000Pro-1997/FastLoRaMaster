# comfy_FLA — 개발 규칙

새 노드를 만들거나 기존 노드를 고칠 때 **반드시** 지켜야 하는 것들입니다.

---

## 1. 문서를 먼저 갱신한다

**코드를 고쳤으면 그 노드의 문서도 같은 커밋에서 고칩니다.** 미루지 않습니다.

| 문서 | 언제 고치나 |
|---|---|
| `docs/FLALoraTheme.md` | 로라 테마 노드를 건드렸을 때 |
| `docs/FLAResolution.md` | 해상도 노드를 건드렸을 때 |
| `docs/FLAChecklist.md` | 체크리스트 노드를 건드렸을 때 |
| `docs/ARCHITECTURE.md` | 파일 구조·저장 방식·API가 바뀌었을 때 |
| `CONTRIBUTING.md` (이 파일) | 규칙 자체가 바뀌었을 때 |

노드를 새로 만들면 `docs/<노드클래스명>.md` 를 새로 만듭니다. 기존 문서를 형식 그대로 따라 씁니다.

---

## 2. 번역을 고려한다

배포 대상이 한국어 사용자만이 아닙니다. **코드에 보이는 글자는 영어가 기본**이고, 한국어·중국어는 번역으로 넣습니다.

### 파이썬 쪽

노드 정의는 전부 영어로 씁니다.

```python
"tooltip": "Off skips every LoRA."          # O
"tooltip": "끄면 로라를 적용하지 않는다."      # X
RETURN_NAMES = ("width", "height", "info")  # O
```

그리고 `locales/ko/nodeDefs.json`, `locales/zh/nodeDefs.json` 에 번역을 넣습니다.

```json
{
  "FLAResolution": {
    "display_name": "FLA 해상도",
    "description": "해상도를 골라 가로/세로 정수로 내보냅니다.",
    "inputs": { "width": { "name": "가로", "tooltip": "…" } },
    "outputs": { "0": { "name": "가로" } }
  }
}
```

ComfyUI가 언어 설정에 따라 알아서 덮어씁니다.

### JavaScript 쪽

캔버스에 직접 그리는 글자는 **ComfyUI 번역 시스템이 닿지 않습니다.** `web/fla_i18n.js` 를 씁니다.

```javascript
import { t } from "./fla_i18n.js";

ctx.fillText(t("save"), x, y);          // O
ctx.fillText("저장", x, y);              // X
```

문구를 새로 추가할 때는 **`en`, `ko`, `zh` 세 곳을 모두** 채웁니다. 하나라도 빠지면 그 언어에서 영어가 그대로 보입니다.

### 번역하면 안 되는 것

- **타입 이름** — `MODEL`, `CLIP`, `IMAGE` 등. ComfyUI 공통 규약입니다.
- **경계를 넘는 상수** — `presets.NONE` 처럼 파이썬과 JS가 값으로 비교하는 것. 언어 중립 값(`"-"`)을 씁니다.
- **사용자 데이터** — 프리셋 이름, 해상도 그룹 이름. 사용자가 직접 정합니다.

### 배포용 기본 데이터

`resolutions_default.json` 같은 **패키지에 딸려가는 데이터는 영어로** 씁니다. 사용자가 받은 뒤 자기 언어로 고치면 그게 사용자 파일에 남습니다.

---

## 3. 위젯 순서를 건드리지 않는다

ComfyUI는 위젯 값을 **배열 인덱스로** 저장하고 복원합니다.

```
저장: widgets_values[i] ← widgets[i].value   (serialize:false 는 건너뜀)
복원: widgets[i].value  ← widgets_values[i]  (건너뛰지 않음)
```

여기서 두 가지 규칙이 나옵니다.

**JS로 추가한 위젯에는 반드시 `serialize = false` 를 붙입니다.** 안 붙이면 저장 슬롯을 차지해서 파이썬 위젯 값이 밀립니다. 증상은 "프롬프트 칸에 프리셋 이름이 들어감", "토글이 항상 켜진 상태로 초기화됨" 처럼 나타납니다.

```javascript
const row = { type: "custom", name: "my_row", serialize: false, /* … */ };
```

**거꾸로, 파이썬 위젯에는 `serialize = false` 를 절대 붙이지 않습니다.** 파이썬이 정의한
위젯은 저장 슬롯을 하나씩 차지해야 합니다. 화면에서 감추려고 붙이면 저장 때만 건너뛰고
복원 때는 안 건너뛰므로 뒤쪽 값이 앞으로 밀립니다. 감출 때는 높이와 그리기만 없애고
`serialize` 는 그대로 둡니다.

증상은 **복사·붙여넣기 하면 값이 초기화되는 것**으로 나타납니다.

**화면 배치를 위해 순서를 바꿔야 하면 저장·복원 시 원래 순서로 되돌립니다.** `fla_lora_theme.js` 의 `flaOriginalOrder` 를 참고하세요.

---

## 3-1. `onConfigure` 가 `onNodeCreated` 보다 먼저 올 수 있다

워크플로를 다시 열면 **복원이 먼저 끝난 뒤** `onNodeCreated` 가 도는 경우가 있습니다.
그래서 `onNodeCreated` 에서 상태를 무턱대고 초기화하면 안 됩니다.

```javascript
node.flaItems = [];              // X  복원된 값을 지운다
node.flaItems = readItems(node); // O  위젯에 남아 있는 값을 먼저 읽는다
```

위젯 값을 되쓰는 함수(`syncHidden` 같은 것)를 초기화 직후에 부르면, 빈 상태가
위젯에 덮여써져 **새로고침할 때마다 내용이 사라집니다.**

`fla_lora_theme.js` 도 같은 이유로 `onConfigure 가 먼저 실행됨` 을 전제하고 씁니다.

---

## 4. 화면 표시와 실제 출력을 일치시킨다

JS에서 미리 계산해 보여주는 값이 있다면, **파이썬이 내놓는 값과 같아야 합니다.** 다르면 디버깅용 표시가 거짓말을 합니다.

해상도 노드가 그 예입니다. 파이썬이 8의 배수로 내림하므로, JS도 값을 넣을 때 8의 배수로 맞춥니다.

```javascript
const snapped = Math.round(v / 8) * 8;   // 파이썬 floor 를 통과해도 그대로 남는 값
```

새로 만들 때는 **양쪽 결과를 실제로 대조**해 보세요.

---

## 5. 노드 크기를 함부로 바꾸지 않는다

- **폭** — 사용자가 정한 값을 그대로 둡니다. `Math.max(keep, MIN)` 같은 걸로 강제하면 좁혀놓은 노드가 다시 넓어집니다.
- **커스텀 위젯의 `computeSize`** — 폭은 `0` 을 돌려줍니다. 값을 돌려주면 그게 최소 폭이 됩니다.
- **높이** — 줄 수가 바뀌면 `node.computeSize()[1]` 로 다시 계산합니다. 안 하면 접었을 때 빈 공간이 남습니다.

---

## 6. 커스텀 위젯 마우스 처리

프론트엔드는 `widget.mouse` 를 **pointerup** 으로 호출합니다. `pointerdown` 만 받으면 클릭이 먹지 않습니다.

```javascript
mouse(event, pos) {
    const t = event.type;
    if (t === "pointerdown" || t === "mousedown") return true;   // 눌림만 알림
    if (t !== "pointerup" && t !== "mouseup") return false;
    // 실제 동작은 여기서 한 번만
}
```

---

## 6-1. Node 2.0 전용 위젯을 쓰지 않는다

`addWidget()` 의 일부 타입은 **Node 2.0 에서만** 그려집니다. 기존 캔버스에서는 내용 대신
`Textarea: Node 2.0 전용` 같은 자리표시가 나옵니다.

```javascript
node.addWidget("textarea", ...)   // X  Node 2.0 전용
```

여러 줄 입력이 필요하면 ComfyUI 의 multiline STRING 위젯과 같은 방식으로 `<textarea>` 를
직접 만들어 얹습니다. `fla_checklist.js` 의 `makePromptWidget()` 을 참고하세요.

DOM 요소를 얹었으면 **치우는 것까지 책임집니다.** 위젯을 걷어낼 때와 노드를 지울 때
(`onRemoved`) 요소를 제거하지 않으면 화면에 그대로 남습니다.

얹은 요소가 **엉뚱한 자리에 나타났다 제자리로 튀면** 순서 문제입니다.

- `display:none` 대신 **`visibility:hidden`** 으로 감춥니다. `display` 는 자리 자체가 없어서
  다시 켤 때 크기가 새로 잡히며 튑니다.
- 좌표와 크기를 **모두 대입한 뒤** 마지막에 보이게 합니다.
- 위젯을 다시 만드는 동안(`rebuild`)에는 노드 크기가 아직 확정되지 않았으므로 계속 숨겨둡니다.

---

## 7. 사용자 데이터를 덮어쓰지 않는다

기본 데이터와 사용자 데이터를 나눕니다.

```
resolutions_default.json   ← 패키지 동봉, 절대 쓰지 않음
resolutions.json           ← 사용자 파일, 없을 때만 기본에서 복사
```

노드를 갱신해도 사용자가 고친 내용이 남아야 합니다. `ensure_user_file()` 처럼 **파일이 있으면 즉시 반환**하는 형태로 만듭니다.

---

## 8. 경로를 신뢰하지 않는다

사용자가 넣은 이름으로 파일을 만들 때는 경로 탈출을 막습니다. `presets._safe_name()` 을 참고하세요.

```python
name = name.replace("\\", "/").split("/")[-1]   # 디렉터리 성분 제거
name = re.sub(r'[<>:"|?*\x00-\x1f]', "", name)  # 파일명 금지 문자 제거
```

---

## 9. 구분자와 겹치는 이름을 피한다

드롭다운에서 `"그룹 / 항목"` 형식을 쓰므로, **그룹 이름에 `/` 가 들어가면 파싱이 깨집니다.** 기본 데이터에는 넣지 말고, 조회할 때는 전체 문자열을 그대로 비교하는 방식으로 방어합니다.

---

## 10. 고치면 확인한다

- 파이썬 — `python -c "import ast; ast.parse(open('파일','utf-8').read())"`
- JS — `node --input-type=module --check < 파일.js`
- 통합 — ComfyUI를 실제로 띄우고 **재시작 + `Ctrl+Shift+R`**

### `--check` 는 없는 변수를 못 잡는다

문법 검사는 **선언되지 않은 이름을 통과시킵니다.** 상수를 지우거나 블록을 통째로
바꿨을 때 `NUM_TOTAL is not defined` 같은 오류가 `draw` 안에서 터지고,
캔버스 그리기가 그 자리에서 멈춰 **화면 전체가 사라집니다.**

증상이 "특정 조건에서만 화면이 사라짐" 이면 이걸 의심하세요. 콘솔(F12)에 오류가 남습니다.

블록을 지우거나 옮겼으면 **지운 범위에 딸려간 것이 없는지** 확인합니다.

```bash
grep -n "쓰는이름" web/파일.js   # 선언 없이 쓰이는 곳이 있는지
```

조건에 따라 갈리는 draw 경로(로라가 있을 때 / 없을 때, 켜짐 / 꺼짐)는
**각각 한 번씩은 실제로 그려봐야** 합니다.

JS는 브라우저 캐시가 남으므로 강력 새로고침이 필요합니다. 파이썬을 고쳤으면 ComfyUI 재시작이 필요합니다.
