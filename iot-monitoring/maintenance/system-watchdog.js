#!/usr/bin/env node
// =====================================================
// 🐕 Smart Home IoT 시스템 워치독
// =====================================================
// 시스템 전체를 감시하고 문제 발생시 자동 복구 및 알림

const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const EventEmitter = require('events');

// 다른 모니터링 모듈들 import
const HealthMonitor = require('./health-monitor');
const PerformanceMonitor = require('./performance-monitor');
const LogManager = require('./log-manager');
const BackupSystem = require('./backup-system');

class SystemWatchdog extends EventEmitter {
    constructor() {
        super();
        
        this.config = {
            checkInterval: 30000, // 30초마다 체크
            criticalServices: ['backend', 'database'],
            autoRestart: true,
            maxRestartAttempts: 3,
            restartCooldown: 300000, // 5분
            alertThresholds: {
                consecutiveFailures: 3,
                systemLoad: 5.0,
                memoryUsage: 90,
                diskUsage: 95
            },
            logDir: path.join(__dirname, '../logs'),
            pidDir: path.join(__dirname, '../'),
            maintenanceSchedule: {
                backup: '0 2 * * *',      // 매일 새벽 2시
                logRotation: '0 3 * * *',  // 매일 새벽 3시
                cleanup: '0 4 * * 0'       // 매주 일요일 새벽 4시
            }
        };
        
        this.state = {
            isRunning: false,
            services: {},
            restartAttempts: {},
            lastRestart: {},
            alerts: [],
            maintenanceMode: false
        };
        
        this.monitors = {};
        
        this.init();
    }
    
    init() {
        // 디렉토리 생성
        if (!fs.existsSync(this.config.logDir)) {
            fs.mkdirSync(this.config.logDir, { recursive: true });
        }
        
        console.log('🐕 System Watchdog 시작됨');
        this.log('info', 'System Watchdog 초기화 완료');
        
        // 모니터링 모듈들 초기화
        this.initializeMonitors();
        
        // 서비스 상태 초기화
        this.initializeServiceStates();
        
        // 이벤트 리스너 설정
        this.setupEventListeners();
        
        // 워치독 시작
        this.start();
        
        // 프로세스 종료 시 정리
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
        process.on('uncaughtException', (error) => this.handleCriticalError(error));
        process.on('unhandledRejection', (reason) => this.handleCriticalError(reason));
    }
    
    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            component: 'SystemWatchdog',
            message,
            data
        };
        
        // 색상 출력
        const colors = {
            INFO: '\x1b[36m',    // Cyan
            WARN: '\x1b[33m',    // Yellow
            ERROR: '\x1b[31m',   // Red
            SUCCESS: '\x1b[32m', // Green
            CRITICAL: '\x1b[35m' // Magenta
        };
        
        console.log(`${colors[level.toUpperCase()] || ''}[${timestamp}] ${level.toUpperCase()}: ${message}\x1b[0m`);
        
        // 파일 로그
        const logFile = path.join(this.config.logDir, `watchdog-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        
        // 이벤트 발생
        this.emit('log', logEntry);
    }
    
    initializeMonitors() {
        try {
            // 각 모니터를 별도 프로세스로 실행하지 않고 직접 사용
            this.log('info', '모니터링 모듈 초기화 중...');
            
            // 모니터 상태만 추적
            this.monitors = {
                health: { active: false, lastCheck: null },
                performance: { active: false, lastCheck: null },
                logs: { active: false, lastCheck: null },
                backup: { active: false, lastCheck: null }
            };
            
            this.log('info', '✅ 모니터링 모듈 초기화 완료');
            
        } catch (error) {
            this.log('error', '모니터링 모듈 초기화 실패', error.message);
        }
    }
    
    initializeServiceStates() {
        const services = ['backend', 'frontend', 'database', 'websocket'];
        
        for (const service of services) {
            this.state.services[service] = {
                status: 'unknown',
                lastCheck: null,
                consecutiveFailures: 0,
                pid: null
            };
            
            this.state.restartAttempts[service] = 0;
            this.state.lastRestart[service] = null;
        }
    }
    
    setupEventListeners() {
        // 자체 이벤트 리스너
        this.on('serviceDown', (service) => this.handleServiceDown(service));
        this.on('serviceUp', (service) => this.handleServiceUp(service));
        this.on('criticalAlert', (alert) => this.handleCriticalAlert(alert));
        this.on('maintenanceRequired', (task) => this.handleMaintenanceTask(task));
    }
    
    start() {
        if (this.state.isRunning) {
            this.log('warn', '워치독이 이미 실행 중입니다');
            return;
        }
        
        this.state.isRunning = true;
        this.log('info', '🚀 시스템 워치독 시작');
        
        // 주기적 체크 시작
        this.watchInterval = setInterval(() => {
            this.performWatchCheck();
        }, this.config.checkInterval);
        
        // 즉시 첫 번째 체크 실행
        this.performWatchCheck();
    }
    
    stop() {
        if (!this.state.isRunning) {
            return;
        }
        
        this.state.isRunning = false;
        
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
        }
        
        this.log('info', '⏹️ 시스템 워치독 중지');
    }
    
    async performWatchCheck() {
        try {
            this.log('info', '🔍 시스템 상태 체크 시작');
            
            // 서비스 상태 체크
            await this.checkServices();
            
            // 시스템 리소스 체크
            await this.checkSystemResources();
            
            // 모니터 상태 체크
            await this.checkMonitors();
            
            // 디스크 공간 체크
            await this.checkDiskSpace();
            
            // 프로세스 상태 체크
            await this.checkProcesses();
            
            // 알림 처리
            this.processAlerts();
            
            this.log('info', '✅ 시스템 상태 체크 완료');
            
        } catch (error) {
            this.log('error', '시스템 체크 중 오류 발생', error.message);
        }
    }
    
    async checkServices() {
        const services = ['backend', 'frontend', 'database'];
        
        for (const service of services) {
            try {
                const isHealthy = await this.checkServiceHealth(service);
                const currentStatus = this.state.services[service].status;
                
                if (isHealthy) {
                    if (currentStatus !== 'healthy') {
                        this.emit('serviceUp', service);
                    }
                    this.updateServiceStatus(service, 'healthy');
                } else {
                    if (currentStatus !== 'unhealthy') {
                        this.emit('serviceDown', service);
                    }
                    this.updateServiceStatus(service, 'unhealthy');
                }
                
            } catch (error) {
                this.log('error', `${service} 상태 체크 실패`, error.message);
                this.updateServiceStatus(service, 'error');
            }
        }
    }
    
    async checkServiceHealth(service) {
        switch (service) {
            case 'backend':
                return await this.checkBackendHealth();
            case 'frontend':
                return await this.checkFrontendHealth();
            case 'database':
                return await this.checkDatabaseHealth();
            default:
                return false;
        }
    }
    
    async checkBackendHealth() {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('curl -f http://localhost:3001/api/health', { timeout: 5000 }, (error) => {
                    resolve(!error);
                });
            });
        } catch {
            return false;
        }
    }
    
    async checkFrontendHealth() {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('curl -f http://localhost:3000', { timeout: 5000 }, (error) => {
                    resolve(!error);
                });
            });
        } catch {
            return false;
        }
    }
    
    async checkDatabaseHealth() {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('pg_isready -h localhost -p 5432', (error) => {
                    resolve(!error);
                });
            });
        } catch {
            return false;
        }
    }
    
    async checkSystemResources() {
        try {
            // CPU 로드 체크
            const loadAvg = require('os').loadavg()[0];
            if (loadAvg > this.config.alertThresholds.systemLoad) {
                this.createAlert('HIGH_SYSTEM_LOAD', `시스템 로드가 높습니다: ${loadAvg.toFixed(2)}`, 'warning');
            }
            
            // 메모리 사용률 체크
            const totalMem = require('os').totalmem();
            const freeMem = require('os').freemem();
            const memUsage = ((totalMem - freeMem) / totalMem) * 100;
            
            if (memUsage > this.config.alertThresholds.memoryUsage) {
                this.createAlert('HIGH_MEMORY_USAGE', `메모리 사용률이 높습니다: ${memUsage.toFixed(1)}%`, 'critical');
            }
            
        } catch (error) {
            this.log('error', '시스템 리소스 체크 실패', error.message);
        }
    }
    
    async checkMonitors() {
        const monitorFiles = {
            health: path.join(this.config.logDir, 'current-status.json'),
            performance: path.join(__dirname, '../metrics', `metrics-${new Date().toISOString().split('T')[0]}.json`)
        };
        
        for (const [monitor, filePath] of Object.entries(monitorFiles)) {
            try {
                if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    const ageMinutes = (Date.now() - stats.mtime.getTime()) / (1000 * 60);
                    
                    if (ageMinutes > 10) { // 10분 이상 업데이트 안됨
                        this.createAlert('MONITOR_STALE', `${monitor} 모니터 데이터가 오래됨: ${ageMinutes.toFixed(1)}분`, 'warning');
                    }
                    
                    this.monitors[monitor].active = true;
                    this.monitors[monitor].lastCheck = new Date().toISOString();
                } else {
                    this.monitors[monitor].active = false;
                    this.createAlert('MONITOR_MISSING', `${monitor} 모니터 데이터 파일 없음`, 'warning');
                }
            } catch (error) {
                this.log('error', `${monitor} 모니터 체크 실패`, error.message);
            }
        }
    }
    
    async checkDiskSpace() {
        try {
            const { exec } = require('child_process');
            
            return new Promise((resolve) => {
                exec('df -h /', (error, stdout) => {
                    if (error) {
                        resolve();
                        return;
                    }
                    
                    const lines = stdout.split('\n');
                    const data = lines[1].split(/\s+/);
                    const usage = parseInt(data[4]);
                    
                    if (usage > this.config.alertThresholds.diskUsage) {
                        this.createAlert('HIGH_DISK_USAGE', `디스크 사용률이 높습니다: ${usage}%`, 'critical');
                    }
                    
                    resolve();
                });
            });
        } catch (error) {
            this.log('error', '디스크 공간 체크 실패', error.message);
        }
    }
    
    async checkProcesses() {
        try {
            const { exec } = require('child_process');
            
            // 좀비 프로세스 체크
            exec('ps aux | awk \'$8 ~ /^Z/ { print $2 }\'', (error, stdout) => {
                if (!error && stdout.trim()) {
                    const zombies = stdout.trim().split('\n');
                    this.createAlert('ZOMBIE_PROCESSES', `좀비 프로세스 발견: ${zombies.length}개`, 'warning');
                }
            });
            
            // 높은 CPU 사용 프로세스 체크
            exec('ps aux --sort=-%cpu | head -5', (error, stdout) => {
                if (!error) {
                    const lines = stdout.split('\n').slice(1, 5);
                    for (const line of lines) {
                        const parts = line.split(/\s+/);
                        if (parts.length > 2) {
                            const cpu = parseFloat(parts[2]);
                            if (cpu > 80) {
                                this.createAlert('HIGH_CPU_PROCESS', `높은 CPU 사용 프로세스: ${parts[10]} (${cpu}%)`, 'warning');
                            }
                        }
                    }
                }
            });
            
        } catch (error) {
            this.log('error', '프로세스 체크 실패', error.message);
        }
    }
    
    updateServiceStatus(service, status) {
        const serviceState = this.state.services[service];
        const previousStatus = serviceState.status;
        
        serviceState.status = status;
        serviceState.lastCheck = new Date().toISOString();
        
        if (status === 'unhealthy' || status === 'error') {
            serviceState.consecutiveFailures++;
        } else {
            serviceState.consecutiveFailures = 0;
        }
        
        // 연속 실패 임계값 체크
        if (serviceState.consecutiveFailures >= this.config.alertThresholds.consecutiveFailures) {
            this.emit('criticalAlert', {
                service,
                message: `${service} 서비스가 ${serviceState.consecutiveFailures}회 연속 실패`,
                severity: 'critical'
            });
        }
    }
    
    handleServiceDown(service) {
        this.log('error', `🔴 서비스 다운 감지: ${service}`);
        
        if (this.config.criticalServices.includes(service) && this.config.autoRestart) {
            this.attemptServiceRestart(service);
        }
    }
    
    handleServiceUp(service) {
        this.log('success', `🟢 서비스 복구 감지: ${service}`);
        
        // 재시작 시도 횟수 리셋
        this.state.restartAttempts[service] = 0;
    }
    
    async attemptServiceRestart(service) {
        const attempts = this.state.restartAttempts[service] || 0;
        const lastRestart = this.state.lastRestart[service];
        
        // 최대 재시작 횟수 체크
        if (attempts >= this.config.maxRestartAttempts) {
            this.log('error', `${service} 최대 재시작 횟수 초과 (${attempts}/${this.config.maxRestartAttempts})`);
            this.emit('criticalAlert', {
                service,
                message: `${service} 서비스 자동 복구 실패 - 수동 개입 필요`,
                severity: 'critical'
            });
            return;
        }
        
        // 쿨다운 시간 체크
        if (lastRestart && (Date.now() - new Date(lastRestart).getTime()) < this.config.restartCooldown) {
            this.log('warn', `${service} 재시작 쿨다운 중...`);
            return;
        }
        
        this.log('info', `🔄 ${service} 서비스 재시작 시도 (${attempts + 1}/${this.config.maxRestartAttempts})`);
        
        try {
            await this.restartService(service);
            
            this.state.restartAttempts[service] = attempts + 1;
            this.state.lastRestart[service] = new Date().toISOString();
            
            this.log('success', `✅ ${service} 서비스 재시작 완료`);
            
        } catch (error) {
            this.log('error', `${service} 서비스 재시작 실패`, error.message);
            this.state.restartAttempts[service] = attempts + 1;
        }
    }
    
    async restartService(service) {
        const projectDir = path.join(__dirname, '../');
        
        return new Promise((resolve, reject) => {
            // 기존 프로세스 종료
            exec(`pkill -f "${this.getProcessPattern(service)}"`, () => {
                // 잠시 대기 후 재시작
                setTimeout(() => {
                    const startCommand = `cd ${projectDir} && ./start.sh ${service}`;
                    
                    exec(startCommand, (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(stdout);
                        }
                    });
                }, 3000);
            });
        });
    }
    
    getProcessPattern(service) {
        const patterns = {
            backend: 'node.*server.js',
            frontend: 'react-scripts',
            database: 'postgres'
        };
        
        return patterns[service] || service;
    }
    
    createAlert(type, message, severity = 'info') {
        const alert = {
            id: Date.now(),
            type,
            message,
            severity,
            timestamp: new Date().toISOString(),
            resolved: false
        };
        
        this.state.alerts.push(alert);
        
        // 알림 로그
        this.log(severity, `🚨 ALERT: ${message}`);
        
        // 심각한 알림은 즉시 처리
        if (severity === 'critical') {
            this.emit('criticalAlert', alert);
        }
        
        return alert;
    }
    
    handleCriticalAlert(alert) {
        this.log('critical', `🚨 CRITICAL ALERT: ${alert.message || alert}`);
        
        // 여기에 긴급 알림 로직 추가 (이메일, SMS, Slack 등)
        // 예: 관리자에게 즉시 알림 발송
        
        // 알림 파일 생성
        const alertFile = path.join(this.config.logDir, `critical-alert-${Date.now()}.json`);
        fs.writeFileSync(alertFile, JSON.stringify({
            timestamp: new Date().toISOString(),
            alert,
            systemState: this.getSystemState()
        }, null, 2));
    }
    
    handleMaintenanceTask(task) {
        this.log('info', `🔧 유지보수 작업 실행: ${task}`);
        
        // 유지보수 모드 활성화
        this.state.maintenanceMode = true;
        
        // 작업 완료 후 유지보수 모드 해제
        setTimeout(() => {
            this.state.maintenanceMode = false;
            this.log('info', '✅ 유지보수 작업 완료');
        }, 60000); // 1분 후
    }
    
    handleCriticalError(error) {
        this.log('critical', '💥 치명적 오류 발생', error.message || error);
        
        // 시스템 상태 저장
        const crashReport = {
            timestamp: new Date().toISOString(),
            error: error.message || error.toString(),
            stack: error.stack,
            systemState: this.getSystemState(),
            processInfo: {
                pid: process.pid,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            }
        };
        
        const crashFile = path.join(this.config.logDir, `crash-report-${Date.now()}.json`);
        fs.writeFileSync(crashFile, JSON.stringify(crashReport, null, 2));
        
        // 긴급 알림
        this.handleCriticalAlert({
            type: 'SYSTEM_CRASH',
            message: `시스템 워치독 치명적 오류: ${error.message}`,
            severity: 'critical'
        });
    }
    
    processAlerts() {
        // 해결되지 않은 알림들 처리
        const unresolvedAlerts = this.state.alerts.filter(alert => !alert.resolved);
        
        if (unresolvedAlerts.length > 10) {
            this.log('warn', `미해결 알림이 많습니다: ${unresolvedAlerts.length}개`);
        }
        
        // 오래된 알림 자동 해결 (24시간 후)
        const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
        this.state.alerts.forEach(alert => {
            if (!alert.resolved && new Date(alert.timestamp).getTime() < cutoffTime) {
                alert.resolved = true;
                alert.resolvedAt = new Date().toISOString();
                alert.resolvedBy = 'auto-timeout';
            }
        });
    }
    
    getSystemState() {
        return {
            timestamp: new Date().toISOString(),
            isRunning: this.state.isRunning,
            maintenanceMode: this.state.maintenanceMode,
            services: this.state.services,
            monitors: this.monitors,
            alerts: this.state.alerts.filter(alert => !alert.resolved),
            restartAttempts: this.state.restartAttempts
        };
    }
    
    getStatus() {
        const systemState = this.getSystemState();
        const healthyServices = Object.values(systemState.services).filter(s => s.status === 'healthy').length;
        const totalServices = Object.keys(systemState.services).length;
        
        return {
            ...systemState,
            summary: {
                overall: healthyServices === totalServices ? 'HEALTHY' : 'DEGRADED',
                healthyServices: `${healthyServices}/${totalServices}`,
                activeAlerts: systemState.alerts.length,
                uptime: process.uptime()
            }
        };
    }
    
    shutdown() {
        this.log('info', '🛑 System Watchdog 종료 중...');
        
        this.stop();
        
        // 최종 상태 저장
        const finalState = this.getSystemState();
        const stateFile = path.join(this.config.logDir, `final-state-${Date.now()}.json`);
        fs.writeFileSync(stateFile, JSON.stringify(finalState, null, 2));
        
        process.exit(0);
    }
}

// CLI 인터페이스
if (require.main === module) {
    const watchdog = new SystemWatchdog();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'status':
            console.log(JSON.stringify(watchdog.getStatus(), null, 2));
            break;
        case 'stop':
            watchdog.stop();
            break;
        default:
            // 기본적으로 워치독 실행
            console.log('System Watchdog가 실행 중입니다. Ctrl+C로 종료하세요.');
    }
}

module.exports = SystemWatchdog;