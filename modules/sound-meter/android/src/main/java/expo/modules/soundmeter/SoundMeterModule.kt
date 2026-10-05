package expo.modules.soundmeter

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.concurrent.thread

class SoundMeterModule : Module() {
  private var capture: Capture? = null

  override fun definition() = ModuleDefinition {
    Name("SoundMeter")

    Events("onLevel")

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.RECORD_AUDIO)
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.RECORD_AUDIO)
    }

    AsyncFunction("start") {
      start()
    }

    Function("stop") {
      stop()
    }

    OnDestroy {
      stop()
    }
  }

  @Synchronized
  private fun start() {
    if (capture != null) return
    val context = requireNotNull(appContext.reactContext)
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw MicrophonePermissionException()
    }

    val audioManager = context.getSystemService(AudioManager::class.java)
    // UNPROCESSED skips noise suppression and gain control. VOICE_RECOGNITION is the
    // closest fallback: Android requires it to have AGC and noise suppression off by default.
    val source = if (audioManager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true") {
      MediaRecorder.AudioSource.UNPROCESSED
    } else {
      MediaRecorder.AudioSource.VOICE_RECOGNITION
    }
    val minBufferBytes = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val record = AudioRecord(
      source,
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_FLOAT,
      maxOf(minBufferBytes, SAMPLE_RATE / 4 * Float.SIZE_BYTES),
    )
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw NoAudioInputException()
    }
    capture = Capture(record) { dbfs -> sendEvent("onLevel", mapOf("dbfs" to dbfs)) }
  }

  @Synchronized
  private fun stop() {
    capture?.close()
    capture = null
  }

  // Owns one AudioRecord and the thread that drains it into a LevelMeter.
  private class Capture(private val record: AudioRecord, onLevel: (Double) -> Unit) {
    @Volatile private var running = true
    private val reader: Thread

    init {
      record.startRecording()
      val meter = LevelMeter(SAMPLE_RATE.toDouble(), onLevel)
      reader = thread(name = "SoundMeter") {
        val buffer = FloatArray(1024)
        while (running) {
          val frames = record.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
          if (frames < 0) break
          meter.process(buffer, frames)
        }
      }
    }

    fun close() {
      running = false
      reader.join()
      record.stop()
      record.release()
    }
  }

  companion object {
    // The only capture rate Android guarantees on every device.
    private const val SAMPLE_RATE = 44100
  }
}

class MicrophonePermissionException : CodedException("Microphone permission has not been granted")

class NoAudioInputException : CodedException("No audio input is available")
