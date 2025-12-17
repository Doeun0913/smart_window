#!/bin/bash
# =====================================================
# 🔧 Smart Home IoT 유지보수 시스템 설치 스크립트
# =====================================================

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 프로젝트 경로
MAINTENANCE_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$MAINTENANCE_DIR")"

echo -e "${CYAN}"
echo "═══════════════════════════════════════════════════════════════"
echo "  🔧 Smart Home IoT 유지보수 시스템 설치"
echo "═══════════════════════════════════════════════════════════════"
echo -e "${NC}"

# 함수: 로그 출력
log() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        "INFO")
            echo -e "${BLUE}[${timestamp}] INFO: ${message}${NC}"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[${timestamp}] SUCCESS: ${message}${NC}"
            ;;
        "WARN")
            echo -e "${YELLOW}[${timestamp}] WARN: ${message}${NC}"
            ;;
        "ERROR")
            echo -e "${RED}[${timestamp}] ERROR: ${message}${NC}"
            ;;
    esac
}

# 함수: 시스템 요구사항 체크
check_requirements() {
    log "INFO" "시스템 요구사항 체크 중..."
    
    # Node.js 체크
    if ! command -v node &> /dev/null; then
        log "ERROR" "Node.js가 설치되지 않았습니다"
        log "INFO" "Node.js 설치 방법:"
        log "INFO" "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        log "INFO" "  sudo apt install -y nodejs"
        exit 1
    fi
    
    local node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$node_version" -lt 14 ]; then
        log "ERROR" "Node.js 14 이상이 필요합니다. 현재 버전: $(node -v)"
        exit 1
    fi
    
    # npm 체크
    if ! command -v npm &> /dev/null; then
        log "ERROR" "npm이 설치되지 않았습니다"
        exit 1
    fi
    
    # PostgreSQL 체크
    if ! command -v psql &> /dev/null; then
        log "WARN" "PostgreSQL이 설치되지 않았습니다"
        log "INFO" "PostgreSQL 설치 방법:"
        log "INFO" "  sudo apt update"
        log "INFO" "  sudo apt install postgresql postgresql-contrib"
    fi
    
    # Python 체크
    if ! command -v python3 &> /dev/null; then
        log "ERROR" "Python 3이 설치되지 않았습니다"
        exit 1
    fi
    
    log "SUCCESS" "시스템 요구사항 체크 완료"
}

# 함수: 디렉토리 생성
create_directories() {
    log "INFO" "필요한 디렉토리 생성 중..."
    
    local dirs=(
        "$PROJECT_DIR/logs"
        "$PROJECT_DIR/metrics"
        "$PROJECT_DIR/backups"
        "$PROJECT_DIR/backups/database"
        "$PROJECT_DIR/backups/files"
        "$PROJECT_DIR/backups/logs"
        "$PROJECT_DIR/backups/archived"
    )
    
    for dir in "${dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log "INFO" "디렉토리 생성: $dir"
        fi
    done
    
    log "SUCCESS" "디렉토리 생성 완료"
}

# 함수: 의존성 설치
install_dependencies() {
    log "INFO" "유지보수 시스템 의존성 설치 중..."
    
    cd "$MAINTENANCE_DIR"
    
    # package.json이 있는지 확인
    if [ ! -f "package.json" ]; then
        log "ERROR" "package.json 파일을 찾을 수 없습니다"
        exit 1
    fi
    
    # npm 의존성 설치
    npm install
    
    log "SUCCESS" "의존성 설치 완료"
}

# 함수: 시스템 서비스 설정
setup_systemd_services() {
    log "INFO" "systemd 서비스 설정 중..."
    
    # 워치독 서비스 파일 생성
    cat > /tmp/iot-watchdog.service << EOF
[Unit]
Description=Smart Home IoT System Watchdog
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$MAINTENANCE_DIR
ExecStart=/usr/bin/node system-watchdog.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # 유지보수 대시보드 서비스 파일 생성
    cat > /tmp/iot-maintenance-dashboard.service << EOF
[Unit]
Description=Smart Home IoT Maintenance Dashboard
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$MAINTENANCE_DIR
ExecStart=/usr/bin/node maintenance-dashboard.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # 서비스 파일 설치 (sudo 권한 필요)
    if [ "$EUID" -eq 0 ]; then
        cp /tmp/iot-watchdog.service /etc/systemd/system/
        cp /tmp/iot-maintenance-dashboard.service /etc/systemd/system/
        
        systemctl daemon-reload
        systemctl enable iot-watchdog.service
        systemctl enable iot-maintenance-dashboard.service
        
        log "SUCCESS" "systemd 서비스 설정 완료"
    else
        log "WARN" "systemd 서비스 설정을 위해 sudo 권한이 필요합니다"
        log "INFO" "수동으로 다음 명령을 실행하세요:"
        log "INFO" "  sudo cp /tmp/iot-watchdog.service /etc/systemd/system/"
        log "INFO" "  sudo cp /tmp/iot-maintenance-dashboard.service /etc/systemd/system/"
        log "INFO" "  sudo systemctl daemon-reload"
        log "INFO" "  sudo systemctl enable iot-watchdog.service"
        log "INFO" "  sudo systemctl enable iot-maintenance-dashboard.service"
    fi
}

# 함수: cron 작업 설정
setup_cron_jobs() {
    log "INFO" "cron 작업 설정 중..."
    
    # 기존 cron 작업 백업
    crontab -l > /tmp/crontab_backup 2>/dev/null || true
    
    # 새로운 cron 작업 추가
    cat > /tmp/iot_maintenance_cron << EOF
# Smart Home IoT 유지보수 작업
# 매일 새벽 2시 - 데이터베이스 백업
0 2 * * * cd $MAINTENANCE_DIR && node backup-system.js database >> $PROJECT_DIR/logs/cron.log 2>&1

# 매일 새벽 3시 - 로그 로테이션
0 3 * * * cd $MAINTENANCE_DIR && node log-manager.js rotate >> $PROJECT_DIR/logs/cron.log 2>&1

# 매주 일요일 새벽 4시 - 파일 백업
0 4 * * 0 cd $MAINTENANCE_DIR && node backup-system.js files >> $PROJECT_DIR/logs/cron.log 2>&1

# 매일 새벽 5시 - 오래된 백업 정리
0 5 * * * cd $MAINTENANCE_DIR && node backup-system.js cleanup >> $PROJECT_DIR/logs/cron.log 2>&1

# 매시간 - 성능 메트릭 수집
0 * * * * cd $MAINTENANCE_DIR && node performance-monitor.js >> $PROJECT_DIR/logs/cron.log 2>&1
EOF

    # 기존 cron과 병합
    if [ -f /tmp/crontab_backup ]; then
        cat /tmp/crontab_backup /tmp/iot_maintenance_cron | crontab -
    else
        crontab /tmp/iot_maintenance_cron
    fi
    
    log "SUCCESS" "cron 작업 설정 완료"
}

# 함수: 설정 파일 생성
create_config_files() {
    log "INFO" "설정 파일 생성 중..."
    
    # 유지보수 설정 파일
    cat > "$MAINTENANCE_DIR/config.json" << EOF
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
    },
    "webhook": {
      "enabled": false,
      "url": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
    }
  },
  "backup": {
    "database": {
      "schedule": "0 2 * * *",
      "retention": 30
    },
    "files": {
      "schedule": "0 4 * * 0",
      "retention": 12
    },
    "logs": {
      "schedule": "0 3 * * *",
      "retention": 7
    }
  }
}
EOF

    # 환경 변수 파일
    if [ ! -f "$MAINTENANCE_DIR/.env" ]; then
        cat > "$MAINTENANCE_DIR/.env" << EOF
# 유지보수 시스템 환경 변수
NODE_ENV=production
LOG_LEVEL=info
DASHBOARD_PORT=3002

# 데이터베이스 설정
DB_HOST=localhost
DB_PORT=5432
DB_NAME=iot_monitoring
DB_USER=postgres
DB_PASSWORD=

# 알림 설정
ALERT_EMAIL_ENABLED=false
ALERT_WEBHOOK_ENABLED=false

# 백업 설정
BACKUP_RETENTION_DAYS=30
METRICS_RETENTION_MINUTES=10080
EOF
    fi
    
    log "SUCCESS" "설정 파일 생성 완료"
}

# 함수: 권한 설정
setup_permissions() {
    log "INFO" "파일 권한 설정 중..."
    
    # 실행 권한 부여
    chmod +x "$MAINTENANCE_DIR"/*.js
    chmod +x "$PROJECT_DIR/start.sh"
    
    # 로그 디렉토리 권한
    chmod 755 "$PROJECT_DIR/logs"
    chmod 755 "$PROJECT_DIR/metrics"
    chmod 755 "$PROJECT_DIR/backups"
    
    log "SUCCESS" "권한 설정 완료"
}

# 함수: 테스트 실행
run_tests() {
    log "INFO" "유지보수 시스템 테스트 중..."
    
    cd "$MAINTENANCE_DIR"
    
    # 각 모듈 기본 테스트
    local modules=("health-monitor.js" "performance-monitor.js" "log-manager.js" "backup-system.js")
    
    for module in "${modules[@]}"; do
        log "INFO" "테스트 중: $module"
        
        # 모듈이 정상적으로 로드되는지 확인
        if node -e "require('./$module'); console.log('OK');" > /dev/null 2>&1; then
            log "SUCCESS" "$module 테스트 통과"
        else
            log "ERROR" "$module 테스트 실패"
            return 1
        fi
    done
    
    log "SUCCESS" "모든 테스트 통과"
}

# 함수: 설치 완료 메시지
show_completion_message() {
    echo -e "${GREEN}"
    echo "═══════════════════════════════════════════════════════════════"
    echo "  ✅ 유지보수 시스템 설치 완료!"
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "${NC}"
    
    echo -e "${CYAN}🚀 시작 방법:${NC}"
    echo "  1. 워치독 시작:     cd $MAINTENANCE_DIR && node system-watchdog.js"
    echo "  2. 대시보드 시작:   cd $MAINTENANCE_DIR && node maintenance-dashboard.js"
    echo "  3. 전체 시스템:     cd $PROJECT_DIR && ./start.sh all"
    echo ""
    
    echo -e "${CYAN}📊 대시보드 접속:${NC}"
    echo "  http://localhost:3002"
    echo ""
    
    echo -e "${CYAN}🔧 유지보수 명령어:${NC}"
    echo "  백업 생성:         cd $MAINTENANCE_DIR && node backup-system.js database"
    echo "  로그 검색:         cd $MAINTENANCE_DIR && node log-manager.js search 'error'"
    echo "  성능 리포트:       cd $MAINTENANCE_DIR && node performance-monitor.js summary"
    echo "  시스템 상태:       cd $MAINTENANCE_DIR && node system-watchdog.js status"
    echo ""
    
    echo -e "${CYAN}📁 중요 디렉토리:${NC}"
    echo "  로그:             $PROJECT_DIR/logs"
    echo "  메트릭:           $PROJECT_DIR/metrics"
    echo "  백업:             $PROJECT_DIR/backups"
    echo "  설정:             $MAINTENANCE_DIR/config.json"
    echo ""
    
    if [ "$EUID" -ne 0 ]; then
        echo -e "${YELLOW}⚠️ 참고사항:${NC}"
        echo "  - systemd 서비스 설정을 위해 sudo 권한으로 추가 설정이 필요합니다"
        echo "  - PostgreSQL 설정을 확인하고 데이터베이스를 초기화하세요"
        echo ""
    fi
}

# 메인 설치 프로세스
main() {
    log "INFO" "Smart Home IoT 유지보수 시스템 설치 시작"
    
    # 1. 시스템 ��구사항 체크
    check_requirements
    
    # 2. 디렉토리 생성
    create_directories
    
    # 3. 의존성 설치
    install_dependencies
    
    # 4. 설정 파일 생성
    create_config_files
    
    # 5. 권한 설정
    setup_permissions
    
    # 6. cron 작업 설정
    setup_cron_jobs
    
    # 7. systemd 서비스 설정 (선택적)
    if [ "$1" = "--with-systemd" ]; then
        setup_systemd_services
    fi
    
    # 8. 테스트 실행
    run_tests
    
    # 9. 완료 메시지
    show_completion_message
    
    log "SUCCESS" "설치가 성공적으로 완료되었습니다!"
}

# 스크립트 실행
main "$@"