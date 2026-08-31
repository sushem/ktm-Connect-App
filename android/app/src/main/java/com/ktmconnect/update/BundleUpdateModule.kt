package com.ktmconnect.update

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.ktmconnect.specs.NativeBundleUpdateSpec
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/**
 * Downloads and stages JavaScript bundles.
 *
 * The download is checked against a hash the caller supplies before anything
 * is staged, and only https is accepted: this loads code into the app, so a
 * plain http URL or an unverified payload is not a convenience worth having.
 */
class BundleUpdateModule(reactContext: ReactApplicationContext) :
  NativeBundleUpdateSpec(reactContext) {

  private val io = Executors.newSingleThreadExecutor()

  override fun isSupported(promise: Promise) {
    promise.resolve(true)
  }

  override fun getStatus(promise: Promise) {
    val context = reactApplicationContext
    promise.resolve(
      Arguments.createMap().apply {
        putString("activeVersion", BundleStore.activeVersion(context))
        putString("pendingVersion", BundleStore.pendingVersion(context))
        putInt("bootAttempts", BundleStore.bootAttempts(context))
      }
    )
  }

  override fun download(url: String, sha256: String, version: String, promise: Promise) {
    io.execute {
      val context = reactApplicationContext
      val target = BundleStore.fileFor(context, version)
      val partial = File(target.absolutePath + ".part")

      try {
        if (!url.startsWith("https://")) {
          promise.reject(ERR_INSECURE, "Refusing to load code over a plain http connection")
          return@execute
        }

        val connection = URL(url).openConnection()
        if (connection !is HttpsURLConnection) {
          promise.reject(ERR_INSECURE, "Refusing to load code over a plain http connection")
          return@execute
        }
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.instanceFollowRedirects = true

        val digest = MessageDigest.getInstance("SHA-256")
        connection.inputStream.use { input ->
          partial.outputStream().use { output ->
            val buffer = ByteArray(16 * 1024)
            var total = 0L
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              total += read
              if (total > MAX_BUNDLE_BYTES) {
                throw IllegalStateException("Bundle is larger than the ${MAX_BUNDLE_BYTES / 1_000_000}MB limit")
              }
              digest.update(buffer, 0, read)
              output.write(buffer, 0, read)
            }
          }
        }

        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (!actual.equals(sha256.trim(), ignoreCase = true)) {
          partial.delete()
          promise.reject(
            ERR_HASH,
            "The downloaded bundle does not match the expected hash, so it was discarded",
          )
          return@execute
        }

        // Rename only once the content is known good, so a half-written or
        // wrong file is never a candidate for loading.
        if (!partial.renameTo(target)) {
          partial.delete()
          promise.reject(ERR_IO, "Could not store the downloaded bundle")
          return@execute
        }
        BundleStore.stage(context, version)
        promise.resolve(null)
      } catch (e: Exception) {
        runCatching { partial.delete() }
        promise.reject(ERR_IO, e.message ?: "Download failed", e)
      }
    }
  }

  override fun markBooted(promise: Promise) {
    BundleStore.markBooted(reactApplicationContext)
    promise.resolve(null)
  }

  override fun reset(promise: Promise) {
    BundleStore.reset(reactApplicationContext)
    promise.resolve(null)
  }

  override fun invalidate() {
    io.shutdown()
    super.invalidate()
  }

  companion object {
    const val NAME: String = "BundleUpdate"

    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val MAX_BUNDLE_BYTES = 64L * 1024 * 1024

    private const val ERR_INSECURE = "E_INSECURE_URL"
    private const val ERR_HASH = "E_HASH_MISMATCH"
    private const val ERR_IO = "E_DOWNLOAD"
  }
}
