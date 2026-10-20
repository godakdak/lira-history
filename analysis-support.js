// ANL 보강값은 화면 전용으로 보관한다. 저장소의 진단 객체를 수정하지 않는다.
export function createAnalysisMetadata(loadAnl) {
  const paths = new Map(), refs = new WeakMap(), warnings = new WeakMap();
  return {
    get(ref) { return refs.get(ref) ?? ref?.lira ?? {}; },
    warning(ref) { return warnings.get(ref) ?? ''; },
    async read(ref) {
      if (refs.has(ref)) return this.get(ref);
      const old = ref?.lira ?? {};
      const path = ref?.raw?.find(p => /\.anl$/i.test(p));
      if (!path || (old.masterMode != null && old.analysisLength != null && old.windowCode != null)) {
        refs.set(ref, old);
        return old;
      }
      try {
        if (!paths.has(path)) paths.set(path, Promise.resolve().then(() => loadAnl(path)));
        const a = await paths.get(path);
        const merged = {...old,
          inputLength:a.inputLength??old.inputLength,
          analysisLength:a.analysisLength??old.analysisLength??old.length,
          length:a.length??old.length, masterMode:a.masterMode??old.masterMode,
          peakTolerancePct:a.peakTolerancePct??old.peakTolerancePct,
          algorithm:a.algorithm??old.algorithm, windowCode:a.windowCode??old.windowCode,
          vr:a.vr??old.vr, bandHz:a.bandPct*a.maxFreqMHz*1e4||old.bandHz};
        refs.set(ref, merged);
        warnings.delete(ref);
        return merged;
      } catch {
        paths.delete(path);
        warnings.set(ref, 'ANL을 읽지 못해 기존 분석 설정을 사용합니다. 저장 모드를 확인하세요.');
        return old;
      }
    },
  };
}

// VLF/전산 긍장 기준 위치 ↔ 분석 거리. 양 끝의 상대 위치를 보존한 뒤 반전한다.
// 범위 밖의 접속점을 경계로 강제 이동하지 않는다.
export function mapCableDistance(distance, fromLength, toLength, reversed=false) {
  if (!(fromLength>0 && toLength>0 && [fromLength,toLength,distance].every(Number.isFinite))
      || distance<0 || distance>fromLength) return null;
  const d=distance*toLength/fromLength;
  return reversed ? toLength-d : d;
}
