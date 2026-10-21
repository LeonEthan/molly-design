/**
 * Hold-to-compare overlay: the pre-turn render as a static image over the
 * stage while the user holds the compare control. Display-only DOM — it never
 * touches the document, it blocks stage pointer input while shown so the
 * hidden current artwork cannot be edited blind, and it follows the stage
 * through zoom and pan. It sits above the element highlights (they describe
 * the current document, not this frame) and below the note pins and tray.
 */
export function createCompareOverlay() {
  const style = document.createElement('style');
  style.textContent = `
.molly-compare{position:fixed;inset:0;z-index:2147483098;pointer-events:none}
.molly-compare[hidden]{display:none}
.molly-compare img{position:absolute;margin:0;pointer-events:auto;user-select:none;-webkit-user-select:none}
`;
  const layer = document.createElement('div');
  layer.className = 'molly-compare';
  layer.hidden = true;
  const image = document.createElement('img');
  image.alt = '';
  image.draggable = false;
  layer.append(image);
  document.head.append(style);
  document.body.append(layer);
  let frame = 0;
  const track = () => {
    frame = 0;
    const stage = document
      .querySelector('.ed-stage-scale .bento-slide')
      ?.getBoundingClientRect();
    if (stage && stage.width && stage.height) {
      image.style.left = `${stage.left}px`;
      image.style.top = `${stage.top}px`;
      image.style.width = `${stage.width}px`;
      image.style.height = `${stage.height}px`;
      image.style.visibility = 'visible';
    } else {
      image.style.visibility = 'hidden';
    }
    frame = requestAnimationFrame(track);
  };
  const hide = () => {
    layer.hidden = true;
    cancelAnimationFrame(frame);
    frame = 0;
  };
  return {
    show(src: string) {
      image.src = src;
      layer.hidden = false;
      cancelAnimationFrame(frame);
      track();
    },
    hide,
    dispose() {
      hide();
      layer.remove();
      style.remove();
    },
  };
}
