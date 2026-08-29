package com.ktmconnect.ktmlink

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.ktmconnect.specs.NativeKtmLinkSpec
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Opens an RFCOMM socket to the motorcycle's MY RIDE service and pumps bytes
 * between it and JavaScript.
 *
 * Reads run on a dedicated thread and are forwarded as base64 device events;
 * writes are serialised onto a single-threaded executor so a burst of UI
 * updates cannot interleave halfway through a frame.
 */
class KtmLinkModule(reactContext: ReactApplicationContext) : NativeKtmLinkSpec(reactContext) {

  private val io = Executors.newSingleThreadExecutor()
  private var socket: BluetoothSocket? = null
  private var output: OutputStream? = null
  private var readerThread: Thread? = null
  private val closingOnPurpose = AtomicBoolean(false)

  override fun isSupported(promise: Promise) {
    promise.resolve(adapter() != null)
  }

  override fun isEnabled(promise: Promise) {
    promise.resolve(adapter()?.isEnabled == true)
  }

  override fun getPairedDevices(promise: Promise) {
    val adapter = adapter()
    if (adapter == null) {
      promise.reject(ERR_UNSUPPORTED, "This device has no Bluetooth adapter")
      return
    }
    if (!hasConnectPermission()) {
      promise.reject(ERR_PERMISSION, "BLUETOOTH_CONNECT permission has not been granted")
      return
    }
    try {
      val devices = Arguments.createArray()
      adapter.bondedDevices.orEmpty().forEach { device ->
        devices.pushMap(
          Arguments.createMap().apply {
            putString("id", device.address)
            putString("name", device.name ?: device.address)
            putBoolean("bonded", device.bondState == BluetoothDevice.BOND_BONDED)
            putArray("uuids", uuidArray(device.uuids?.map { it.uuid.toString() }.orEmpty()))
          }
        )
      }
      promise.resolve(devices)
    } catch (e: SecurityException) {
      promise.reject(ERR_PERMISSION, e.message, e)
    }
  }

  /**
   * Run a fresh SDP query against the device.
   *
   * The cached UUID list is often empty or stale — Android only fills it during
   * pairing — so this asks the device again and waits for the ACTION_UUID
   * broadcast, falling back to whatever was cached if nothing arrives.
   */
  override fun discoverServices(address: String, promise: Promise) {
    val adapter = adapter()
    if (adapter == null) {
      promise.reject(ERR_UNSUPPORTED, "This device has no Bluetooth adapter")
      return
    }
    if (!hasConnectPermission()) {
      promise.reject(ERR_PERMISSION, "BLUETOOTH_CONNECT permission has not been granted")
      return
    }

    val device =
      try {
        adapter.getRemoteDevice(address)
      } catch (e: IllegalArgumentException) {
        promise.reject(ERR_CONNECT, "\"$address\" is not a Bluetooth address", e)
        return
      }

    val settled = AtomicBoolean(false)
    val cached = { device.uuids?.map { it.uuid.toString() }.orEmpty() }

    val receiver =
      object : BroadcastReceiver() {
        @Suppress("DEPRECATION") // The typed overloads only exist from API 33.
        override fun onReceive(context: Context, intent: Intent) {
          val forDevice =
            intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)?.address
          if (forDevice != null && !forDevice.equals(address, ignoreCase = true)) {
            return
          }
          val found =
            intent
              .getParcelableArrayExtra(BluetoothDevice.EXTRA_UUID)
              ?.filterIsInstance<ParcelUuid>()
              ?.map { it.uuid.toString() }
              .orEmpty()
          finish(this, settled, promise, if (found.isNotEmpty()) found else cached())
        }
      }

    ContextCompat.registerReceiver(
      reactApplicationContext,
      receiver,
      IntentFilter(BluetoothDevice.ACTION_UUID),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )

    // SDP has no failure callback, so cap the wait and report what we have.
    Handler(Looper.getMainLooper()).postDelayed(
      { finish(receiver, settled, promise, cached()) },
      SDP_TIMEOUT_MS,
    )

    try {
      runCatching { adapter.cancelDiscovery() }
      if (!device.fetchUuidsWithSdp()) {
        finish(receiver, settled, promise, cached())
      }
    } catch (e: SecurityException) {
      finish(receiver, settled, promise, cached())
    }
  }

  private fun finish(
    receiver: BroadcastReceiver,
    settled: AtomicBoolean,
    promise: Promise,
    uuids: List<String>,
  ) {
    if (!settled.compareAndSet(false, true)) {
      return
    }
    runCatching { reactApplicationContext.unregisterReceiver(receiver) }
    promise.resolve(uuidArray(uuids))
  }

  private fun uuidArray(uuids: List<String>) =
    Arguments.createArray().apply { uuids.distinct().forEach { pushString(it) } }

  override fun connect(address: String, uuid: String, secure: Boolean, promise: Promise) {
    val adapter = adapter()
    if (adapter == null) {
      promise.reject(ERR_UNSUPPORTED, "This device has no Bluetooth adapter")
      return
    }
    if (!adapter.isEnabled) {
      promise.reject(ERR_DISABLED, "Bluetooth is switched off")
      return
    }
    if (!hasConnectPermission()) {
      promise.reject(ERR_PERMISSION, "BLUETOOTH_CONNECT permission has not been granted")
      return
    }

    io.execute {
      try {
        closeQuietly()
        closingOnPurpose.set(false)

        val device = adapter.getRemoteDevice(address)
        val serviceUuid = UUID.fromString(uuid)
        // Discovery keeps the radio busy and makes connects flaky.
        runCatching { adapter.cancelDiscovery() }

        val bluetoothSocket =
          if (secure) {
            device.createRfcommSocketToServiceRecord(serviceUuid)
          } else {
            device.createInsecureRfcommSocketToServiceRecord(serviceUuid)
          }
        bluetoothSocket.connect()

        socket = bluetoothSocket
        output = bluetoothSocket.outputStream
        startReader(bluetoothSocket.inputStream)
        promise.resolve(null)
      } catch (e: SecurityException) {
        closeQuietly()
        promise.reject(ERR_PERMISSION, e.message, e)
      } catch (e: IOException) {
        closeQuietly()
        promise.reject(ERR_CONNECT, "Could not open the MY RIDE service on $address: ${e.message}", e)
      } catch (e: IllegalArgumentException) {
        closeQuietly()
        promise.reject(ERR_CONNECT, e.message, e)
      }
    }
  }

  override fun disconnect(promise: Promise) {
    io.execute {
      closingOnPurpose.set(true)
      closeQuietly()
      promise.resolve(null)
    }
  }

  override fun isConnected(promise: Promise) {
    promise.resolve(socket?.isConnected == true)
  }

  override fun write(base64: String, promise: Promise) {
    io.execute {
      val stream = output
      if (stream == null) {
        promise.reject(ERR_NOT_CONNECTED, "Not connected to a dashboard")
        return@execute
      }
      try {
        stream.write(Base64.decode(base64, Base64.NO_WRAP))
        stream.flush()
        promise.resolve(null)
      } catch (e: IOException) {
        promise.reject(ERR_WRITE, e.message, e)
        dropConnection(e.message ?: "Write failed")
      } catch (e: IllegalArgumentException) {
        promise.reject(ERR_WRITE, "Payload was not valid base64", e)
      }
    }
  }

  override fun invalidate() {
    closingOnPurpose.set(true)
    closeQuietly()
    io.shutdown()
    super.invalidate()
  }

  private fun startReader(input: InputStream) {
    val thread =
      Thread({
        val buffer = ByteArray(1024)
        try {
          while (!Thread.currentThread().isInterrupted) {
            val read = input.read(buffer)
            if (read < 0) {
              break
            }
            if (read > 0) {
              val chunk = Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP)
              emit(EVENT_DATA, chunk)
            }
          }
          dropConnection("Dashboard closed the connection")
        } catch (e: IOException) {
          dropConnection(e.message ?: "Connection lost")
        }
      }, "ktm-link-reader")
    thread.isDaemon = true
    readerThread = thread
    thread.start()
  }

  private fun dropConnection(reason: String) {
    val wasIntentional = closingOnPurpose.getAndSet(true)
    closeQuietly()
    if (!wasIntentional) {
      emit(EVENT_DISCONNECT, reason)
    }
  }

  private fun closeQuietly() {
    readerThread?.interrupt()
    readerThread = null
    runCatching { output?.close() }
    output = null
    runCatching { socket?.close() }
    socket = null
  }

  private fun emit(event: String, payload: String) {
    if (reactApplicationContext.hasActiveReactInstance()) {
      reactApplicationContext.emitDeviceEvent(event, payload)
    }
  }

  private fun adapter(): BluetoothAdapter? {
    val manager =
      reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return manager?.adapter
  }

  private fun hasConnectPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return true
    }
    return ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.BLUETOOTH_CONNECT,
    ) == PackageManager.PERMISSION_GRANTED
  }

  companion object {
    const val NAME: String = "KtmLink"

    private const val SDP_TIMEOUT_MS = 12_000L

    const val EVENT_DATA: String = "KtmLink:data"
    const val EVENT_DISCONNECT: String = "KtmLink:disconnect"

    private const val ERR_UNSUPPORTED = "E_UNSUPPORTED"
    private const val ERR_DISABLED = "E_BLUETOOTH_OFF"
    private const val ERR_PERMISSION = "E_PERMISSION"
    private const val ERR_CONNECT = "E_CONNECT"
    private const val ERR_NOT_CONNECTED = "E_NOT_CONNECTED"
    private const val ERR_WRITE = "E_WRITE"
  }
}
