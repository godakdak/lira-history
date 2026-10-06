// LIRA 진단이력 — 웹 버전 (Swift Playgrounds 데모와 같은 동작)
// 데이터는 store.js를 통해 중앙 저장소(Supabase) 또는 이 브라우저(로컬 모드)에 저장된다.

import * as Sig from './signature.js';
import * as Lira from './lira.js';
import { createStore } from './store.js';

const { createApp, reactive, computed, watch, nextTick, markRaw } = Vue;

// ===========================================================================
// 상수·유틸

const HQ_LIST = ['부산울산', '광주전남', '남서울', '서울', '경기북부', '경기', '인천', '강원', '충북', '대전세종충남', '전북', '대구', '경북', '경남', '제주'];
const PHOTO_TAGS = ['설비 명판', '현장 전경', '측정 연결', '장비 화면', '기타'];
const PHASES = Sig.allPhases;
const LOC_LABEL = { photoGPS: '대표사진 GPS', device: '기기 현재 위치', manual: '지도에서 지정', estimated: '추정 위치(동·섬 단위)', none: '위치 미확정' };
const isConfirmed = s => s === 'photoGPS' || s === 'device' || s === 'manual';
const STATUS = {
  imported: { label: '이관 자료', cls: 'gray', icon: '⤓' },
  needsInput: { label: '추가 입력 필요', cls: 'orange', icon: '!' },
  complete: { label: '입력 완료', cls: 'green', icon: '✓' },
};
const REGIONS = {
  '전체': [[33.2, 124.9], [38.9, 130.5]],
  '부산울산': [[34.99, 128.86], [35.61, 129.48]],
  '광주전남': [[33.70, 125.80], [35.40, 127.70]],
  '남서울': [[37.41, 126.81], [37.63, 127.09]],
};
/** 지도 필터: 데이터가 있는 본부만 (한전 본부 순서) */
function hqFilters() {
  const have = new Set(state.sites.map(s => s.hq).filter(Boolean));
  return ['전체', ...HQ_LIST.filter(h => have.has(h)), ...[...have].filter(h => !HQ_LIST.includes(h)).sort()];
}
/** 본부 영역: 미리 정한 범위, 없으면 그 본부 구간 위치로 계산 */
function hqBounds(hq) {
  if (REGIONS[hq]) return REGIONS[hq];
  const pts = [];
  for (const s of state.sites) {
    if (s.hq !== hq) continue;
    if (s.location) pts.push([s.location.lat, s.location.lon]);
    if (s.endLocation) pts.push([s.endLocation.lat, s.endLocation.lon]);
  }
  if (!pts.length) return REGIONS['전체'];
  const lat = pts.map(p => p[0]), lon = pts.map(p => p[1]);
  const pad = 0.03;
  return [[Math.min(...lat) - pad, Math.min(...lon) - pad], [Math.max(...lat) + pad, Math.max(...lon) + pad]];
}
const COLORS = { orange: '#f08a00', blue: '#0a84ff', green: '#2e9e4f', purple: '#8e44ad', gray: '#8e8e93', pink: '#ff2d55', red: '#e5383b', teal: '#1aa3b5' };
const PHASE_COLOR = { A: COLORS.red, B: COLORS.green, C: COLORS.blue, N: COLORS.gray };
const TIMELINE_COLORS = [COLORS.orange, COLORS.blue, COLORS.green, COLORS.purple, COLORS.gray, COLORS.pink];
const SD2_COLOR = '#f5c400', SD3_COLOR = '#e5383b';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const pad = n => String(n).padStart(2, '0');
const nowISO = () => new Date().toISOString();
function fmtDay(iso) { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; }
function fmtDayTime(iso) { if (!iso) return ''; const d = new Date(iso); return `${fmtDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtFileStamp(d = new Date()) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
function fmtDG(v) { return v == null || !isFinite(v) ? '–' : Number(v).toFixed(1); }
function meters(d) { return d < 1000 ? `${d.toFixed(0)} m` : `${(d / 1000).toFixed(1)} km`; }
function toLocalInput(iso) { const d = iso ? new Date(iso) : new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fromLocalInput(s) { const d = new Date(s); return isNaN(d) ? nowISO() : d.toISOString(); }
function isToday(iso) { const a = new Date(iso), b = new Date(); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function defaultStage(d) { return isToday(d.date) ? '현장' : '사무실'; }
function sortPhases(a) { return [...a].sort((x, y) => PHASES.indexOf(x) - PHASES.indexOf(y)); }
function dgGrade(v) {
  if (v == null || !isFinite(v)) return null;
  if (v < 20) return { label: '양호', cls: 'green' };
  if (v < 25) return { label: '관찰', cls: 'yellow' };
  return { label: '주의', cls: 'orange' };
}
function haversine(a, b) {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function geoText(p) { return p ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}` : ''; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function tickStep(range, target) {
  if (!(range > 0) || !isFinite(range)) return 1;
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}
function phaseFromFileName(name) {
  const base = name.replace(/\.[^.]+$/, '').toUpperCase();
  const m = /(?:^|[_\-\s.])([ABCN])(?:상)?$/.exec(base);
  return m ? m[1] : null;
}

// 모델 헬퍼
const resultOf = (d, ph) => d.results.find(r => r.phase === ph) || null;
const deltaGOf = (d, ph) => { const r = resultOf(d, ph); return r && r.deltaG != null ? r.deltaG : null; };
function missingItems(d) {
  if (d.imported) return [];
  const m = [];
  if (!d.photos.length) m.push('현장 사진');
  const noDG = d.phases.filter(ph => deltaGOf(d, ph) == null);
  if (noDG.length) m.push('DeltaG ' + noDG.join('·') + '상');
  const noSp = d.phases.filter(ph => !resultOf(d, ph)?.spectrum);
  if (noSp.length) m.push('스펙트럼 ' + noSp.join('·') + '상');
  return m;
}
function statusOf(d) { return d.imported ? 'imported' : (missingItems(d).length ? 'needsInput' : 'complete'); }
function repPhotoOf(d) { return d.photos.find(p => p.id === d.repPhotoId) || d.photos[0] || null; }
function maxDGOf(d) { const v = d.phases.map(ph => deltaGOf(d, ph)).filter(x => x != null); return v.length ? Math.max(...v) : null; }
function specText(s) {
  const parts = [s.kind];
  if (s.cableType) parts.push(s.cableType + (s.size ? ` ${s.size}㎟` : ''));
  if (s.lengthM != null) parts.push(`${Math.round(s.lengthM)} m`);
  if (s.mfg) parts.push(`제조 ${s.mfg}`);
  return parts.join(' · ');
}
function codesText(s) { return [s.fromCode, s.toCode].filter(Boolean).join(' → '); }
function shortLabel(s) { return s.fromName || s.name; }
function refMaxFreq(ref) { return ref.f0 + ref.df * Math.max(ref.points - 1, 0); }
function refSummary(ref) { return `${ref.points}점 · ${(ref.f0 / 1e6).toFixed(2)}–${(refMaxFreq(ref) / 1e6).toFixed(1)} MHz · 간격 ${(ref.df / 1e3).toFixed(1)} kHz`; }

// ===========================================================================
// 상태

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

const state = reactive({
  ready: false, fatal: '', sites: [], diagnoses: [],
  mode: '', modeLabel: '', operator: ls.get('operatorName') || '',
  route: { path: '/map', parts: ['map'], query: {} }, tab: 'map',
  toast: '', busy: '', dialog: null, headerOverride: null, lastLoc: null,
});
let store = null;

const siteMap = computed(() => new Map(state.sites.map(s => [s.id, s])));
const diagMap = computed(() => new Map(state.diagnoses.map(d => [d.id, d])));
const historyMap = computed(() => {
  const m = new Map();
  for (const d of state.diagnoses) { if (!m.has(d.siteId)) m.set(d.siteId, []); m.get(d.siteId).push(d); }
  for (const a of m.values()) a.sort((x, y) => new Date(x.date) - new Date(y.date));
  return m;
});
const pending = computed(() => state.diagnoses.filter(d => statusOf(d) === 'needsInput').sort((a, b) => new Date(b.date) - new Date(a.date)));
const siteById = id => siteMap.value.get(id) || null;
const diagById = id => diagMap.value.get(id) || null;
const historyOf = id => historyMap.value.get(id) || [];
const lastDiagOf = id => { const h = historyOf(id); return h.length ? h[h.length - 1] : null; };
const hasSpectrum = id => historyOf(id).some(d => d.results.some(r => r.spectrum));

function nearby(p, within) {
  const out = [];
  for (const s of state.sites) {
    if (!s.location) continue;
    let d = haversine(s.location, p);
    if (s.endLocation) d = Math.min(d, haversine(s.endLocation, p));
    if (d <= within) out.push({ site: s, distance: d });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
function searchSites(q) {
  const key = q.trim().toUpperCase();
  if (!key) return [];
  return state.sites.filter(s => [s.fromCode, s.toCode, s.name, s.office].some(x => (x || '').toUpperCase().includes(key)));
}

// ===========================================================================
// 알림·대화상자

let toastTimer = null;
function toast(msg) { state.toast = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => { state.toast = ''; }, 2600); }
function dialog(opts) { return new Promise(resolve => { state.dialog = { ...opts, value: '', resolve }; }); }
function alertBox(title, text) { return dialog({ title, text, buttons: [{ label: '확인', value: true, prim: true }] }); }
function confirmBox(text, okLabel = '확인', danger = false) {
  return dialog({ title: text, text: '', buttons: [{ label: '취소', value: false }, { label: okLabel, value: true, danger, prim: !danger }] });
}
async function withBusy(msg, fn) {
  state.busy = msg;
  try { return await fn(); } finally { state.busy = ''; }
}
function reportError(e) { console.error(e); toast(e?.message || String(e)); }

// ===========================================================================
// 라우팅 (#/경로?질의)

const navStack = [];
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/map';
  const [path, qs] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const parts = path.split('/').filter(Boolean);
  return { path, parts: parts.length ? parts : ['map'], query, full: h };
}
const scrollMemo = new Map();
function contentEl() { return document.querySelector('main.content'); }
function syncRoute() {
  const r = parseHash();
  const prev = state.route.full, el = contentEl();
  if (el && prev) scrollMemo.set(prev, el.scrollTop);
  let isBack = false;
  if (navStack.length >= 2 && navStack[navStack.length - 2] === r.full) { navStack.pop(); isBack = true; }
  else if (navStack[navStack.length - 1] !== r.full) navStack.push(r.full);
  state.route = r;
  // 앞으로 이동하면 맨 위, 뒤로 오면 이전 스크롤 위치
  const y = isBack ? (scrollMemo.get(r.full) || 0) : 0;
  nextTick(() => { const c = contentEl(); if (c) c.scrollTop = y; setTimeout(() => { const c2 = contentEl(); if (c2 && isBack) c2.scrollTop = y; }, 120); });
  if (['map', 'sites', 'pending', 'settings'].includes(r.parts[0])) state.tab = r.parts[0];
}
window.addEventListener('hashchange', syncRoute);
function go(path) { location.hash = path; }
function replaceRoute(path) {
  history.replaceState(null, '', '#' + path);
  navStack.pop();
  syncRoute();
}
function back() {
  if (navStack.length > 1) history.back();
  else go('/' + state.tab);
}
function switchTab(t) {
  state.tab = t;
  navStack.length = 0;
  go('/' + t);
}

// ===========================================================================
// 위치·사진

function deviceLocation(timeout = 10000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => { state.lastLoc = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, heading: p.coords.heading }; resolve(state.lastLoc); },
      () => resolve(state.lastLoc), { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name}: 이미지를 열 수 없습니다 (HEIC는 JPEG로 바꿔 올려 주세요).`)); };
    img.src = url;
  });
}
function toJpeg(img, maxSide, quality) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', quality));
}
/** 사진 파일 → 메타데이터(EXIF·GPS) + 저장용 JPEG(긴 변 1600) + 썸네일 */
async function ingestFile(file, source, deviceLoc) {
  const meta = { gpsSource: '없음', originalName: file.name };
  try {
    const ex = window.exifr ? await window.exifr.parse(file, { tiff: true, exif: true, gps: true }) : null;
    if (ex) {
      if (ex.Make) meta.make = String(ex.Make).trim();
      if (ex.Model) meta.model = String(ex.Model).trim();
      const dt = ex.DateTimeOriginal || ex.CreateDate;
      if (dt instanceof Date && !isNaN(dt)) meta.takenAt = dt.toISOString();
      if (isFinite(ex.latitude) && isFinite(ex.longitude)) {
        meta.location = { lat: ex.latitude, lon: ex.longitude };
        meta.gpsSource = '사진 EXIF';
        if (isFinite(ex.GPSAltitude)) meta.altitude = ex.GPSAltitude;
        if (isFinite(ex.GPSHPositioningError)) meta.hAccuracy = ex.GPSHPositioningError;
        if (isFinite(ex.GPSImgDirection)) meta.heading = ex.GPSImgDirection;
      }
    }
  } catch { /* EXIF 없음 */ }
  if (source === '카메라') {
    if (!meta.takenAt) meta.takenAt = nowISO();
    if (!meta.location && deviceLoc) {
      meta.location = { lat: deviceLoc.lat, lon: deviceLoc.lon };
      if (deviceLoc.acc != null) meta.hAccuracy = deviceLoc.acc;
      if (deviceLoc.alt != null) meta.altitude = deviceLoc.alt;
      meta.gpsSource = '촬영 시 기기 위치';
    }
  }
  const img = await loadImage(file);
  meta.width = img.naturalWidth; meta.height = img.naturalHeight;
  const full = await toJpeg(img, 1600, 0.85);
  const thumb = await toJpeg(img, 360, 0.75);
  return { id: uuid(), meta, full, thumb, preview: URL.createObjectURL(thumb), source };
}
function metaRows(meta, p) {
  const rows = [['촬영 일시', meta.takenAt ? fmtDayTime(meta.takenAt) : '정보 없음']];
  if (meta.location) {
    rows.push(['위치', geoText(meta.location)], ['위치 출처', meta.gpsSource]);
    if (meta.hAccuracy != null) rows.push(['수평 오차', `±${Math.round(meta.hAccuracy)} m`]);
    if (meta.altitude != null) rows.push(['고도', `${Number(meta.altitude).toFixed(1)} m`]);
    if (meta.heading != null) rows.push(['촬영 방향', `${Math.round(meta.heading)}°`]);
  } else rows.push(['위치', 'GPS 없음']);
  const dev = [meta.make, meta.model].filter(Boolean).join(' ');
  if (dev) rows.push(['기기', dev]);
  if (meta.width && meta.height) rows.push(['해상도', `${meta.width} × ${meta.height}`]);
  if (p) {
    rows.push(['가져온 방식', p.source], ['등록', `${p.stage} · ${fmtDayTime(p.addedAt)}`]);
    if (meta.originalName) rows.push(['원본 파일', meta.originalName]);
  }
  return rows;
}

// ===========================================================================
// 데이터 변경 (화면 → 저장소)

const A = {
  async addSite(s) { state.sites.push(s); await store.saveSite(s); },
  async updateSite(id, fn) { const s = siteById(id); if (!s) return; fn(s); await store.saveSite(s); },
  async addDiagnosis(d) { d.createdAt = d.createdAt || nowISO(); d.updatedAt = nowISO(); state.diagnoses.push(d); await store.saveDiagnosis(d); },
  async updateDiagnosis(id, fn) {
    const d = diagById(id); if (!d) return;
    fn(d); d.updatedAt = nowISO();
    try { await store.saveDiagnosis(d); } catch (e) { reportError(e); }
  },
  async deleteDiagnosis(id) {
    const d = diagById(id); if (!d) return;
    const files = [];
    d.photos.forEach(p => files.push(p.fileName, p.thumb));
    d.results.forEach(r => { r.signatures.forEach(p => files.push(p.fileName, p.thumb)); if (r.spectrum) files.push(r.spectrum.fileName, ...(r.spectrum.raw || [])); });
    await store.deleteDiagnosis(id);
    state.diagnoses.splice(state.diagnoses.indexOf(d), 1);
    store.removeFiles(files).catch(() => {});
  },
  async storeImage(img, tag, stage) {
    const id = uuid();
    const fileName = `photos/${id}.jpg`, thumb = `photos/${id}_t.jpg`;
    await store.putFile(fileName, img.full, 'image/jpeg');
    await store.putFile(thumb, img.thumb, 'image/jpeg');
    return { id, fileName, thumb, tag, meta: img.meta, addedAt: nowISO(), stage, source: img.source };
  },
  async addPhotos(imgs, diagId, tag, stage) {
    const items = [];
    for (let i = 0; i < imgs.length; i++) {
      state.busy = `사진 저장 중 (${i + 1}/${imgs.length})`;
      items.push(await A.storeImage(imgs[i], tag, stage));
    }
    state.busy = '';
    await A.updateDiagnosis(diagId, d => { d.photos.push(...items); if (!d.repPhotoId && items[0]) d.repPhotoId = items[0].id; });
  },
  async addSignatures(imgs, diagId, phase, stage) {
    const items = [];
    for (let i = 0; i < imgs.length; i++) {
      state.busy = `사진 저장 중 (${i + 1}/${imgs.length})`;
      items.push(await A.storeImage(imgs[i], '장비 화면', stage));
    }
    state.busy = '';
    await A.updateDiagnosis(diagId, d => {
      let r = resultOf(d, phase);
      if (!r) { r = { phase, deltaG: null, signatures: [] }; d.results.push(r); }
      r.signatures.push(...items); r.updatedAt = nowISO(); r.stage = stage;
    });
  },
  async removePhoto(photoId, diagId) {
    const d = diagById(diagId); if (!d) return;
    let p = d.photos.find(x => x.id === photoId);
    d.results.forEach(r => { const q = r.signatures.find(x => x.id === photoId); if (q) p = q; });
    await A.updateDiagnosis(diagId, dd => {
      dd.photos = dd.photos.filter(x => x.id !== photoId);
      dd.results.forEach(r => { r.signatures = r.signatures.filter(x => x.id !== photoId); });
      if (dd.repPhotoId === photoId) dd.repPhotoId = dd.photos[0]?.id || null;
    });
    if (p) store.removeFiles([p.fileName, p.thumb]).catch(() => {});
  },
  async confirmSiteLocation(siteId, photo) {
    if (!photo?.meta?.location) return;
    await A.setConfirmedLocation(siteId, photo.meta.location, 'photoGPS');
  },
  /** 위치 미확정 구간을 사진·기기 위치로 확정. 추정 위치와 10 km 넘게 다르면 먼저 묻는다. */
  async setConfirmedLocation(siteId, point, source) {
    const s = siteById(siteId);
    if (!s || isConfirmed(s.locSource) || !point) return;
    if (s.location) {
      const km = haversine(s.location, point) / 1000;
      if (km > 10 && !(await confirmBox(`사진 위치가 이 구간의 추정 위치와 ${km.toFixed(0)} km 떨어져 있습니다. 구간 위치를 이 위치로 바꿀까요?`, '바꾸기'))) return;
    }
    await A.updateSite(siteId, x => { x.location = { lat: point.lat, lon: point.lon }; x.locSource = source; });
  },
  _setSpectrum(d, phase, ref, stage) {
    if (!d.phases.includes(phase)) d.phases = sortPhases([...d.phases, phase]);
    let r = resultOf(d, phase), old = null;
    if (!r) { r = { phase, deltaG: null, signatures: [] }; d.results.push(r); }
    old = r.spectrum || null;
    r.spectrum = ref; r.updatedAt = nowISO(); r.stage = stage;
    return old;
  },
  /** 스펙트럼 텍스트 저장. originalName이 없으면 클립보드 붙여넣기로 기록 */
  async attachSpectrumText(text, originalName, diagId, phase, stage, parsed) {
    const data = parsed || Sig.parseSpectrum(text);
    const pasted = !originalName;
    const name = pasted ? '클립보드 붙여넣기' : originalName;
    const id = uuid(), path = `spectra/${id}.txt`;
    await store.putFile(path, new Blob([text], { type: 'text/plain' }), 'text/plain');
    specCache.set(path, Promise.resolve(markRaw(data)));
    const ref = { fileName: path, originalName: name, label: data.label, points: data.count, f0: data.f0, df: data.df, addedAt: nowISO(), stage, source: pasted ? 'paste' : 'txt' };
    let old = null;
    await A.updateDiagnosis(diagId, d => { old = A._setSpectrum(d, phase, ref, stage); });
    if (old) store.removeFiles([old.fileName, ...(old.raw || [])]).catch(() => {});
    return `${phase}상 ← ${pasted ? '클립보드' + (data.label ? ' (' + data.label + ')' : '') : name}`;
  },
  /** LIRA 측정 파일 묶음(.lira 필수, .anl·.out·.sdt 선택) */
  async attachLiraGroup(g, diagId, stage, fallbackPhase) {
    const f = g.files;
    const lira = Lira.parseLiraBinary(await f.lira.arrayBuffer());
    const anl = f.anl ? Lira.readAnl(await f.anl.text()) : null;
    const out = f.out ? Lira.readOut(await f.out.text()) : null;
    const sdt = f.sdt ? Lira.readSdt(await f.sdt.text()) : null;
    let phase = anl?.phase || lira.phaseName || phaseFromFileName(g.key) || fallbackPhase;
    if (!phase) phase = await askPhase(g.key);
    if (!phase) throw new Error('상을 정하지 않아 건너뜀');
    const sp = Lira.spectrumFromLira(lira, anl);
    const text = Lira.spectrumToText(sp);
    const ln = Lira.liraNormalization(sdt, anl);
    const id = uuid(), path = `spectra/${id}.txt`;
    state.busy = `${phase}상 파일 저장 중`;
    await store.putFile(path, new Blob([text], { type: 'text/plain' }), 'text/plain');
    const raw = [], rawNames = [];
    for (const [ext, file] of Object.entries(f)) {
      const p = `raw/${id}/file.${ext}`;
      await store.putFile(p, file, 'application/octet-stream');
      raw.push(p); rawNames.push(file.name);
    }
    state.busy = '';
    specCache.set(path, Promise.resolve(markRaw(sp)));
    const ref = {
      fileName: path, originalName: g.key + '.lira', label: sp.label, points: sp.count, f0: sp.f0, df: sp.df,
      addedAt: nowISO(), stage, source: 'lira', raw, rawNames,
      lira: {
        cable: anl?.cable || '', length: anl?.length ?? out?.length ?? null,
        bandPct: anl?.bandPct ?? null, maxFreqMHz: anl?.maxFreqMHz ?? null,
        bandHz: anl?.bandPct && anl?.maxFreqMHz ? anl.maxFreqMHz * 1e6 * anl.bandPct / 100 : null,
        vr: anl?.vr ?? out?.vr ?? null, residZL_uH: anl?.residZL_uH ?? null,
        norm: ln, deltaG: out?.deltaG ?? null, termination: out?.termination || '',
      },
    };
    let old = null, dgSet = false;
    const d0 = diagById(diagId);
    await A.updateDiagnosis(diagId, d => {
      old = A._setSpectrum(d, phase, ref, stage);
      const r = resultOf(d, phase);
      if (out?.deltaG != null && r.deltaG == null) { r.deltaG = out.deltaG; dgSet = true; }
      if (d.maxFreqMHz == null && anl?.maxFreqMHz) d.maxFreqMHz = Math.round(anl.maxFreqMHz * 1000) / 1000;
    });
    const site = d0 && siteById(d0.siteId);
    if (site && site.lengthM == null && ref.lira.length) await A.updateSite(site.id, s => { s.lengthM = ref.lira.length; });
    if (old) store.removeFiles([old.fileName, ...(old.raw || [])]).catch(() => {});
    const notes = [];
    if (dgSet) notes.push(`DeltaG ${fmtDG(out.deltaG)} 자동 입력`);
    if (!anl) notes.push('⚠ .anl 없음: 직렬 인덕턴스 보정 안 됨');
    if (!sdt) notes.push('.sdt 없음: 0 dB 기준선은 앱 추정');
    return `${phase}상 ← ${g.key}` + (notes.length ? ` (${notes.join(', ')})` : '');
  },
  async removeSpectrum(diagId, phase) {
    const d = diagById(diagId); const r = d && resultOf(d, phase); const sp = r?.spectrum;
    if (!sp) return;
    await A.updateDiagnosis(diagId, dd => { resultOf(dd, phase).spectrum = null; });
    store.removeFiles([sp.fileName, ...(sp.raw || [])]).catch(() => {});
    specCache.delete(sp.fileName);
  },
};

function askPhase(name) {
  return dialog({
    title: '상을 선택하세요', text: `${name}\n측정 설명이나 파일 이름에서 상(A·B·C·N)을 찾지 못했습니다.`,
    buttons: [...PHASES.map(p => ({ label: p + '상', value: p, prim: true })), { label: '건너뛰기', value: null }],
  });
}

// 스펙트럼 캐시 (경로 → 파싱 결과)
const specCache = new Map();
function loadSpectrum(path) {
  if (!specCache.has(path)) {
    specCache.set(path, store.getText(path).then(t => markRaw(Sig.parseSpectrum(t))).catch(e => { specCache.delete(path); throw e; }));
  }
  return specCache.get(path);
}

// 내보내기
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function exportJSON() {
  const snap = { version: 1, exportedAt: nowISO(), sites: state.sites, diagnoses: state.diagnoses };
  download(`LIRA_진단이력_${fmtFileStamp()}.json`, new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' }));
}
function exportCSV() {
  const lines = ['본부,구간,지중/해저,시점전산화번호,종점전산화번호,진단일,상,DeltaG,스펙트럼,상태,출처'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const d of [...state.diagnoses].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    const s = siteById(d.siteId); if (!s) continue;
    for (const ph of d.phases) {
      const r = resultOf(d, ph);
      lines.push([s.hq, s.name, s.kind, s.fromCode, s.toCode, fmtDay(d.date), ph,
        r?.deltaG != null ? Number(r.deltaG).toFixed(2) : '', r?.spectrum ? 'Y' : 'N', STATUS[statusOf(d)].label, d.source].map(q).join(','));
    }
  }
  download(`LIRA_DeltaG_${fmtFileStamp()}.csv`, new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
}

// 다른 사용자의 변경 반영
function applyRemote(table, p) {
  const arr = table === 'sites' ? state.sites : state.diagnoses;
  if (p.eventType === 'DELETE') {
    const id = p.old?.id; const i = arr.findIndex(x => x.id === id);
    if (i >= 0) arr.splice(i, 1);
    return;
  }
  const data = p.new?.data; if (!data) return;
  const i = arr.findIndex(x => x.id === data.id);
  if (i < 0) arr.push(data);
  else if ((arr[i].updatedAt || '') < (data.updatedAt || '~')) arr.splice(i, 1, data);
}
let lastReload = 0;
async function reloadAll(force = false) {
  if (!store || (!force && Date.now() - lastReload < 30000)) return;
  lastReload = Date.now();
  try {
    const data = await store.loadAll();
    state.sites = data.sites; state.diagnoses = data.diagnoses;
  } catch (e) { reportError(e); }
}

// ===========================================================================
// 공통 컴포넌트

const PImg = {
  props: { path: String, alt: { type: String, default: '' } },
  data: () => ({ url: '' }),
  watch: { path: { immediate: true, handler(p) { this.url = ''; if (p) store.getURL(p).then(u => { if (this.path === p) this.url = u; }); } } },
  template: `<img v-if="url" :src="url" :alt="alt" loading="lazy"><div v-else class="pimg-ph"></div>`,
};

const StatusBadge = {
  props: ['status'],
  computed: { s() { return STATUS[this.status]; } },
  template: `<span class="chip" :class="s.cls">{{ s.icon }} {{ s.label }}</span>`,
};

const DgValue = {
  props: ['value'],
  computed: { g() { return dgGrade(this.value); }, txt() { return fmtDG(this.value); } },
  template: `<span class="mono bold">{{ txt }}</span> <span v-if="g" class="chip" :class="g.cls">{{ g.label }}</span>`,
};

const LocLabel = {
  props: ['source'],
  computed: { ok() { return isConfirmed(this.source); }, label() { return LOC_LABEL[this.source] || '위치 미확정'; } },
  template: `<span class="small" :style="{color: ok ? 'var(--accent)' : 'var(--sub)'}">{{ ok ? '📍' : '⌀' }} {{ label }}</span>`,
};

const PhaseToggles = {
  props: { modelValue: Array },
  emits: ['update:modelValue'],
  data: () => ({ phases: PHASES }),
  methods: {
    toggle(ph) {
      const on = this.modelValue.includes(ph);
      this.$emit('update:modelValue', on ? this.modelValue.filter(x => x !== ph) : sortPhases([...this.modelValue, ph]));
    },
  },
  template: `<div class="phase-tg"><button v-for="ph in phases" :key="ph" type="button" :class="{on: modelValue.includes(ph)}" @click="toggle(ph)">{{ ph }}상</button></div>`,
};

const PhotoAdd = {
  props: { libraryTitle: { default: '보관함' }, cameraTitle: { default: '촬영' }, max: { default: 20 } },
  emits: ['add'],
  data: () => ({ busy: false }),
  methods: {
    pickLib() { this.$refs.lib.click(); },
    async pickCam() { deviceLocation(8000); this.$refs.cam.click(); },
    async onFiles(ev, source) {
      const files = [...ev.target.files].slice(0, this.max);
      ev.target.value = '';
      if (!files.length) return;
      this.busy = true;
      const out = [];
      const loc = source === '카메라' ? (state.lastLoc || await deviceLocation(6000)) : null;
      for (const f of files) {
        try { out.push(await ingestFile(f, source, loc)); } catch (e) { reportError(e); }
      }
      this.busy = false;
      if (out.length) this.$emit('add', out);
    },
  },
  template: `<div class="btnrow">
    <button type="button" class="btn" @click="pickLib">🖼 {{ libraryTitle }}</button>
    <button type="button" class="btn" @click="pickCam">📷 {{ cameraTitle }}</button>
    <span v-if="busy" class="sub small">사진 읽는 중…</span>
    <input ref="lib" type="file" accept="image/*" multiple class="hidden" @change="onFiles($event, '보관함')">
    <input ref="cam" type="file" accept="image/*" capture="environment" class="hidden" @change="onFiles($event, '카메라')">
  </div>`,
};

const PhotoGrid = {
  components: { PImg },
  props: { photos: Array, repId: String, big: Boolean },
  emits: ['open'],
  template: `<div class="pgrid" :class="{big}">
    <button v-for="p in photos" :key="p.id" type="button" class="pthumb" @click="$emit('open', p)">
      <p-img :path="p.thumb || p.fileName"></p-img>
      <span class="tl" v-if="p.id === repId || p.meta.location"><span v-if="p.id === repId" style="color:#ffd60a">★</span><span v-if="p.meta.location">📍</span></span>
      <span class="bl">{{ p.tag }}</span>
    </button>
  </div>`,
};

// 작은 지도 (조작 불가)
const MiniMap = {
  props: { center: Object, zoom: { default: 16 }, markers: { type: Array, default: () => [] }, line: Array, height: { default: 160 } },
  mounted() { this.build(); },
  beforeUnmount() { if (this.map) { this.map.remove(); this.map = null; } },
  watch: { center() { this.build(); }, markers() { this.build(); } },
  methods: {
    build() {
      if (!this.center || !window.L) return;
      if (!this.map) {
        this.map = L.map(this.$refs.el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, attributionControl: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this.map);
        this.layer = L.layerGroup().addTo(this.map);
      }
      this.map.setView([this.center.lat, this.center.lon], this.zoom, { animate: false });
      this.layer.clearLayers();
      if (this.line) L.polyline(this.line, { color: COLORS.teal, weight: 3 }).addTo(this.layer);
      for (const m of this.markers) {
        L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', html: `<div class="${m.cls}" title="${m.title || ''}">${m.html || ''}</div>`, iconSize: m.size || [30, 30], iconAnchor: (m.size || [30, 30]).map(v => v / 2) }) }).addTo(this.layer);
      }
      setTimeout(() => this.map && this.map.invalidateSize(), 50);
    },
  },
  template: `<div class="minimap" :style="{height: height + 'px'}" ref="el"></div>`,
};

// 지도에서 위치 지정
const LocationPicker = {
  props: { initial: Object },
  emits: ['pick', 'close'],
  data: () => ({ center: null }),
  mounted() {
    const c = this.initial || state.lastLoc;
    this.map = L.map(this.$refs.el, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(this.map);
    if (c) this.map.setView([c.lat, c.lon], 17); else this.map.fitBounds(REGIONS['전체']);
    const upd = () => { const p = this.map.getCenter(); this.center = { lat: p.lat, lon: p.lng }; };
    this.map.on('move', upd); upd();
    setTimeout(() => this.map && this.map.invalidateSize(), 60);
  },
  beforeUnmount() { if (this.map) { this.map.remove(); this.map = null; } },
  methods: {
    async here() { const l = await deviceLocation(); if (!this.map) return; if (l) this.map.setView([l.lat, l.lon], 18); else toast('기기 위치를 얻지 못했습니다.'); },
    done() { if (this.center) this.$emit('pick', { ...this.center }); this.$emit('close'); },
  },
  template: `<div class="overlay" @click.self="$emit('close')">
    <div class="sheet tall">
      <div class="sheet-h"><button class="tbtn" @click="$emit('close')">취소</button><div class="title">위치 지정</div><button class="tbtn strong" :disabled="!center" @click="done">이 위치로</button></div>
      <div class="sheet-b nopad">
        <div ref="el" style="position:absolute;inset:0"></div>
        <div class="crosshair"></div>
        <button class="map-fab" style="top:12px" @click="here" title="현재 위치">◎</button>
        <div class="coordpill code">{{ center ? center.lat.toFixed(6) + ', ' + center.lon.toFixed(6) : '지도를 움직여 위치를 맞추세요' }}</div>
      </div>
    </div>
  </div>`,
};

// 사진 상세 (메타데이터·분류·대표 지정·삭제)
const PhotoDetail = {
  components: { PImg },
  props: { diagId: String, photoId: String, isSignature: Boolean },
  emits: ['close'],
  data: () => ({ tags: PHOTO_TAGS, full: '' }),
  computed: {
    d() { return diagById(this.diagId); },
    p() {
      const d = this.d; if (!d) return null;
      return d.photos.find(x => x.id === this.photoId) || d.results.flatMap(r => r.signatures).find(x => x.id === this.photoId) || null;
    },
    isRep() { return this.d && repPhotoOf(this.d)?.id === this.photoId; },
    rows() { return this.p ? metaRows(this.p.meta, this.p) : []; },
  },
  methods: {
    setTag(v) { A.updateDiagnosis(this.diagId, d => { const p = d.photos.find(x => x.id === this.photoId); if (p) p.tag = v; }); },
    async makeRep() {
      await A.updateDiagnosis(this.diagId, d => { d.repPhotoId = this.photoId; });
      await A.confirmSiteLocation(this.d.siteId, this.p);
    },
    async openFull() { this.full = await store.getURL(this.p.fileName); },
    async remove() {
      if (!(await confirmBox('이 사진을 삭제할까요?', '삭제', true))) return;
      await A.removePhoto(this.photoId, this.diagId); this.$emit('close');
    },
  },
  template: `<div class="overlay" @click.self="$emit('close')">
    <div class="sheet tall" v-if="p">
      <div class="sheet-h"><span style="width:56px"></span><div class="title">{{ isSignature ? '측정 화면' : p.tag }}</div><button class="tbtn strong" @click="$emit('close')">닫기</button></div>
      <div class="sheet-b">
        <div style="margin-top:12px;text-align:center;cursor:zoom-in" @click="openFull">
          <p-img :path="p.fileName" style="max-width:100%;max-height:44vh;border-radius:10px"></p-img>
        </div>
        <div class="sec" v-if="!isSignature"><div class="card">
          <div class="field"><label>분류</label><select class="input" :value="p.tag" @change="setTag($event.target.value)"><option v-for="t in tags" :key="t">{{ t }}</option></select></div>
          <div class="row" v-if="isRep"><span class="star">★ 대표사진</span></div>
          <div class="row" v-else><button class="linkbtn" @click="makeRep">☆ 대표사진으로 지정</button></div>
        </div></div>
        <div class="sec"><div class="sec-h">메타데이터</div><div class="card">
          <div class="kv" v-for="r in rows" :key="r[0]"><span class="k">{{ r[0] }}</span><span class="v">{{ r[1] }}</span></div>
        </div></div>
        <div class="sec"><div class="card"><div class="row"><button class="linkbtn danger" @click="remove">사진 삭제</button></div></div></div>
      </div>
    </div>
    <div class="fullimg" v-if="full" @click="full = ''"><button class="btn small" @click.stop="full = ''">닫기</button><img :src="full"></div>
  </div>`,
};

// ===========================================================================
// Signature 그래프 (canvas)

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }

const SignatureChart = {
  props: {
    curves: Array, hidden: { type: Array, default: () => [] }, xMax: Number, lengthMarker: Number,
    cursor: Number, height: { default: 280 }, interactive: { default: true }, normalized: Boolean, showSD: Boolean,
  },
  emits: ['update:cursor'],
  mounted() {
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.$refs.cv);
    this.draw();
  },
  beforeUnmount() { this.ro && this.ro.disconnect(); },
  watch: {
    curves() { this.draw(); }, hidden() { this.draw(); }, xMax() { this.draw(); }, cursor() { this.draw(); },
    normalized() { this.draw(); }, showSD() { this.draw(); }, lengthMarker() { this.draw(); },
  },
  computed: { visible() { return (this.curves || []).filter(c => !this.hidden.includes(c.id)); } },
  methods: {
    yRange() {
      let lo = Infinity, hi = -Infinity;
      for (const c of this.visible) {
        const n = Math.min(c.trace.values.length, Math.floor(this.xMax / Math.max(c.trace.step, 1e-9)) + 2);
        for (let i = 0; i < n; i++) { const v = c.trace.values[i]; if (!isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      if (!isFinite(lo) || !isFinite(hi)) return this.normalized ? [0, 20] : [-60, 0];
      if (this.normalized) {
        const sdTop = this.showSD ? Math.max(0, ...this.visible.map(c => c.trace.sd3 || 0)) : 0;
        const top = Math.max(hi, sdTop + 3, 5);
        const st = tickStep(top, 6);
        return [0, Math.ceil((top + 1) / st) * st];
      }
      lo = Math.max(lo, hi - 90);
      const st = tickStep(hi - lo, 6);
      return [Math.floor((lo - 2) / st) * st, Math.ceil((hi + 2) / st) * st];
    },
    plotRect() {
      const W = this.$refs.cv.clientWidth, H = this.height;
      return { x: 40, y: 10, w: Math.max(W - 50, 10), h: Math.max(H - 36, 10), W, H };
    },
    draw() {
      const cv = this.$refs.cv; if (!cv) return;
      const pr = this.plotRect(); const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(pr.W * dpr); cv.height = Math.round(pr.H * dpr); cv.style.height = pr.H + 'px';
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, pr.W, pr.H);
      const [y0, y1] = this.yRange(); const xMax = this.xMax || 1;
      const px = d => pr.x + d / xMax * pr.w;
      const py = v => pr.y + pr.h - (v - y0) / (y1 - y0) * pr.h;
      const sub = cssVar('--sub'), text = cssVar('--text');
      ctx.font = '9px -apple-system, sans-serif';
      ctx.lineWidth = 0.5; ctx.strokeStyle = sub; ctx.globalAlpha = 0.25;
      const xs = tickStep(xMax, 6);
      for (let d = 0; d <= xMax + 1e-9; d += xs) { ctx.beginPath(); ctx.moveTo(px(d), pr.y); ctx.lineTo(px(d), pr.y + pr.h); ctx.stroke(); }
      const ys = tickStep(y1 - y0, 6);
      for (let v = y0; v <= y1 + 1e-9; v += ys) { ctx.beginPath(); ctx.moveTo(pr.x, py(v)); ctx.lineTo(pr.x + pr.w, py(v)); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = sub;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let d = 0; d <= xMax + 1e-9; d += xs) ctx.fillText(xMax >= 5000 ? (d / 1000).toFixed(1) + 'k' : d.toFixed(0), px(d), pr.y + pr.h + 4);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let v = y0; v <= y1 + 1e-9; v += ys) ctx.fillText(v.toFixed(0), pr.x - 4, py(v));
      ctx.strokeStyle = sub; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.8; ctx.strokeRect(pr.x, pr.y, pr.w, pr.h); ctx.globalAlpha = 1;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '600 9px -apple-system, sans-serif';
      ctx.fillText(this.normalized ? 'dB (Normalized)' : 'dB', pr.x + 4, pr.y + 2);
      if (this.lengthMarker && this.lengthMarker <= xMax) {
        ctx.save(); ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px(this.lengthMarker), pr.y); ctx.lineTo(px(this.lengthMarker), pr.y + pr.h); ctx.stroke(); ctx.restore();
        ctx.textAlign = 'right'; ctx.fillText(`종단 ${Math.round(this.lengthMarker)} m`, px(this.lengthMarker) - 3, pr.y + 2);
      }
      // 곡선
      ctx.save(); ctx.beginPath(); ctx.rect(pr.x, pr.y, pr.w, pr.h); ctx.clip();
      for (const c of this.visible) {
        ctx.strokeStyle = c.color; ctx.lineWidth = 1.4; ctx.beginPath();
        let started = false; const vals = c.trace.values, st = c.trace.step;
        for (let i = 0; i < vals.length; i++) {
          const dist = i * st; if (dist > xMax + st) break;
          const v = vals[i];
          if (!isFinite(v)) { started = false; continue; }
          if (started) ctx.lineTo(px(dist), py(v)); else { ctx.moveTo(px(dist), py(v)); started = true; }
        }
        ctx.stroke();
      }
      ctx.restore();
      // 2SD·3SD 선 (곡선마다 자기 SD)
      if (this.normalized && this.showSD) {
        const sdc = this.visible.filter(c => c.trace.sd2 != null);
        sdc.forEach((c, k) => {
          for (const [lv, col, name] of [[c.trace.sd2, SD2_COLOR, '2SD'], [c.trace.sd3, SD3_COLOR, '3SD']]) {
            if (lv == null || lv < y0 || lv > y1) continue;
            const y = py(lv);
            ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(pr.x, y); ctx.lineTo(pr.x + pr.w, y); ctx.stroke(); ctx.restore();
            if (sdc.length > 1) { ctx.strokeStyle = c.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(pr.x, y); ctx.lineTo(pr.x + 14, y); ctx.stroke(); }
            if (k === 0) { ctx.fillStyle = col; ctx.font = '700 9px -apple-system, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(name, pr.x + pr.w - 3, y - 1); }
          }
        });
      }
      // 커서
      if (this.cursor != null) {
        ctx.strokeStyle = text; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px(this.cursor), pr.y); ctx.lineTo(px(this.cursor), pr.y + pr.h); ctx.stroke(); ctx.globalAlpha = 1;
        for (const c of this.visible) {
          const v = Sig.traceValueAt(c.trace, this.cursor);
          if (v != null && v >= y0 && v <= y1) { ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(px(this.cursor), py(v), 3, 0, 2 * Math.PI); ctx.fill(); }
        }
      }
    },
    onPointer(e) {
      if (!this.interactive) return;
      if (e.type === 'pointermove' && !(e.buttons & 1) && e.pointerType === 'mouse') return;
      const r = this.$refs.cv.getBoundingClientRect(); const pr = this.plotRect();
      const t = (e.clientX - r.left - pr.x) / pr.w;
      this.$emit('update:cursor', clamp(t, 0, 1) * this.xMax);
    },
  },
  template: `<canvas ref="cv" @pointerdown="onPointer" @pointermove="onPointer"></canvas>`,
};

// 분석 대역폭 (슬라이더 + 직접 입력)
const BandwidthControl = {
  props: { modelValue: Number, lo: Number, hi: Number, maxFreqMHz: Number, guideline: Number },
  emits: ['update:modelValue'],
  data() { return { text: this.fmt(this.modelValue), focus: false }; },
  watch: { modelValue(v) { if (!this.focus) this.text = this.fmt(v); } },
  computed: { pct() { return (this.modelValue / Math.max(this.maxFreqMHz, 1e-9) * 100).toFixed(0); }, step() { return (this.hi - this.lo) / 1000; } },
  methods: {
    fmt(v) { return v >= 10 ? Number(v).toFixed(1) : Number(v).toFixed(2); },
    onSlide(e) { this.$emit('update:modelValue', Number(e.target.value)); },
    onType() { const v = parseFloat(String(this.text).replace(',', '.')); if (isFinite(v) && v >= this.lo && v <= this.hi) this.$emit('update:modelValue', v); },
    commit() { this.focus = false; const v = parseFloat(String(this.text).replace(',', '.')); if (isFinite(v)) this.$emit('update:modelValue', clamp(v, this.lo, this.hi)); this.text = this.fmt(clamp(isFinite(v) ? v : this.modelValue, this.lo, this.hi)); },
    useGuide() { this.$emit('update:modelValue', clamp(this.guideline, this.lo, this.hi)); },
  },
  template: `<div>
    <div class="optrow">
      <div class="grow bold">분석 대역폭</div>
      <input class="boxinput mono" style="width:86px;text-align:right" inputmode="decimal" v-model="text" @focus="focus = true" @input="onType" @blur="commit" @keyup.enter="$event.target.blur()">
      <span class="sub">MHz</span><span class="sub small mono" style="min-width:42px;text-align:right">({{ pct }}%)</span>
    </div>
    <input type="range" class="range" :min="lo" :max="hi" :step="step" :value="modelValue" @input="onSlide">
    <div class="btnrow xs sub" style="justify-content:space-between">
      <span>{{ fmt(lo) }} MHz</span>
      <button v-if="guideline" class="btn small" @click="useGuide">가이드라인 {{ fmt(guideline) }} MHz</button>
      <span>{{ fmt(hi) }} MHz (100%)</span>
    </div>
  </div>`,
};

// ===========================================================================
// Signature 뷰어 (전후 비교 · 상간 비교)

const SignatureCompare = {
  components: { SignatureChart, BandwidthControl },
  props: { siteId: String, focusDiagId: String },
  data: () => ({
    mode: 'timeline', phase: 'A', diagId: null, bandwidthMHz: 20, windowName: '4 Term B-H', vrMode: 'length', manualVR: 0.55,
    normalize: false, showSD: false, curves: [], hidden: [], reversed: [], cursor: null, savedNotice: false,
    windows: Sig.WINDOWS, loading: false, err: '',
  }),
  computed: {
    site() { return siteById(this.siteId); },
    length() { return this.site?.lengthM || null; },
    allSources() {
      return historyOf(this.siteId).flatMap(d => d.phases.map(ph => {
        const ref = resultOf(d, ph)?.spectrum; return ref ? { diag: d, phase: ph, ref, id: d.id + '-' + ph } : null;
      }).filter(Boolean));
    },
    phasesWithData() { return PHASES.filter(ph => this.allSources.some(s => s.phase === ph)); },
    diagsWithData() { const seen = new Set(); return this.allSources.filter(s => !seen.has(s.diag.id) && seen.add(s.diag.id)).map(s => s.diag); },
    sources() { return this.mode === 'timeline' ? this.allSources.filter(s => s.phase === this.phase) : this.allSources.filter(s => s.diag.id === this.diagId); },
    maxFreqMHz() { const m = Math.min(...this.sources.map(s => refMaxFreq(s.ref) / 1e6)); return isFinite(m) ? Math.max(m, 0.1) : 100; },
    bwLo() { return Math.max(this.maxFreqMHz * 0.02, 0.05); },
    bwHi() { return Math.max(this.maxFreqMHz, this.bwLo + 0.01); },
    xMax() {
      if (this.length > 0) return this.length * 1.05;
      const vr = this.vrMode === 'manual' ? this.manualVR : 0.55;
      const df = Math.max(...this.sources.map(s => s.ref.df), 10000);
      return vr * Sig.C / (2 * df) / 4;
    },
    guideline() { return this.length ? Sig.guidelineBandwidthMHz(this.length) : null; },
    key() {
      return JSON.stringify([this.bandwidthMHz, this.windowName, this.vrMode, this.manualVR, this.mode, this.phase, this.diagId,
        this.sources.map(s => s.ref.fileName), this.reversed, this.normalize, this.length]);
    },
    resText() { const c = this.curves[0]; return c ? `분해능 ${c.resolutionM.toFixed(1)} m · Shadow ${(c.resolutionM * 5 / 3).toFixed(1)} m` : ''; },
    visibleCurves() { return this.curves.filter(c => !this.hidden.includes(c.id)); },
    tdr() { return Sig.tdrVelocity(this.manualVR).toFixed(1); },
  },
  watch: { key() { this.schedule(); } },
  mounted() { this.setup(); },
  methods: {
    setup() {
      const f = this.focusDiagId;
      if (f && this.diagsWithData.some(d => d.id === f)) { this.mode = 'phases'; this.diagId = f; }
      else this.diagId = this.diagsWithData[this.diagsWithData.length - 1]?.id || null;
      if (!this.phasesWithData.includes(this.phase)) this.phase = this.phasesWithData[0] || 'A';
      const s = this.site;
      if (s?.sigWindow && Sig.WINDOWS.includes(s.sigWindow)) this.windowName = s.sigWindow;
      const liraSrc = this.allSources.find(x => x.ref.lira?.bandHz);
      const initial = s?.sigBandwidthMHz ?? (liraSrc ? liraSrc.ref.lira.bandHz / 1e6 : null) ?? this.guideline ?? this.maxFreqMHz * 0.4;
      this.bandwidthMHz = clamp(initial, this.bwLo, this.bwHi);
      if (!this.length) this.vrMode = 'manual';
      this.schedule();
    },
    schedule() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = null; this.recompute(); });
    },
    async recompute() {
      const token = (this.token = (this.token || 0) + 1);
      const srcs = this.sources;
      let datas;
      try {
        this.loading = true;
        datas = await Promise.all(srcs.map(s => loadSpectrum(s.ref.fileName).catch(() => null)));
      } finally { this.loading = false; }
      if (token !== this.token) return;
      const bwHz = clamp(this.bandwidthMHz, this.bwLo, this.bwHi) * 1e6;
      const L = this.length, xm = this.xMax, ownMax = Math.max(xm, L || 0) * 1.02;
      const dates = srcs.map(s => s.diag.date).sort();
      this.vrCache = this.vrCache || new Map();
      const out = [];
      srcs.forEach((src, idx) => {
        const data = datas[idx]; if (!data) return;
        let vr = this.manualVR;
        if (this.vrMode === 'length' && L) {
          const k = `${src.ref.fileName}|${bwHz}|${this.windowName}|${L}`;
          if (!this.vrCache.has(k)) this.vrCache.set(k, Sig.estimateVR(data, bwHz, this.windowName, L));
          const est = this.vrCache.get(k); if (est) vr = est;
        }
        const r = Sig.computeSignature(data, bwHz, this.windowName, vr, ownMax);
        let norm = Sig.makeNormalization(r, L);
        const ln = src.ref.lira?.norm, lbw = src.ref.lira?.bandHz;
        if (norm && ln && lbw && Math.abs(bwHz - lbw) / lbw < 0.02 && this.windowName === '4 Term B-H') {
          norm = { ...norm, slope: ln.slope, zeroDB: ln.zero, sd: ln.sd ?? norm.sd, source: 'LIRA 분석값' };
        }
        const trace = Sig.displayTrace(r, norm, this.normalize, this.reversed.includes(src.id), L, xm);
        let title, color;
        if (this.mode === 'timeline') {
          title = fmtDay(src.diag.date) + ' ' + src.phase + '상';
          const rank = dates.length - 1 - dates.lastIndexOf(src.diag.date);
          color = TIMELINE_COLORS[clamp(rank, 0, TIMELINE_COLORS.length - 1)];
        } else {
          title = src.phase + '상 · ' + fmtDay(src.diag.date);
          color = PHASE_COLOR[src.phase] || COLORS.gray;
        }
        const parts = [`VR ${vr.toFixed(3)}`];
        parts.push(norm ? `감쇠 ${(norm.slope * 1000).toFixed(1)} dB/km(왕복) · 종단 피크 ${norm.endPeakDB.toFixed(1)} dB` : '감쇠 보정 불가');
        if (this.normalize && norm) parts.push(`기준선 ${norm.source} · 1 SD ${norm.sd.toFixed(1)} dB`);
        parts.push(src.ref.label || src.ref.originalName);
        out.push(markRaw({ id: src.id, title, color, trace: markRaw(trace), vr, resolutionM: r.resolutionM, detail: parts.join(' · ') }));
      });
      this.curves = out;
      this.savedNotice = false;
    },
    toggleHidden(id) { this.hidden = this.hidden.includes(id) ? this.hidden.filter(x => x !== id) : [...this.hidden, id]; },
    toggleRev(id) { this.reversed = this.reversed.includes(id) ? this.reversed.filter(x => x !== id) : [...this.reversed, id]; },
    readout(c) { const v = Sig.traceValueAt(c.trace, this.cursor); return v == null ? '–' : v.toFixed(1) + ' dB'; },
    async saveStd() {
      await A.updateSite(this.siteId, s => { s.sigBandwidthMHz = this.bandwidthMHz; s.sigWindow = this.windowName; });
      this.savedNotice = true;
    },
  },
  template: `<div>
    <div class="btnrow" style="justify-content:space-between;margin-bottom:8px">
      <h3 style="margin:0">Signature</h3><span class="sub small mono">{{ resText }}</span>
    </div>
    <div v-if="!allSources.length" class="panel">
      <div class="bold">업로드된 스펙트럼 데이터가 없습니다.</div>
      <div class="sub small" style="margin-top:4px">진단 기록의 상별 결과에서 LIRA 측정 파일(.lira·.anl·.out·.sdt) 또는 스펙트럼 텍스트를 불러오면, 여기에서 Signature를 계산해 겹쳐 봅니다.</div>
    </div>
    <template v-else>
      <div class="seg" style="margin-bottom:8px">
        <button :class="{on: mode === 'timeline'}" @click="mode = 'timeline'">전후 비교 (같은 상)</button>
        <button :class="{on: mode === 'phases'}" @click="mode = 'phases'">상간 비교 (같은 진단)</button>
      </div>
      <div class="seg" v-if="mode === 'timeline'" style="margin-bottom:8px">
        <button v-for="ph in phasesWithData" :key="ph" :class="{on: phase === ph}" @click="phase = ph">{{ ph }}상</button>
      </div>
      <select v-else class="boxinput" style="margin-bottom:8px" v-model="diagId">
        <option v-for="d in diagsWithData" :key="d.id" :value="d.id">{{ fmtDay(d.date) }}</option>
      </select>
      <div class="chartbox">
        <signature-chart :curves="curves" :hidden="hidden" :x-max="xMax" :length-marker="length" v-model:cursor="cursor" :normalized="normalize" :show-s-d="showSD"></signature-chart>
      </div>
      <div class="readout" v-if="cursor != null">
        <b class="mono">{{ cursor.toFixed(1) }} m</b>
        <span v-for="c in visibleCurves" :key="c.id"><span class="dot" :style="{background: c.color}"></span>{{ c.title }} <span class="mono">{{ readout(c) }}</span></span>
        <button class="linkbtn small" @click="cursor = null">커서 지우기</button>
      </div>
      <div class="sub small" v-else style="padding:6px 2px">그래프를 터치하거나 끌면 거리별 값을 비교할 수 있습니다.{{ loading ? ' (불러오는 중…)' : '' }}</div>

      <div class="panel" style="margin-top:6px">
        <bandwidth-control v-model="bandwidthMHz" :lo="bwLo" :hi="bwHi" :max-freq-m-hz="maxFreqMHz" :guideline="guideline"></bandwidth-control>
      </div>
      <div class="panel">
        <div class="optrow">
          <div class="grow"><div class="t">Normalized</div><div class="sub xs">0 dB = 평균 변동 + 1 SD. 0 dB 위로 솟은 신호만 표시합니다.</div></div>
          <label class="toggle"><input type="checkbox" v-model="normalize"><span></span></label>
        </div>
        <div class="optrow" v-if="normalize" style="padding-left:12px">
          <div class="grow">2SD · 3SD 선 표시</div>
          <label class="toggle"><input type="checkbox" v-model="showSD"><span></span></label>
        </div>
        <div class="sub xs" v-if="!length">긍장 정보가 있어야 감쇠 보정과 정규화를 할 수 있습니다. 구간 정보에 긍장을 입력하세요.</div>
      </div>
      <div class="panel">
        <div class="optrow"><div class="grow">윈도우</div><select class="boxinput" style="width:auto" v-model="windowName"><option v-for="w in windows" :key="w">{{ w }}</option></select></div>
        <div class="optrow"><div class="grow">전파속도(VR)</div>
          <select class="boxinput" style="width:auto" v-model="vrMode" :disabled="!length"><option value="length">긍장 기준 자동</option><option value="manual">VR 직접 입력</option></select></div>
        <div class="optrow" v-if="vrMode === 'manual' || !length">
          <span>VR</span><input type="range" class="range grow" min="0.30" max="0.90" step="0.001" v-model.number="manualVR">
          <div style="text-align:right;min-width:92px"><div class="mono">{{ manualVR.toFixed(3) }}</div><div class="sub xs mono">TDR {{ tdr }} m/μs</div></div>
        </div>
        <div class="optrow">
          <div class="grow sub small">{{ site && site.sigBandwidthMHz ? '구간 기준: ' + site.sigBandwidthMHz.toFixed(2) + ' MHz · ' + (site.sigWindow || '4 Term B-H') : '구간 기준 대역폭이 아직 없습니다.' }}</div>
          <button class="btn small" @click="saveStd">{{ savedNotice ? '저장됨' : '현재 조건을 구간 기준으로 저장' }}</button>
        </div>
      </div>
      <div class="panel">
        <div class="legend-row" v-for="c in curves" :key="c.id">
          <button class="checkdot" :style="{borderColor: c.color, background: hidden.includes(c.id) ? 'transparent' : c.color}" @click="toggleHidden(c.id)">{{ hidden.includes(c.id) ? '' : '✓' }}</button>
          <span class="swatch" :style="{background: c.color}"></span>
          <div class="grow"><div class="bold small">{{ c.title }}</div><div class="sub xs" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ c.detail }}</div></div>
          <button v-if="length" class="rbtn" :class="{on: reversed.includes(c.id)}" @click="toggleRev(c.id)">반전</button>
        </div>
        <div class="sub xs" style="margin-top:6px">반전: 반대편 끝에서 측정한 데이터를 같은 거리축으로 맞춥니다. 측정단을 확인하세요.</div>
      </div>
    </template>
  </div>`,
};

// 진단 상세 화면용 미리보기
const SignaturePreview = {
  components: { SignatureChart },
  props: { refObj: Object, site: Object, phase: String },
  data: () => ({ curves: [], xMax: 100, caption: '', cursor: null }),
  computed: { key() { return [this.refObj.fileName, this.site.sigBandwidthMHz, this.site.sigWindow, this.site.lengthM].join('|'); } },
  watch: { key: { immediate: true, handler() { this.build(); } } },
  methods: {
    async build() {
      let data;
      try { data = await loadSpectrum(this.refObj.fileName); } catch (e) { this.caption = '스펙트럼을 읽지 못했습니다: ' + e.message; return; }
      const win = Sig.WINDOWS.includes(this.site.sigWindow) ? this.site.sigWindow : '4 Term B-H';
      const L = this.site.lengthM || null;
      const lb = this.refObj.lira?.bandHz;
      const guide = L ? Sig.guidelineBandwidthMHz(L) * 1e6 : null;
      const bw = Math.min((this.site.sigBandwidthMHz ? this.site.sigBandwidthMHz * 1e6 : null) ?? lb ?? guide ?? data.maxFreq * 0.4, data.maxFreq);
      let vr = 0.55;
      if (L) { const est = Sig.estimateVR(data, bw, win, L); if (est) vr = est; }
      const xm = L ? L * 1.05 : vr * Sig.C / (2 * data.df) / 4;
      const r = Sig.computeSignature(data, bw, win, vr, xm * 1.02);
      const norm = Sig.makeNormalization(r, L);
      this.xMax = xm;
      this.caption = `대역폭 ${(bw / 1e6).toFixed(2)} MHz · ${win} · VR ${vr.toFixed(3)} · 분해능 ${r.resolutionM.toFixed(1)} m` + (norm ? ` · 감쇠 보정 ${(norm.slope * 1000).toFixed(1)} dB/km` : '');
      this.curves = [markRaw({ id: this.phase, title: this.phase + '상', color: PHASE_COLOR[this.phase] || COLORS.gray, trace: markRaw(Sig.displayTrace(r, norm, false, false, L, xm)) })];
    },
  },
  template: `<div><div class="chartbox"><signature-chart :curves="curves" :x-max="xMax" :length-marker="site.lengthM" :cursor="null" :height="170" :interactive="false"></signature-chart></div>
    <div class="sub xs mono" style="margin-top:4px">{{ caption }}</div></div>`,
};

// ===========================================================================
// 화면: 지도

const MapView = {
  components: { LocLabel },
  data: () => ({ hq: '전체', selected: null, showUnlocated: false }),
  computed: {
    filters() { return hqFilters(); },
    filtered() { return state.sites.filter(s => this.hq === '전체' || s.hq === this.hq); },
    unconfirmed() { return this.filtered.filter(s => !isConfirmed(s.locSource)); },
    diagCount() { const ids = new Set(this.filtered.map(s => s.id)); return state.diagnoses.filter(d => ids.has(d.siteId)).length; },
    sel() { return this.selected ? siteById(this.selected) : null; },
    selHist() { return this.sel ? historyOf(this.sel.id) : []; },
    selLast() { return this.selHist[this.selHist.length - 1] || null; },
    markerKey() {
      return this.filtered.map(s => {
        const h = historyOf(s.id);
        return [s.id, s.location?.lat, s.location?.lon, s.endLocation?.lat, s.locSource, h.length, h.some(d => statusOf(d) === 'needsInput')].join(',');
      }).join('|') + '|' + this.selected;
    },
    visible() { return state.route.parts[0] === 'map'; },
  },
  watch: {
    markerKey() { this.renderMarkers(); },
    visible(v) {
      if (!v) return;
      nextTick(() => {
        if (!this.map) return;
        this.map.invalidateSize();
        // 다른 화면에서 시작해 숨겨진 채로 만들어졌다면 처음 보일 때 영역을 다시 맞춤
        if (!this.fitted && this.$refs.el.clientWidth > 0) { this.map.fitBounds(hqBounds(this.hq)); this.fitted = true; }
      });
    },
  },
  mounted() {
    this.map = L.map(this.$refs.el, { zoomControl: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(this.map);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
    if (this.$refs.el.clientWidth > 0) { this.map.fitBounds(REGIONS['전체']); this.fitted = true; }
    else this.map.setView([36.0, 127.7], 7);
    this.map.on('click', () => { this.selected = null; });
    this.renderMarkers();
    setTimeout(() => this.map.invalidateSize(), 100);
  },
  methods: {
    setHq(f) { this.hq = f; this.selected = null; this.fitted = true; this.map.flyToBounds(hqBounds(f), { duration: 0.6, maxZoom: 15 }); },
    renderMarkers() {
      if (!this.layer) return;
      this.layer.clearLayers();
      for (const s of this.filtered) {
        if (!s.location) continue;
        if (s.endLocation) L.polyline([[s.location.lat, s.location.lon], [s.endLocation.lat, s.endLocation.lon]], { color: COLORS.teal, weight: 3, dashArray: '6 5', opacity: 0.8 }).addTo(this.layer);
        const h = historyOf(s.id);
        const cls = ['mk', isConfirmed(s.locSource) ? '' : 'est', h.some(d => statusOf(d) === 'needsInput') ? 'pend' : '', this.selected === s.id ? 'sel' : ''].join(' ');
        const label = h.length ? h.length : (s.kind === '해저' ? '≈' : '⚡');
        const m = L.marker([s.location.lat, s.location.lon], { icon: L.divIcon({ className: '', html: `<div class="${cls}" title="${shortLabel(s)}">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) });
        m.on('click', e => { L.DomEvent.stopPropagation(e); this.selected = s.id; });
        m.addTo(this.layer);
      }
      if (this.me) this.me.addTo(this.layer);
    },
    async locate() {
      const l = await deviceLocation();
      if (!l) { toast('기기 위치를 얻지 못했습니다. 위치 권한을 확인하세요.'); return; }
      this.me = L.marker([l.lat, l.lon], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) });
      this.renderMarkers();
      this.map.flyTo([l.lat, l.lon], 15, { duration: 0.6 });
    },
    open(id) { this.showUnlocated = false; go('/site/' + id); },
    fmtDay, specText, maxDGOf, statusOf,
  },
  template: `<div class="mapwrap">
    <div id="bigmap" ref="el"></div>
    <div class="map-top"><button v-for="f in filters" :key="f" :class="{on: hq === f}" @click="setHq(f)">{{ f }}</button></div>
    <button class="map-fab" style="top:56px" @click="locate" title="내 위치">◎</button>
    <div class="map-bottom">
      <div class="glass" v-if="sel" style="cursor:pointer" @click="open(sel.id)">
        <div class="btnrow" style="justify-content:space-between"><b>{{ sel.name }}</b><span class="sub small">{{ selHist.length }}회 ›</span></div>
        <div class="sub small">{{ sel.hq }} · {{ specText(sel) }}</div>
        <div class="btnrow small" style="margin-top:4px" v-if="selLast">최근 {{ fmtDay(selLast.date) }}
          <span v-if="maxDGOf(selLast) != null" class="sub">· DeltaG 최대 <b class="mono">{{ maxDGOf(selLast).toFixed(1) }}</b></span>
          <span v-if="statusOf(selLast) === 'needsInput'" class="chip orange">추가 입력 필요</span>
        </div>
      </div>
      <div class="glass">
        <div class="stats">
          <div class="stat"><div class="n">{{ filtered.length }}</div><div class="l">진단 구간</div></div>
          <div class="stat"><div class="n">{{ diagCount }}</div><div class="l">진단 기록</div></div>
          <button class="stat btnlike" @click="showUnlocated = true"><div class="n" style="color:var(--orange)">{{ unconfirmed.length }}</div><div class="l">위치 미확정 ›</div></button>
        </div>
        <div class="legend">
          <span><i style="background:var(--teal)"></i>GPS 확정</span>
          <span><i style="border:2px dashed var(--teal);width:8px;height:8px"></i>추정 위치</span>
          <span><i style="background:var(--orange)"></i>추가 입력 필요</span>
        </div>
      </div>
    </div>
    <div class="overlay" v-if="showUnlocated" @click.self="showUnlocated = false">
      <div class="sheet">
        <div class="sheet-h"><span style="width:50px"></span><div class="title">위치 미확정 구간</div><button class="tbtn strong" @click="showUnlocated = false">닫기</button></div>
        <div class="sheet-b">
          <div class="sec-f" style="padding-top:10px">다음 진단 때 대표사진 GPS로 위치가 확정됩니다.</div>
          <div class="sec"><div class="card">
            <a class="rowlink" v-for="s in unconfirmed" :key="s.id" @click="open(s.id)"><div class="grow"><div class="bold small">{{ s.name }}</div><div class="xs sub">{{ s.hq }} · <loc-label :source="s.locSource"></loc-label></div></div></a>
          </div></div>
        </div>
      </div>
    </div>
  </div>`,
};

// ===========================================================================
// 화면: 구간 목록

const SiteRow = {
  components: { DgValue, StatusBadge },
  props: ['site'],
  computed: {
    hist() { return historyOf(this.site.id); },
    last() { return this.hist[this.hist.length - 1] || null; },
  },
  methods: { fmtDay, specText, maxDGOf, statusOf, isConfirmed },
  template: `<div class="grow">
    <div class="btnrow" style="justify-content:space-between;flex-wrap:nowrap"><b class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ site.name }}</b><span class="xs sub mono">{{ hist.length }}회</span></div>
    <div class="xs sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ site.hq }} · {{ specText(site) }}</div>
    <div class="btnrow xs" style="margin-top:3px" v-if="last">
      <span>최근 {{ fmtDay(last.date) }}</span>
      <span v-if="maxDGOf(last) != null"><span class="sub">DeltaG 최대</span> <dg-value :value="maxDGOf(last)"></dg-value></span>
      <status-badge v-if="statusOf(last) === 'needsInput'" status="needsInput"></status-badge>
      <span v-if="!isConfirmed(site.locSource)" class="sub" style="margin-left:auto">⌀ 위치</span>
    </div>
  </div>`,
};

const SitesView = {
  components: { SiteRow },
  data: () => ({ q: '', hq: '전체' }),
  computed: {
    hqs() { return ['전체', ...[...new Set(state.sites.map(s => s.hq))].sort()]; },
    list() {
      const q = this.q.trim().toUpperCase();
      const t = id => { const l = lastDiagOf(id); return l ? new Date(l.date).getTime() : 0; };
      return state.sites
        .filter(s => this.hq === '전체' || s.hq === this.hq)
        .filter(s => !q || [s.name, s.fromCode, s.toCode, s.office].some(x => (x || '').toUpperCase().includes(q)))
        .sort((a, b) => t(b.id) - t(a.id));
    },
  },
  methods: { go },
  template: `<div class="page">
    <input class="search" v-model="q" placeholder="🔍 구간명·전산화번호·사업소">
    <div class="sec"><div class="card">
      <div class="field"><label>본부</label><select class="input" v-model="hq"><option v-for="h in hqs" :key="h">{{ h }}</option></select></div>
      <a class="rowlink" v-for="s in list" :key="s.id" @click="go('/site/' + s.id)"><site-row :site="s"></site-row></a>
    </div></div>
    <div class="empty" v-if="!list.length">조건에 맞는 구간이 없습니다.</div>
  </div>`,
};

// ===========================================================================
// 화면: 구간 상세

const DiagRow = {
  components: { PImg, StatusBadge },
  props: ['diag'],
  computed: { rep() { return repPhotoOf(this.diag); }, missing() { return missingItems(this.diag); }, st() { return statusOf(this.diag); } },
  methods: { fmtDay, fmtDG, dg(ph) { return deltaGOf(this.diag, ph); }, cls(ph) { const g = dgGrade(deltaGOf(this.diag, ph)); return g ? 'dg-' + g.cls : 'sub'; } },
  template: `<div class="thumb52"><p-img v-if="rep" :path="rep.thumb || rep.fileName"></p-img><span v-else>🖼</span></div>
    <div class="grow">
      <div class="btnrow"><b class="small">{{ fmtDay(diag.date) }}</b><status-badge :status="st"></status-badge></div>
      <div class="btnrow xs" style="gap:10px;margin-top:2px"><span v-for="ph in diag.phases" :key="ph"><b class="sub">{{ ph }}</b> <span class="mono" :class="cls(ph)">{{ fmtDG(dg(ph)) }}</span></span></div>
      <div class="xs" style="color:var(--orange)" v-if="missing.length">미입력: {{ missing.join(', ') }}</div>
    </div>`,
};

const SiteView = {
  components: { LocLabel, MiniMap, DiagRow, LocationPicker },
  props: ['id'],
  data: () => ({ editing: false, draft: '', picker: false }),
  computed: {
    site() { return siteById(this.id); },
    hist() { return historyOf(this.id); },
    histRev() { return [...this.hist].reverse(); },
    canCompare() { return this.hist.length >= 2 || hasSpectrum(this.id); },
    markers() { const s = this.site; return s?.location ? [{ lat: s.location.lat, lon: s.location.lon, cls: 'mk', html: '⚡' }] : []; },
    line() { const s = this.site; return s?.location && s.endLocation ? [[s.location.lat, s.location.lon], [s.endLocation.lat, s.endLocation.lon]] : null; },
    kakao() { const s = this.site; return s?.location ? `https://map.kakao.com/link/map/${encodeURIComponent(shortLabel(s))},${s.location.lat},${s.location.lon}` : ''; },
    gmap() { const s = this.site; return s?.location ? `https://www.google.com/maps/search/?api=1&query=${s.location.lat},${s.location.lon}` : ''; },
  },
  methods: {
    go, specText, codesText, geoText, isConfirmed,
    async saveNote() { await A.updateSite(this.id, s => { s.note = this.draft; }); this.editing = false; },
    async picked(c) { await A.updateSite(this.id, s => { s.location = c; s.locSource = 'manual'; }); toast('위치를 지정했습니다.'); },
  },
  template: `<div class="page" v-if="site">
    <div class="card" style="padding:12px 16px">
      <div class="xs sub">{{ site.hq }}{{ site.office ? ' · ' + site.office : '' }}</div>
      <div style="margin:4px 0" class="small">{{ specText(site) }}</div>
      <div class="xs sub code" v-if="codesText(site)"># 전산화번호 {{ codesText(site) }}</div>
      <div class="xs sub" v-if="site.maker">제조사 {{ site.maker }}</div>
    </div>
    <div class="sec"><div class="sec-h">위치</div><div class="card">
      <template v-if="site.location">
        <mini-map :center="site.location" :zoom="site.kind === '해저' ? 12 : 17" :markers="markers" :line="line"></mini-map>
        <div class="row"><loc-label :source="site.locSource"></loc-label><span class="grow"></span><span class="xs sub code">{{ geoText(site.location) }}</span></div>
        <div class="row"><a :href="kakao" target="_blank" rel="noopener">카카오맵에서 보기·길찾기</a><span class="sub">·</span><a :href="gmap" target="_blank" rel="noopener">구글 지도</a></div>
      </template>
      <div class="row" v-else><loc-label :source="site.locSource"></loc-label></div>
      <template v-if="!isConfirmed(site.locSource)">
        <div class="row"><button class="linkbtn" @click="picker = true">📌 지도에서 위치 지정</button></div>
        <div class="row xs sub">새 진단에서 대표사진을 등록하면 사진 GPS로 자동 확정됩니다.</div>
      </template>
    </div></div>
    <div class="sec"><div class="sec-h">진단 이력 {{ hist.length }}회</div><div class="card">
      <div class="row sub" v-if="!hist.length">진단 기록이 없습니다.</div>
      <a class="rowlink" v-for="d in histRev" :key="d.id" @click="go('/diag/' + d.id)"><diag-row :diag="d"></diag-row></a>
      <div class="row"><button class="linkbtn" @click="go('/new?site=' + site.id)">＋ 이 구간에 새 진단 추가</button></div>
    </div></div>
    <div class="sec"><div class="sec-h">Signature · 전후 비교</div><div class="card">
      <a class="rowlink" v-if="canCompare" @click="go('/compare/' + site.id)">〰 {{ hist.length >= 2 ? hist.length + '회 진단 비교 (Signature 중첩 · DeltaG · 코멘트)' : 'Signature 뷰어 (상간 비교 · 대역폭 조절)' }}</a>
      <div class="row sub small" v-else>{{ hist.length ? '스펙트럼 데이터를 불러오면 Signature를 볼 수 있습니다. 이번 진단이 다음 진단의 기준 데이터(Baseline)가 됩니다.' : '진단 기록이 쌓이면 전후 비교를 할 수 있습니다.' }}</div>
      <div class="row xs sub" v-if="site.sigBandwidthMHz">구간 기준 분석 대역폭 {{ site.sigBandwidthMHz.toFixed(2) }} MHz · {{ site.sigWindow || '4 Term B-H' }}</div>
    </div></div>
    <div class="sec"><div class="sec-h">구간 메모</div><div class="card">
      <template v-if="editing">
        <div class="field stack"><textarea class="input" v-model="draft"></textarea></div>
        <div class="row"><button class="linkbtn" @click="saveNote">메모 저장</button></div>
      </template>
      <template v-else>
        <div class="row small" v-if="site.note" style="white-space:pre-wrap">{{ site.note }}</div>
        <div class="row"><button class="linkbtn" @click="draft = site.note; editing = true">{{ site.note ? '메모 수정' : '메모 추가' }}</button></div>
      </template>
    </div></div>
    <location-picker v-if="picker" :initial="site.location" @pick="picked" @close="picker = false"></location-picker>
  </div>
  <div class="empty" v-else><div class="big">❓</div>구간을 찾을 수 없습니다.</div>`,
};

// ===========================================================================
// 화면: 새 진단 (현장용)

const NewView = {
  components: { PhotoAdd, MiniMap, PhaseToggles, LocationPicker },
  data() {
    return {
      pending: [], repId: null, manualLoc: null, manualSource: 'manual', picker: false,
      selectedSiteId: null, createNew: false, query: '',
      newSite: { hq: '부산울산', office: '', fromName: '', fromCode: '', toName: '', toCode: '', kind: '지중', cableType: '', size: '', mfg: '' },
      lengthText: '', date: toLocalInput(), dateTouched: false, phases: ['A', 'B', 'C'], measuredEnd: '', saving: false,
      tags: PHOTO_TAGS, hqList: HQ_LIST,
    };
  },
  computed: {
    presetId() { return state.route.query.site || null; },
    preset() { return this.presetId ? siteById(this.presetId) : null; },
    repPhoto() { return this.pending.find(p => p.id === this.repId) || this.pending[0] || null; },
    resolved() {
      const p = this.repPhoto;
      if (p?.meta.location) {
        const acc = p.meta.hAccuracy != null ? ` · 오차 ±${Math.round(p.meta.hAccuracy)} m` : '';
        return { point: p.meta.location, source: 'photoGPS', note: `대표사진 GPS (${p.meta.gpsSource})${acc}` };
      }
      if (this.manualLoc) return { point: this.manualLoc, source: this.manualSource, note: LOC_LABEL[this.manualSource] };
      return null;
    },
    nearbySites() { return this.resolved ? nearby(this.resolved.point, 500) : []; },
    mapMarkers() {
      if (!this.resolved) return [];
      const m = [{ lat: this.resolved.point.lat, lon: this.resolved.point.lon, cls: 'mk-here', html: '📷' }];
      for (const n of this.nearbySites) m.push({ lat: n.site.location.lat, lon: n.site.location.lon, cls: 'mk-near', size: [24, 24], title: shortLabel(n.site) });
      return m;
    },
    searchResults() { return searchSites(this.query).slice(0, 8); },
    canSave() {
      if (!this.phases.length || this.saving) return false;
      if (this.preset) return true;
      if (this.createNew) return !!this.newSite.fromName.trim();
      return !!this.selectedSiteId;
    },
    operator: { get() { return state.operator; }, set(v) { state.operator = v; ls.set('operatorName', v); } },
  },
  watch: {
    canSave: { immediate: true, handler() { this.setHeader(); } },
  },
  mounted() { if (this.presetId) this.selectedSiteId = this.presetId; this.setHeader(); },
  beforeUnmount() { state.headerOverride = null; this.pending.forEach(p => URL.revokeObjectURL(p.preview)); },
  methods: {
    geoText, meters, fmtDayTime, specText, codesText, historyOf,
    setHeader() {
      state.headerOverride = { left: { label: '취소', action: () => back() }, back: false, right: { label: '현장 저장', action: () => this.save(), disabled: !this.canSave, strong: true } };
    },
    onAdd(imgs) {
      for (const img of imgs) this.pending.push({ ...img, tag: this.pending.length ? '현장 전경' : '설비 명판' });
      if (!this.repId) this.repId = (this.pending.find(p => p.meta.location) || this.pending[0])?.id || null;
      if (!this.dateTouched && this.repPhoto?.meta.takenAt) this.date = toLocalInput(this.repPhoto.meta.takenAt);
    },
    removeP(p) { this.pending = this.pending.filter(x => x.id !== p.id); if (this.repId === p.id) this.repId = this.pending[0]?.id || null; },
    async useDevice() {
      const l = await deviceLocation();
      if (l) { this.manualLoc = { lat: l.lat, lon: l.lon }; this.manualSource = 'device'; }
      else toast('기기 위치를 얻지 못했습니다. 위치 권한을 확인하세요.');
    },
    picked(c) { this.manualLoc = c; this.manualSource = 'manual'; },
    choose(id) { this.selectedSiteId = this.selectedSiteId === id ? null : id; },
    async save() {
      if (!this.canSave) return;
      this.saving = true;
      try {
        let siteId;
        if (this.preset) siteId = this.preset.id;
        else if (this.createNew) {
          const n = this.newSite;
          const s = {
            id: uuid(), ...n, fromName: n.fromName.trim(), toName: n.toName.trim(), maker: '', note: '',
            lengthM: isFinite(parseFloat(this.lengthText.replace(/,/g, ''))) ? parseFloat(this.lengthText.replace(/,/g, '')) : null,
            location: this.resolved ? { ...this.resolved.point } : null, endLocation: null,
            locSource: this.resolved ? this.resolved.source : 'none', createdAt: nowISO(),
          };
          s.name = s.toName ? `${s.fromName} ~ ${s.toName}` : s.fromName;
          await A.addSite(s); siteId = s.id;
        } else siteId = this.selectedSiteId;
        const d = {
          id: uuid(), siteId, date: fromLocalInput(this.date), phases: [...this.phases], measuredEnd: this.measuredEnd, operatorName: state.operator,
          maxFreqMHz: null, docNo: '', photos: [], repPhotoId: null, results: this.phases.map(ph => ({ phase: ph, deltaG: null, signatures: [] })),
          comments: [], imported: false, source: '웹 입력', createdAt: nowISO(), updatedAt: nowISO(),
        };
        for (let i = 0; i < this.pending.length; i++) {
          state.busy = `사진 저장 중 (${i + 1}/${this.pending.length})`;
          const p = this.pending[i];
          const item = await A.storeImage(p, p.tag, '현장');
          d.photos.push(item);
          if (p.id === this.repPhoto?.id) d.repPhotoId = item.id;
        }
        state.busy = '진단 저장 중';
        await A.addDiagnosis(d);
        const site = siteById(siteId);
        state.busy = '';
        if (site && !isConfirmed(site.locSource) && this.resolved && isConfirmed(this.resolved.source)) {
          await A.setConfirmedLocation(siteId, this.resolved.point, this.resolved.source);
        }
        replaceRoute('/diag/' + d.id + '?new=1');
      } catch (e) { state.busy = ''; reportError(e); } finally { this.saving = false; }
    },
  },
  template: `<div class="page">
    <div class="sec"><div class="sec-h">1. 현장 사진</div><div class="card">
      <div class="row"><photo-add @add="onAdd"></photo-add></div>
      <div class="pending-row" v-if="pending.length">
        <div class="pcard" v-for="p in pending" :key="p.id">
          <div class="im"><img :src="p.preview"><button class="x" @click="removeP(p)">✕</button></div>
          <button class="linkbtn small" :class="{star: p.id === repPhoto.id}" style="text-align:left" @click="repId = p.id">{{ p.id === repPhoto.id ? '★ 대표사진' : '☆ 대표로' }}</button>
          <select v-model="p.tag"><option v-for="t in tags" :key="t">{{ t }}</option></select>
          <span :style="{color: p.meta.location ? 'var(--accent)' : 'var(--sub)'}">{{ p.meta.location ? '📍 GPS 있음' : '⌀ GPS 없음' }}</span>
          <span class="sub">{{ p.meta.takenAt ? fmtDayTime(p.meta.takenAt) : '촬영일시 없음' }}</span>
        </div>
      </div>
    </div><div class="sec-f">★ 대표사진의 GPS로 현장 위치를 특정합니다. 설비 명판을 대표사진으로 두면 전산화번호 확인에도 유리합니다.</div></div>

    <div class="sec"><div class="sec-h">2. 현장 위치</div><div class="card">
      <template v-if="resolved">
        <mini-map :center="resolved.point" :zoom="17" :markers="mapMarkers"></mini-map>
        <div class="kv"><span class="k">좌표</span><span class="v code">{{ geoText(resolved.point) }}</span></div>
        <div class="kv"><span class="k">출처</span><span class="v">{{ resolved.note }}</span></div>
      </template>
      <div class="row sub small" v-else>{{ pending.length ? '대표사진에 GPS 정보가 없습니다.' : '사진을 추가하면 대표사진의 GPS로 위치를 찾습니다.' }}</div>
      <div class="row btnrow" v-if="!resolved || resolved.source !== 'photoGPS'">
        <button class="btn" @click="useDevice">◎ 현재 기기 위치</button>
        <button class="btn" @click="picker = true">📌 지도에서 지정</button>
      </div>
    </div></div>

    <div class="sec"><div class="sec-h">3. 대상 구간</div><div class="card">
      <div class="row" v-if="preset" style="display:block">
        <b>{{ preset.name }}</b>
        <div class="xs sub">{{ specText(preset) }}</div>
        <div class="xs" style="color:var(--teal)">기존 이력 {{ historyOf(preset.id).length }}회 · 저장 시 전후 비교에 포함됩니다.</div>
      </div>
      <template v-else>
        <div class="row"><div class="seg grow"><button :class="{on: !createNew}" @click="createNew = false">기존 구간</button><button :class="{on: createNew}" @click="createNew = true">새 구간 등록</button></div></div>
        <template v-if="createNew">
          <div class="field"><label>본부</label><select class="input" v-model="newSite.hq"><option v-for="h in hqList" :key="h">{{ h }}</option></select></div>
          <div class="field"><input class="input" style="text-align:left" v-model="newSite.office" placeholder="사업소 (예: 중부산)"></div>
          <div class="field"><input class="input" style="text-align:left" v-model="newSite.fromName" placeholder="시점 설비명 (예: 수산 9 # 1) *"></div>
          <div class="field"><input class="input code" style="text-align:left;text-transform:uppercase" v-model="newSite.fromCode" placeholder="시점 전산화번호 (예: 0188G462)"></div>
          <div class="field"><input class="input" style="text-align:left" v-model="newSite.toName" placeholder="종점 설비명"></div>
          <div class="field"><input class="input code" style="text-align:left;text-transform:uppercase" v-model="newSite.toCode" placeholder="종점 전산화번호"></div>
          <div class="field"><label>포설</label><div class="seg grow"><button :class="{on: newSite.kind === '지중'}" @click="newSite.kind = '지중'">지중</button><button :class="{on: newSite.kind === '해저'}" @click="newSite.kind = '해저'">해저</button></div></div>
          <div class="field"><input class="input" style="text-align:left" v-model="newSite.cableType" placeholder="선종 (CNCV-W 등)"><input class="input" style="text-align:left" v-model="newSite.size" inputmode="numeric" placeholder="규격 ㎟"></div>
          <div class="field"><input class="input" style="text-align:left" v-model="lengthText" inputmode="decimal" placeholder="긍장 m"><input class="input" style="text-align:left" v-model="newSite.mfg" inputmode="numeric" placeholder="제조년월"></div>
        </template>
        <template v-else>
          <template v-if="resolved">
            <div class="row sub small" v-if="!nearbySites.length">✓ 반경 500 m 안에 진단 이력이 있는 구간이 없습니다.</div>
            <div class="row" v-for="n in nearbySites" :key="n.site.id" style="cursor:pointer" @click="choose(n.site.id)">
              <span :style="{color: selectedSiteId === n.site.id ? 'var(--accent)' : 'var(--sub)'}">{{ selectedSiteId === n.site.id ? '◉' : '○' }}</span>
              <div class="grow"><div class="small bold">{{ n.site.name }}</div><div class="xs sub">{{ [codesText(n.site), '이력 ' + historyOf(n.site.id).length + '회'].filter(Boolean).join(' · ') }}</div></div>
              <span class="xs mono" style="color:var(--teal)">{{ meters(n.distance) }}</span>
            </div>
          </template>
          <div class="field"><input class="input code" style="text-align:left" v-model="query" placeholder="🔍 전산화번호·설비명으로 찾기 (예: 0188G462)"></div>
          <div class="row" v-for="s in searchResults" :key="s.id" style="cursor:pointer" @click="choose(s.id)">
            <span :style="{color: selectedSiteId === s.id ? 'var(--accent)' : 'var(--sub)'}">{{ selectedSiteId === s.id ? '◉' : '○' }}</span>
            <div class="grow"><div class="small bold">{{ s.name }}</div><div class="xs sub">{{ [codesText(s), '이력 ' + historyOf(s.id).length + '회'].filter(Boolean).join(' · ') }}</div></div>
          </div>
        </template>
      </template>
    </div><div class="sec-f" v-if="!preset">{{ createNew ? '시점·종점 설비명과 전산화번호는 명판 사진을 보고 입력하세요.' : '주변에 이력이 있는 구간을 선택하면 이번 진단이 그 구간의 이력에 추가되어 전후 비교가 됩니다.' }}</div></div>

    <div class="sec"><div class="sec-h">4. 측정 정보</div><div class="card">
      <div class="field"><label>진단 일시</label><input class="input" type="datetime-local" v-model="date" @change="dateTouched = true"></div>
      <div class="field" style="flex-wrap:wrap"><label>측정 상</label><phase-toggles v-model="phases"></phase-toggles></div>
      <div class="field"><input class="input" style="text-align:left" v-model="measuredEnd" placeholder="측정단 (예: 수산 9 # 1 측)"></div>
      <div class="field"><input class="input" style="text-align:left" v-model="operator" placeholder="측정자"></div>
    </div><div class="sec-f">DeltaG, 스펙트럼, 코멘트는 저장 후 바로 입력하거나 사무실 복귀 후 '추가 입력' 탭에서 입력할 수 있습니다.</div></div>
    <button class="btn prim full" style="margin-top:18px" :disabled="!canSave" @click="save">현장 저장</button>
    <location-picker v-if="picker" :initial="manualLoc || state.lastLoc" @pick="picked" @close="picker = false"></location-picker>
  </div>`,
};

// ===========================================================================
// 화면: 진단 상세 (현장 일부 입력 → 사무실에서 나머지)

const DiagView = {
  components: { StatusBadge, PhaseToggles, PhotoGrid, PhotoAdd, PhotoDetail, SignaturePreview },
  props: ['id'],
  data: () => ({ viewing: null, commentText: '', commentStage: '사무실', importTarget: null, dragOver: false }),
  computed: {
    d() { return diagById(this.id); },
    site() { return this.d ? siteById(this.d.siteId) : null; },
    afterCreate() { return state.route.query.new === '1'; },
    st() { return statusOf(this.d); },
    missing() { return missingItems(this.d); },
    rep() { return repPhotoOf(this.d); },
    comments() { return [...this.d.comments].sort((a, b) => new Date(a.at) - new Date(b.at)); },
    operator() { return state.operator; },
  },
  watch: { afterCreate: { immediate: true, handler(v) { state.headerOverride = v ? { back: false, left: null, right: { label: '완료', strong: true, action: () => back() } } : null; } } },
  mounted() { if (this.d) this.commentStage = defaultStage(this.d); document.addEventListener('paste', this.onPaste); },
  beforeUnmount() { state.headerOverride = null; document.removeEventListener('paste', this.onPaste); },
  methods: {
    fmtDay, fmtDayTime, fmtDG, toLocalInput, specText, refSummary,
    upd(fn) { return A.updateDiagnosis(this.id, fn); },
    setDate(v) { this.upd(d => { d.date = fromLocalInput(v); }); },
    setPhases(v) { this.upd(d => { d.phases = v; for (const ph of v) if (!resultOf(d, ph)) d.results.push({ phase: ph, deltaG: null, signatures: [] }); }); },
    setField(k, v) { this.upd(d => { d[k] = v; }); },
    setMaxF(v) { const x = parseFloat(v); this.upd(d => { d.maxFreqMHz = isFinite(x) ? x : null; }); },
    r(ph) { return resultOf(this.d, ph); },
    grade(ph) { return dgGrade(deltaGOf(this.d, ph)); },
    setDG(ph, v) {
      const x = parseFloat(String(v).replace(',', '.'));
      this.upd(d => {
        let r = resultOf(d, ph);
        if (!r) { r = { phase: ph, deltaG: null, signatures: [] }; d.results.push(r); }
        r.deltaG = isFinite(x) ? x : null; r.updatedAt = nowISO(); r.stage = defaultStage(d);
      });
    },
    prevDG(ph) {
      const earlier = historyOf(this.d.siteId).filter(e => new Date(e.date) < new Date(this.d.date) && e.id !== this.d.id);
      for (let i = earlier.length - 1; i >= 0; i--) { const v = deltaGOf(earlier[i], ph); if (v != null) return { date: earlier[i].date, value: v }; }
      return null;
    },
    prevText(ph) {
      const p = this.prevDG(ph), cur = deltaGOf(this.d, ph);
      if (!p || cur == null) return null;
      const dv = cur - p.value;
      return { text: `직전 진단(${fmtDay(p.date)}) ${p.value.toFixed(1)} → 이번 ${cur.toFixed(1)}  (${dv >= 0 ? '+' : ''}${dv.toFixed(1)})`, warn: Math.abs(dv) >= 3 };
    },
    async addPhotos(imgs) {
      await A.addPhotos(imgs, this.id, '현장 전경', defaultStage(this.d));
      if (this.site && !isConfirmed(this.site.locSource)) await A.confirmSiteLocation(this.site.id, repPhotoOf(this.d));
    },
    addSigs(ph, imgs) { A.addSignatures(imgs, this.id, ph, defaultStage(this.d)); },
    pickFiles(target) { this.importTarget = target; this.$refs.files.click(); },
    onFiles(ev) { const files = [...ev.target.files]; ev.target.value = ''; this.importFiles(files, this.importTarget || '*'); },
    onDrop(ev) { this.dragOver = false; const files = [...(ev.dataTransfer?.files || [])]; if (files.length) this.importFiles(files, '*'); },
    async importFiles(files, target) {
      const stage = defaultStage(this.d);
      const { groups, loose } = Lira.groupLiraFiles(files);
      const done = [], failed = [];
      for (const g of groups) {
        if (!g.files.lira) { failed.push(`${g.key}: .lira 파일이 없습니다 (.anl·.out·.sdt만으로는 스펙트럼을 만들 수 없음)`); continue; }
        try { done.push(await A.attachLiraGroup(g, this.id, stage, target === '*' ? null : target)); }
        catch (e) { state.busy = ''; failed.push(`${g.key}: ${e.message}`); }
      }
      for (let i = 0; i < loose.length; i++) {
        const f = loose[i];
        const ph = target === '*' ? phaseFromFileName(f.name) : (i === 0 && !groups.length ? target : null);
        if (!ph) { failed.push(`${f.name}: 파일 이름에서 상(A·B·C·N)을 찾지 못함`); continue; }
        try {
          state.busy = `${ph}상 스펙트럼 저장 중`;
          done.push(await A.attachSpectrumText(await f.text(), f.name, this.id, ph, stage));
        } catch (e) { failed.push(`${f.name}: ${e.message}`); } finally { state.busy = ''; }
      }
      const lines = [];
      if (done.length) lines.push('불러옴\n' + done.join('\n'));
      if (failed.length) lines.push('실패\n' + failed.join('\n'));
      if (failed.length || done.length > 1 || done.some(x => x.includes('('))) alertBox('스펙트럼 불러오기', lines.join('\n\n'));
      else if (done.length) toast(done[0]);
    },
    async removeSpec(ph) { if (await confirmBox(`${ph}상 스펙트럼을 삭제할까요?`, '삭제', true)) A.removeSpectrum(this.id, ph); },
    /** 클립보드 읽기: 브라우저가 허용하면 바로, 아니면 붙여넣기 창 */
    async readClipboard() {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const t = await navigator.clipboard.readText();
          if (t && t.trim()) return t;
        }
      } catch { /* 권한 거부·미지원 → 붙여넣기 창 */ }
      const v = await dialog({
        title: '스펙트럼 붙여넣기', text: 'LIRA에서 클립보드로 복사한 스펙트럼을 아래 칸에 붙여넣으세요 (Ctrl+V).',
        textarea: true, submitOnPaste: true, placeholder: 'frequency (Hz) - …\tImp. phase (deg) - …\n500.0\t-86.4\n1.0k\t-87.6\n…',
        buttons: [{ label: '취소', value: false }, { label: '확인', value: 'check', prim: true }],
      });
      return typeof v === 'string' && v.trim() ? v : null;
    },
    async pasteSpectrum(phase) {
      const text = await this.readClipboard();
      if (text) await this.attachPasted(text, phase);
    },
    /** 붙여넣은 텍스트 → 형식 확인 → (상 선택·교체 확인·중복 확인) → 저장 */
    async attachPasted(text, phase) {
      let data;
      try { data = Sig.parseSpectrum(text); }
      catch (e) { await alertBox('붙여넣기 실패', `${e.message}\n\nLIRA에서 스펙트럼을 클립보드로 복사했는지 확인하세요.`); return; }
      const info = `${data.label || '측정 이름 없음'}\n${data.count}점 · ${(data.f0 / 1e6).toFixed(2)}–${(data.maxFreq / 1e6).toFixed(1)} MHz`;
      if (!phase) {
        phase = await dialog({
          title: '어느 상의 스펙트럼인가요?', text: info,
          buttons: [...PHASES.map(p => ({ label: p + '상' + (this.r(p)?.spectrum ? '(교체)' : ''), value: p, prim: true })), { label: '취소', value: null }],
        });
        if (!phase) return;
      } else if (this.r(phase)?.spectrum) {
        const ok = await dialog({ title: `${phase}상 스펙트럼 교체`, text: `이미 있는 ${phase}상 스펙트럼을 붙여넣은 내용으로 바꿀까요?\n\n${info}`, buttons: [{ label: '취소', value: false }, { label: '바꾸기', value: true, prim: true }] });
        if (!ok) return;
      }
      // 같은 측정을 다른 상에 이미 넣었다면 (다음 상 복사를 잊은 경우) 확인
      const dup = data.label && PHASES.find(p => p !== phase && this.r(p)?.spectrum?.label === data.label);
      if (dup) {
        const ok = await dialog({ title: '같은 측정 데이터', text: `붙여넣은 데이터가 ${dup}상에 이미 넣은 측정과 같습니다.\n(${data.label})\n\nLIRA에서 ${phase}상을 복사했는지 확인하세요.`, buttons: [{ label: '취소', value: false, prim: true }, { label: '그래도 넣기', value: true }] });
        if (!ok) return;
      }
      try {
        state.busy = `${phase}상 스펙트럼 저장 중`;
        toast(await A.attachSpectrumText(text, null, this.id, phase, defaultStage(this.d), data));
      } catch (e) { reportError(e); } finally { state.busy = ''; }
    },
    /** 화면에서 Ctrl+V (입력칸 밖) → 스펙트럼 붙여넣기 */
    onPaste(e) {
      if (state.dialog || state.busy || !this.d) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!text || !text.trim()) return;
      e.preventDefault();
      this.attachPasted(text, null);
    },
    async addComment() {
      const text = this.commentText.trim(); if (!text) return;
      await this.upd(d => { d.comments.push({ id: uuid(), text, author: state.operator, at: nowISO(), stage: this.commentStage }); });
      this.commentText = '';
    },
    async delComment(c) { if (await confirmBox('이 코멘트를 삭제할까요?', '삭제', true)) this.upd(d => { d.comments = d.comments.filter(x => x.id !== c.id); }); },
    async del() {
      if (!(await confirmBox('이 진단 기록과 사진을 삭제할까요?', '삭제', true))) return;
      const siteId = this.d.siteId, id = this.id;
      try {
        await withBusy('삭제 중', () => A.deleteDiagnosis(id));
        const prev = navStack[navStack.length - 2] || '';
        if (prev.includes(id) || prev.startsWith('/new')) replaceRoute('/site/' + siteId); else back();
        toast('진단 기록을 삭제했습니다.');
      } catch (e) { reportError(e); }
    },
    go,
  },
  template: `<div class="page" v-if="d && site">
    <div class="card" v-if="afterCreate" style="padding:12px 16px;color:var(--green)">✓ 현장 기록이 저장되었습니다. 결과는 지금 입력하거나 사무실에서 '추가 입력' 탭으로 이어서 입력하세요.</div>
    <div class="sec"><div class="card">
      <div class="row"><div class="grow"><b>{{ site.name }}</b><div class="xs sub">{{ specText(site) }}</div></div><status-badge :status="st"></status-badge></div>
      <div class="row xs" v-if="missing.length" style="color:var(--orange)">남은 입력: {{ missing.join(', ') }}</div>
      <div class="row xs sub" v-if="d.imported">출처: {{ d.source }}</div>
    </div></div>

    <div class="sec"><div class="sec-h">측정 정보</div><div class="card">
      <div class="field"><label>진단 일시</label><input class="input" type="datetime-local" :value="toLocalInput(d.date)" @change="setDate($event.target.value)"></div>
      <div class="field" style="flex-wrap:wrap"><label>측정 상</label><phase-toggles :model-value="d.phases" @update:model-value="setPhases"></phase-toggles></div>
      <div class="field"><label>측정단</label><input class="input" :value="d.measuredEnd" @change="setField('measuredEnd', $event.target.value)"></div>
      <div class="field"><label>측정자</label><input class="input" :value="d.operatorName" @change="setField('operatorName', $event.target.value)"></div>
      <div class="field"><label>Max Frequency</label><input class="input mono" inputmode="decimal" :value="d.maxFreqMHz ?? ''" placeholder="값 입력" @change="setMaxF($event.target.value)"><span class="sub">MHz</span></div>
      <div class="kv" v-if="d.docNo"><span class="k">진단 문서번호</span><span class="v">{{ d.docNo }}</span></div>
    </div></div>

    <div class="sec"><div class="sec-h">현장 사진 {{ d.photos.length }}장</div><div class="card">
      <div class="row sub" v-if="!d.photos.length">현장 사진이 없습니다.</div>
      <photo-grid v-else :photos="d.photos" :rep-id="rep && rep.id" @open="viewing = {photo: $event, sig: false}"></photo-grid>
      <div class="row"><photo-add @add="addPhotos"></photo-add></div>
    </div><div class="sec-f">사진을 누르면 메타데이터(촬영 일시·GPS·기기) 확인, 분류 변경, 대표사진 지정을 할 수 있습니다.</div></div>

    <div class="sec"><div class="sec-h">스펙트럼 데이터</div><div class="card">
      <div class="dropzone" :class="{over: dragOver}" @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop">
        <div class="btnrow" style="justify-content:center">
          <button class="btn prim" @click="pickFiles('*')">📂 LIRA 측정 파일 한 번에 불러오기</button>
          <button class="btn" @click="pasteSpectrum(null)">📋 클립보드 붙여넣기</button>
        </div>
        <div style="margin-top:6px">.lira·.anl·.out·.sdt 또는 스펙트럼 텍스트(.txt)<br>PC에서는 파일을 여기로 끌어다 놓아도 됩니다.</div>
      </div>
      <input ref="files" type="file" multiple class="hidden" accept=".lira,.anl,.out,.sdt,.txt,.tsv,.csv,text/plain,application/octet-stream" @change="onFiles">
    </div><div class="sec-f">LIRA 측정 폴더의 같은 이름 파일(.lira·.anl·.out·.sdt)을 함께 고르면 상(측정 설명의 Phase A/B/C/N), DeltaG, 긍장, 분석대역, LIRA 정규화 기준선을 자동으로 가져옵니다. 텍스트 파일은 이름 끝의 _A·_B·_C·_N으로 상을 구분합니다. LIRA에서 클립보드로 복사한 스펙트럼은 📋 붙여넣기 버튼을 누르거나 이 화면에서 Ctrl+V로 바로 넣을 수 있습니다.</div></div>

    <div class="sec" v-for="ph in d.phases" :key="ph"><div class="sec-h">{{ ph }}상 결과</div><div class="card">
      <div class="field"><label>DeltaG</label>
        <input class="input mono" inputmode="decimal" :value="r(ph) && r(ph).deltaG != null ? r(ph).deltaG : ''" placeholder="값 입력" @change="setDG(ph, $event.target.value)">
        <span v-if="grade(ph)" class="chip" :class="grade(ph).cls">{{ grade(ph).label }}</span>
      </div>
      <div class="row xs mono" v-if="prevText(ph)" :style="{color: prevText(ph).warn ? 'var(--orange)' : 'var(--sub)'}">{{ prevText(ph).text }}</div>
      <template v-if="r(ph) && r(ph).spectrum">
        <div class="row" style="display:block">
          <div class="btnrow" style="justify-content:space-between;flex-wrap:nowrap">
            <b class="small" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">〰 {{ r(ph).spectrum.originalName }}</b>
            <span class="btnrow" style="flex:none;flex-wrap:nowrap"><button class="btn small" @click="pickFiles(ph)">교체</button><button class="btn small" @click="pasteSpectrum(ph)" title="클립보드 붙여넣기">📋</button><button class="btn small danger" @click="removeSpec(ph)">삭제</button></span>
          </div>
          <div class="xs sub mono" style="margin:2px 0 6px">{{ refSummary(r(ph).spectrum) }}{{ r(ph).spectrum.label ? ' · ' + r(ph).spectrum.label : '' }}{{ r(ph).spectrum.lira ? ' · LIRA 파일' : '' }}</div>
          <signature-preview :ref-obj="r(ph).spectrum" :site="site" :phase="ph"></signature-preview>
          <div style="margin-top:6px"><button class="linkbtn small" @click="go('/compare/' + d.siteId + '?focus=' + d.id)">🎚 Signature 뷰어에서 대역폭 조절·비교 ›</button></div>
        </div>
      </template>
      <div class="row btnrow" v-else>
        <button class="btn" @click="pickFiles(ph)">📄 {{ ph }}상 스펙트럼 파일</button>
        <button class="btn" @click="pasteSpectrum(ph)">📋 붙여넣기</button>
      </div>
      <photo-grid v-if="r(ph) && r(ph).signatures.length" :photos="r(ph).signatures" big @open="viewing = {photo: $event, sig: true}"></photo-grid>
      <div class="row"><photo-add library-title="화면 사진" camera-title="화면 촬영" :max="4" @add="addSigs(ph, $event)"></photo-add></div>
      <div class="row xs sub" v-if="r(ph) && r(ph).stage && r(ph).updatedAt">최근 입력: {{ r(ph).stage }} · {{ fmtDayTime(r(ph).updatedAt) }}</div>
    </div></div>

    <div class="sec"><div class="sec-h">코멘트 {{ d.comments.length }}</div><div class="card">
      <div class="row" v-for="c in comments" :key="c.id" style="display:block">
        <div class="btnrow xs"><span class="chip" :class="c.stage === '현장' ? 'teal' : 'indigo'">{{ c.stage }}</span><b>{{ c.author || '작성자 미입력' }}</b><span class="sub">{{ fmtDayTime(c.at) }}</span><button class="linkbtn danger xs" style="margin-left:auto" @click="delComment(c)">삭제</button></div>
        <div class="small" style="margin-top:4px;white-space:pre-wrap">{{ c.text }}</div>
      </div>
      <div class="field stack"><textarea class="input" style="min-height:60px" v-model="commentText" placeholder="특이사항·분석결과를 간단히 입력"></textarea></div>
      <div class="row"><div class="seg" style="width:170px"><button :class="{on: commentStage === '현장'}" @click="commentStage = '현장'">현장</button><button :class="{on: commentStage === '사무실'}" @click="commentStage = '사무실'">사무실</button></div><span class="grow"></span><button class="btn prim small" :disabled="!commentText.trim()" @click="addComment">등록</button></div>
    </div><div class="sec-f">작성자는 '설정'의 측정자 이름({{ operator || '미입력' }})으로 기록됩니다.</div></div>

    <div class="sec"><div class="card"><div class="row"><button class="linkbtn danger" @click="del">이 진단 기록 삭제</button></div></div></div>
    <photo-detail v-if="viewing" :diag-id="d.id" :photo-id="viewing.photo.id" :is-signature="viewing.sig" @close="viewing = null"></photo-detail>
  </div>
  <div class="empty" v-else><div class="big">📄</div>진단 기록을 찾을 수 없습니다.</div>`,
};

// ===========================================================================
// 화면: 전후 비교

const CompareView = {
  components: { SignatureCompare, PImg },
  props: ['id'],
  computed: {
    site() { return siteById(this.id); },
    hist() { return historyOf(this.id); },
    focus() { return state.route.query.focus || null; },
    phasesUsed() { return PHASES.filter(ph => this.hist.some(d => d.phases.includes(ph))); },
    timeline() {
      return this.hist.flatMap(d => d.comments.map(c => ({ d, c }))).sort((a, b) => new Date(b.c.at) - new Date(a.c.at));
    },
    withPhoto() { return this.hist.filter(d => repPhotoOf(d)); },
    chart() {
      const pts = [];
      for (const d of this.hist) for (const ph of d.phases) { const v = deltaGOf(d, ph); if (v != null) pts.push({ t: new Date(d.date).getTime(), ph, v }); }
      const dates = new Set(pts.map(p => p.t));
      if (dates.size < 2) return null;
      const W = 600, H = 220, pl = 34, pr = 12, pt = 10, pb = 26;
      const t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t));
      const ymax = Math.max(30, Math.max(...pts.map(p => p.v)) * 1.15);
      const x = t => pl + (t - t0) / Math.max(t1 - t0, 1) * (W - pl - pr);
      const y = v => pt + (1 - v / ymax) * (H - pt - pb);
      const series = PHASES.map(ph => ({ ph, color: PHASE_COLOR[ph], pts: pts.filter(p => p.ph === ph).sort((a, b) => a.t - b.t).map(p => ({ x: x(p.t), y: y(p.v), v: p.v })) })).filter(s => s.pts.length);
      const yt = []; const st = tickStep(ymax, 5); for (let v = 0; v <= ymax + 1e-9; v += st) yt.push({ v, y: y(v) });
      const xt = [...dates].sort().map(t => ({ x: x(t), label: fmtDay(new Date(t).toISOString()).slice(2) }));
      return { W, H, pl, pr, pt, pb, series, yt, xt, yWatch: y(20), yCaution: y(25) };
    },
  },
  methods: {
    fmtDay, fmtDG, specText, repPhotoOf,
    dg(d, ph) { return deltaGOf(d, ph); },
    cls(d, ph) { const g = dgGrade(deltaGOf(d, ph)); return g ? 'dg-' + g.cls : 'sub'; },
    delta(ph) {
      const vals = this.hist.map(d => deltaGOf(d, ph)).filter(v => v != null);
      if (vals.length < 2) return null;
      const dv = vals[vals.length - 1] - vals[0];
      return { text: `${dv >= 0 ? '+' : ''}${dv.toFixed(1)}`, warn: Math.abs(dv) >= 3 };
    },
  },
  template: `<div class="page wide" v-if="site">
    <div style="margin:4px 0 14px"><h2 style="margin:0;font-size:20px">{{ site.name }}</h2><div class="xs sub">{{ specText(site) }}</div></div>
    <signature-compare :site-id="id" :focus-diag-id="focus"></signature-compare>
    <hr style="border:none;border-top:0.5px solid var(--line);margin:22px 0">
    <h3 style="margin:0 0 8px">DeltaG 이력</h3>
    <div class="panel" style="overflow-x:auto">
      <table class="dg"><thead><tr><th>상</th><th v-for="d in hist" :key="d.id">{{ fmtDay(d.date) }}</th><th>변화</th></tr></thead>
        <tbody><tr v-for="ph in phasesUsed" :key="ph"><td>{{ ph }}</td><td v-for="d in hist" :key="d.id" :class="cls(d, ph)">{{ fmtDG(dg(d, ph)) }}</td>
          <td><b v-if="delta(ph)" :style="{color: delta(ph).warn ? 'var(--orange)' : 'var(--text)'}">{{ delta(ph).text }}</b><span v-else class="sub">–</span></td></tr></tbody></table>
    </div>
    <div class="xs sub" style="margin-top:6px">등급 색상: 한국형 잠정기준 (양호 &lt; 20 ≤ 관찰 &lt; 25 ≤ 주의). 변화는 값이 있는 첫 진단과 마지막 진단의 차이.</div>
    <template v-if="chart">
      <h3 style="margin:20px 0 8px">DeltaG 추이</h3>
      <div class="panel">
        <svg :viewBox="'0 0 ' + chart.W + ' ' + chart.H" style="width:100%;display:block">
          <g font-size="10" fill="var(--sub)">
            <g v-for="t in chart.yt" :key="'y' + t.v"><line :x1="chart.pl" :x2="chart.W - chart.pr" :y1="t.y" :y2="t.y" stroke="var(--line)" stroke-width="0.6"></line><text :x="chart.pl - 5" :y="t.y + 3" text-anchor="end">{{ t.v }}</text></g>
            <text v-for="t in chart.xt" :key="'x' + t.x" :x="t.x" :y="chart.H - 8" text-anchor="middle">{{ t.label }}</text>
          </g>
          <line :x1="chart.pl" :x2="chart.W - chart.pr" :y1="chart.yWatch" :y2="chart.yWatch" stroke="#d4a600" stroke-dasharray="4 3" opacity="0.7"></line>
          <line :x1="chart.pl" :x2="chart.W - chart.pr" :y1="chart.yCaution" :y2="chart.yCaution" stroke="#f08a00" stroke-dasharray="4 3" opacity="0.7"></line>
          <g v-for="s in chart.series" :key="s.ph">
            <polyline :points="s.pts.map(p => p.x + ',' + p.y).join(' ')" fill="none" :stroke="s.color" stroke-width="2"></polyline>
            <circle v-for="(p, i) in s.pts" :key="i" :cx="p.x" :cy="p.y" r="3.5" :fill="s.color"><title>{{ s.ph }}상 {{ p.v.toFixed(1) }}</title></circle>
          </g>
        </svg>
        <div class="legend"><span v-for="s in chart.series" :key="s.ph"><i :style="{background: s.color}"></i>{{ s.ph }}상</span><span>- - 관찰 20 / 주의 25</span></div>
      </div>
    </template>
    <template v-if="withPhoto.length">
      <h3 style="margin:20px 0 8px">현장 대표사진</h3>
      <div class="hscroll"><div v-for="d in withPhoto" :key="d.id" style="flex:none;width:110px">
        <div class="pthumb" style="width:110px;height:110px"><p-img :path="repPhotoOf(d).thumb || repPhotoOf(d).fileName"></p-img></div>
        <div class="xs sub">{{ fmtDay(d.date) }}</div></div></div>
    </template>
    <h3 style="margin:20px 0 8px">코멘트 타임라인</h3>
    <div class="sub small" v-if="!timeline.length">코멘트가 없습니다.</div>
    <div class="timeline-item" v-for="it in timeline" :key="it.c.id">
      <span class="dot" :style="{background: it.c.stage === '현장' ? 'var(--teal)' : 'var(--indigo)'}"></span>
      <div><div class="xs sub">{{ fmtDay(it.d.date) }} 진단 · {{ it.c.stage }} · {{ it.c.author || '작성자 미입력' }}</div><div class="small" style="white-space:pre-wrap">{{ it.c.text }}</div></div>
    </div>
  </div>`,
};

// ===========================================================================
// 화면: 추가 입력 · 설정

const PendingView = {
  computed: { list() { return pending.value; } },
  methods: { fmtDayTime, missingItems, go, site(d) { return siteById(d.siteId); } },
  template: `<div class="page">
    <div class="empty" v-if="!list.length"><div class="big">✅</div><b>추가 입력할 진단이 없습니다</b><div class="small" style="margin-top:6px">현장에서 저장한 진단 중 DeltaG·스펙트럼이 빠진 기록이 여기에 모입니다.</div></div>
    <template v-else>
      <div class="sec"><div class="card">
        <a class="rowlink" v-for="d in list" :key="d.id" @click="go('/diag/' + d.id)"><div class="grow">
          <b class="small">{{ site(d) ? site(d).name : '구간 미상' }}</b>
          <div class="xs sub">{{ fmtDayTime(d.date) }}{{ d.operatorName ? ' · ' + d.operatorName : '' }}</div>
          <div class="btnrow" style="margin-top:4px;gap:6px"><span class="chip orange" v-for="m in missingItems(d)" :key="m">{{ m }}</span></div>
        </div></a>
      </div><div class="sec-f">사무실 복귀 후 LIRA CS에서 확인한 DeltaG와 상별 스펙트럼(또는 LIRA 측정 파일)을 입력하면 '입력 완료'로 바뀝니다.</div></div>
    </template>
  </div>`,
};

const SettingsView = {
  data: () => ({}),
  computed: {
    operator: { get() { return state.operator; }, set(v) { state.operator = v; ls.set('operatorName', v); } },
    counts() {
      const photos = state.diagnoses.reduce((n, d) => n + d.photos.length + d.results.reduce((m, r) => m + r.signatures.length, 0), 0);
      const spectra = state.diagnoses.reduce((n, d) => n + d.results.filter(r => r.spectrum).length, 0);
      return { sites: state.sites.length, diags: state.diagnoses.length, pending: pending.value.length, photos, spectra };
    },
    mode() { return state.mode; },
    modeLabel() { return state.modeLabel; },
    host() { try { return new URL(window.LIRA_CONFIG?.SUPABASE_URL || '').host; } catch { return ''; } },
  },
  methods: {
    exportJSON, exportCSV,
    async refresh() { await withBusy('새로 불러오는 중', () => reloadAll(true)); toast('최신 데이터로 갱신했습니다.'); },
    async reset() {
      const central = state.mode === 'supabase';
      const ok = central
        ? (await dialog({ title: '전체 초기화', text: '중앙 저장소의 모든 지역 데이터(진단·사진·스펙트럼)가 삭제되고 이관 자료만 남습니다.\n계속하려면 "초기화"를 입력하세요.', input: true, buttons: [{ label: '취소', value: false }, { label: '초기화', value: 'check', danger: true }] })) === '초기화'
        : await confirmBox('모든 입력 데이터를 지우고 예시 데이터로 되돌릴까요?', '초기화', true);
      if (!ok) return;
      try {
        await withBusy('초기화 중', async () => {
          await store.resetAll();
          specCache.clear();
          const seed = await (await fetch('seed.json')).json();
          await store.bulkInsert(seed.sites, seed.diagnoses);
          await reloadAll(true);
        });
        toast('예시 데이터로 초기화했습니다.');
      } catch (e) { reportError(e); }
    },
  },
  template: `<div class="page">
    <div class="sec"><div class="sec-h">측정자</div><div class="card"><div class="field"><input class="input" style="text-align:left" v-model="operator" placeholder="이름 (코멘트 작성자로 기록)"></div></div></div>
    <div class="sec"><div class="sec-h">데이터 저장소</div><div class="card">
      <div class="kv"><span class="k">방식</span><span class="v" :style="{color: mode === 'supabase' ? 'var(--teal)' : 'var(--orange)'}">{{ modeLabel }}</span></div>
      <div class="kv" v-if="host"><span class="k">서버</span><span class="v code">{{ host }}</span></div>
      <div class="row"><button class="linkbtn" @click="refresh">⟳ 최신 데이터 다시 불러오기</button></div>
    </div><div class="sec-f" v-if="mode !== 'supabase'">지금은 이 브라우저에만 저장됩니다. config.js에 Supabase 주소와 키를 넣으면 전국 담당자가 같은 데이터를 봅니다.</div>
      <div class="sec-f" v-else>전국 담당자가 올린 데이터가 한곳에 모입니다. 다른 사람이 저장하면 자동으로 반영됩니다.</div></div>
    <div class="sec"><div class="sec-h">데이터 현황</div><div class="card">
      <div class="kv"><span class="k">진단 구간</span><span class="v">{{ counts.sites }}개</span></div>
      <div class="kv"><span class="k">진단 기록</span><span class="v">{{ counts.diags }}건</span></div>
      <div class="kv"><span class="k">추가 입력 필요</span><span class="v">{{ counts.pending }}건</span></div>
      <div class="kv"><span class="k">사진</span><span class="v">{{ counts.photos }}장</span></div>
      <div class="kv"><span class="k">스펙트럼</span><span class="v">{{ counts.spectra }}개</span></div>
    </div></div>
    <div class="sec"><div class="sec-h">내보내기</div><div class="card">
      <div class="row"><button class="linkbtn" @click="exportJSON">⇪ 전체 이력 내보내기 (JSON)</button></div>
      <div class="row"><button class="linkbtn" @click="exportCSV">▦ DeltaG 이력 내보내기 (CSV·엑셀)</button></div>
    </div><div class="sec-f">구간·진단·사진 메타데이터를 내보냅니다. 사진·스펙트럼 원본은 저장소에 보관됩니다.</div></div>
    <div class="sec"><div class="sec-h">판단 기준 (표시용)</div><div class="card">
      <div class="kv"><span class="k">DeltaG 한국형 잠정기준</span><span class="v">양호 &lt; 20 ≤ 관찰 &lt; 25 ≤ 주의</span></div>
      <div class="kv"><span class="k">Wirescan 권고치</span><span class="v">65 / 75 (×10⁻³)</span></div>
      <div class="row xs sub">한국형 기준은 부산울산본부 63개 측정점 기반의 잠정값이며, 데이터가 쌓이면 갱신합니다.</div>
    </div></div>
    <div class="sec"><div class="card"><div class="row"><button class="linkbtn danger" @click="reset">예시 데이터로 초기화</button></div></div>
      <div class="sec-f">{{ mode === 'supabase' ? '중앙 저장소의 모든 입력 데이터가 삭제되고 이관 자료만 남습니다. 시연 준비용입니다.' : '입력한 모든 진단과 사진이 삭제되고 이관 자료만 남습니다.' }}</div></div>
    <div class="sec"><div class="sec-h">앱 정보</div><div class="card">
      <div class="kv"><span class="k">버전</span><span class="v">0.2 (웹 데모)</span></div>
      <div class="kv"><span class="k">제작</span><span class="v">(주)액트투</span></div>
    </div></div>
  </div>`,
};

// ===========================================================================
// 루트

const TAB_ICONS = {
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>',
  sites: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>',
  pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
};

const Root = {
  components: { MapView, SitesView, SiteView, NewView, DiagView, CompareView, PendingView, SettingsView },
  data: () => ({ tabs: [['map', '지도'], ['sites', '진단이력'], ['pending', '추가 입력'], ['settings', '설정']], icons: TAB_ICONS }),
  computed: {
    s() { return state; },
    r() { return state.route; },
    view() {
      const p = this.r.parts[0];
      return { sites: 'sites-view', site: 'site-view', new: 'new-view', diag: 'diag-view', compare: 'compare-view', pending: 'pending-view', settings: 'settings-view' }[p] || null;
    },
    pendingCount() { return pending.value.length; },
    header() {
      const p = this.r.parts; let title = '', backBtn = false, right = null;
      const newBtn = { label: '＋ 새 진단', action: () => go('/new') };
      switch (p[0]) {
        case 'map': title = '진단 이력 지도'; right = newBtn; break;
        case 'sites': title = '진단 이력'; right = newBtn; break;
        case 'pending': title = '추가 입력'; break;
        case 'settings': title = '설정'; break;
        case 'site': title = siteById(p[1])?.name || '구간'; backBtn = true; break;
        case 'diag': { const d = diagById(p[1]); title = d ? fmtDay(d.date) + ' 진단' : '진단'; backBtn = true; break; }
        case 'compare': title = 'Signature · 전후 비교'; backBtn = true; break;
        case 'new': title = '새 진단'; backBtn = true; break;
        default: title = 'LIRA 진단이력';
      }
      return { title, back: backBtn, right, left: null, ...(state.headerOverride || {}) };
    },
  },
  watch: {
    's.dialog'(v) { if (v && (v.input || v.textarea)) nextTick(() => { const el = document.querySelector('.dialog textarea, .dialog input'); if (el) el.focus(); }); },
  },
  methods: {
    back, switchTab,
    /** 붙여넣기 창: 붙여넣는 즉시 처리 (수만 줄을 입력칸에 그리면 느려지므로 칸에 넣지 않음) */
    dialogPaste(e) {
      if (!state.dialog || !state.dialog.submitOnPaste) return;
      const t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!t || !t.trim()) return;
      e.preventDefault();
      state.dialog.value = t;
      this.closeDialog('check');
    },
    closeDialog(v) { const dlg = state.dialog; state.dialog = null; if (v === 'check') v = dlg.value; dlg.resolve(v); },
  },
  template: `<div class="shell" v-if="s.ready">
    <header class="topbar">
      <div class="side">
        <button class="tbtn" v-if="header.left" @click="header.left.action()">{{ header.left.label }}</button>
        <button class="tbtn" v-else-if="header.back" @click="back()">‹ 뒤로</button>
      </div>
      <div class="title">{{ header.title }}</div>
      <div class="side right"><button class="tbtn" :class="{strong: header.right.strong}" v-if="header.right" :disabled="header.right.disabled" @click="header.right.action()">{{ header.right.label }}</button></div>
    </header>
    <div class="banner" v-if="s.mode === 'local'">로컬 모드 · 이 브라우저에만 저장됩니다</div>
    <main class="content">
      <map-view v-show="r.parts[0] === 'map'"></map-view>
      <component v-if="view" :is="view" :id="r.parts[1]" :key="r.full"></component>
    </main>
    <nav class="tabbar">
      <button v-for="t in tabs" :key="t[0]" class="tab" :class="{on: s.tab === t[0]}" @click="switchTab(t[0])">
        <span v-html="icons[t[0]]"></span><span>{{ t[1] }}</span>
        <span class="badge" v-if="t[0] === 'pending' && pendingCount">{{ pendingCount }}</span>
      </button>
    </nav>
    <div class="toast" v-if="s.toast">{{ s.toast }}</div>
    <div class="busy" v-if="s.busy"><div>⏳ {{ s.busy }}</div></div>
    <div class="overlay" v-if="s.dialog" style="align-items:center">
      <div class="dialog">
        <h3>{{ s.dialog.title }}</h3>
        <p v-if="s.dialog.text">{{ s.dialog.text }}</p>
        <input v-if="s.dialog.input" class="boxinput" style="margin-bottom:12px" v-model="s.dialog.value">
        <textarea v-if="s.dialog.textarea" class="boxinput mono" style="margin-bottom:12px;height:180px;font-size:12px;white-space:pre;resize:vertical" v-model="s.dialog.value" :placeholder="s.dialog.placeholder || ''" @paste="dialogPaste"></textarea>
        <div class="btnrow"><button v-for="b in s.dialog.buttons" :key="b.label" class="btn" :class="{prim: b.prim, danger: b.danger}" @click="closeDialog(b.value)">{{ b.label }}</button></div>
      </div>
    </div>
  </div>
  <div v-else-if="s.fatal" class="errorbox">
    <h3 style="margin-top:0">데이터를 불러오지 못했습니다</h3>
    <p class="code small" style="white-space:pre-wrap">{{ s.fatal }}</p>
    <p class="small">중앙 저장소(Supabase)를 쓰는 경우 config.js의 주소·키와 setup.sql 실행 여부를 확인하세요. 무료 프로젝트는 1주일 동안 사용하지 않으면 일시 정지되므로 Supabase 대시보드에서 다시 시작해야 합니다.</p>
    <button class="btn prim" onclick="location.reload()">다시 시도</button>
  </div>
  <div v-else style="padding:60px;text-align:center" class="sub">불러오는 중…</div>`,
};

// ===========================================================================
// 시작

async function init() {
  syncRoute();
  try {
    if (!window.Vue || !window.L) throw new Error('라이브러리(Vue·Leaflet)를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
    store = await createStore(window.LIRA_CONFIG);
    state.mode = store.mode; state.modeLabel = store.label;
    let data = await store.loadAll();
    if (!data.sites.length) {
      const seed = await (await fetch('seed.json')).json();
      await store.bulkInsert(seed.sites, seed.diagnoses);
      data = await store.loadAll();
    }
    state.sites = data.sites; state.diagnoses = data.diagnoses;
    lastReload = Date.now();
    store.subscribe(applyRemote);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.mode === 'supabase') reloadAll(); });
    state.ready = true;
  } catch (e) {
    console.error(e);
    state.fatal = e?.message || String(e);
  }
}

const app = createApp(Root);
app.config.globalProperties.fmtDay = fmtDay;
app.config.globalProperties.state = state;
app.mount('#app');
init();
