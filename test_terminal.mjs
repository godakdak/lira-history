// 실제 문제 자료와 합성 측정으로 terminal-v2를 회귀 검증한다. VLF 값은 사용하지 않는다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as S from './signature.js';
import fs from 'node:fs';
const local=fs.existsSync(new URL('../../claude-dashboard/compute.mjs',import.meta.url))?await import('../../claude-dashboard/compute.mjs'):null;
const {load,compute}=local??{};
const win='4 Term B-H';
const response=(peaks)=>S.makeSpectrum('synthetic',10000,10000,Float64Array.from({length:10000},(_,i)=>
  peaks.reduce((v,[m,a])=>v+a*Math.cos(2*Math.PI*(i+1)*10000*2*m/(S.C*.6)),0)));
test('수동 고정 길이 가까이 있는 약한 신호가 강한 검출 종단을 대체하지 않는다',()=>{
 const s=response([[130,25],[150,5]]),g=S.resolveAnalysisGeometry(s,win,150,
 {analysisLength:150,savedVR:.6,masterMode:0,referenceBandwidthHz:50e6,bandwidthHz:80e6,peakTolerancePct:20});
 assert.equal(g.status,'tracked');assert.equal(g.length,150);assert.equal(g.vr,.6);
 assert.ok(Math.abs(g.terminalDistance-130)<.01);
});
test('저장 길이 근처의 낮은 부엽보다 실제 반사 피크를 선택한다',()=>{
 const g=S.resolveAnalysisGeometry(response([[72,15],[25,2]]),win,80,
 {analysisLength:80,savedVR:.6,masterMode:2,referenceBandwidthHz:40e6,bandwidthHz:40e6,peakTolerancePct:20});
 assert.equal(g.status,'tracked');assert.ok(Math.abs(g.length-72)<.01);
});
test('저장 창이 미지원이면 표시 창으로 대체하여 확정하지 않는다',()=>{
 const g=S.resolveAnalysisGeometry(response([[100,15]]),win,100,
 {analysisLength:100,savedVR:.6,masterMode:2,referenceWindowName:null,bandwidthHz:40e6});
 assert.equal(g.status,'unresolved');assert.match(g.note,/창 함수/);
});
test('암남7-3 C 분리 피크는 저대역 분해능으로 묶지 않으며 조작 순서와 무관하다',{skip:!local},()=>{
 const d=load('AmNam7-3_20260413-154425.lira');
 const options={...d.geometryOptions,bandwidthHz:18.129e6};
 const before=S.resolveAnalysisGeometry(d.spectrum,win,d.inputLength,options);
 for(const hz of [50e6,16e6,25e6])S.resolveAnalysisGeometry(d.spectrum,win,d.inputLength,{...options,bandwidthHz:hz});
 const after=S.resolveAnalysisGeometry(d.spectrum,win,d.inputLength,options);
 assert.equal(before.status,'ambiguous');assert.deepEqual(after,before);
 assert.ok(before.terminalAudit.trackingMarginDB<3);
});
test('남포·온산 수동 종단 및 범내5 VR 길이는 원래 고정량과 구분한다',{skip:!local},()=>{
 for(const [file,fixed,end]of [['_NampoSW_11_20260114-103926.lira',150,127.6785],['OnSan316H2_20260309-112809.lira',115,103.5515]]) {
  const d=load(file),r=compute(file,{mhz:d.savedHz/1e6});
  assert.equal(r.status,'ok');assert.equal(r.length,fixed);assert.ok(Math.abs(r.terminal.terminalDistance-end)<.01);
  assert.ok(r.detected.every(p=>p.distance<r.evaluationLength-r.resolution));
 }
 const file='BeumNea5_20260326-101529.lira',d=load(file),r=compute(file,{mhz:d.savedHz/1e6});
 assert.equal(r.inputLength,31);assert.ok(Math.abs(r.length-24.332719)<.002);assert.equal(r.terminal.vr,.546379);
});
test('저장 Hamming 창과 현재 BH 창이 다르면 SDT 정규화를 재사용하지 않는다',{skip:!local},()=>{
 const file='GoRea41_20260317-112703.lira',d=load(file),r=compute(file,{mhz:d.savedHz/1e6});
 assert.equal(d.anl.windowCode,2);assert.equal(r.status,'ok');assert.notEqual(r.norm.source,'LIRA 분석값');
 assert.equal(r.terminal.anchor.referenceWindowName,'Hamming');
});
test('낮은 저장 VR에서도 허용 탐색 상한 전체를 계산한다',()=>{
 const vr=.2,L=150,df=10000;
 const s=S.makeSpectrum('low-vr',df,df,Float64Array.from({length:10000},(_,i)=>15*Math.cos(2*Math.PI*(i+1)*df*2*L/(S.C*vr))));
 const g=S.resolveAnalysisGeometry(s,win,L,{analysisLength:L,savedVR:vr,masterMode:2,
 referenceBandwidthHz:50e6,bandwidthHz:80e6,peakTolerancePct:20});
 assert.equal(g.status,'tracked');assert.ok(Math.abs(g.length-L)<.01);
});
test('추적 반경 밖의 강한 반사를 놓치고 작은 봉우리를 확정하지 않는다',()=>{
 const anchor={status:'candidate',delayDistance:100/.6,referenceResolutionM:3,peakTolerancePct:20,
 searchLow:80/.6,searchHigh:120/.6,method:'test'};
 const g=S.terminalAtBand(response([[100,1],[105,15]]),80e6,win,100,anchor);
 assert.equal(g.status,'ambiguous');assert.match(g.note,/반경 밖/);
});
test('수동 종단이 고정 길이 바깥에 있어도 정규화 피크를 잘라 쓰지 않는다',()=>{
 const s=response([[120,15]]),g=S.resolveAnalysisGeometry(s,win,100,{analysisLength:100,savedVR:.6,
 masterMode:0,referenceBandwidthHz:50e6,bandwidthHz:80e6,peakTolerancePct:30});
 assert.equal(g.status,'tracked');assert.equal(g.length,100);assert.ok(Math.abs(g.terminalDistance-120)<.01);
 const r=S.computeSignature(s,80e6,win,g.vr,Math.max(g.length,g.terminalDistance)*1.122);
 const n=S.makeNormalization(r,g.length,1,g.terminalDistance);assert.ok(Math.abs(n.endDistance-120)<.01);
});
test('유효하지 않은 tolerance를 임의 기본값으로 고치지 않는다',()=>{
 for(const peakTolerancePct of [0,-1,101,NaN]) {
  const g=S.resolveAnalysisGeometry(response([[100,15]]),win,100,{analysisLength:100,savedVR:.6,
  masterMode:1,referenceBandwidthHz:50e6,bandwidthHz:80e6,peakTolerancePct});
  assert.equal(g.status,'unresolved');assert.match(g.note,/tolerance/);
 }
});
