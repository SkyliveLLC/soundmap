#if targetEnvironment(simulator)
import Foundation

// Simulator builds feed the meter a synthetic café instead of the Mac's microphone,
// which the simulator reaches through the host audio server and which can deadlock
// there. Everything after the microphone (A-weighting, framing, events, JS) still runs.
final class SimulatedInput {
  private static let sampleRate = 48_000.0
  private static let chunkSeconds = 0.1
  // Roughly 55 dB SPL with the placeholder calibration offset: a quiet café.
  private static let backgroundRms: Float = 0.0006

  private let meter: LevelMeter
  private let queue = DispatchQueue(label: "soundmap.simulated-input")
  private var timer: DispatchSourceTimer?
  private var burstGain: Float = 1
  private var burstSecondsLeft = 0.0

  init(onLevel: @escaping (Double) -> Void) {
    meter = LevelMeter(sampleRate: Self.sampleRate, onLevel: onLevel)
  }

  func start() {
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now(), repeating: Self.chunkSeconds)
    timer.setEventHandler { [weak self] in self?.emitChunk() }
    timer.resume()
    self.timer = timer
  }

  func stop() {
    timer?.cancel()
    timer = nil
  }

  private func emitChunk() {
    updateBurst()
    let count = Int(Self.sampleRate * Self.chunkSeconds)
    // Uniform noise in [-a, a] has RMS a / sqrt(3).
    let amplitude = Self.backgroundRms * burstGain * Float(3).squareRoot()
    let samples = (0..<count).map { _ in Float.random(in: -amplitude...amplitude) }
    samples.withUnsafeBufferPointer { meter.process($0.baseAddress!, count: count) }
  }

  // Occasional louder events (grinder, laughter, a dropped cup) so L10, LAmax and
  // spikiness have something to show.
  private func updateBurst() {
    if burstSecondsLeft > 0 {
      burstSecondsLeft -= Self.chunkSeconds
      if burstSecondsLeft <= 0 { burstGain = 1 }
    } else if Double.random(in: 0..<1) < 0.04 {
      burstSecondsLeft = Double.random(in: 0.5...3)
      burstGain = Float.random(in: 2...6)
    }
  }
}
#endif
