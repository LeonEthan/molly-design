import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { prepareDesignEvalBrowser, validateBrowserSelection } from './design-eval-browser.mjs';

const selection = { browserId: 'chrome', profileId: 'synthetic-profile' };

function fixture(options = {}) {
  const state = { imported: false, verified: false };
  const summary = () => ({
    importAvailable: options.available ?? true,
    persistent: false,
    sites: [
      {
        site: 'pinterest.com',
        cookieCount: state.imported ? (options.cookies ?? 6) : (options.initialCookies ?? 0),
      },
    ],
  });
  const invoke = async (method, input) => {
    if (method === 'publicBrowser.getAccountSummary') return summary();
    if (method === 'publicBrowser.getImportSources')
      return {
        sources:
          options.profiles === false
            ? []
            : [{ ...selection, profiles: [{ id: selection.profileId }] }],
      };
    if (method === 'publicBrowser.importBrowserAccount') {
      assert.deepEqual(input, { ...selection, site: 'pinterest.com', replaceExisting: false });
      if (options.importError) throw Error('Synthetic import denial');
      state.imported = true;
      return { imported: options.imported ?? 6 };
    }
    throw Error(`Unexpected IPC method ${method}`);
  };
  const verify = async (site) => {
    assert(state.imported);
    assert.equal(site, 'pinterest.com');
    state.verified = true;
    return options.page ?? { signedIn: true, visibleReferences: true, loginBlocked: false };
  };
  return { state, prepare: () => prepareDesignEvalBrowser({ invoke, selection, verify }) };
}

void test('imports into the isolated account before verifying the actual website', async () => {
  const { state, prepare } = fixture();
  const result = await prepare();
  assert.equal(result.status, 'ready');
  assert.equal(result.cookieCount, 6);
  assert.equal(result.persistent, false);
  assert.deepEqual(state, { imported: true, verified: true });
});

void test('unavailable profile access stops preparation before importing or verifying', async () => {
  const { state, prepare } = fixture({ profiles: false });
  await assert.rejects(prepare(), /launcher browser-data access/);
  assert.deepEqual(state, { imported: false, verified: false });
});

void test('unavailable import or an existing account cannot start preparation', async () => {
  for (const options of [{ available: false }, { initialCookies: 6 }]) {
    const { state, prepare } = fixture(options);
    await assert.rejects(prepare(), /import unavailable|fresh isolated website account/);
    assert.deepEqual(state, { imported: false, verified: false });
  }
});

void test('import denial stops preparation without a website verification', async () => {
  const { state, prepare } = fixture({ importError: true });
  await assert.rejects(prepare(), /Synthetic import denial/);
  assert.deepEqual(state, { imported: false, verified: false });
});

void test('stored cookies do not establish a signed-in research page', async () => {
  const { prepare } = fixture({
    page: { signedIn: false, visibleReferences: true, loginBlocked: false },
  });
  await assert.rejects(prepare(), /sign-in and visible references/);
});

void test('a login overlay or missing references fails preparation', async () => {
  for (const page of [
    { signedIn: true, visibleReferences: true, loginBlocked: true },
    { signedIn: true, visibleReferences: false, loginBlocked: false },
  ]) {
    const { prepare } = fixture({ page });
    await assert.rejects(prepare(), /sign-in and visible references/);
  }
});

void test('an empty import cannot be accepted as ready', async () => {
  const { state, prepare } = fixture({ imported: 0, cookies: 0 });
  await assert.rejects(prepare(), /did not retain/);
  assert.equal(state.verified, false);
});

void test('browser selection requires an explicit source and supports only existing importers', () => {
  assert.deepEqual(validateBrowserSelection(selection), { ...selection, site: 'pinterest.com' });
  for (const input of [
    undefined,
    {},
    { browserId: 'safari', profileId: 'example' },
    { browserId: 'chrome', profileId: '' },
  ])
    assert.throws(() => validateBrowserSelection(input), /Configure browser/);
});
