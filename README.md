# 실시간 자막 (EN → KO)

영어 발화를 실시간으로 한국어 자막으로 띄우는 웹앱. 마이크로 들어온 영어를
OpenAI `gpt-realtime-translate`로 번역해, **스포티파이 가사처럼** 현재 문장이
화면 중앙에 크게 뜨고 지난 줄은 위로 흐려지며 흘러갑니다. 정지하면 **원본
녹음(.webm)** 과 **한국어 자막 전문(.txt)** 이 자동 다운로드됩니다.

## 동작 구조

```
브라우저(마이크 캡처 + 자막 + 녹음)
        │  ① GET /api/token  →  ~1분짜리 임시 토큰 발급 (실제 키는 서버에만)
        │  ② 그 토큰으로 OpenAI에 직접 WebSocket 연결 (subprotocol 인증)
        ▼
   OpenAI Realtime  (gpt-realtime-translate, 출력 언어 ko)
```

- **API 키는 서버(Vercel 함수 / 로컬 Node)에만** 있고, 브라우저엔 1분짜리 임시
  토큰만 전달됩니다.
- 마이크(`getUserMedia`)는 **https 또는 localhost에서만** 동작합니다. 폰에서
  쓰려면 Vercel 배포(https)가 필요합니다.

## 빠른 시작 (로컬, 사람·마이크 없이도 확인 가능)

```bash
npm install
cp .env.example .env        # .env 안에 OPENAI_API_KEY 채우기
npm start
```

http://localhost:3000 을 브라우저에서 열고:

- **▷ 데모 보기 (샘플 음성)** — 번들된 영어 샘플을 흘려보내 자막을 시연합니다.
  마이크·발표자 없이 동작/디자인을 바로 확인할 수 있어요. (샘플은
  `npm run sample` 으로 먼저 생성)
- **▶ 시작하기** — 실제 마이크로 영어를 듣고 번역합니다.

> 폰에서 `http://노트북IP:3000` 로 접속하면 https가 아니라 마이크가 막힙니다.
> 폰 테스트는 아래 Vercel 배포로 하거나, `ngrok http 3000` 같은 터널로 https
> 주소를 받으세요.

## 배포 (Vercel — 폰에서 쓰려면 이 방법)

```bash
npm i -g vercel
vercel                      # 배포 (질문에 기본값 엔터)
vercel env add OPENAI_API_KEY   # 키 입력 (Production 선택)
vercel --prod               # 키 반영해 재배포
```

나오는 `https://...vercel.app` 주소를 **폰 브라우저에서 열고** → 시작 → 마이크
허용. 폰을 가로로 눕히고 글자를 키우면 가독성이 가장 좋습니다.

## 사용 / 다운로드

- **시작/데모** → 한국어 자막이 흐름. 상단 바는 3초 뒤 자동으로 숨음(화면 탭하면 다시 표시).
- **A− / A+** 글자 크기, **⛶** 전체화면.
- **정지** → 자동 다운로드:
  - `녹음-YYYYMMDD-HHMM.webm` — 원본 마이크 음성
  - `자막-YYYYMMDD-HHMM.txt` — 한국어 자막 전문

## 검증 하니스 (선택)

마이크·브라우저 없이 번역 파이프라인을 터미널에서 검증합니다.

```bash
npm run sample   # 영어 음성 샘플 생성 (OpenAI TTS → harness/sample.pcm)
npm run verify   # 그 샘플을 번역 WS에 스트리밍 → 한국어 번역 + 지연(ms) 출력
```

`SAMPLE_TEXT="..." npm run sample` 로 다른 문장도 테스트할 수 있습니다.

## 파일

- `public/index.html` — 자막 UI 전부 (마이크 캡처·번역·큐 렌더링·녹음·다운로드)
- `public/pcm-worklet.js` — 마이크 오디오를 24kHz PCM16으로 변환
- `api/token.js` — Vercel 서버리스 함수: 임시 토큰 발급
- `server.js` — 로컬 개발 서버 (토큰 발급 + 정적 서빙, Vercel 동작을 미러)
- `harness/` — 헤드리스 검증 스크립트
- `vercel.json` — 배포 설정

## 비용

분당 약 $0.034 (오디오 길이 기준). 30분 챗 ≈ $1, 1시간 리허설 ≈ $2.
검증 하니스는 회당 몇 센트(TTS + 번역).

## 현장 팁

- 마이크를 발표자 쪽으로 향하게 두면 정확도가 올라갑니다.
- 행사 전에 한 번 리허설로 지연·품질을 확인하세요.
- iOS Safari / 안드로이드 Chrome 모두 동작. 폰 자동잠금을 잠시 꺼두면 화면이 안 꺼집니다.

## 커스터마이징

`public/index.html` 상단 상수:

- 출력 언어: `api/token.js` 의 `audio.output.language` 와 `index.html` 의
  `session.update` 두 곳 (기본 `ko`).
- `MAX_LINES` — 화면에 남는 자막 줄 수.
- `BASE_CPS` / `MAX_CPS` — 자막이 풀리는 속도(초당 글자 수). 큐가 밀리면
  `MAX_CPS`까지 빨라져 음성을 따라잡습니다.

## 알려진 한계

- OpenAI의 한국어 번역 출력이 가끔 두 단어를 공백 없이 붙여 보냅니다
  (예: `모델은작은`). 원본 출력 자체의 문제로, 빈도는 낮습니다.
- 폰 실기기 + 현장 마이크 환경은 별도 리허설로 확인하세요.
