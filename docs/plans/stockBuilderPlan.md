---
type: plan
status: done
updated_at: 2026-11-06
---

# Stock Builder — 주식 공사장 애니메이션 웹

종목을 등록하면 등락률에 따라 꼬마 캐릭터들이 건물을 짓거나 부수는 애니메이션을 보여주는 웹.

## 1. 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| 서버 | Node.js 22 (내장 `http` + `fetch`, 외부 의존성 0) | 패키지 매니저는 pnpm (`pnpm start` / `pnpm stop`) |
| 시세 | Yahoo Finance chart API (`/v8/finance/chart/{symbol}`) | API 키 불필요, 국내(.KS/.KQ)·해외 모두 지원. CORS 때문에 서버가 프록시 |
| 프론트 | 순수 HTML/CSS/JS + Canvas 2D | 빌드 단계 없음 |
| 저장 | `data/stocks.json` | 요청대로 JSON으로 등록 관리 |
| 이미지 | Codex CLI(`codex exec`)로 스프라이트 생성 → `public/assets/` | 캐릭터·건물·장비 이미지 |

## 2. 등락 단계 (기준가 대비 %)

| 등락률 | 단계 | 연출 |
|---|---|---|
| +30% 이상 | 🎉 폭풍 건설 | 일꾼 6명+, 크레인, 층 빠르게 증가, 폭죽 |
| +20 ~ +30% | 🔨 열심히 건설 | 일꾼 4~5명, 크레인, 빠른 망치질 |
| +10 ~ +20% | 🧱 건설 중 | 일꾼 3명, 벽돌 나르기 |
| 0 ~ +10% | 🚶 느긋한 공사 | 일꾼 1~2명, 느린 작업 |
| 0 ~ -10% | 🪓 조금 부수기 | 일꾼 1~2명이 망치로 벽 깨기 |
| -10 ~ -20% | 🚜 철거 중 | 굴삭기, 벽돌 떨어짐 |
| -20 ~ -30% | 💥 대규모 철거 | 철거반 + 먼지 구름, 층 감소 |
| -30% 이하 | 🧨 폭파 | 폭파 연출, 잔해만 남음 |

- 건물 층수 = 등락률에 비례 (기본 10층, ±% 만큼 증감, 최소 0층)
- 단계 경계값(10/20/30)은 `data/stocks.json`의 `settings.tiers`에서 수정 가능

## 3. 화면

- **메인**: 등록 종목마다 "공사장 카드". 개수 N에 따라 `cols = ceil(sqrt(N))`, `rows = ceil(N/cols)`로 화면을 꽉 채우도록 동적 그리드 (창 크기 변경 시 재계산)
- **카드**: 별명(또는 종목명), 현재가, 등락률 배지, 애니메이션 Canvas
- **상세 팝업 (카드 클릭)**: 종목명/코드, 현재가, 전일 대비, 기준가 대비, 시가/고가/저가, 거래량, 52주 고저, 최근 1개월 미니 차트, 현재 단계 설명, 별명·기준가 수정, 삭제 버튼
- **상단 바**: 종목 추가(코드 입력), 대시보드 제목(이름 설정), 새로고침 주기

## 4. 종목 관리 (JSON)

`data/stocks.json`
```json
{
  "settings": { "title": "우리 동네 주식 공사장", "refreshSec": 60, "tiers": [10, 20, 30], "basis": "base" },
  "stocks": [
    { "id": "uuid", "symbol": "005930.KS", "alias": "삼성이네", "basePrice": 71000, "addedAt": "2026-11-06" }
  ]
}
```
- REST: `GET/POST /api/stocks`, `PATCH/DELETE /api/stocks/:id`, `GET /api/quote/:symbol`, `PATCH /api/settings`
- 6자리 숫자 입력 시 `.KS` → 실패하면 `.KQ` 자동 시도. 해외는 `AAPL` 그대로
- 기준가 기본값 = 등록 시점 가격 (팝업에서 매수가 등으로 변경 가능)

## 5. 이미지 (Codex)

`codex exec`로 다음 에셋을 생성해 `public/assets/`에 저장:
- 일꾼 캐릭터 스프라이트 (걷기/망치질/벽돌 운반/환호/당황)
- 건물 층 블록, 공사 비계, 크레인, 굴삭기, 잔해, 먼지·폭죽 이펙트
- 생성 실패/누락 시에는 Canvas 도형으로 그리는 기본 그림으로 표시 (화면이 깨지지 않게, 대신 콘솔에 경고 출력)

## 6. 실행 스크립트

- `./start.sh` — 서버 백그라운드 실행, PID를 `.server.pid`에 저장, 브라우저 자동 오픈 (기본 포트 4545)
- `./stop.sh` — PID로 서버 종료
- `pnpm start` / `pnpm stop` 으로도 실행 가능 (package.json scripts)
- 로그: `logs/server.log`

## 7. 디렉터리

```
stock_game/
  server.js          # 정적 파일 + REST API + 시세 프록시
  data/stocks.json
  public/
    index.html, style.css
    js/app.js        # 그리드/등록/팝업
    js/scene.js      # 공사장 애니메이션 엔진
    assets/          # Codex 생성 이미지
  scripts/genAssets.sh  # Codex 이미지 생성 스크립트
  start.sh, stop.sh
```

## 8. 진행 순서

1. 서버 + JSON 저장 + 시세 프록시 → curl로 검증
2. 프론트 그리드/등록/삭제/팝업
3. 애니메이션 엔진 (Canvas 기본 도형으로 먼저)
4. Codex로 이미지 생성 → 스프라이트 적용
5. start/stop 스크립트 → 브라우저에서 동작 확인
