#!/bin/bash
# IoT Monitoring System - 통합 시작 스크립트
# 사용법: ./start.sh [옵션]
#   --all     : 모든 서비스 시작 (백엔드, 프론트엔드, ANC)
#   --backend : 백엔드만 시작
#   --frontend: 프론트엔드만 시작
#   --anc     : ANC 시스템만 시작
#   (옵션 없음): 백엔드 + 프론트엔드만 시작

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=========================================${NC}"
echo -e "${CYAN}  🏠 IoT Monitoring System Starter${NC}"
echo -e "${CYAN}=========================================${NC}"

# 기존 프로세스 종료 함수
cleanup() {
    echo -e "\n${YELLOW}🛑 서비스 종료 중...${NC}"
    pkill -f "node server.js" 2>/dev/null || true
    pkill -f "react-scripts start" 2>/dev/null || true
    pkill -f "anc_elite.py" 2>/dev/null || true
    echo -e "${GREEN}✅ 모든 서비스가 종료되었습니다${NC}"
}

trap cleanup EXIT

# PostgreSQL 확인
start_postgres() {
    echo -e "${YELLOW}📦 PostgreSQL 확인 중...${NC}"
    if pg_isready -q 2>/dev/null; then
        echo -e "${GREEN}   ✅ PostgreSQL 실행 중${NC}"
    else
        echo -e "${YELLOW}   PostgreSQL 시작 시도...${NC}"
        sudo service postgresql start 2>/dev/null || true
        sleep 2
    fi
}

# 백엔드 시작
start_backend() {
    echo -e "\n${YELLOW}🔧 백엔드 서버 시작 중...${NC}"
    cd "$SCRIPT_DIR/backend"
    
    pkill -f "node server.js" 2>/dev/null || true
    sleep 1
    
    # 백엔드를 nohup으로 실행
    nohup node server.js > /tmp/backend.log 2>&1 &
    BACKEND_PID=$!
    sleep 3
    
    if kill -0 $BACKEND_PID 2>/dev/null; then
        echo -e "${GREEN}   ✅ 백엔드 서버 실행 중 (PID: $BACKEND_PID)${NC}"
        echo -e "${GREEN}   📡 API: http://localhost:3001${NC}"
        return 0
    else
        echo -e "${RED}   ❌ 백엔드 서버 시작 실패${NC}"
        cat /tmp/backend.log 2>/dev/null | tail -5
        return 1
    fi
}

# 프론트엔드 시작
start_frontend() {
    echo -e "\n${YELLOW}🎨 프론트엔드 시작 중...${NC}"
    cd "$SCRIPT_DIR/frontend/iot-dashboard"
    
    # 이미 실행중이면 스킵
    if pgrep -f "react-scripts start" > /dev/null; then
        echo -e "${GREEN}   ✅ 프론트엔드 이미 실행 중${NC}"
        return 0
    fi
    
    # 백그라운드에서 실행
    nohup npm start > /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!
    sleep 8
    
    echo -e "${GREEN}   ✅ 프론트엔드 실행 중${NC}"
    echo -e "${GREEN}   🌐 Dashboard: http://localhost:3000${NC}"
}

# ANC 시스템 시작
start_anc() {
    echo -e "\n${YELLOW}🎧 ANC 시스템 시작 중...${NC}"
    cd "$SCRIPT_DIR/anc_system"
    
    pkill -f "anc_elite.py" 2>/dev/null || true
    sleep 1
    
    if [ -d "venv" ]; then
        source venv/bin/activate
        echo -e "${GREEN}   ✅ Python 가상환경 활성화${NC}"
    fi
    
    # ANC를 포그라운드에서 실행 (사용자가 수동 실행 원함)
    # python anc_elite.py 200 &
    # ANC_PID=$!
    echo -e "${GREEN}   ✅ ANC 시스템: 수동 실행 대기중 (python anc_elite.py 200)${NC}"
    sleep 2
    
    if kill -0 $ANC_PID 2>/dev/null; then
        echo -e "${GREEN}   ✅ ANC 시스템 실행 중 (PID: $ANC_PID)${NC}"
    else
        echo -e "${RED}   ❌ ANC 시스템 시작 실패${NC}"
    fi
}

# 상태 출력
print_status() {
    echo -e "\n${CYAN}=========================================${NC}"
    echo -e "${CYAN}  📊 서비스 상태${NC}"
    echo -e "${CYAN}=========================================${NC}"
    
    if pgrep -f "node server.js" > /dev/null; then
        echo -e "${GREEN}  ✅ 백엔드:     http://localhost:3001${NC}"
    else
        echo -e "${RED}  ❌ 백엔드:     실행 안됨${NC}"
    fi
    
    if pgrep -f "react-scripts" > /dev/null; then
        echo -e "${GREEN}  ✅ 프론트엔드: http://localhost:3000${NC}"
    else
        echo -e "${RED}  ❌ 프론트엔드: 실행 안됨${NC}"
    fi
    
    if pgrep -f "anc_elite.py" > /dev/null; then
        echo -e "${GREEN}  ✅ ANC 시스템: 실행 중${NC}"
    else
        echo -e "${YELLOW}  ⏸️  ANC 시스템: 실행 안됨${NC}"
    fi
    
    echo -e "${CYAN}=========================================${NC}"
    echo -e "${YELLOW}종료하려면 Ctrl+C를 누르세요${NC}"
}

# 메인 로직
case "${1:-}" in
    --all)
        start_postgres
        start_backend
        start_frontend
        start_anc
        print_status
        ;;
    --backend)
        start_postgres
        start_backend
        print_status
        ;;
    --frontend)
        start_frontend
        print_status
        ;;
    --anc)
        start_anc
        print_status
        ;;
    *)
        start_postgres
        start_backend
        start_frontend
        print_status
        ;;
esac

wait
