#!/usr/bin/env node
// =====================================================
// 🏥 Smart Home IoT 시스템 헬스 모니터
// =====================================================
// 시스템 상태를 실시간으로 모니터링하고 문제 발생시 자동 복구

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const WebSocket = require('ws');

class HealthMonitor {
    constructor() {
        this.config = {
            checkInterval: 30000, // 30초마다 체크
            maxRetries: 3,
            services: {
                backend: {
                    url: 'http://localhost:3001/api/health',
                    port: 3001,
                    processName: 'node.*server.js'
                },
                frontend: {
                    url: 'http://localhost:3000',
                    port: 3000,
                    processName: 'react-scripts'
                },
                database: {
                    host: 'localhost',
                    port: 5432,
                    name: 'postgresql'
                }
            },
            logDir: path.join(__dirname, '../logs'),
            pidDir: path.join(__dirname, '../')
        };
        
        this.status = {
            backend: { healthy: false, lastCheck: null, retries: 0 },
            frontend: { healthy: false, lastCheck: null, retries: 0 },
            database: { healthy: false, lastCheck: null, retries: 0 },
            websocket: { healthy: false, lastCheck: null, retries: 0 }
        };
        
        this.init();
    }
    
    init() {
        // 로그 디렉토리 생성
        if (!fs.existsSync(this.config.logDir)) {
            fs.mkdirSync(this.config.logDir, { recursive: true });
        }
        
        console.log('🏥 Health Monitor 시작됨');
        this.log('info', 'Health Monitor 초기화 완료');
        
        // 주기적 헬스체크 시작
        this.startHealthCheck();
        
        // 프로세스 종료 시 정리
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }
    
    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            data
        };
        
        // 콘솔 출력
        const colors = {
            INFO: '\x1b[36m',    // Cyan
            WARN: '\x1b[33m',    // Yellow
            ERROR: '\x1b[31m',   // Red
            SUCCESS: '\x1b[32m'  // Green
        };
        
        console.log(`${colors[level.toUpperCase()] || ''}[${timestamp}] ${level.toUpperCase()}: ${message}\x1b[0m`);
        
        // 파일 로그
        const logFile = path.join(this.config.logDir, `health-monitor-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    }
    
    async startHealthCheck() {
        setInterval(async () => {
            await this.performHealthCheck();
        }, this.config.checkInterval);
        
        // 즉시 첫 번째 체크 실행
        await this.performHealthCheck();
    }
    
    async performHealthCheck() {
        this.log('info', '🔍 헬스체크 시작');
        
        const results = await Promise.allSettled([
            this.checkBackend(),
            this.checkFrontend(),
            this.checkDatabase(),
            this.checkWebSocket()
        ]);
        
        // 결과 분석 및 복구 시도
        for (const [index, result] of results.entries()) {
            const services = ['backend', 'frontend', 'database', 'websocket'];
            const serviceName = services[index];
            
            if (result.status === 'rejected') {
                this.log('error', `${serviceName} 헬스체크 실패`, result.reason);
                await this.handleServiceFailure(serviceName);
            }
        }
        
        // 전체 상태 리포트
        this.generateStatusReport();
    }
    
    async checkBackend() {
        try {
            const response = await axios.get(this.config.services.backend.url, {
                timeout: 5000
            });
            
            if (response.status === 200) {
                this.updateServiceStatus('backend', true);
                return { service: 'backend', status: 'healthy', data: response.data };
            }
        } catch (error) {
            this.updateServiceStatus('backend', false);
            throw new Error(`Backend 응답 없음: ${error.message}`);
        }
    }
    
    async checkFrontend() {
        try {
            const response = await axios.get(this.config.services.frontend.url, {
                timeout: 5000
            });
            
            if (response.status === 200) {
                this.updateServiceStatus('frontend', true);
                return { service: 'frontend', status: 'healthy' };
            }
        } catch (error) {
            this.updateServiceStatus('frontend', false);
            throw new Error(`Frontend 응답 없음: ${error.message}`);
        }
    }
    
    async checkDatabase() {
        return new Promise((resolve, reject) => {
            exec('pg_isready -h localhost -p 5432', (error, stdout, stderr) => {
                if (error) {
                    this.updateServiceStatus('database', false);
                    reject(new Error(`Database 연결 실패: ${error.message}`));
                } else {
                    this.updateServiceStatus('database', true);
                    resolve({ service: 'database', status: 'healthy' });
                }
            });
        });
    }
    
    async checkWebSocket() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket('ws://localhost:3001');
            
            const timeout = setTimeout(() => {
                ws.terminate();
                this.updateServiceStatus('websocket', false);
                reject(new Error('WebSocket 연결 타임아웃'));
            }, 5000);
            
            ws.on('open', () => {
                clearTimeout(timeout);
                ws.close();
                this.updateServiceStatus('websocket', true);
                resolve({ service: 'websocket', status: 'healthy' });
            });
            
            ws.on('error', (error) => {
                clearTimeout(timeout);
                this.updateServiceStatus('websocket', false);
                reject(new Error(`WebSocket 연결 실패: ${error.message}`));
            });
        });
    }
    
    updateServiceStatus(service, healthy) {
        this.status[service].healthy = healthy;
        this.status[service].lastCheck = new Date().toISOString();
        
        if (healthy) {
            this.status[service].retries = 0;
        } else {
            this.status[service].retries++;
        }
    }
    
    async handleServiceFailure(serviceName) {
        const service = this.status[serviceName];
        
        if (service.retries >= this.config.maxRetries) {
            this.log('error', `${serviceName} 최대 재시도 횟수 초과, 자동 복구 시도`);
            await this.attemptServiceRecovery(serviceName);
        } else {
            this.log('warn', `${serviceName} 실패 (${service.retries}/${this.config.maxRetries})`);
        }
    }
    
    async attemptServiceRecovery(serviceName) {
        this.log('info', `🔧 ${serviceName} 자동 복구 시작`);
        
        try {
            switch (serviceName) {
                case 'backend':
                    await this.restartService('backend');
                    break;
                case 'frontend':
                    await this.restartService('frontend');
                    break;
                case 'database':
                    await this.restartDatabase();
                    break;
                case 'websocket':
                    // WebSocket은 보통 백엔드와 함께 복구됨
                    await this.restartService('backend');
                    break;
            }
            
            this.log('success', `${serviceName} 복구 완료`);
        } catch (error) {
            this.log('error', `${serviceName} 복구 실패`, error.message);
            await this.sendAlert(`${serviceName} 서비스 복구 실패`, error.message);
        }
    }
    
    async restartService(serviceName) {
        const projectDir = path.join(__dirname, '../');
        
        return new Promise((resolve, reject) => {
            // 기존 프로세스 종료
            exec(`pkill -f "${this.config.services[serviceName].processName}"`, () => {
                // 잠시 대기 후 재시작
                setTimeout(() => {
                    const startCommand = serviceName === 'backend' 
                        ? `cd ${projectDir} && ./start.sh backend`
                        : `cd ${projectDir} && ./start.sh frontend`;
                    
                    exec(startCommand, (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(stdout);
                        }
                    });
                }, 2000);
            });
        });
    }
    
    async restartDatabase() {
        return new Promise((resolve, reject) => {
            exec('sudo systemctl restart postgresql', (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    }
    
    generateStatusReport() {
        const report = {
            timestamp: new Date().toISOString(),
            overall: Object.values(this.status).every(s => s.healthy) ? 'HEALTHY' : 'DEGRADED',
            services: this.status
        };
        
        // 상태 파일 저장
        const statusFile = path.join(this.config.logDir, 'current-status.json');
        fs.writeFileSync(statusFile, JSON.stringify(report, null, 2));
        
        // 전체 상태 로그
        const healthyCount = Object.values(this.status).filter(s => s.healthy).length;
        const totalCount = Object.keys(this.status).length;
        
        this.log('info', `📊 시스템 상태: ${healthyCount}/${totalCount} 서비스 정상`);
        
        if (report.overall === 'DEGRADED') {
            const failedServices = Object.entries(this.status)
                .filter(([_, status]) => !status.healthy)
                .map(([name, _]) => name);
            
            this.log('warn', `⚠️ 문제 서비스: ${failedServices.join(', ')}`);
        }
    }
    
    async sendAlert(title, message) {
        // 여기에 알림 로직 추가 (이메일, Slack, Discord 등)
        this.log('error', `🚨 ALERT: ${title}`, message);
        
        // 알림 파일 생성
        const alertFile = path.join(this.config.logDir, `alert-${Date.now()}.json`);
        fs.writeFileSync(alertFile, JSON.stringify({
            timestamp: new Date().toISOString(),
            title,
            message,
            status: this.status
        }, null, 2));
    }
    
    shutdown() {
        this.log('info', '🛑 Health Monitor 종료 중...');
        process.exit(0);
    }
}

// 스크립트 직접 실행시
if (require.main === module) {
    new HealthMonitor();
}

module.exports = HealthMonitor;