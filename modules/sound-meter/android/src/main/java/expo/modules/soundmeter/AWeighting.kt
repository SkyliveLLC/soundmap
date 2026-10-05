package expo.modules.soundmeter

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

// A-weighting per IEC 61672-1: the analog filter's poles (20.598997, 107.65265,
// 737.86223 and 12194.217 Hz) and four zeros at 0 Hz, mapped to the input sample
// rate by the bilinear transform and normalised to 0 dB at 1 kHz.
// LevelMeter.swift in the iOS module uses the identical design. Change both together.
class AWeightingFilter(fs: Double) {
  private val sections: List<Biquad>

  init {
    fun pole(hz: Double): Double {
      val w = 2 * PI * hz
      return (2 * fs - w) / (2 * fs + w)
    }
    val p1 = pole(20.598997)
    val p2 = pole(107.65265)
    val p3 = pole(737.86223)
    val p4 = pole(12194.217)
    // Zeros at s = 0 map to z = 1. The two extra zeros at s = infinity map to z = -1.
    val unscaled = listOf(
      Biquad(1.0, -2.0, 1.0, -2 * p1, p1 * p1),
      Biquad(1.0, -2.0, 1.0, -(p2 + p3), p2 * p3),
      Biquad(1.0, 2.0, 1.0, -2 * p4, p4 * p4),
    )
    val gainAt1k = unscaled.fold(1.0) { acc, s -> acc * s.magnitude(1000.0, fs) }
    sections = listOf(unscaled[0].scaled(1 / gainAt1k)) + unscaled.drop(1)
  }

  fun process(x: Double): Double = sections.fold(x) { y, s -> s.process(y) }
}

// Transposed direct form II. Double state because the 20 Hz poles sit very close to z = 1.
class Biquad(
  private val b0: Double,
  private val b1: Double,
  private val b2: Double,
  private val a1: Double,
  private val a2: Double,
) {
  private var z1 = 0.0
  private var z2 = 0.0

  fun scaled(k: Double) = Biquad(b0 * k, b1 * k, b2 * k, a1, a2)

  fun process(x: Double): Double {
    val y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }

  fun magnitude(hz: Double, fs: Double): Double {
    val w = 2 * PI * hz / fs
    val numRe = b0 + b1 * cos(w) + b2 * cos(2 * w)
    val numIm = -(b1 * sin(w) + b2 * sin(2 * w))
    val denRe = 1 + a1 * cos(w) + a2 * cos(2 * w)
    val denIm = -(a1 * sin(w) + a2 * sin(2 * w))
    return sqrt(numRe * numRe + numIm * numIm) / sqrt(denRe * denRe + denIm * denIm)
  }
}

// A-weights samples and reports A-weighted dBFS once per 125 ms ("fast") window.
class LevelMeter(sampleRate: Double, private val onLevel: (Double) -> Unit) {
  private val filter = AWeightingFilter(sampleRate)
  private val windowLength = (sampleRate * WINDOW_SECONDS).roundToInt()
  private var sumOfSquares = 0.0
  private var count = 0

  fun process(samples: FloatArray, frames: Int) {
    for (i in 0 until frames) {
      val y = filter.process(samples[i].toDouble())
      sumOfSquares += y * y
      count += 1
      if (count == windowLength) {
        val rms = sqrt(sumOfSquares / count)
        // Floor keeps digital silence finite instead of -infinity.
        onLevel(20 * log10(max(rms, 1e-9)))
        sumOfSquares = 0.0
        count = 0
      }
    }
  }

  companion object {
    const val WINDOW_SECONDS = 0.125
  }
}
