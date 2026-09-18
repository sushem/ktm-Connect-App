import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Over-the-air JavaScript updates.
 *
 * Everything above the native layer — the protocols, the screens, the
 * decisions — is JavaScript, and React Native can load that from a file
 * instead of the copy inside the APK. So a change to any of it can ship
 * without a reinstall; only changes to native code need a new build.
 *
 * A downloaded bundle is staged as `pending` and only promoted to `active`
 * once it has actually started, so a bundle that crashes on boot is rolled
 * back rather than bricking the app.
 */

export type BundleStatus = {
  /** Version of the bundle currently running, or null for the one in the APK. */
  activeVersion: string;
  /** Downloaded and awaiting proof that it boots. */
  pendingVersion: string;
  /** How many times the pending bundle has been launched without confirming. */
  bootAttempts: number;
};

export interface Spec extends TurboModule {
  /** False where over-the-air updates are not implemented. */
  isSupported(): Promise<boolean>;
  getStatus(): Promise<BundleStatus>;
  /**
   * Download a bundle over HTTPS, check it against `sha256`, and stage it for
   * the next launch. Rejects rather than staging anything if the hash differs.
   */
  download(url: string, sha256: string, version: string): Promise<void>;
  /** Confirm the running bundle started successfully. */
  markBooted(): Promise<void>;
  /** Discard downloaded bundles and go back to the one shipped in the APK. */
  reset(): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('BundleUpdate');
