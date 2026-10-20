import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as S from './signature.js';

test('복소 FFT는 직접 DFT와 일치하고 기존 크기를 보존한다',()=>{
  const x=Float64Array.from({length:23},(_,i)=>Math.sin(i*.47)+.3*Math.cos(i*.22));
  const r=S.realFFTComplex(x,6,32),mag=S.realFFTMagnitude(x,6,32);
  for(let k=0;k<32;k++) {
    let re=0,im=0;for(let i=0;i<x.length;i++){re+=x[i]*Math.cos(-2*Math.PI*k*i/64);im+=x[i]*Math.sin(-2*Math.PI*k*i/64);}
    assert.ok(Math.abs(r.real[k]-re)<1e-12);assert.ok(Math.abs(r.imag[k]-im)<1e-12);
    assert.equal(mag[k],r.magnitude[k]);
  }
});

test('DNORM은 SD와 Norm 표시에서 독립적이고 Re/Im은 위상과 일치한다',()=>{
  const r={step:2,values:new Float64Array([12,10,8]),real:new Float64Array([3,3,3]),imag:new Float64Array([4,4,4])};
  const n={slope:.5,sd:3,sigma:1};
  const a=S.dnormAt(r,n,2,2),b=S.dnormAt(r,{...n,sd:15,sigma:2},2,2);
  assert.deepEqual(a,b);assert.ok(Math.abs(a.dnorm-100*9/37)<1e-12);
  assert.ok(Math.abs(a.angleDeg-Math.atan2(4,3)*180/Math.PI)<1e-12);
  assert.ok(Math.abs(a.real-.6*a.dnorm)<1e-12);assert.ok(Math.abs(a.imag-.8*a.dnorm)<1e-12);
});

test('고대역 내부 반사가 강해져도 기준 종단은 바뀌지 않는다',()=>{
  const n=10000,df=2500,L=954,vr=.53;
  const phase=Float64Array.from({length:n},(_,i)=>{
    const f=(i+1)*df;
    return (15*Math.exp(-f/7e6))*Math.cos(2*Math.PI*f*2*L/(S.C*vr))+
      (f>10e6?18:1)*Math.cos(2*Math.PI*f*2*650/(S.C*vr));
  });
  const s=S.makeSpectrum('synthetic',df,df,phase);
  const anchor=S.terminalAnchor(s,'4 Term B-H',L,{referenceBandwidthHz:7e6,savedVR:vr});
  assert.ok(anchor);assert.equal(anchor.status,'candidate');assert.ok(Math.abs(anchor.vr-vr)<.001);
  const oldHigh=S.estimateVR(s,25e6,'4 Term B-H',L);
  assert.ok(Math.abs(oldHigh-vr)>.1,'기존 전체 최댓값 탐지가 내부 반사로 바뀌는 합성 사례');
  for(const band of [7e6,15e6,25e6]) {
    const tracked=S.terminalAtBand(s,band,'4 Term B-H',L,anchor);
    assert.equal(tracked.status,'tracked');
    assert.ok(Math.abs(tracked.vr-vr)<.001);
    const r=S.computeSignature(s,band,'4 Term B-H',tracked.vr,L*1.1);
    // 종단 주변에서만 확인한다. 가장 큰 내부 반사를 종단으로 다시 선택하지 않는다.
    let best=0,at=0;for(let i=0;i<r.values.length;i++)if(Math.abs(i*r.step-L)<5 && (!best||r.values[i]>best)){best=r.values[i];at=i*r.step;}
    assert.ok(Math.abs(at-L)<3);
  }
});

test('종단 정보가 없는 평탄 입력은 자동 판정을 만들지 않는다',()=>{
  const s=S.makeSpectrum('flat',2500,2500,new Float64Array(10000));
  assert.equal(S.terminalAnchor(s,'4 Term B-H',954).status,'unresolved');
});

test('0 Hz 보충에 따른 위상 회전은 첫 측정 표본 원점을 사용한다',()=>{
  // 동일 벡터에 한 표본 지연 exp(-j2πk/N)이 붙은 경우 이를 제거한다.
  const k=3,N=32,theta=.4,shift=2*Math.PI*k/N;
  const r={step:1,values:new Float64Array(8).fill(12),
    real:new Float64Array(8).fill(Math.cos(theta-shift)),
    imag:new Float64Array(8).fill(Math.sin(theta-shift)),prepend:1,npad:N};
  const p=S.dnormAt(r,{slope:0,sd:1,sigma:1},k);
  assert.ok(Math.abs(p.angleDeg-theta*180/Math.PI)<1e-12);
});

test('정규화도 추적한 종단을 사용하고 근처의 강한 내부 반사를 다시 선택하지 않는다',()=>{
  const values=Float64Array.from({length:120},(_,i)=>-20+Math.sin(i));
  values[89]=10;values[90]=30;values[91]=10;
  values[99]=0;values[100]=20;values[101]=0;
  const r={step:1,values,resolutionM:1};
  const old=S.makeNormalization(r,100,1),tracked=S.makeNormalization(r,100,1,100);
  assert.equal(old.endDistance,90);assert.equal(tracked.endDistance,100);
  assert.equal(tracked.slope,(39-20)/100);
});
