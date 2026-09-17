import { z } from 'zod';
import path from 'node:path';
import { getMollyDataDir } from '@molly/shared/node/installation-profile';
import { openDesignSample } from './design/sample';

const request = z.object({
  operation: z.literal('open-sample'),
  resources: z.string().refine(path.isAbsolute),
}).strict().parse(JSON.parse(process.argv[2] ?? 'null'));
try {
  const payload = await openDesignSample(getMollyDataDir('local'), request.resources);
  process.stdout.write(JSON.stringify(payload));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
