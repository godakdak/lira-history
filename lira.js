// LIRA 측정 폴더 파일(.lira / .anl / .out / .sdt / .pbd) 읽기
// 검증
//  - 장산도–자라도1 2025-09-22 B상 (LIRA CS 6.2.5, 프로브 보정 OFF): .anl 직렬 인덕턴스 보정 위상이
//    LIRA 클립보드 내보내기와 0.1° 이내, Signature가 .sdt와 평균 0.00 dB.
//  - 완주 SW1001 2024-01-23 A·B·C상 (LIRA CS 6.4.1, 프로브 보정 ON): .pbd 프로브 보정을 적용하면
//    Signature가 .sdt NOT Normalized와 중앙값 0.00~0.04 dB (보정 없이는 −4 dB, 모양도 다름).

import { makeSpectrum } from './signature.js?v=0.5';

export const VERSION = '0.5';

/** .lira: 헤더 + [N, 주파수 float32 BE] + [N, 실수부] + [N, 허수부] */
export function parseLiraBinary(buf) {
  const dv = new DataView(buf);
  const size = buf.byteLength;
  for (let p = 0; p + 4 <= Math.min(size, 8192); p++) {
    const N = dv.getUint32(p, false);
    if (N < 64 || N > 2000000) continue;
    if (p + 3 * (4 + 4 * N) !== size) continue;
    if (dv.getUint32(p + 4 + 4 * N, false) !== N) continue;
    if (dv.getUint32(p + 8 + 8 * N, false) !== N) continue;
    const f = new Float64Array(N), re = new Float64Array(N), im = new Float64Array(N);
    let ok = true;
    for (let i = 0; i < N; i++) {
      f[i] = dv.getFloat32(p + 4 + 4 * i, false);
      re[i] = dv.getFloat32(p + 8 + 4 * N + 4 * i, false);
      im[i] = dv.getFloat32(p + 12 + 8 * N + 4 * i, false);
      if (i > 0 && !(f[i] > f[i - 1])) { ok = false; break; }
    }
    if (!ok) continue;
    const header = latin1(new Uint8Array(buf, 0, p));
    return { N, f, re, im, header, phaseName: phaseFromText(header), measName: measNameFromText(header) };
  }
  throw new Error('.lira 파일 형식을 인식하지 못했습니다.');
}

function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** INI 형식(.anl, .out) → { section: { key: value } } */
export function parseIni(text) {
  const out = {};
  let sec = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^\[(.+)\]$/.exec(line);
    if (m) { sec = m[1]; out[sec] = out[sec] || {}; continue; }
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    v = v.replace(/\\0A/g, '\n');
    (out[sec] = out[sec] || {})[k] = v;
  }
  return out;
}

function num(v) {
  if (v == null) return null;
  const x = parseFloat(String(v).trim());
  return isFinite(x) ? x : null;
}

export function phaseFromText(t) {
  const m = /Phase\s*([ABCN])\b/i.exec(t || '') || /([ABCN])\s*상/.exec(t || '');
  return m ? m[1].toUpperCase() : null;
}

export function measNameFromText(t) {
  const m = /([^\x00-\x1f"\\/]*?\d{8}-\d{6})(?:\.lira)?/.exec(t || '');
  return m ? m[1].replace(/^[^\w_]+/, '') : null;
}

/**
 * .pbd: 프로브 보정 데이터 (LIRA Spectrum → Probe). little-endian
 *  [f64 프로브 특성임피던스][u16 EnableProbComp][u32 N][N × (f64 주파수, f64 Re H)][u32 N][N × (f64 주파수, f64 Im H)]
 * H(f)는 프로브(리드선)만 측정한 반사 전달함수. 보정: Γ케이블 = Γ측정 / H, Γ = (Z − Z0)/(Z + Z0)
 */
export function parsePbd(buf) {
  const dv = new DataView(buf);
  const bad = () => { throw new Error('.pbd 파일 형식을 인식하지 못했습니다.'); };
  if (buf.byteLength < 64) bad();
  const z0 = dv.getFloat64(0, true);
  const enabled = dv.getUint16(8, true) === 1;
  const n = dv.getUint32(10, true);
  const p2 = 14 + 16 * n;
  if (!(z0 > 1 && z0 < 1000) || !(n >= 16 && n < 2e6) || p2 + 4 + 16 * n > buf.byteLength) bad();
  if (dv.getUint32(p2, true) !== n) bad();
  const f = new Float64Array(n), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    f[i] = dv.getFloat64(14 + 16 * i, true);
    re[i] = dv.getFloat64(14 + 16 * i + 8, true);
    im[i] = dv.getFloat64(p2 + 4 + 16 * i + 8, true);
    if ((i > 0 && !(f[i] > f[i - 1])) || !isFinite(re[i]) || !isFinite(im[i])) bad();
  }
  return { z0, enabled, n, f, re, im };
}

/** 프로브 전달함수 H를 주파수 fr에서 (선형 보간) */
function probeAt(pbd, fr, hint) {
  const { f, re, im, n } = pbd;
  if (hint >= 0 && hint < n && Math.abs(f[hint] - fr) < 1e-3 * Math.max(fr, 1)) return [re[hint], im[hint]];
  if (fr <= f[0]) return [re[0], im[0]];
  if (fr >= f[n - 1]) return [re[n - 1], im[n - 1]];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m] <= fr) lo = m; else hi = m; }
  const t = (fr - f[lo]) / (f[hi] - f[lo]);
  return [re[lo] + t * (re[hi] - re[lo]), im[lo] + t * (im[hi] - im[lo])];
}

/** .anl 분석 설정에서 필요한 값 */
export function readAnl(text) {
  const ini = parseIni(text);
  const op = ini.Operation || {}, an = ini.Analyzer || {}, imp = ini.Impedance || {};
  const mod = ini.Modulator || {}, hs = ini.HotSpot || {}, dso = ini.DSO || {};
  return {
    cable: op.TestCable || '',
    testInfo: op.TestInfo || '',
    phase: phaseFromText(op.TestInfo),
    date: op.TestDate || '',
    length: num(op.Length) ?? num(an.SegLen0),
    bandPct: num(imp.band),
    vr: num(an.SegVR0),
    maxFreqMHz: num(dso.MaxFreq),
    residZL_uH: num(mod.ResidZL) || 0,
    residYC_pF: num(mod.ResidYC) || 0,   // LIRA 보고서의 'Stray capacitance (pF)'
    outlierSigma: num(an.Outliers),
    impOffset: num(imp.offset) || 0,
    normSlopePerBin: num(hs.NormParamValue),
    normOffset: num(hs.NormParamOffset),
    sigmaCoeff: num(hs.sigmacoeff) ?? 1,
    operator: op.Operator || '',
  };
}

/** .out 분석 결과 */
export function readOut(text) {
  const r = parseIni(text)['LIRA analysis results'] || {};
  let vr = num(r.VR);
  if (vr != null && vr > 2) vr = vr / 10000;
  return {
    deltaG: num(r.DeltaG),
    vr,
    attenuation: num(r['Attenuation(dB/km)']),
    z0: num(r['Char. Impedance(ohm)']),
    termination: (r['Termination status'] || '').trim(),
    length: num(r['Cable length(m)']),
  };
}

/** .sdt: 거리, Normalized dB, NOT Normalized dB */
export function readSdt(text) {
  const d = [], norm = [], raw = [];
  for (const line of String(text).split(/\r?\n/)) {
    const p = line.trim().split(/\t+/);
    if (p.length < 3) continue;
    const a = Number(p[0]), b = Number(p[1]), c = Number(p[2]);
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) continue;
    d.push(a); norm.push(b); raw.push(c);
  }
  return d.length > 20 ? { d, norm, raw } : null;
}

/**
 * LIRA 분석값(정규화 0 dB 선과 SD).
 * .sdt의 (Normalized − NOT Normalized) = slope·d − zero 직선에서 slope·zero를 얻고,
 * .anl의 회귀선 절편(NormParamOffset)으로 SD = (zero − 절편) / sigmacoeff 를 구한다.
 */
export function liraNormalization(sdt, anl) {
  if (!sdt) return null;
  const n = sdt.d.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = sdt.d[i], y = sdt.norm[i] - sdt.raw[i];
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (!den) return null;
  const slope = (n * sxy - sx * sy) / den;
  const icpt = (sy - slope * sx) / n;
  const zero = -icpt;
  let sd = null;
  if (anl && anl.normOffset != null) {
    const s = (zero - anl.normOffset) / (anl.sigmaCoeff || 1);
    if (s > 0 && s < 40) sd = s;
  }
  return { slope, zero, sd, sigma: anl?.sigmaCoeff || 1, length: sdt.d[n - 1] };
}

/**
 * .lira(+ .anl, .pbd) → 위상 스펙트럼 (LIRA가 Signature 계산에 쓰는 위상).
 *  1) 프로브 보정(.pbd의 EnableProbComp가 켜져 있을 때): Γc = Γm / H, Z = Z0·(1 + Γc)/(1 − Γc)
 *  2) 직렬 인덕턴스(ResidZL, μH) 제거, 병렬 표유용량(ResidYC, pF) 제거
 */
export function spectrumFromLira(lira, anl, pbd) {
  const L = (anl?.residZL_uH || 0) * 1e-6;
  const Cp = (anl?.residYC_pF || 0) * 1e-12;
  const probe = pbd && pbd.enabled ? pbd : null;
  const Z0 = probe ? probe.z0 : 50;
  const N = lira.N;
  const ph = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 2 * Math.PI * lira.f[i];
    let zr = lira.re[i], zi = lira.im[i];
    if (probe) {
      // Γm = (Z − Z0)/(Z + Z0)
      const nr = zr - Z0, ni = zi, dr = zr + Z0, di = zi, dd = dr * dr + di * di;
      const gr = (nr * dr + ni * di) / dd, gi = (ni * dr - nr * di) / dd;
      // Γc = Γm / H
      const [hr, hi] = probeAt(probe, lira.f[i], i);
      const hh = hr * hr + hi * hi;
      const cr = (gr * hr + gi * hi) / hh, ci = (gi * hr - gr * hi) / hh;
      // Z = Z0 (1 + Γc)/(1 − Γc)
      const ar = 1 + cr, ai = ci, br = 1 - cr, bi = -ci, bb = br * br + bi * bi;
      zr = Z0 * (ar * br + ai * bi) / bb;
      zi = Z0 * (ai * br - ar * bi) / bb;
    }
    zi -= w * L;
    if (Cp) {
      const d = zr * zr + zi * zi;
      const yr = zr / d, yi = -zi / d - w * Cp;
      const d2 = yr * yr + yi * yi;
      zr = yr / d2; zi = -yi / d2;
    }
    ph[i] = Math.atan2(zi, zr) * 180 / Math.PI;
  }
  const df = (lira.f[N - 1] - lira.f[0]) / (N - 1);
  const f0 = lira.f[0];
  return makeSpectrum(lira.measName || anl?.cable || '', Math.round(f0 * 1000) / 1000, Math.round(df * 1000) / 1000, ph);
}

/** 스펙트럼을 LIRA 내보내기와 같은 탭 구분 텍스트로 (중앙 저장소 보관용) */
export function spectrumToText(sp) {
  const head = `frequency (Hz) - ${sp.label}\tImp. phase (deg) - ${sp.label}`;
  const lines = [head];
  for (let i = 0; i < sp.count; i++) lines.push(`${(sp.f0 + sp.df * i).toFixed(1)}\t${sp.phase[i].toFixed(4)}`);
  return lines.join('\n');
}

/** 업로드한 파일들을 측정 이름(…_YYYYMMDD-HHMMSS)별로 묶는다 */
export function groupLiraFiles(files) {
  const groups = new Map();
  const loose = [];
  for (const f of files) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['lira', 'anl', 'out', 'sdt', 'pbd'].includes(ext)) { loose.push(f); continue; }
    const m = /(\d{8}-\d{6})/.exec(f.name);
    const key = m ? f.name.slice(0, f.name.indexOf(m[1]) + m[1].length).replace(/^[0-9a-f]{8}-(?=_)/, '') : f.name.replace(/\.[^.]+$/, '');
    if (!groups.has(key)) groups.set(key, { key, files: {} });
    groups.get(key).files[ext] = f;
  }
  return { groups: [...groups.values()], loose };
}
