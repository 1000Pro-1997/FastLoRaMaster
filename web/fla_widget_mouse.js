import { app } from "../../scripts/app.js";

/** 커스텀 위젯 공통 마우스 처리.
 *
 *  프론트엔드(LGraphCanvas.processWidgetClick)는 widget.mouse() 의 반환값을
 *  "이벤트를 처리했다"가 아니라 dirty_canvas 값으로 쓴다.
 *
 *      else if (widget.mouse) {
 *        const result = widget.mouse(e, [x, y], node)
 *        if (result != null) this.dirty_canvas = result
 *      }
 *
 *  그러니 무엇을 돌려주든 이벤트가 소비되지는 않는다.
 *  같은 클릭이 두 번 처리되지 않도록 실제 동작은 up 에서만 한 번 한다.
 */
export function mouseGate(event) {
    const type = event?.type;
    if (type === "pointerdown" || type === "mousedown") return "down";
    if (type === "pointerup" || type === "mouseup") return "up";
    return null;
}

/** 위젯 클릭 상태(node_widget)를 강제로 정리한다.
 *
 *  프론트엔드는 pointerup 뒤 pointer.finally 안에서 node_widget 을 비운다.
 *
 *      pointer.finally = () => {
 *        if (widget.mouse) { const { eUp } = pointer; if (!eUp) return
 *                            widget.mouse(eUp, ...) }      // ← 여기서 예외가 나면
 *        this.node_widget = null                            // ← 여기에 도달하지 못한다
 *      }
 *
 *  즉 widget.mouse() 가 up 처리 중에 예외를 던지면 node_widget 이 남는다.
 *  남은 node_widget 은 이후 모든 pointermove 를 그 위젯으로만 흘려보내
 *  (processMouseMove) 다른 버튼이 반응하지 않는 것처럼 보인다.
 *
 *  핸들러가 예외 없이 끝나면 프론트엔드가 알아서 정리하므로 보통은 필요 없다.
 *  블로킹 대화상자처럼 흐름이 끊길 수 있는 곳에서만 보험으로 쓴다.
 */
export function releaseWidgetCapture() {
    const canvas = app?.canvas;
    if (!canvas) return;
    canvas.node_widget = null;
    canvas.block_click = false;
}

/** node_widget 대입이 끝난 뒤로 미뤄서 정리한다.
 *
 *  pointerdown 처리 중에 바로 풀면 소용이 없다.
 *  프론트엔드가 widget.mouse() 를 부른 "뒤에" node_widget 을 채우기 때문이다.
 *
 *      if (widget) { this.processWidgetClick(e, node, widget)   // ← 여기서 mouse()
 *                    this.node_widget = [node, widget] }        // ← 그 다음 대입
 */
export function releaseWidgetCaptureSoon() {
    releaseWidgetCapture();
    // 예약해둔 정리가 "다음" 클릭까지 살아남으면 안 된다.
    // 그 사이에 새 위젯이 잡히면(예: 강도 숫자 드래그) 그것까지 풀어버려
    // pointermove 가 위젯에 전달되지 않는다. 대입해둔 주인이 그대로일 때만 푼다.
    const canvas = app?.canvas;
    // node_widget 은 [node, widget] 배열이라 매번 새로 만들어진다.
    // 위젯 자체를 기억해 두고, 같은 위젯일 때만 푼다.
    const owner = canvas?.node_widget?.[1] ?? null;
    Promise.resolve().then(() => {
        if (!canvas) return;
        const current = canvas.node_widget?.[1] ?? null;
        // 그 사이 다른 위젯이 잡혔으면(예: 강도 숫자 드래그) 건드리지 않는다
        if (current !== null && current !== owner) return;
        releaseWidgetCapture();
    });
}

/** 위젯을 통째로 다시 만들기 직전에 부른다.
 *
 *  rebuild 는 화면의 위젯 객체를 전부 새로 만든다. 그런데 프론트엔드가
 *  잡아둔 canvas.node_widget 은 옛 위젯을 계속 가리키고 있어서,
 *  그 뒤의 pointermove 가 이미 화면에서 사라진 위젯으로 전달된다.
 *  잡혀 있던 위젯이 이 노드 것이면 놓아준다.
 */
export function dropCaptureFor(node) {
    const canvas = app?.canvas;
    if (!canvas?.node_widget) return;
    if (canvas.node_widget[0] !== node) return;
    canvas.node_widget = null;
}
