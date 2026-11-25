import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { developerIdentity, inspectDeveloperSignature } from './package-mygo-desktop.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const moduleName = 'github.com/LeonEthan/molly-design';

const sharedIdentifier = 'com.molly.stage3b.acl-test';

export function measureOperation(operation) {
  try {
    operation();
    return { passed: true, osStatus: 0 };
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    const match = /OSStatus (-?\d+)/.exec(detail);
    return { passed: false, osStatus: match ? Number(match[1]) : null, error: detail };
  }
}

export function verifyIsolatedACL(run = execFileSync) {
  if (process.platform !== 'darwin') throw new Error('macOS is required');
  const temp = fs.mkdtempSync('/tmp/molly-acl-');
  const keychain = path.join(temp, 'synthetic.keychain-db');
  const report = {
    teamIdentifiers: {},
    created: false,
    read: false,
    updated: false,
    verified: false,
    explicitACL: { read: false, updated: false, verified: false },
    sameIdentifier: { signatures: {}, passed: false },
    cleaned: false,
  };
  try {
    fs.writeFileSync(
      path.join(temp, 'go.mod'),
      `module ${moduleName}/aclprobe\ngo 1.27.3\nrequire ${moduleName} v0.0.0\nreplace ${moduleName} => ${JSON.stringify(root)}\n`
    );
    const binaries = {};
    for (const name of ['electron', 'mygo']) {
      fs.mkdirSync(path.join(temp, 'src-' + name));
      const source = path.join(temp, 'src-' + name, 'main.go');
      fs.writeFileSync(
        source,
        `package main
import ("os"; "log"; sec "${moduleName}/internal/security"; "github.com/ebitengine/purego")
func main(){
  log.SetFlags(0)
  lib,err := purego.Dlopen("/System/Library/Frameworks/Security.framework/Security",purego.RTLD_NOW)
  if err!=nil {log.Fatal(err)}
  var disable func(uint8) int32
  purego.RegisterLibFunc(&disable, lib,"SecKeychainSetUserInteractionAllowed")
  if disable(0)!=0 {log.Fatal("could not disable Keychain UI")}
  opts := sec.KeychainOptions{KeychainPath: ${JSON.stringify(keychain)}}
  service, account := "Molly Stage3B ACL Test", os.Args[3]
  value := os.Args[2]
  if os.Args[1] == "write" {
    if err := sec.SetKeychainGenericPassword(service, account, []byte(value),opts); err != nil { log.Fatal(err) }
  } else {
    result,err := sec.ReadKeychainGenericPassword(service, account,opts)
    if err != nil { log.Fatal(err) }; if string(result)!=value { log.Fatal("unexpected synthetic value") }
  }
}`
      );
      const binary = path.join(temp, name);
      run('go', ['build', '-mod=mod', '-trimpath', '-o', binary, './src-' + name], {
        cwd: temp,
        env: { ...process.env, CGO_ENABLED: '0', GOWORK: 'off' },
      });
      run('/usr/bin/codesign', [
        '--force',
        '--sign',
        developerIdentity,
        '--options',
        'runtime',
        '--timestamp',
        '--identifier',
        'dev.molly-design.acl.' + name,
        binary,
      ]);
      run('/usr/bin/codesign', ['--verify', '--strict', binary]);
      report.teamIdentifiers[name] = inspectDeveloperSignature(
        binary,
        developerIdentity
      ).teamIdentifier;
      binaries[name] = binary;
    }
    const password = randomBytes(32).toString('hex');
    run('/usr/bin/security', ['create-keychain', '-p', password, keychain]);
    run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain]);
    const probe = (account, result) => {
      const execute = (name, action, value) =>
        run(binaries[name], [action, value, account], { timeout: 10000 });
      execute('electron', 'write', 'initial');
      result.created = true;
      execute('electron', 'read', 'initial');
      result.creatorVerified = true;
      execute('mygo', 'read', 'initial');
      result.read = true;
      execute('mygo', 'write', 'updated');
      result.updated = true;
      execute('electron', 'read', 'updated');
      result.verified = true;
    };
    try {
      probe('default-acl', report);
    } catch (error) {
      report.error = error.stderr?.toString().trim() || 'Default ACL probe failed';
    }
    run('/usr/bin/security', [
      'add-generic-password',
      '-s',
      'Molly Stage3B ACL Test',
      '-a',
      'explicit-acl',
      '-w',
      'placeholder',
      '-T',
      binaries.electron,
      '-T',
      binaries.mygo,
      keychain,
    ]);
    probe('explicit-acl', report.explicitACL);
    const scenario = report.sameIdentifier;
    for (const [name, binary] of Object.entries(binaries)) {
      run('/usr/bin/codesign', [
        '--force',
        '--sign',
        developerIdentity,
        '--options',
        'runtime',
        '--timestamp',
        '--identifier',
        sharedIdentifier,
        binary,
      ]);
      run('/usr/bin/codesign', ['--verify', '--strict', binary]);
      const display = spawnSync('/usr/bin/codesign', ['-d', '-r-', binary], { encoding: 'utf8' });
      const designatedRequirement = /^designated => (.+)$/m.exec(
        display.stdout + display.stderr
      )?.[1];
      if (
        display.status !== 0 ||
        !designatedRequirement?.startsWith(`identifier "${sharedIdentifier}" and `)
      ) {
        throw new Error('Missing expected designated requirement for ' + name);
      }
      scenario.signatures[name] = {
        ...inspectDeveloperSignature(binary, developerIdentity),
        designatedRequirement,
        sha256: createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
      };
    }
    const { electron, mygo } = scenario.signatures;
    if (
      electron.sha256 === mygo.sha256 ||
      electron.designatedRequirement !== mygo.designatedRequirement
    ) {
      throw new Error('Invalid in-place upgrade fixtures');
    }
    const installed = path.join(temp, 'installed');
    const execute = (action, value) =>
      run(installed, [action, value, 'same-id-default'], {
        timeout: 10000,
        stdio: 'pipe',
      });
    fs.copyFileSync(binaries.electron, installed);
    execute('write', 'initial');
    execute('read', 'initial');
    fs.renameSync(binaries.mygo, installed);
    scenario.read = measureOperation(() => execute('read', 'initial'));
    scenario.update = measureOperation(() => execute('write', 'updated'));
    scenario.verified = measureOperation(() =>
      run(binaries.electron, ['read', 'updated', 'same-id-default'])
    );
    scenario.passed = scenario.read.passed && scenario.update.passed && scenario.verified.passed;
  } catch (error) {
    report.verifierError = error.stderr?.toString().trim() || error.message;
  } finally {
    try {
      if (fs.existsSync(keychain)) run('/usr/bin/security', ['delete-keychain', keychain]);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
      report.cleaned = !fs.existsSync(temp);
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = verifyIsolatedACL();
  console.log(JSON.stringify(report));
  if (
    !(report.creatorVerified && !report.read && report.error?.includes('OSStatus -25293')) ||
    !report.sameIdentifier.passed ||
    !report.explicitACL.verified ||
    !report.cleaned
  )
    process.exitCode = 1;
}
