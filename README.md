# LIRA 진단이력 — 웹 버전 (데모)

Swift Playgrounds 데모와 같은 기능을 하는 웹 페이지입니다. 아이폰·아이패드·PC 브라우저에서 같은 주소로 열고, **전국 본부 담당자가 올린 측정 데이터가 한곳(중앙 저장소)에 모입니다.**

- 화면: 지도 · 진단이력 · 추가 입력 · 설정 / 구간 상세 · 새 진단(현장) · 진단 상세(사무실) · Signature 전후·상간 비교
- 새 기능: LIRA 측정 파일(.lira·.anl·.out·.sdt)을 그대로 불러오기 → 상·DeltaG·긍장·분석대역 자동 입력, LIRA 분석값 그대로의 Normalized 기준선(0 dB)·1SD
- 로그인 없음 (데모)

## 구조

```
GitHub Pages (무료)  ── 화면(HTML·JS) 제공
        │
        ▼
Supabase (무료)      ── 데이터베이스(구간·진단) + 파일 저장소(사진·스펙트럼·LIRA 원본)
```

GitHub Pages는 파일을 보여주기만 하고 데이터를 저장할 수 없으므로, 저장은 Supabase 무료 플랜을 씁니다.
Supabase를 연결하지 않으면 **로컬 모드**(그 브라우저에만 저장)로 동작하므로, 먼저 화면만 확인해 볼 수도 있습니다.

| 파일 | 역할 |
|---|---|
| `index.html` | 시작 페이지 |
| `app.js` | 화면과 동작 전체 |
| `signature.js` | Signature 계산 (FFT·윈도우·감쇠보정·Normalized) |
| `lira.js` | LIRA 측정 파일 읽기 |
| `store.js` | 저장소 연결 (Supabase / 로컬) — 나중에 한전 서버로 옮길 때 이 파일만 교체 |
| `config.js` | **Supabase 주소·키 입력하는 곳** |
| `styles.css` | 화면 모양 |
| `seed.json`, `seed_susan6.jpg`, `seed_susan9.jpg` | 이관 자료(예시 데이터) |
| `icon.png` | 아이콘 |
| `setup.sql` | Supabase 초기 설정 스크립트 (사이트에는 올리지 않아도 됨) |

---

## 1단계 — Supabase 준비 (약 10분)

1. https://supabase.com 가입 → **New project**
   - Region: **Northeast Asia (Seoul)** 권장
   - Database password는 아무 값이나 (앱에서는 쓰지 않음)
2. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor** → **New query**
3. `setup.sql` 내용을 통째로 붙여넣고 **Run** → 마지막에 `sites_count 0`, `diagnoses_count 0`이 나오면 성공
   (테이블 2개, 파일 저장소 `lira`, 데모용 접근 권한, 실시간 반영이 한 번에 설정됩니다. 여러 번 실행해도 안전)
4. 주소와 키 복사
   - **Project URL**: `https://xxxxxxxx.supabase.co` (대시보드 상단 **Connect** 버튼 또는 Project Settings → Data API)
   - **Publishable key** (`sb_publishable_...`) 또는 **anon public** key (Project Settings → API Keys)
   - ⚠️ `secret` / `service_role` 키는 절대 넣지 마세요.

## 2단계 — config.js 수정

```js
window.LIRA_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_KEY: 'sb_publishable_xxxxxxxxxxxx',
};
```

## 3단계 — GitHub Pages에 올리기

1. GitHub 로그인 → 오른쪽 위 **+** → **New repository**
   - 이름 예: `lira-history`, **Public** 선택 (무료 계정의 Pages는 Public 저장소에서만 됩니다)
2. 저장소 화면에서 **Add file → Upload files** → 위 표의 파일들을 폴더 없이 그대로 끌어다 놓고 **Commit changes**
3. **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main** / **(root)** → **Save**
4. 1~2분 뒤 `https://<깃허브아이디>.github.io/lira-history/` 로 접속
   - 첫 접속 시 이관 자료(36개 구간·37건)가 중앙 저장소에 자동으로 채워집니다.
   - 설정 탭 → 데이터 저장소가 **중앙 저장소 (Supabase)** 로 보이면 연결 성공입니다.
5. 아이폰: Safari로 열고 **공유 → 홈 화면에 추가** 하면 앱처럼 쓸 수 있습니다.

파일을 고친 뒤에는 같은 방법으로 다시 올리면(같은 이름 덮어쓰기) 몇 분 안에 반영됩니다.

---

## 사용 흐름

**현장 (아이폰)** — `＋ 새 진단`
1. 명판·전경 사진 (보관함 또는 촬영). ★ 대표사진의 GPS로 위치를 잡고, 반경 500 m 안의 기존 구간을 찾아 줍니다.
2. 기존 구간 선택 또는 새 구간 등록 → 측정 상·측정단·측정자 → **현장 저장**

**사무실 (PC)** — `추가 입력` 탭에서 빠진 항목이 있는 진단을 열고
- **📂 LIRA 측정 파일 한 번에 불러오기**: 측정 폴더에서 같은 이름의 `.lira .anl .out .sdt` 파일을 여러 상 한꺼번에 선택(또는 끌어다 놓기)
  - 상: 측정 설명의 `Phase A/B/C/N` → 없으면 파일 이름 → 그래도 없으면 물어봄
  - DeltaG(.out), 긍장·분석대역(.anl), LIRA 정규화 기준선(.sdt) 자동 반영
  - `.lira`는 필수, 나머지는 선택 (`.anl`이 없으면 직렬 인덕턴스 보정을 못 해 그래프가 조금 달라질 수 있음)
- 기존 방식의 스펙트럼 텍스트(.txt)도 그대로 됩니다 (파일 이름 끝 `_A` `_B` `_C` `_N`으로 상 구분).

**분석** — 구간 화면 → `Signature · 전후 비교`
- 전후 비교(같은 상, 여러 날짜) / 상간 비교(같은 날짜, A·B·C·N)
- 분석 대역폭 슬라이더, Normalized + 2SD·3SD 선, 반전, VR 직접 입력(TDR m/μs 함께 표시)
- 대역폭이 LIRA 분석대역과 같고(±2%) 윈도우가 4 Term B-H이면 0 dB 기준선·1SD는 **LIRA 분석값**(.sdt)을 그대로 씁니다. 범례에 `기준선 LIRA 분석값`으로 표시됩니다.

---

## 꼭 알아 둘 점 (데모 한계)

- **로그인이 없습니다.** 웹 주소를 아는 사람은 누구나 보고, 고치고, 지울 수 있습니다. 주소는 관계자에게만 알리고, 시연 단계에서는 민감한 실데이터를 최소화하세요. config.js의 키는 원래 공개되는 값이라 노출 자체는 정상입니다.
- 설정 탭의 **예시 데이터로 초기화**는 중앙 저장소의 모든 입력을 지웁니다 (`초기화`를 직접 입력해야 실행).
- **Supabase 무료 플랜 한도**: 데이터베이스 500 MB, 파일 1 GB(사진은 긴 변 1600px로 줄여 저장 → 약 3,000장), 월 전송량 5 GB, 파일 1개 50 MB.
- **1주일 동안 아무도 접속하지 않으면 Supabase 프로젝트가 일시 정지**됩니다. 화면에 "데이터를 불러오지 못했습니다"가 나오면 Supabase 대시보드에서 **Restore/Resume** 하세요(데이터는 남아 있음).
- 같은 진단을 두 사람이 동시에 고치면 **나중에 저장한 쪽**이 남습니다.
- 다른 담당자가 저장하면 열려 있는 화면에 자동 반영됩니다. 반영이 늦으면 설정 → **최신 데이터 다시 불러오기**.
- 아이폰 Safari에서 보관함 사진을 고르면 GPS 정보가 빠지는 경우가 있습니다. 그때는 **📷 촬영**(촬영 시 기기 위치 기록)이나 **◎ 현재 기기 위치**, **📌 지도에서 지정**을 쓰세요. HEIC 사진은 PC 브라우저에서 열리지 않을 수 있습니다(JPEG로 올리기).
- 지도는 OpenStreetMap을 씁니다.

## 실제 운영으로 넘어갈 때

1. Supabase Auth로 로그인 추가 → 본부별 권한 정책(RLS)으로 `setup.sql`의 "demo" 정책 교체
2. 한전 내부 서버로 옮길 경우 `store.js`만 새 서버 API에 맞게 바꾸면 화면 코드는 그대로 쓸 수 있습니다.
3. 판단 기준(DeltaG 한국형 잠정기준 20/25)은 `app.js`의 `dgGrade`에서 조정합니다.
