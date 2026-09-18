import {NATIVE_API_LEVEL, chooseUpdate, parseManifest} from '../updates';

const HASH = 'a'.repeat(64);

const manifest = (over: Record<string, unknown> = {}) => ({
  version: '2026.09.01-2',
  requiresNativeApi: 1,
  android: {url: 'https://example.test/bundle.js', sha256: HASH},
  ...over,
});

/**
 * This decides whether to load code off the network, so the interesting cases
 * are the refusals rather than the happy path.
 */
describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const parsed = parseManifest(manifest())!;
    expect(parsed.version).toBe('2026.09.01-2');
    expect(parsed.android.sha256).toBe(HASH);
  });

  it('refuses a bundle offered over plain http', () => {
    expect(parseManifest(manifest({android: {url: 'http://example.test/b.js', sha256: HASH}}))).toBeNull();
  });

  it('refuses a manifest with no usable hash', () => {
    expect(
      parseManifest(manifest({android: {url: 'https://example.test/b.js', sha256: 'abc'}})),
    ).toBeNull();
    expect(
      parseManifest(manifest({android: {url: 'https://example.test/b.js', sha256: 'z'.repeat(64)}})),
    ).toBeNull();
  });

  it('refuses anything without a version or a native level', () => {
    expect(parseManifest(manifest({version: '  '}))).toBeNull();
    expect(parseManifest(manifest({requiresNativeApi: 'one'}))).toBeNull();
    expect(parseManifest(manifest({requiresNativeApi: 1.5}))).toBeNull();
  });

  it('refuses junk outright', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('not a manifest')).toBeNull();
    expect(parseManifest({})).toBeNull();
  });

  it('normalises a hash given in upper case', () => {
    const parsed = parseManifest(
      manifest({android: {url: 'https://example.test/b.js', sha256: HASH.toUpperCase()}}),
    )!;
    expect(parsed.android.sha256).toBe(HASH);
  });
});

describe('chooseUpdate', () => {
  const current = {version: '2026.09.01-1', nativeApi: NATIVE_API_LEVEL};

  it('offers a newer bundle', () => {
    const decision = chooseUpdate(manifest(), current);
    expect(decision.action).toBe('update');
  });

  it('says nothing to do when the versions match', () => {
    expect(chooseUpdate(manifest({version: current.version}), current).action).toBe('up-to-date');
  });

  it('treats the packaged bundle as a version worth replacing', () => {
    expect(chooseUpdate(manifest(), {version: '', nativeApi: NATIVE_API_LEVEL}).action).toBe(
      'update',
    );
  });

  it('refuses a bundle that needs native code this app does not have', () => {
    const decision = chooseUpdate(manifest({requiresNativeApi: NATIVE_API_LEVEL + 1}), current);

    expect(decision).toEqual({
      action: 'needs-app-update',
      version: '2026.09.01-2',
      requires: NATIVE_API_LEVEL + 1,
    });
  });

  it('checks the native level before the version, so a stale app is told the truth', () => {
    // Same version, but built against newer native code: still not loadable.
    const decision = chooseUpdate(
      manifest({version: current.version, requiresNativeApi: NATIVE_API_LEVEL + 1}),
      current,
    );
    expect(decision.action).toBe('needs-app-update');
  });

  it('accepts a bundle built for an older app', () => {
    expect(chooseUpdate(manifest({requiresNativeApi: 0}), current).action).toBe('update');
  });

  it('reports a malformed manifest rather than acting on it', () => {
    const decision = chooseUpdate({nonsense: true}, current);
    expect(decision).toEqual({
      action: 'unusable',
      reason: 'The update manifest is missing or malformed',
    });
  });
});
