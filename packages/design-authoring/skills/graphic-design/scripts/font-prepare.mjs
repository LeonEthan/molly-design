#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONTTOOLS_VERSION = '4.60.2';
const usage = `font-prepare:
  setup <environment-dir> [--python <python3>]
  faces <source.ttf|otf|ttc|woff> --python <environment-dir>/bin/python
  woff <source.ttf|otf|ttc|woff> <new-output.woff> --face <index> --python <environment-dir>/bin/python
Setup explicitly installs pinned FontTools in an isolated environment. Keep that
environment outside the collected artwork tree, in the workspace or $TMPDIR.
WOFF keeps the complete selected font, including all glyphs. It preserves source
files and refuses to overwrite output or emit a font larger than 16 MiB.`;

export function parseFontArguments(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || !command) return { command: 'help' };
  if (!['setup', 'faces', 'woff'].includes(command)) throw new Error(usage);
  const positional = [];
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    if (
      !['--python', '--face'].includes(value) ||
      options[value] !== undefined ||
      !rest[i + 1] ||
      rest[i + 1].startsWith('--')
    )
      throw new Error(usage);
    options[value] = rest[++i];
  }
  if (positional.length !== (command === 'woff' ? 2 : 1)) throw new Error(usage);
  if (command !== 'woff' && options['--face'] !== undefined) throw new Error(usage);
  if (command === 'woff' && !/^\d+$/.test(options['--face'] ?? ''))
    throw new Error('Select a face index from the faces command.');
  if (command !== 'setup' && !options['--python'])
    throw new Error('Supply --python from a prepared environment.');
  return {
    command,
    positional,
    python: options['--python'] ?? 'python3',
    face: Number(options['--face'] ?? 0),
  };
}

function python(pythonPath, args, cwd) {
  const result = spawnSync(pythonPath, ['-I', '-B', ...args], {
    encoding: 'utf8',
    cwd,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
      PIP_NO_INPUT: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      result.error?.message ?? (result.stderr || result.stdout || 'Python failed').trim()
    );
  return result.stdout.trim();
}

function checkEnvironment(pythonPath) {
  const report = JSON.parse(
    python(pythonPath, [
      '-c',
      'import sys,json,importlib.metadata; print(json.dumps({"isolated":sys.prefix != sys.base_prefix,"version":importlib.metadata.version("fonttools")}))',
    ])
  );
  if (!report.isolated || report.version !== FONTTOOLS_VERSION)
    throw new Error(
      `Use an isolated environment with fontTools ${FONTTOOLS_VERSION}; run setup first.`
    );
}

const conversion = String.raw`
import io,json,os,sys
from fontTools.ttLib import TTFont,TTCollection
command,source,face,output = sys.argv[1:]
face = int(face)
with open(source,'rb') as f:
    collection = f.read(4) == b'ttcf'
count = len(TTCollection(source,lazy=True).fonts) if collection else 1
def load(index):
    return TTFont(source,fontNumber=index if collection else -1,lazy=True,recalcBBoxes=False,recalcTimestamp=False)
def describe(font,index):
    return {'index':index,'family':font['name'].getDebugName(1),'style':font['name'].getDebugName(2),'fullName':font['name'].getDebugName(4),'weight':font['OS/2'].usWeightClass if 'OS/2' in font else None,'glyphs':font['maxp'].numGlyphs,'characters':len(font.getBestCmap() or {})}
if command == 'faces':
    print(json.dumps({'faces':[describe(load(i),i) for i in range(count)]},ensure_ascii=False))
    sys.exit(0)
if face < 0 or face >= count:
    raise ValueError('Face index is outside this font collection')
if os.path.exists(output):
    raise ValueError('Output already exists; choose a new file')
font = load(face)
original = {tag:font.reader[tag] for tag in font.reader.keys()}
font.flavor = 'woff'
buffer = io.BytesIO()
font.save(buffer,reorderTables=False)
data = buffer.getvalue()
if len(data) > 16777216:
    raise ValueError('Complete WOFF is %d bytes; limit is 16777216. Choose a compatible complete font or explicitly resolve the edit limitation.' % len(data))
check = TTFont(io.BytesIO(data),lazy=True)
def comparable(tag,data):
    return data[:8] + bytes(4) + data[12:] if tag == 'head' else data
if set(original) != set(check.reader.keys()) or any(comparable(tag,data) != comparable(tag,check.reader[tag]) for tag,data in original.items()):
    raise ValueError('Font table preservation check failed; output was not written')
source_font = load(face)
if source_font.getBestCmap() != check.getBestCmap() or source_font.getGlyphOrder() != check.getGlyphOrder() or source_font['hmtx'].metrics != check['hmtx'].metrics:
    raise ValueError('Glyph mapping or metrics changed; output was not written')
report = describe(check,face)
with open(output,'xb') as f:
    f.write(data)
print(json.dumps({'output':output,'bytes':len(data),'limitBytes':16777216,'completeGlyphSet':True,'tablesPreservedExceptHeadChecksum':True,**report},ensure_ascii=False))
`;

export function prepareFont(argv) {
  const args = parseFontArguments(argv);
  if (args.command === 'help') return usage;
  if (args.command === 'setup') {
    const environment = resolve(args.positional[0]);
    const executable = join(
      environment,
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    );
    if (existsSync(environment)) {
      checkEnvironment(executable);
      return JSON.stringify({ python: executable, version: FONTTOOLS_VERSION, reused: true });
    }
    mkdirSync(dirname(environment), { recursive: true });
    python(args.python, ['-m', 'venv', environment]);
    python(
      executable,
      [
        '-m',
        'pip',
        '--isolated',
        '--disable-pip-version-check',
        'install',
        '--no-input',
        '--cache-dir',
        join(environment, 'pip-cache'),
        '--index-url',
        'https://pypi.org/simple',
        `fonttools==${FONTTOOLS_VERSION}`,
      ],
      environment
    );
    checkEnvironment(executable);
    return JSON.stringify({ python: executable, version: FONTTOOLS_VERSION, reused: false });
  }
  checkEnvironment(args.python);
  const source = realpathSync(args.positional[0]);
  const output = args.command === 'woff' ? resolve(args.positional[1]) : '';
  if (output && (existsSync(output) || !output.endsWith('.woff')))
    throw new Error('Choose a new .woff output path; existing files are preserved.');
  return python(args.python, ['-c', conversion, args.command, source, String(args.face), output]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(prepareFont(process.argv.slice(2)));
  } catch (error) {
    console.error(`font-prepare: ${error.message}`);
    process.exitCode = 1;
  }
}
