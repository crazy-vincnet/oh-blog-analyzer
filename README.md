# 🚀 OH BLOG Analyzer (오 블로그 분석기)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Electron](https://img.shields.io/badge/platform-Electron-47848F.svg)
![React](https://img.shields.io/badge/frontend-React-61DAFB.svg)

**OH BLOG**는 네이버 블로그 포스팅의 SEO(검색 최적화) 상태를 정밀 분석하고, 키워드 순위 및 경쟁사 데이터를 한눈에 파악하여 블로그 성장 전략을 제시하는 스마트한 분석 도구입니다.

---

## ✨ 주요 기능 (Key Features)

### 1. 🔍 SEO 정밀 분석
- **실시간 스코어링:** 네이버 알고리즘 지표를 반영한 100점 만점 기준 SEO 점수 산출.
- **콘텐츠 분석:** 공백 제외 글자 수, 이미지 개수 및 품질(EXIF 원본 데이터) 분석.
- **키워드 최적화:** 본문 내 키워드 밀도 분석 및 적정 빈도 추천.

### 2. 🏆 키워드 순위 추적
- 특정 키워드 검색 시 내 포스팅이 검색 결과 상위 10위권 내에 있는지 실시간 확인.
- 과거 순위 기록 저장 및 변화 추적.

### 3. ⚔️ 경쟁사 비교 분석
- 타겟 키워드 상위 노출 글들의 평균 글자 수, 이미지 개수 데이터를 추출하여 내 글과 비교 분석.

### 4. 📈 연관 키워드 추출
- 네이버 연관 검색어 기반으로 포스팅 확장 전략을 세울 수 있도록 관련 키워드 제공.

---

## 🛠 기술 스택 (Tech Stack)

### Frontend
- **React 19** (TypeScript, Vite)
- **Lucide React** (Icons)
- **Vanilla CSS** (Styling)

### Backend & Desktop
- **Electron 34** (Desktop App Framework)
- **Node.js & Express 5** (Server Logic)
- **SQLite3** (Local Database)
- **Cheerio & Axios** (Web Scraping & API)
- **Exifr** (Image Metadata Analysis)

---

## ⚙️ 시작하기 (Getting Started)

### 로컬 개발 환경 설정
1. 저장소 클론:
   ```bash
   git clone https://github.com/crazy-vincnet/oh-blog-analyzer.git
   cd oh-blog-analyzer
   ```

2. 의존성 설치 (Root & Client):
   ```bash
   npm install
   cd client && npm install
   cd ..
   ```

3. 개발 모드 실행:
   ```bash
   npm run dev
   ```

### 실행파일 빌드 (Build)
윈도우와 맥용 실행파일을 생성하려면 다음 명령어를 사용합니다:
```bash
npm run dist
```
빌드된 결과물은 `dist_electron/` 폴더 내에 생성됩니다.

---

## 📁 프로젝트 구조 (Project Structure)

```text
.
├── client/             # React 프론트엔드 (Vite)
├── server/             # Express 백엔드 (API 및 크롤링 로직)
├── electron-main.js    # Electron 메인 프로세스 설정
├── package.json        # 전체 의존성 및 빌드 설정
└── OH_BLOG_사용설명서.md  # 사용자용 상세 가이드
```

---

## 📝 사용 설명서
상세한 설치 및 사용 방법은 [OH_BLOG_사용설명서.md](./OH_BLOG_사용설명서.md) 파일을 참고하세요.

## ⚠️ 면책 조항 (Disclaimer)
본 프로그램은 교육 및 개인 분석용으로 제작되었습니다. 네이버 서비스 이용약관을 준수하시기 바라며, 과도한 크롤링으로 인한 불이익은 사용자에게 책임이 있습니다.

---

## 📄 라이선스 (License)
이 프로젝트는 MIT 라이선스 하에 배포됩니다.
