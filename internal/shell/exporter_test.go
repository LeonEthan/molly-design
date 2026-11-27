package shell

import (
	"fmt"
	"image"
	"image/color"
	"os/exec"
	"testing"
)

func TestExportAreaSamplingWithAlpha(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
	tiles, _ := PlanExportTiles(1, 1, 1, 1, 0)
	result, err := StitchCapturedTiles(1, 1, 1, []CapturedTile{{tiles[0], img}})
	if err != nil {
		t.Fatal(err)
	}
	if got := result.NRGBAAt(0, 0); got != (color.NRGBA{R: 255, A: 64}) {
		t.Fatal(got)
	}
}

func TestOffscreenTileWaitsForImageDecodingWithoutAnimationFrames(t *testing.T) {
	script := `import assert from 'node:assert/strict';
globalThis.window = {bento:{doc:{}}};
globalThis.devicePixelRatio = 2;
globalThis.MutationObserver = class {observe(){} disconnect(){}};
const html = Promise.withResolvers(), svg = Promise.withResolvers();
const stage = {offsetWidth:4,offsetHeight:6,style:{},querySelectorAll(tag){
 if(tag==='img') return [{decode:()=>html.promise}];
 assert.equal(tag,'image');
 return [{getAttribute:name=>name==='xlink:href'?'asset.png':null}];
},getBoundingClientRect(){return {left:-1,top:-2}}};
globalThis.Image = class {decode(){assert.equal(this.src,'asset.png');return svg.promise}};
let mounted=false;
globalThis.document={fonts:[],documentElement:{style:{}},body:{style:{},replaceChildren(el){assert.equal(el,stage);mounted=true}},querySelector:()=>stage};
const ready = ` + fmt.Sprintf(offscreenReadyJS, 4, 6) + `;
html.resolve();
await new Promise(setImmediate);
assert.equal(mounted,false);
svg.resolve();
assert.equal(await ready,2);
assert(mounted);
assert.equal(await ` + fmt.Sprintf(offscreenTileJS, -1, -2, -1, -2, 42) + `,42);`
	if out, err := exec.Command("node", "--input-type=module", "-e", script).CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
}
