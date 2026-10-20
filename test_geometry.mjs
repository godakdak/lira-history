import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as S from './signature.js';
import {readAnl} from './lira.js';
import {createAnalysisMetadata,mapCableDistance} from './analysis-support.js';

const win='4 Term B-H';
function fixture(end=25,vr=.546379) {
  const df=10000,phase=Float64Array.from({length:10000},(_,i)=>{
    const f=(i+1)*df;
    return 15*Math.cos(2*Math.PI*f*2*end/(S.C*vr))
      +4*Math.cos(2*Math.PI*f*2*8/(S.C*vr));
  });
  return S.makeSpectrum('length-mode-fixture',df,df,phase);
}
const base={analysisLength:25,savedVR:.546379,referenceBandwidthHz:50e6,peakTolerancePct:15};

test('ANL의 입력 긍장과 분석 길이·모드·피크 허용폭을 구분한다',()=>{
  const a=readAnl('[Operation]\nLength="31"\n[Analyzer]\nSegLen0=24.354594\nSegVR0=.546379\nMasterMode=2\n[HotSpot]\ntolerance=15');
  assert.equal(a.inputLength,31);assert.equal(a.length,24.354594);
  assert.equal(a.analysisLength,24.354594);assert.equal(a.masterMode,2);
  assert.equal(a.peakTolerancePct,15);
});
test('VR 모드는 전산31m와 무관하게 VR을 고정하고 실제25m를 구한다',()=>{
  for(const bandwidthHz of [30e6,50e6,90e6]) {
    const g=S.resolveAnalysisGeometry(fixture(),win,31,{...base,masterMode:2,bandwidthHz});
    assert.equal(g.status,'tracked');assert.equal(g.vr,base.savedVR);
    assert.ok(Math.abs(g.length-25)<.03);assert.equal(g.inputLength,31);
    assert.ok(Math.abs(g.length-g.vr*S.C*g.roundTripDelaySeconds/2)<1e-10);
  }
});
test('LEN 선택은 길이를 고정하고 같은 종단 지연에서 VR만 바꾼다',()=>{
  const g=S.resolveAnalysisGeometry(fixture(),win,31,{...base,masterMode:2,mode:'length',bandwidthHz:50e6});
  assert.equal(g.status,'tracked');assert.equal(g.length,31);
  assert.ok(Math.abs(g.vr-.546379*31/25)<.001);
});
test('수동 모드는 길이와 VR을 그대로 유지한다',()=>{
  const g=S.resolveAnalysisGeometry(fixture(),win,31,{...base,masterMode:0,bandwidthHz:50e6});
  assert.equal(g.status,'tracked');assert.equal(g.length,25);assert.equal(g.vr,.546379);
});
test('VR 누락과 CAP 모드는 임의 길이를 만들지 않는다',()=>{
  const s=fixture();
  assert.equal(S.resolveAnalysisGeometry(s,win,31,{...base,savedVR:null,masterMode:2}).status,'unresolved');
  assert.equal(S.resolveAnalysisGeometry(s,win,31,{...base,masterMode:3}).status,'unresolved');
});
test('저장 종단 주변의 더 큰 별도 내부 반사를 종단으로 바꾸지 않는다',()=>{
  const df=10000,vr=.546379,L=150;
  const phase=Float64Array.from({length:10000},(_,i)=>{
    const f=(i+1)*df;
    return 15*Math.cos(2*Math.PI*f*2*L/(S.C*vr))
      +25*Math.cos(2*Math.PI*f*2*130/(S.C*vr));
  });
  const s=S.makeSpectrum('nearby-strong-internal',df,df,phase);
  const g=S.resolveAnalysisGeometry(s,win,146,{...base,analysisLength:L,masterMode:2,bandwidthHz:80e6});
  assert.equal(g.status,'tracked');assert.ok(Math.abs(g.length-L)<.05);
});

test('Algorithm OFF는 저장 VR 모드라도 길이와 VR을 고정한다',()=>{
  assert.equal(readAnl('[Analyzer]\nAlgorithm=False').algorithm,false);
  const g=S.resolveAnalysisGeometry(fixture(),win,31,{...base,analysisLength:25.2,
    masterMode:2,algorithm:false,bandwidthHz:50e6});
  assert.equal(g.mode,'manual');assert.equal(g.length,25.2);assert.equal(g.vr,.546379);
});
test('종단 없는 수동 파형을 계산 오류나 DNORM 0으로 바꾸지 않는다',()=>{
  const s=S.makeSpectrum('flat',10000,10000,new Float64Array(10000));
  const g=S.resolveAnalysisGeometry(s,win,31,{...base,masterMode:0,bandwidthHz:50e6});
  assert.equal(g.status,'manual');assert.equal(g.length,25);assert.equal(g.terminalDistance,null);
  const r=S.computeSignature(s,50e6,win,g.vr,27);
  assert.deepEqual(S.dnormPeaks(r,null,g.length),[]);
});
test('전산 접속점은 분석 길이에 비례 환산한 뒤 측정 방향을 반전한다',()=>{
  const d=mapCableDistance(20,31,24.33,true);
  assert.ok(Math.abs(d-(24.33-20*24.33/31))<1e-10);
  assert.ok(Math.abs(mapCableDistance(24.33-d,24.33,31)-20)<1e-10);
  assert.equal(mapCableDistance(32,31,24.33),null);
  assert.equal(mapCableDistance(20,null,24.33),null);
});
test('ANL 보강은 기존 참조를 바꾸지 않고 동일 파일을 한번만 읽는다',async()=>{
  let reads=0;
  const cache=createAnalysisMetadata(async()=>{reads++;return {
    inputLength:31,analysisLength:24.35,length:24.35,masterMode:2,vr:.546379};});
  const ref={fileName:'a.txt',raw:['a.anl'],lira:{length:31,norm:{sd:2}}};
  const before=JSON.stringify(ref);
  const a=await cache.read(ref),b=await cache.read(ref);
  assert.equal(reads,1);assert.equal(a,b);assert.equal(cache.get(ref).masterMode,2);
  assert.equal(JSON.stringify(ref),before);assert.equal(a.norm.sd,2);
});
test('ANL 접근 실패는 기존 설정을 보존하고 경고를 반환한다',async()=>{
  const cache=createAnalysisMetadata(async()=>{throw Error('unavailable');});
  const ref={raw:['missing.anl'],lira:{length:31,vr:.546379}};
  const result=await cache.read(ref);
  assert.equal(result,ref.lira);assert.match(cache.warning(ref),/ANL/);
});
test('일시적인 ANL 실패 뒤 다음 읽기는 다시 시도하고 경고를 지운다',async()=>{
  let n=0;
  const cache=createAnalysisMetadata(async()=>{
    if(n++===0)throw Error('temporary');
    return {analysisLength:24.35,masterMode:2};
  });
  const ref={raw:['retry.anl'],lira:{length:31}};
  await cache.read(ref);
  assert.equal((await cache.read(ref)).analysisLength,24.35);
  assert.equal(cache.warning(ref),'');assert.equal(n,2);
});
