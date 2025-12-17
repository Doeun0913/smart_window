#!/bin/bash
# ==========================================
# ANC System 설치 스크립트
# 라즈베리파이 OS Bookworm 호환
# ==========================================

echo "=========================================="
echo "🏠 Smart Home IoT - ANC System 설치"
echo "=========================================="

cd /home/user/smart-home-iot/iot-monitoring/anc_system

# 1. 시스템 패키지 설치
echo ""
echo "📦 시스템 패키지 설치 중..."
sudo apt update
sudo apt install -y python3-full python3-venv python3-pip
sudo apt install -y python3-numpy python3-matplotlib
sudo apt install -y portaudio19-dev  # sounddevice 필요

# 2. 가상환경 생성
echo ""
echo "🐍 Python 가상환경 생성 중..."
python3 -m venv venv --system-site-packages

# 3. 가상환경 활성화 및 패키지 설치
echo ""
echo "📥 Python 패키지 설치 중..."
source venv/bin/activate

pip install --upgrade pip
pip install pyserial sounddevice requests

echo ""
echo "=========================================="
echo "✅ 설치 완료!"
echo "=========================================="
echo ""
echo "🚀 실행 방법:"
echo ""
echo "   # 가상환경 활성화"
echo "   source /home/user/smart-home-iot/iot-monitoring/anc_system/venv/bin/activate"
echo ""
echo "   # 헤드리스 모드 실행 (모니터 없이)"
echo "   python anc_headless.py"
echo ""
echo "   # GUI 모드 실행 (모니터 있을 때)"
echo "   python anc_with_api.py"
echo ""
echo "   # 백그라운드 실행"
echo "   nohup python anc_headless.py > ../logs/anc.log 2>&1 &"
echo ""
echo "=========================================="
