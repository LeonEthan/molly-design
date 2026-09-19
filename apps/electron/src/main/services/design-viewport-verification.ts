import { strict as assert } from 'node:assert'
import type { WebContentsView } from 'electron'

/** Measure the actual native layout, not a copy of the viewport policy. */
export async function assertDesignFits(view: WebContentsView) {
  const geometry = await view.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('.ed-scroll');
    const stage = document.querySelector('.ed-stage-scale .bento-slide');
    const box = scroller.getBoundingClientRect();
    const rect = stage.getBoundingClientRect();
    const { width, height } = window.bento.doc.size;
    return {
      scale: window.bento.viewport().scale,
      expected: Math.min((scroller.clientWidth - 64) / width, (scroller.clientHeight - 64) / height),
      left: rect.left - box.left - scroller.clientLeft,
      top: rect.top - box.top - scroller.clientTop,
      right: box.left + scroller.clientLeft + scroller.clientWidth - rect.right,
      bottom: box.top + scroller.clientTop + scroller.clientHeight - rect.bottom
    };
  })()`)
  assert.ok(Math.abs(geometry.scale - geometry.expected) < 1e-6, JSON.stringify(geometry))
  for (const edge of ['left', 'right', 'top', 'bottom'])
    assert.ok(geometry[edge] >= 31, JSON.stringify(geometry))
  assert.ok(Math.abs(geometry.left - geometry.right) <= 2, JSON.stringify(geometry))
  assert.ok(Math.abs(geometry.top - geometry.bottom) <= 2, JSON.stringify(geometry))
  return geometry
}
