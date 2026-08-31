package com.ktmconnect.update

import android.content.Context
import java.io.File

/**
 * Where downloaded JavaScript bundles live, and which one should be loaded.
 *
 * Kept separate from the React module because [resolveBundlePath] runs during
 * Application.onCreate, before React exists.
 */
object BundleStore {

  private const val PREFS = "ktm-connect.bundles"
  private const val KEY_ACTIVE = "active"
  private const val KEY_PENDING = "pending"
  private const val KEY_BOOT_ATTEMPTS = "bootAttempts"

  /**
   * A bundle gets this many launches to prove it starts. One is the normal
   * case; the second covers a launch interrupted for reasons of its own.
   */
  private const val MAX_BOOT_ATTEMPTS = 2

  fun directory(context: Context): File =
    File(context.filesDir, "js-bundles").apply { mkdirs() }

  fun fileFor(context: Context, version: String): File =
    File(directory(context), "$version.bundle")

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun activeVersion(context: Context): String = prefs(context).getString(KEY_ACTIVE, "") ?: ""

  fun pendingVersion(context: Context): String = prefs(context).getString(KEY_PENDING, "") ?: ""

  fun bootAttempts(context: Context): Int = prefs(context).getInt(KEY_BOOT_ATTEMPTS, 0)

  fun stage(context: Context, version: String) {
    prefs(context).edit().putString(KEY_PENDING, version).putInt(KEY_BOOT_ATTEMPTS, 0).apply()
  }

  /**
   * The bundle to load, or null for the one packaged in the APK.
   *
   * A pending bundle is handed out on trial and its attempt count raised; if it
   * never confirms it started, the count runs out and it is discarded. This is
   * what keeps a broken update from being permanent.
   */
  fun resolveBundlePath(context: Context): String? {
    val pending = pendingVersion(context)
    if (pending.isNotEmpty()) {
      val attempts = bootAttempts(context)
      val file = fileFor(context, pending)
      if (attempts >= MAX_BOOT_ATTEMPTS || !file.exists()) {
        discardPending(context)
      } else {
        prefs(context).edit().putInt(KEY_BOOT_ATTEMPTS, attempts + 1).apply()
        return file.absolutePath
      }
    }

    val active = activeVersion(context)
    if (active.isNotEmpty()) {
      val file = fileFor(context, active)
      if (file.exists()) {
        return file.absolutePath
      }
      prefs(context).edit().remove(KEY_ACTIVE).apply()
    }
    return null
  }

  /** The running bundle started: promote it and stop counting attempts. */
  fun markBooted(context: Context) {
    val pending = pendingVersion(context)
    val editor = prefs(context).edit().putInt(KEY_BOOT_ATTEMPTS, 0)
    if (pending.isNotEmpty()) {
      editor.putString(KEY_ACTIVE, pending).remove(KEY_PENDING)
      cleanUp(context, keep = pending)
    }
    editor.apply()
  }

  fun discardPending(context: Context) {
    val pending = pendingVersion(context)
    if (pending.isNotEmpty()) {
      runCatching { fileFor(context, pending).delete() }
    }
    prefs(context).edit().remove(KEY_PENDING).putInt(KEY_BOOT_ATTEMPTS, 0).apply()
  }

  /** Back to the bundle inside the APK. */
  fun reset(context: Context) {
    runCatching { directory(context).listFiles()?.forEach { it.delete() } }
    prefs(context).edit().clear().apply()
  }

  private fun cleanUp(context: Context, keep: String) {
    val keepName = fileFor(context, keep).name
    runCatching {
      directory(context).listFiles()?.forEach { if (it.name != keepName) it.delete() }
    }
  }
}
