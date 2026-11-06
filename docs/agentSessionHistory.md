---
type: reference
status: in_progress
updated_at: 2026-11-06
---

# Agent Session History

## 2026-11-06 — Stock Builder 최초 구현 (Claude / Opus 5.5)

**완료**
- Node 서버(`server.js`, 의존성 0): JSON 저장(`data/stocks.json`), Yahoo 시세 프록시, 네이버 한글명/검색
- 프론트: 동적 그리드(4:3 셀 기준 최적 열 수), 종목 추가(한글 자동완성), 상세 팝업(차트 5일~1년, 별명/기준가 수정, 삭제), 제목 변경, 설정(단계 경계, 새로고침 주기), 기준가/전일 대비 전환
- Canvas 애니메이션: 9단계(+4 ~ -4), 층수 = 6 + pct/tiers[2]*6 (0~14)
- Codex CLI(`image_generation`)로 스프라이트 9종 생성 → `public/assets/` (원본 `assets_src/`)
- `start.sh` / `stop.sh` + `pnpm start|stop|restart`

**결정 사항**
- 패키지 매니저는 pnpm (사용자 요청). 외부 패키지 없음
- 등락 기본 기준 = 기준가 대비 (기준가 기본값 = 등록 시점 가격), `전일 대비` 전환 가능
- 6자리 국내 코드는 네이버 `stockExchangeType`으로 KS/KQ 판별 (Yahoo는 코스닥 코드를 .KS로 조회해도 엉뚱한 옛 데이터를 돌려줌)
- `pnpm restart`는 pnpm 내장(stop → restart → start)이므로 restart 스크립트는 메시지 출력만

**데모 데이터**
- 샘플 종목 8개, 기준가는 1개월 전 종가로 설정 (여러 단계가 보이도록)

**알려진 한계**
- Yahoo 시세는 지연될 수 있음 (네이버 대비 수 분)
- 스프라이트는 정지 이미지 1장씩이라 동작은 위치/회전/점프로 표현

## 2026-11-06 — 후속 작업 (Claude / Opus 5.5)

- GitHub 저장소 연결: `MyNameIsHojung/stock_game` (기존 LICENSE 커밋 위에 이어서 push)
- 시세 실패 원인: 회사망 TLS 검사(사설 루트 인증서)로 Node가 `SELF_SIGNED_CERT_IN_CHAIN` 거부
  → `start.sh`에 `NODE_USE_SYSTEM_CA=1` (macOS 키체인 신뢰), fetch 오류에 cause 기록
- 무료 호스팅(GitHub Pages / Render) 검토 → 사용자 결정으로 보류
- 종목 순서 설정: 카드 드래그 앤 드롭 + 팝업 앞/뒤 버튼, `PUT /api/stocks/order` (전체 id 목록 검증)
