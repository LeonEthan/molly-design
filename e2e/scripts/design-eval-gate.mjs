import { readFile } from 'node:fs/promises';

const compact = (text) => text.replace(/\s+/gu, '');

const elementText = (element) =>
  (element.text?.paragraphs ?? [])
    .map((paragraph) => (paragraph.runs ?? []).map((run) => run.text).join(''))
    .join('');

/** Automatic pass/fail checks for one committed design; visual quality stays with the owner. */
export function checkDesignGate(gate, doc) {
  const failures = [];
  const { width, height } = doc.canvas;
  if (width !== gate.canvas[0] || height !== gate.canvas[1]) {
    failures.push(`canvas is ${width}x${height}, expected ${gate.canvas.join('x')}`);
  }
  const texts = doc.elements.filter((element) => element.kind === 'text');
  const editable = texts.map((element) => compact(elementText(element)));
  for (const required of gate.requiredText) {
    if (!editable.some((text) => text.includes(compact(required)))) {
      failures.push(`missing editable text: ${required}`);
    }
  }
  if (gate.textInsideCanvas) {
    for (const element of texts) {
      const [x, y, w, h] = element.bounds;
      if (x < 0 || y < 0 || x + w > width || y + h > height) {
        failures.push(`text ${element.id} extends outside the canvas`);
      }
    }
  }
  return { status: failures.length === 0 ? 'passed' : 'failed', failures };
}

export async function readCase(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [caseFile, designFile] = process.argv.slice(2);
  if (!caseFile || !designFile) {
    throw Error('usage: node e2e/scripts/design-eval-gate.mjs <case.json> <design.json>');
  }
  const { gate } = await readCase(caseFile);
  const { doc } = JSON.parse(await readFile(designFile, 'utf8'));
  const result = checkDesignGate(gate, doc);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'passed') process.exitCode = 1;
}
