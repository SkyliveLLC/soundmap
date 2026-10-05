import Foundation

// A-weighting per IEC 61672-1: the analog filter's poles (20.598997, 107.65265,
// 737.86223 and 12194.217 Hz) and four zeros at 0 Hz, mapped to the input sample
// rate by the bilinear transform and normalised to 0 dB at 1 kHz.
// AWeighting.kt in the Android module uses the identical design. Change both together.
struct AWeightingFilter {
  private var sections: [Biquad]

  init(sampleRate fs: Double) {
    func pole(_ hz: Double) -> Double {
      let w = 2 * Double.pi * hz
      return (2 * fs - w) / (2 * fs + w)
    }
    let p1 = pole(20.598997), p2 = pole(107.65265), p3 = pole(737.86223), p4 = pole(12194.217)
    // Zeros at s = 0 map to z = 1. The two extra zeros at s = infinity map to z = -1.
    var sections = [
      Biquad(b0: 1, b1: -2, b2: 1, a1: -2 * p1, a2: p1 * p1),
      Biquad(b0: 1, b1: -2, b2: 1, a1: -(p2 + p3), a2: p2 * p3),
      Biquad(b0: 1, b1: 2, b2: 1, a1: -2 * p4, a2: p4 * p4),
    ]
    let gainAt1k = sections.reduce(1.0) { $0 * $1.magnitude(at: 1000, sampleRate: fs) }
    sections[0].scale(by: 1 / gainAt1k)
    self.sections = sections
  }

  mutating func process(_ x: Double) -> Double {
    var y = x
    for i in sections.indices {
      y = sections[i].process(y)
    }
    return y
  }
}

// Transposed direct form II. Double state because the 20 Hz poles sit very close to z = 1.
struct Biquad {
  private(set) var b0, b1, b2: Double
  let a1, a2: Double
  private var z1 = 0.0, z2 = 0.0

  init(b0: Double, b1: Double, b2: Double, a1: Double, a2: Double) {
    (self.b0, self.b1, self.b2, self.a1, self.a2) = (b0, b1, b2, a1, a2)
  }

  mutating func scale(by k: Double) {
    b0 *= k
    b1 *= k
    b2 *= k
  }

  mutating func process(_ x: Double) -> Double {
    let y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }

  func magnitude(at hz: Double, sampleRate fs: Double) -> Double {
    let w = 2 * Double.pi * hz / fs
    let (c1, s1, c2, s2) = (cos(w), sin(w), cos(2 * w), sin(2 * w))
    let numRe = b0 + b1 * c1 + b2 * c2, numIm = -(b1 * s1 + b2 * s2)
    let denRe = 1 + a1 * c1 + a2 * c2, denIm = -(a1 * s1 + a2 * s2)
    return (numRe * numRe + numIm * numIm).squareRoot() / (denRe * denRe + denIm * denIm).squareRoot()
  }
}

// A-weights samples and reports A-weighted dBFS once per 125 ms ("fast") window.
final class LevelMeter {
  static let windowSeconds = 0.125

  private var filter: AWeightingFilter
  private let windowLength: Int
  private var sumOfSquares = 0.0
  private var count = 0
  private let onLevel: (Double) -> Void

  init(sampleRate: Double, onLevel: @escaping (Double) -> Void) {
    filter = AWeightingFilter(sampleRate: sampleRate)
    windowLength = Int((sampleRate * Self.windowSeconds).rounded())
    self.onLevel = onLevel
  }

  func process(_ samples: UnsafePointer<Float>, count frames: Int) {
    for i in 0..<frames {
      let y = filter.process(Double(samples[i]))
      sumOfSquares += y * y
      count += 1
      if count == windowLength {
        let rms = (sumOfSquares / Double(count)).squareRoot()
        // Floor keeps digital silence finite instead of -infinity.
        onLevel(20 * log10(max(rms, 1e-9)))
        sumOfSquares = 0
        count = 0
      }
    }
  }
}
