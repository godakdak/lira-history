// LIRA Signature 계산 — Swift 데모(Signature.swift)와 같은 알고리즘
// LIRA 보고서 52건의 NOT NORM Signature와 0.1 dB 이내로 일치함을 확인한 방식이다.

export const C = 299792458;
export const allPhases = ['A', 'B', 'C', 'N'];

// ---------------------------------------------------------------------------
// 스펙트럼 (주파수 - 임피던스 위상)

/** 파일 버전 — app.js와 같아야 한다 (일부 파일만 올리면 화면에 경고) */
export const VERSION = '0.4';

export class SpectrumParseError extends Error {}

/** "10.0k", "1.0M", "2500000" → {value Hz, resolution} */
export function parseFrequency(token) {
  let s = String(token).trim();
  if (/hz$/i.test(s)) s = s.slice(0, -2).trim();
  let mult = 1;
  const last = s.slice(-1);
  if (last === 'k' || last === 'K') mult = 1e3;
  else if (last === 'M' || last === 'm') mult = 1e6;
  else if (last === 'G' || last === 'g') mult = 1e9;
  if (mult !== 1) s = s.slice(0, -1).trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const v = parseFloat(s);
  let res = mult;
  if (/[eE]/.test(s)) res = Math.max(Math.abs(v * mult) * 1e-6, 1e-3);
  else if (s.includes('.')) res = mult * Math.pow(10, -(s.length - s.indexOf('.') - 1));
  return { value: v * mult, resolution: Math.max(res, 1e-3) };
}

function splitFields(line) {
  let p = line.split('\t').map(x => x.trim()).filter(x => x.length);
  if (p.length < 2) p = line.split(/[,;]/).map(x => x.trim()).filter(x => x.length);
  if (p.length < 2) p = line.split(/\s+/).map(x => x.trim()).filter(x => x.length);
  return p;
}

function snap(v) {
  if (!v || !isFinite(v)) return v;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 2);
  const r = Math.round(v / mag) * mag;
  return Math.abs(r - v) / Math.abs(v) < 0.005 ? r : v;
}

/** 탭(또는 쉼표·공백)으로 구분된 "주파수  위상(deg)" 텍스트 → {label, f0, df, phase: Float64Array} */
export function parseSpectrum(raw) {
  const text = String(raw).replace(/﻿/g, '');
  let label = '';
  const freqs = [], weights = [], phases = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const f = splitFields(t);
    if (f.length < 2) continue;
    const ph = Number(f[1]);
    const fr = parseFrequency(f[0]);
    if (!fr || !isFinite(ph) || f[1] === '') {
      if (!label && !freqs.length) {
        for (const x of f) { const i = x.indexOf(' - '); if (i >= 0) label = x.slice(i + 3).trim(); }
      }
      continue;
    }
    freqs.push(fr.value); weights.push(1 / (fr.resolution * fr.resolution)); phases.push(ph);
  }
  if (phases.length < 64) throw new SpectrumParseError(`데이터 행이 ${phases.length}개뿐입니다. '주파수<탭>위상' 형식의 스펙트럼 파일인지 확인하세요.`);
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < freqs.length; i++) {
    const w = weights[i], x = i, y = freqs[i];
    sw += w; sx += w * x; sy += w * y; sxx += w * x * x; sxy += w * x * y;
  }
  const den = sw * sxx - sx * sx;
  if (!den) throw new SpectrumParseError('주파수 간격을 계산할 수 없습니다.');
  const df = snap((sw * sxy - sx * sy) / den);
  const f0 = snap((sy - df * sx) / sw);
  if (!(df > 0)) throw new SpectrumParseError('주파수 간격을 계산할 수 없습니다.');
  return makeSpectrum(label, f0, df, Float64Array.from(phases));
}

export function makeSpectrum(label, f0, df, phase) {
  return {
    label, f0, df, phase,
    get count() { return this.phase.length; },
    get maxFreq() { return this.f0 + this.df * Math.max(this.phase.length - 1, 0); },
  };
}

/** 측정 이름(예: _Jangsando_Jarado1_20250922-153014)에서 일시 */
export function measuredAtFromLabel(label) {
  const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(label || '');
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
}

// ---------------------------------------------------------------------------
// 윈도우 (LIRA CS와 같은 3종)

export const WINDOWS = ['4 Term B-H', 'Exact Blackman', 'Hamming'];

export function windowCoefficients(name, n) {
  const w = new Float64Array(n);
  if (n <= 1) { w.fill(1); return w; }
  const m = n - 1;
  for (let k = 0; k < n; k++) {
    const x = 2 * Math.PI * k / m;
    if (name === 'Exact Blackman') w[k] = 0.42659071 - 0.49656062 * Math.cos(x) + 0.07684867 * Math.cos(2 * x);
    else if (name === 'Hamming') w[k] = 0.54 - 0.46 * Math.cos(x);
    else w[k] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
  }
  return w;
}

// ---------------------------------------------------------------------------
// FFT (실수 입력, zero-padding) — N/2 복소 FFT로 계산

const MAX_LOG2N = 17;
const twiddleCache = new Map();

function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) { t.cos[i] = Math.cos(2 * Math.PI * i / n); t.sin[i] = -Math.sin(2 * Math.PI * i / n); }
    twiddleCache.set(n, t);
  }
  return t;
}

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const tw = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = tw.cos[k * step], wi = tw.sin[k * step];
        const a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/** 실수 x(길이 ≤ N)를 N점 zero-padding FFT한 |X[k]|, k = 0..bins-1 */
export function realFFTMagnitude(x, log2n, bins) {
  const N = 1 << log2n, H = N >> 1;
  const re = new Float64Array(H), im = new Float64Array(H);
  for (let i = 0; i < Math.min(x.length, N); i++) {
    if (i & 1) im[i >> 1] = x[i]; else re[i >> 1] = x[i];
  }
  fftInPlace(re, im);
  const out = new Float64Array(Math.min(bins, H));
  for (let k = 0; k < out.length; k++) {
    const k2 = k === 0 ? 0 : H - k;
    const er = 0.5 * (re[k] + re[k2]), ei = 0.5 * (im[k] - im[k2]);
    const orr = 0.5 * (im[k] + im[k2]), oi = -0.5 * (re[k] - re[k2]);
    const a = -2 * Math.PI * k / N, c = Math.cos(a), s = Math.sin(a);
    const xr = er + c * orr - s * oi, xi = ei + c * oi + s * orr;
    out[k] = Math.hypot(xr, xi);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Signature

export function guidelineBandwidthMHz(length) {
  return 1126.70 * Math.pow(Math.max(length, 1), -0.798);
}

/**
 * LIRA CS와 같은 Spot Signature: 0 Hz ~ 분석대역 위상(deg) × 윈도우 → FFT → 20·log10(√2·|X|/Σw)
 * 평균(DC)을 빼지 않는다. 내보낸 스펙트럼이 0 Hz 없이 df부터 시작하면 첫 값을 0 Hz 값으로 보충한다.
 */
export function computeSignature(s, bandwidthHz, windowName, vr, maxDistance) {
  const bw = Math.min(Math.max(bandwidthHz, s.f0 + s.df * 16), s.maxFreq);
  let n = Math.round((bw - s.f0) / s.df) + 1;
  n = Math.min(Math.max(n, 16), Math.min(s.count, (1 << MAX_LOG2N) - 1));
  const prepend = Math.abs(s.f0 - s.df) < s.df * 0.01 ? 1 : 0;
  const m = n + prepend;
  const x = new Float64Array(m);
  if (prepend) x[0] = s.phase[0];
  for (let i = 0; i < n; i++) x[i + prepend] = s.phase[i];
  const w = windowCoefficients(windowName, m);
  let wsum = 0;
  for (let i = 0; i < m; i++) { x[i] *= w[i]; wsum += w[i]; }

  const v = Math.max(vr, 0.05) * C;
  const totalRange = v / (2 * s.df);
  const wantBins = 800 * totalRange / Math.max(maxDistance, 1);
  const log2n = Math.min(Math.ceil(Math.log2(Math.max(m, wantBins, 1024))), MAX_LOG2N);
  const npad = 1 << log2n;
  const step = totalRange / npad;
  const bins = Math.min(npad / 2, Math.floor(maxDistance / step) + 3);
  const mag = realFFTMagnitude(x, log2n, bins);
  const scale = Math.SQRT2 / Math.max(wsum, 1e-9);
  const values = new Float64Array(mag.length);
  for (let i = 0; i < mag.length; i++) values[i] = 20 * Math.log10(mag[i] * scale + 1e-9);
  const top = s.f0 + s.df * (n - 1);
  return {
    step, values, vr, bandwidthHz: top, resolutionM: v / Math.max(top, 1), bandSamples: m,
    get shadowM() { return this.resolutionM * 5 / 3; },
  };
}

export function sigValueAt(r, distance) {
  if (!(r.step > 0)) return null;
  const x = Math.abs(distance) / r.step;
  const i = Math.floor(x);
  if (i + 1 >= r.values.length) return null;
  const t = x - i;
  return r.values[i] * (1 - t) + r.values[i + 1] * t;
}

/** LIRA Master mode LENGTH처럼 긍장 기준으로 종단 반사 피크 위치에서 VR을 산출 */
export function estimateVR(s, bandwidthHz, windowName, length) {
  if (!(length > 0)) return null;
  const lo = length / 0.90, hi = length / 0.30;
  const r = computeSignature(s, bandwidthHz, windowName, 1.0, hi);
  const i0 = Math.max(Math.floor(lo / r.step), 1);
  const i1 = Math.min(Math.floor(hi / r.step), r.values.length - 2);
  if (i1 <= i0) return null;
  let best = i0;
  for (let i = i0; i <= i1; i++) if (r.values[i] > r.values[best]) best = i;
  const y0 = r.values[best - 1], y1 = r.values[best], y2 = r.values[best + 1];
  const den = y0 - 2 * y1 + y2;
  const off = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
  const d = (best + Math.max(-0.5, Math.min(0.5, off))) * r.step;
  return d > 0 ? length / d : null;
}

// ---------------------------------------------------------------------------
// 감쇠 보정 + 정규화 (LIRA Normalization, Norm ON)
//  NORM(d) = Signature(d) + slope·d − zero
//  slope = (39 dB − 종단 반사 피크) / 종단 거리   (개방 종단 완전 반사 = 39 dB)
//  zero  = 회귀선 절편 + VAR × SD  ("평균 변동 + 1 SD")
//    감쇠 보정한 신호의 [2×분해능, 0.9×긍장] 구간에서 평균 ±1.5 SD 밖의 값(반사 피크·골)을 한 번 걸러 내고,
//    남은 값의 평균 = 절편(LIRA처럼 0 dB 이하로 제한), 표준편차 = SD.
//    검증: LIRA 보고서 52건 + 완주 SW1001 3건에서 LIRA 0 dB 선과 중앙값 0.5 dB 차이 (37/55건 1 dB 이내).
//  LIRA 분석값(.sdt/.anl)이 있으면 그 값을 그대로 쓴다.

export const FULL_REFLECTION_DB = 39;
export const OUTLIER_SIGMA = 1.5;

function meanStd(a) {
  let s = 0, s2 = 0;
  for (const x of a) { s += x; s2 += x * x; }
  const m = s / a.length;
  return [m, Math.sqrt(Math.max(s2 / a.length - m * m, 0))];
}

export function makeNormalization(r, length, variance = 1) {
  if (!(length > 0) || !(r.step > 0) || r.values.length < 9) return null;
  const v = r.values;
  const i0 = Math.max(Math.floor(length * 0.85 / r.step), 1);
  const i1 = Math.min(Math.floor(length * 1.15 / r.step), v.length - 2);
  if (i1 <= i0) return null;
  let b = i0;
  for (let i = i0; i <= i1; i++) if (v[i] > v[b]) b = i;
  const y0 = v[b - 1], y1 = v[b], y2 = v[b + 1];
  const den = y0 - 2 * y1 + y2;
  const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
  const peak = y1 - 0.25 * (y0 - y2) * off;
  const dEnd = (b + off) * r.step;
  if (!(dEnd > 0)) return null;
  const slope = Math.max((FULL_REFLECTION_DB - peak) / dEnd, 0);

  let a = 2 * r.resolutionM, e = 0.9 * length;
  if (e - a < 0.3 * length) { a = 0.05 * length; e = 0.9 * length; }
  const j0 = Math.max(Math.ceil(a / r.step), 0), j1 = Math.min(Math.floor(e / r.step), v.length - 1);
  if (j1 - j0 < 8) return null;
  const z = [];
  for (let j = j0; j <= j1; j++) z.push(v[j] + slope * j * r.step);
  const [m0, s0] = meanStd(z);
  const kept = z.filter(x => Math.abs(x - m0) <= OUTLIER_SIGMA * s0);
  const [m1, sd] = kept.length > 4 ? meanStd(kept) : [m0, s0];
  const intercept = Math.min(m1, 0);
  return { endDistance: dEnd, endPeakDB: peak, slope, intercept, sd, sigma: variance, zeroDB: intercept + variance * sd, source: '앱 추정' };
}

/**
 * 화면 표시용 곡선 (LIRA Signature 탭과 같은 방식).
 *  - Normalized OFF: Signature 그대로 (LIRA Norm OFF = NOT Normalized, 감쇠 보정 없음)
 *  - Normalized ON : Signature(d) + slope·d − zero (감쇠 보정 + 0 dB 기준선), 반전 시 d = |L − x|
 * 정규화 좌표에서 'k SD' 높이 = (k − sigma) × sd  (0 dB = 절편 + sigma × SD)
 */
export function displayTrace(r, norm, normalize, reversed, length, xMax) {
  const step = r.step;
  const count = Math.floor(xMax / step) + 2;
  const rev = reversed && length > 0;
  const L = length || 0;
  const vals = new Float64Array(count).fill(NaN);
  for (let j = 0; j < count; j++) {
    const x = j * step;
    const d = rev ? Math.abs(L - x) : x;
    const own = sigValueAt(r, d);
    if (own == null) continue;
    vals[j] = normalize && norm ? own + norm.slope * Math.abs(d) - norm.zeroDB : own;
  }
  const sd = normalize && norm && norm.sd > 0 ? norm.sd : null;
  return { step, values: vals, sd, sigma: norm?.sigma ?? 1 };
}

/** 정규화 좌표에서 'k SD' 선의 높이 */
export function sdLevel(trace, k) {
  return trace && trace.sd != null ? (k - (trace.sigma ?? 1)) * trace.sd : null;
}

export function traceValueAt(t, x) {
  if (!(t.step > 0) || x < 0) return null;
  const p = x / t.step, i = Math.floor(p);
  if (i + 1 >= t.values.length) return null;
  const a = t.values[i], b = t.values[i + 1];
  if (!isFinite(a) || !isFinite(b)) return null;
  const f = p - i;
  return a * (1 - f) + b * f;
}

/** TDR 표기 전파속도 (m/μs) = VR × 광속 / 2 */
export function tdrVelocity(vr) { return vr * C / 2 / 1e6; }
