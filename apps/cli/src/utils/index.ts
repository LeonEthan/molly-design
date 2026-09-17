import path from 'path';
import packageJson from '@/pkg';
import {
  checkClaude,
  checkCodex,
  checkKimi,
  checkOpencode,
  __test__,
} from '@molly/shared/node/cli-detection';
import { getMollyDataDir } from '@molly/shared/node/installation-profile';

export const getMollyCLIVersion = () => {
  return packageJson.version;
};

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  return path.join(getMollyDataDir(), 'credentials.json');
}

export { checkClaude, checkCodex, checkKimi, checkOpencode, __test__ };
