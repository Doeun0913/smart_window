# 🔧 Smart Home IoT 유지보수 시스템

완벽한 자동화된 유지보수 및 모니터링 시스템으로 Smart Home IoT 프로젝트의 안정성과 성능을 보장합니다.

## 📋 시스템 개요

이 유지보수 시스템은 다음과 같은 핵심 기능을 제공합니다:

- **🏥 헬스 모니터링**: 서비스 상태 실시간 감시 및 자동 복구
- **📊 성능 모니터링**: 시스템 리소스 및 응답 시간 추적
- **💾 자동 백업**: 데이터베이스, 파일, 로그 정기 백업
- **📝 로그 관리**: 로그 수집, 분석, 로테이션, 검색
- **🐕 시스템 워치독**: 전체 시스템 감시 및 장애 대응
- **📊 웹 대시보드**: 실시간 모니터링 및 관리 인터페이스

## 🚀 빠른 시작

### 1. 설치

```bash
# 유지보수 시스템 설치
cd smart-home-iot/iot-monitoring/maintenance
./install.sh

# systemd 서비스와 함께 설치 (권장)
./install.sh --with-systemd
```

### 2. 시작

```bash
# 워치독 시작 (백그라운드)
node system-watchdog.js &

# 유지보수 대시보드 시작
node maintenance-dashboard.js &

# 또는 systemd 서비스로 시작
sudo systemctl start iot-watchdog
sudo systemctl start iot-maintenance-dashboard
```

### 3. 접속

- **유지보수 대시보드**: http://localhost:3002
- **메인 IoT 대시보드**: http://localhost:3000

## 📁 구조

```
maintenance/
├── system-watchdog.js          # 🐕 메인 워치독 시스템
├── health-monitor.js           # 🏥 헬스 모니터
├── performance-monitor.js      # 📊 성능 모니터
├── backup-system.js           # 💾 백업 시스템
├── log-manager.js             # 📝 로그 관리자
├── maintenance-dashboard.js    # 📊 웹 대시보드
├── install.sh                 # 🔧 설치 스크립트
├── config.json               # ⚙️ 설정 파일
└── package.json              # 📦 의존성
```

## 🔧 주요 모듈

### 🐕 System Watchdog (system-watchdog.js)

전체 시스템을 감시하는 메인 워치독입니다.

**기능:**
- 서비스 상태 모니터링 (Backend, Frontend, Database)
- 자동 재시작 (최대 3회 시도)
- 시스템 리소스 감시 (CPU, 메모리, 디스크)
- 임계값 기반 알림
- 치명적 오류 처리

**사용법:**
```bash
# 워치독 시작
node system-watchdog.js

# 상태 확인
node system-watchdog.js status

# 중지
node system-watchdog.js stop
```

### 🏥 Health Monitor (health-monitor.js)

서비스별 헬스체크를 수행합니다.

**기능:**
- HTTP 엔드포인트 헬스체크
- WebSocket 연결 테스트
- 데이터베이스 연결 확인
- 자동 복구 시도
- 상태 리포트 생성

**사용법:**
```bash
# 헬스 모니터 시작
node health-monitor.js

# 현재 상태 확인
curl http://localhost:3001/api/health
```

### 📊 Performance Monitor (performance-monitor.js)

시스템 성능 메트릭을 수집하고 분석합니다.

**기능:**
- CPU, 메모리, 디스크 사용률 추적
- API 응답 시간 측정
- 네트워크 통계 수집
- 성능 임계값 모니터링
- 메트릭 데이터 저장

**사용법:**
```bash
# 성능 모니터 시작
node performance-monitor.js

# 24시간 요약 보기
node performance-monitor.js summary 24
```

### 💾 Backup System (backup-system.js)

자동화된 백업 및 복구 시스템입니다.

**기능:**
- 데이터베이스 자동 백업 (매일 새벽 2시)
- 파일 백업 (매주 일요일)
- 로그 백업 (매일)
- 백업 압축 및 보관
- 오래된 백업 자동 정리

**사용법:**
```bash
# 데이터베이스 백업
node backup-system.js database

# 파일 백업
node backup-system.js files

# 로그 백업
node backup-system.js logs

# 백업 목록 보기
node backup-system.js list

# 데이터베이스 복구
node backup-system.js restore-db /path/to/backup.sql.gz

# 오래된 백업 정리
node backup-system.js cleanup
```

### 📝 Log Manager (log-manager.js)

로그 수집, 분석, 관리 시스템입니다.

**기능:**
- 다양한 소스에서 로그 수집
- 로그 로테이션 및 압축
- 로그 검색 및 필터링
- 로그 분석 리포트
- 오래된 로그 자동 정리

**사용법:**
```bash
# 로그 수집
node log-manager.js collect

# 로그 로테이션
node log-manager.js rotate

# 로그 검색
node log-manager.js search "error"

# 로그 리포트 생성
node log-manager.js report 24

# 오래된 로그 정리
node log-manager.js cleanup
```

### 📊 Maintenance Dashboard (maintenance-dashboard.js)

웹 기반 유지보수 대시보드입니다.

**기능:**
- 실시간 시스템 상태 표시
- 서비스 제어 (시작/중지/재시작)
- 로그 뷰어
- 백업 관리
- 알림 관리
- WebSocket 실시간 업데이트

**접속:** http://localhost:3002

## ⚙️ 설정

### config.json

```json
{
  "system": {
    "checkInterval": 30000,
    "maxRestartAttempts": 3,
    "restartCooldown": 300000
  },
  "monitoring": {
    "metricsRetention": 10080,
    "logRetention": 30,
    "backupRetention": 30
  },
  "alerts": {
    "email": {
      "enabled": false,
      "smtp": {
        "host": "smtp.gmail.com",
        "port": 587,
        "secure": false,
        "auth": {
          "user": "your-email@gmail.com",
          "pass": "your-password"
        }
      },
      "recipients": ["admin@example.com"]
    }
  }
}
```

### 환경 변수 (.env)

```env
NODE_ENV=production
LOG_LEVEL=info
DASHBOARD_PORT=3002

DB_HOST=localhost
DB_PORT=5432
DB_NAME=iot_monitoring
DB_USER=postgres
DB_PASSWORD=

ALERT_EMAIL_ENABLED=false
BACKUP_RETENTION_DAYS=30
```

## 📅 자동화 스케줄

### Cron 작업

```bash
# 매일 새벽 2시 - 데이터베이스 백업
0 2 * * * cd /path/to/maintenance && node backup-system.js database

# 매일 새벽 3시 - 로그 로테이션
0 3 * * * cd /path/to/maintenance && node log-manager.js rotate

# 매주 일요일 새벽 4시 - 파일 백업
0 4 * * 0 cd /path/to/maintenance && node backup-system.js files

# 매일 새벽 5시 - 오래된 백업 정리
0 5 * * * cd /path/to/maintenance && node backup-system.js cleanup
```

### Systemd 서비스

```bash
# 서비스 상태 확인
sudo systemctl status iot-watchdog
sudo systemctl status iot-maintenance-dashboard

# 서비스 시작/중지
sudo systemctl start iot-watchdog
sudo systemctl stop iot-watchdog

# 자동 시작 설정
sudo systemctl enable iot-watchdog
```

## 🚨 알림 시스템

### 알림 유형

- **INFO**: 일반 정보
- **WARNING**: 주의 필요
- **CRITICAL**: 즉시 조치 필요

### 알림 조건

- CPU 사용률 > 80%
- 메모리 사용률 > 85%
- 디스크 사용률 > 90%
- API 응답 시간 > 5초
- 서비스 연속 실패 > 3회

### 알림 채널

- **로그 파일**: 모든 알림 기록
- **웹 대시보드**: 실시간 알림 표시
- **이메일**: 중요 알림 (설정 시)
- **Webhook**: Slack/Discord 연동 (설정 시)

## 📊 모니터링 메트릭

### 시스템 메트릭

- CPU 사용률 및 로드 평균
- 메모리 사용률
- 디스크 사용률 및 I/O
- 네트워크 트래픽
- 프로세스 상태

### 애플리케이션 메트릭

- API 응답 시간
- 요청 처리량
- 에러율
- WebSocket 연결 수
- 데이터베이스 연결 상태

### 비즈니스 메트릭

- 센서 데이터 수집률
- 알림 발생 빈도
- 시스템 가용성
- 백업 성공률

## 🔍 로그 분석

### 로그 레벨

- **ERROR**: 오류 발생
- **WARN**: 경고 상황
- **INFO**: 일반 정보
- **DEBUG**: 디버그 정보

### 로그 검색

```bash
# 에러 로그 검색
node log-manager.js search "error"

# 특정 시간대 로그
node log-manager.js search "temperature" --start-date="2024-01-01" --end-date="2024-01-02"

# 특정 레벨 로그
node log-manager.js search "database" --level="error"
```

## 💾 백업 전략

### 백업 유형

1. **데이터베이스 백업**
   - 매일 새벽 2시 자동 실행
   - PostgreSQL dump 생성
   - gzip 압축 저장
   - 30일간 보관

2. **파일 백업**
   - 매주 일요일 자동 실행
   - 소스 코드 및 설정 파일
   - ZIP 아카이브 생성
   - 12주간 보관

3. **로그 백업**
   - 매일 새벽 3시 자동 실행
   - 로그 파일 압축 보관
   - 7일간 보관

### 복구 절차

```bash
# 데이터베이스 복구
node backup-system.js restore-db /path/to/backup.sql.gz

# 파일 복구 (수동)
cd /path/to/backups/files
unzip latest-backup.zip
```

## 🛠️ 문제 해결

### 일반적인 문제

1. **서비스가 시작되지 않음**
   ```bash
   # 포트 사용 확인
   sudo netstat -tlnp | grep :3001
   
   # 프로세스 확인
   ps aux | grep node
   
   # 로그 확인
   tail -f logs/watchdog-$(date +%Y-%m-%d).log
   ```

2. **백업 실패**
   ```bash
   # 디스크 공간 확인
   df -h
   
   # PostgreSQL 연결 확인
   pg_isready -h localhost -p 5432
   
   # 권한 확인
   ls -la backups/
   ```

3. **높은 리소스 사용률**
   ```bash
   # CPU 사용률 확인
   top
   
   # 메모리 사용률 확인
   free -h
   
   # 디스크 I/O 확인
   iotop
   ```

### 로그 위치

- **워치독 로그**: `logs/watchdog-YYYY-MM-DD.log`
- **헬스 모니터 로그**: `logs/health-monitor-YYYY-MM-DD.log`
- **성능 모니터 로그**: `logs/performance-YYYY-MM-DD.log`
- **백업 로그**: `logs/backup-YYYY-MM-DD.log`
- **시스템 로그**: `/var/log/syslog`

## 📈 성능 최적화

### 권장 설정

1. **시스템 리소스**
   - 최소 2GB RAM
   - 10GB 여유 디스크 공간
   - 듀얼 코어 CPU

2. **데이터베이스**
   - 정기적인 VACUUM 실행
   - 인덱스 최적화
   - 연결 풀 설정

3. **로그 관리**
   - 로그 레벨 조정
   - 로테이션 주기 설정
   - 압축 활성화

## 🔒 보안 고려사항

1. **접근 제어**
   - 대시보드 인증 설정
   - 방화벽 규칙 적용
   - SSL/TLS 인증서 사용

2. **데이터 보호**
   - 백업 암호화
   - 로그 민감 정보 마스킹
   - 정기적인 보안 업데이트

3. **모니터링**
   - 비정상적인 접근 감지
   - 시스템 변경 추적
   - 보안 이벤트 로깅

## 📞 지원

문제가 발생하거나 도움이 필요한 경우:

1. **로그 확인**: 관련 로그 파일을 먼저 확인하세요
2. **상태 체크**: `node system-watchdog.js status` 실행
3. **대시보드 확인**: http://localhost:3002에서 실시간 상태 확인
4. **문서 참조**: 각 모듈의 주석과 도움말 확인

## 📝 라이선스

MIT License - 자유롭게 사용, 수정, 배포 가능합니다.