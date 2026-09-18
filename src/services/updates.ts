import NativeBundleUpdate from '../../specs/NativeBundleUpdate';

/**
 * Over-the-air JavaScript updates.
 *
 * Everything that is not native — both dashboard protocols, the OBD client,
 * every screen — lives in the JavaScript bundle, and React Native will load
 * that from a file rather than the copy inside the APK. So a protocol fix can
 * reach a rider without a reinstall, and only genuine native changes (a new
 * Bluetooth capability, a new module) need a new build.
 *
 * That last part needs enforcing rather than hoping: a bundle written against
 * native code the installed app does not have would fail at runtime, in the
 * hands of someone at the side of a road. Hence the native API level below.
 */

/**
 * Raise this whenever the native modules change shape — a new method, a
 * changed signature. A published bundle declares the level it needs, and one
 * that needs more than the installed app provides is refused rather than
 * loaded.
 */
export const NATIVE_API_LEVEL = 1;

/** Where published bundles are announced. Must be https: this loads code. */
export const MANIFEST_URL = 'https://sushem.github.io/ktm-Connect-App/updates/manifest.json';

export interface UpdateManifest {
  version: string;
  /** The native API level this bundle expects. */
  requiresNativeApi: number;
  notes?: string;
  android: {url: string; sha256: string};
}

export type UpdateDecision =
  | {action: 'update'; manifest: UpdateManifest}
  | {action: 'up-to-date'}
  | {action: 'needs-app-update'; version: string; requires: number}
  | {action: 'unusable'; reason: string};

/** Reject anything malformed before it gets near a download. */
export function parseManifest(input: unknown): UpdateManifest | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const android = raw.android as Record<string, unknown> | undefined;

  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  const requires = typeof raw.requiresNativeApi === 'number' ? raw.requiresNativeApi : NaN;
  const url = typeof android?.url === 'string' ? android.url : '';
  const sha256 = typeof android?.sha256 === 'string' ? android.sha256.trim().toLowerCase() : '';

  if (version.length === 0 || !Number.isInteger(requires)) {
    return null;
  }
  // Code, over the network: https and a full hash, or nothing.
  if (!url.startsWith('https://') || !/^[0-9a-f]{64}$/.test(sha256)) {
    return null;
  }

  return {
    version,
    requiresNativeApi: requires,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    android: {url, sha256},
  };
}

/**
 * Decide what to do about a manifest, given what is already running. Pure, so
 * the rules are testable without a network or a device.
 */
export function chooseUpdate(
  input: unknown,
  current: {version: string; nativeApi: number},
): UpdateDecision {
  const manifest = parseManifest(input);
  if (!manifest) {
    return {action: 'unusable', reason: 'The update manifest is missing or malformed'};
  }
  if (manifest.requiresNativeApi > current.nativeApi) {
    return {
      action: 'needs-app-update',
      version: manifest.version,
      requires: manifest.requiresNativeApi,
    };
  }
  if (manifest.version === current.version) {
    return {action: 'up-to-date'};
  }
  return {action: 'update', manifest};
}

export interface UpdateState {
  supported: boolean;
  /** Version running now; empty means the bundle shipped in the APK. */
  activeVersion: string;
  pendingVersion: string;
}

export async function currentState(): Promise<UpdateState> {
  if (!NativeBundleUpdate) {
    return {supported: false, activeVersion: '', pendingVersion: ''};
  }
  const status = await NativeBundleUpdate.getStatus();
  return {
    supported: true,
    activeVersion: status.activeVersion,
    pendingVersion: status.pendingVersion,
  };
}

/** Ask the host what it has published, and decide. */
export async function checkForUpdate(
  fetchImpl: typeof fetch = fetch,
  manifestUrl: string = MANIFEST_URL,
): Promise<UpdateDecision> {
  const state = await currentState();
  if (!state.supported) {
    return {action: 'unusable', reason: 'Over-the-air updates are not available in this build'};
  }

  let payload: unknown;
  try {
    const response = await fetchImpl(`${manifestUrl}?t=${Date.now()}`);
    if (!response.ok) {
      return {action: 'unusable', reason: `The update server answered ${response.status}`};
    }
    payload = await response.json();
  } catch (error) {
    return {
      action: 'unusable',
      reason: error instanceof Error ? error.message : 'Could not reach the update server',
    };
  }

  return chooseUpdate(payload, {version: state.activeVersion, nativeApi: NATIVE_API_LEVEL});
}

/**
 * Download and stage a bundle. It takes effect on the next launch — and only
 * sticks once it has proved it starts, so a bad one rolls itself back.
 */
export async function applyUpdate(manifest: UpdateManifest): Promise<void> {
  if (!NativeBundleUpdate) {
    throw new Error('Over-the-air updates are not available in this build');
  }
  await NativeBundleUpdate.download(
    manifest.android.url,
    manifest.android.sha256,
    manifest.version,
  );
}

/**
 * Tell the native side the running bundle started. Until this is called, a
 * freshly downloaded bundle is on trial and will be discarded if the app keeps
 * failing to start.
 */
export async function confirmBoot(): Promise<void> {
  await NativeBundleUpdate?.markBooted().catch(() => undefined);
}

/** Go back to the bundle inside the APK. */
export async function revertToPackagedBundle(): Promise<void> {
  await NativeBundleUpdate?.reset();
}
