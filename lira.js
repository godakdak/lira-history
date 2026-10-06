// LIRA 측정 폴더 파일(.lira / .anl / .out / .sdt) 읽기
// 장산도–자라도1 2025-09-22 B상 파일로 검증: .anl의 직렬 인덕턴스 보정을 적용한 위상이
// LIRA 클립보드 내보내기와 0.1° 이내, 계산한 Signature가 .sdt와 평균 0.00 dB로 일치.

import { makeSpectrum } from './signature.js';

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
    residYC_nF: num(mod.ResidYC) || 0,
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
  return { slope, zero, sd, length: sdt.d[n - 1] };
}

/**
 * .lira(+ .anl) → 위상 스펙트럼. LIRA처럼 직렬 인덕턴스(ResidZL, μH)를 빼고
 * 병렬 표유용량(ResidYC, nF)이 있으면 그것도 보정한다.
 */
export function spectrumFromLira(lira, anl) {
  const L = (anl?.residZL_uH || 0) * 1e-6;
  const Cp = (anl?.residYC_nF || 0) * 1e-9;
  const N = lira.N;
  const ph = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 2 * Math.PI * lira.f[i];
    let zr = lira.re[i], zi = lira.im[i] - w * L;
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
    if (!['lira', 'anl', 'out', 'sdt'].includes(ext)) { loose.push(f); continue; }
    const m = /(\d{8}-\d{6})/.exec(f.name);
    const key = m ? f.name.slice(0, f.name.indexOf(m[1]) + m[1].length).replace(/^[0-9a-f]{8}-(?=_)/, '') : f.name.replace(/\.[^.]+$/, '');
    if (!groups.has(key)) groups.set(key, { key, files: {} });
    groups.get(key).files[ext] = f;
  }
  return { groups: [...groups.values()], loose };
}
