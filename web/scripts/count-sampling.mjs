// Browser-side evidence shared by choreography and the throttled review probe.
export const recordCounts = () => {
  let samples = [], frames = [], frame;
  const last = new Map();
  const sample = (renderFrame = false) => {
    const at = globalThis.performance.now();
    if (renderFrame) frames.push(at);
    for (const el of document.querySelectorAll('.tiles > .tile')) {
      const label = el.querySelector('.tile__label span')?.textContent?.trim();
      const text = el.querySelector('.tile__value strong')?.textContent;
      if (!label || text == null || last.get(el) === text) continue;
      last.set(el, text); samples.push({ el, label, text, at });
    }
  };
  const tick = () => { sample(true); frame = globalThis.requestAnimationFrame(tick); };
  globalThis.__countsFrom = () => {
    globalThis.cancelAnimationFrame(frame); samples = []; frames = []; last.clear(); tick();
  };
  globalThis.__countSnapshot = () => {
    // Include the terminal DOM value even when the renderer delivered no intermediate frame.
    sample();
    return {
      series: samples.filter(s => s.el.isConnected).map(({ label, text, at }) => ({ label, text, at })),
      frames: [...frames],
      tiles: [...document.querySelectorAll('.tiles > .tile')].map(el => {
        const value = el.querySelector('.tile__value strong');
        return { label: el.querySelector('.tile__label span')?.textContent?.trim(),
          start: Number(value?.dataset.countStart), delay: Number(value?.dataset.countDelay),
          duration: Number(value?.dataset.countDuration), target: value?.dataset.countTarget,
          text: value?.textContent };
      }),
    };
  };
  globalThis.__countsFrom();
};

// Include the frames bracketing the window: a long stalled frame must not disappear
// merely because it straddled the tween. Ordering requires a sustained 20 fps, so
// report both average throughput and the slowest frame's equivalent fps.
export function frameRate(frames, start, end) {
  const gaps = frames.slice(1).map((at, i) => ({ from: frames[i], at, gap: at - frames[i] }))
    .filter(f => f.gap > 0 && f.at >= start && f.from <= end);
  if (!gaps.length) return { fps: 0, sustained: 0 };
  return { sustained: 1000 / Math.max(...gaps.map(f => f.gap)), fps: gaps.length * 1000 / gaps.reduce((sum, f) => sum + f.gap, 0) };
}
const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
const number = text => {
  const match = /^(?:≈\s*)?(-?[\d,]+(?:\.\d+)?)\s*([KMBT])?(?:%|\s*ms)?$/.exec((text ?? '').trim());
  return match ? Number(match[1].replaceAll(',', '')) * (scale[match[2]] ?? 1) : null;
};
export function checkCounts(where, snapshot, schedules, check) {
  const results = [];
  for (const tile of snapshot.tiles) {
    const target = number(tile.target);
    if (target === null) continue;
    const samples = snapshot.series.filter(s => s.label === tile.label);
    const values = samples.map(s => number(s.text));
    const timing = schedules.find(s => s.label === tile.label);
    check(!!timing && tile.delay === timing.delay && tile.duration === 640,
      `${where}: ${tile.label} count schedule ${tile.delay}/${tile.duration}, expected ${timing?.delay}/640`);
    check(samples.length > 0, `${where}: ${tile.label} has no samples`);
    if (!samples.length) continue;
    if (samples[0].at < tile.start + 100)
      check(values[0] === 0, `${where}: ${tile.label} early sample was ${samples[0].text}, expected zero`);
    check(values.every((v, i) => v !== null && (i === 0 || v >= values[i - 1])),
      `${where}: ${tile.label} samples are not monotonic: ${samples.map(s => s.text)}`);
    check(samples.at(-1).text === tile.target && tile.text === tile.target,
      `${where}: ${tile.label} terminal value ${tile.text}, expected ${tile.target}`);
    const rate = frameRate(snapshot.frames, tile.start, tile.start + tile.duration);
    if (target !== 0 && rate.fps >= 20)
      check(samples.length >= 3, `${where}: ${tile.label} reached ${tile.target} in ${samples.length} steps at ${rate.fps.toFixed(1)} fps`);
    console.log(`${where}: ${tile.label} ${samples.length} steps, ${rate.fps.toFixed(1)} fps (slowest-frame cadence ${rate.sustained.toFixed(1)}); ${rate.fps >= 20 ? 'step count checked' : 'step count skipped below 20 fps'}; schedule, monotonicity and terminal checked`);
    results.push({ label: tile.label, steps: samples.length, ...rate });
  }
  check(results.length > 0, `${where}: no numeric count schedules found`);
  return results;
}
