#!/usr/bin/env node
// =====================================================
// 📊 Smart Home IoT 유지보수 대시보드
// =====================================================
// 웹 기반 유지보수 모니터링 대시보드

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// 유지보수 모듈들
const SystemWatchdog = require('./system-watchdog');
const HealthMonitor = require('./health-monitor');
const PerformanceMonitor = require('./performance-monitor');
const LogManager = require('./log-manager');
const BackupSystem = require('./backup-system');

class MaintenanceDashboard {
    constructor() {
        // 포트는 .env의 DASHBOARD_PORT(기본 3002)를 따름
        const DASHBOARD_PORT = process.env.DASHBOARD_PORT
            ? parseInt(process.env.DASHBOARD_PORT, 10)
            : 3002;

        this.config = {
            port: DASHBOARD_PORT,
            logDir: path.join(__dirname, '../logs'),
            metricsDir: path.join(__dirname, '../metrics'),
            backupDir: path.join(__dirname, '../backups')
        };

        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });

        this.clients = new Set();
        this.modules = {};

        this.init();
    }

    init() {
        console.log('📊 Maintenance Dashboard 초기화 중...');

        // Express 설정
        this.setupExpress();

        // WebSocket 설정
        this.setupWebSocket();

        // API 라우트 설정
        this.setupRoutes();

        // 유지보수 모듈들 초기화
        this.initializeModules();

        // 서버 시작
        this.start();
    }

    setupExpress() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, 'dashboard-ui')));

        // CORS 설정
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            next();
        });
    }

    setupWebSocket() {
        this.wss.on('connection', async (ws) => {
            console.log('📱 클라이언트 연결됨');
            this.clients.add(ws);

            // 초기 상태 전송
            try {
                const status = await this.getSystemStatus();
                this.sendToClient(ws, 'status', status);
            } catch (error) {
                console.error('초기 상태 전송 실패:', error);
                this.sendToClient(ws, 'error', { message: '상태 로드 실패' });
            }

            ws.on('close', () => {
                console.log('📱 클라이언트 연결 해제됨');
                this.clients.delete(ws);
            });

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleClientMessage(ws, data);
                } catch (error) {
                    console.error('WebSocket 메시지 파싱 오류:', error);
                }
            });
        });
    }

    setupRoutes() {
        // 시스템 상태
        this.app.get('/api/status', async (req, res) => {
            try {
                const status = await this.getSystemStatus();
                res.json(status);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // 가벼운 상태(빠른 응답용)
        this.app.get('/api/status-lite', async (req, res) => {
            try {
                const status = await this.getLiteStatus();
                res.json(status);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // 서비스 제어
        this.app.post('/api/services/:service/:action', async (req, res) => {
            try {
                const { service, action } = req.params;
                const result = await this.controlService(service, action);
                res.json({ success: true, result });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // 로그 조회
        this.app.get('/api/logs', async (req, res) => {
            try {
                const { query, category, level, limit } = req.query;
                const logs = await this.searchLogs(query, { category, level, limit: parseInt(limit) || 100 });
                res.json(logs);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // 메트릭 조회
        this.app.get('/api/metrics', (req, res) => {
            try {
                const { hours } = req.query;
                const metrics = this.getMetrics(parseInt(hours) || 24);
                res.json(metrics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // 백업 관리
        this.app.get('/api/backups', async (req, res) => {
            try {
                const backups = await this.getBackupList();
                res.json(backups);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/backups/:type', async (req, res) => {
            try {
                const { type } = req.params;
                const result = await this.createBackup(type);
                res.json({ success: true, result });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // 알림 관리
        this.app.get('/api/alerts', (req, res) => {
            try {
                const alerts = this.getAlerts();
                res.json(alerts);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/alerts/:id/resolve', (req, res) => {
            try {
                const { id } = req.params;
                const result = this.resolveAlert(id);
                res.json({ success: true, result });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // 시스템 유지보수
        this.app.post('/api/maintenance/cleanup', (req, res) => {
            try {
                this.performSystemCleanup()
                    .then(result => res.json({ success: true, result }))
                    .catch(error => res.status(500).json({ success: false, error: error.message }));
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // 성능 리포트
        this.app.post('/api/reports/performance', (req, res) => {
            try {
                this.generatePerformanceReport()
                    .then(result => res.json({ success: true, result }))
                    .catch(error => res.status(500).json({ success: false, error: error.message }));
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // 메인 대시보드 페이지
        this.app.get('/', (req, res) => {
            res.send(this.generateDashboardHTML());
        });
    }

    initializeModules() {
        try {
            // 각 모듈을 직접 인스턴스화하지 않고 상태만 추적
            this.modules = {
                watchdog: { status: 'unknown', lastUpdate: null },
                health: { status: 'unknown', lastUpdate: null },
                performance: { status: 'unknown', lastUpdate: null },
                logs: { status: 'unknown', lastUpdate: null },
                backup: { status: 'unknown', lastUpdate: null }
            };

            console.log('✅ 유지보수 모듈 상태 추적 초기화 완료');

        } catch (error) {
            console.error('유지보수 모듈 초기화 실패:', error);
        }
    }

    start() {
        this.server.listen(this.config.port, () => {
            console.log(`📊 Maintenance Dashboard 시작됨: http://localhost:${this.config.port}`);
        });

        // 주기적 상태 업데이트
        setInterval(() => {
            this.broadcastStatus();
        }, 30000); // 30초마다
    }

    // 가벼운 상태 정보 (알림/성능 메트릭 제외) - HTTP 폴링용
    async getLiteStatus() {
        return {
            timestamp: new Date().toISOString(),
            services: await this.getServiceStatus(),
            system: await this.getSystemInfo(),
            uptime: process.uptime()
        };
    }

    async getSystemStatus() {
        const status = {
            timestamp: new Date().toISOString(),
            services: await this.getServiceStatus(),
            modules: this.modules,
            system: await this.getSystemInfo(),
            alerts: await this.getAlerts(),
            uptime: process.uptime(),
            performance: await this.getPerformanceData()
        };

        return status;
    }

    async getServiceStatus() {
        // 실제 서비스 상태 체크
        const services = {
            backend: await this.checkServiceRunning('node.*server.js'),
            frontend: await this.checkServiceRunning('react-scripts|npm.*start|yarn.*start'),
            database: await this.checkServiceRunning('postgres'),
            watchdog: await this.checkServiceRunning('system-watchdog.js')
        };

        return services;
    }

    async checkServiceRunning(processPattern) {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            exec(`pgrep -f "${processPattern}"`, (error, stdout, stderr) => {
                if (error || !stdout.trim()) {
                    resolve({
                        status: 'stopped',
                        pid: null,
                        lastCheck: new Date().toISOString(),
                        error: error ? error.message : null
                    });
                } else {
                    const pids = stdout.trim().split('\n').filter(pid => pid);
                    resolve({
                        status: 'running',
                        pid: pids[0],
                        pids: pids,
                        lastCheck: new Date().toISOString()
                    });
                }
            });
        });
    }

    async getSystemInfo() {
        const os = require('os');

        // 실제 CPU 사용률 계산
        const cpuUsage = await this.getCpuUsage();

        // 디스크 사용률 가져오기
        const diskUsage = await this.getDiskUsage();

        return {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            uptime: os.uptime(),
            loadavg: os.loadavg(),
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                usage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
            },
            cpu: {
                usage: cpuUsage,
                cores: os.cpus().length
            },
            disk: diskUsage
        };
    }

    async getCpuUsage() {
        return new Promise((resolve) => {
            const startMeasure = this.cpuAverage();

            setTimeout(() => {
                const endMeasure = this.cpuAverage();
                const idleDifference = endMeasure.idle - startMeasure.idle;
                const totalDifference = endMeasure.total - startMeasure.total;
                const usage = 100 - ~~(100 * idleDifference / totalDifference);
                resolve(Math.max(0, Math.min(100, usage)));
            }, 1000);
        });
    }

    cpuAverage() {
        const cpus = require('os').cpus();
        let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;

        for (let cpu of cpus) {
            user += cpu.times.user;
            nice += cpu.times.nice;
            sys += cpu.times.sys;
            idle += cpu.times.idle;
            irq += cpu.times.irq;
        }

        const total = user + nice + sys + idle + irq;
        return { idle, total };
    }

    async getDiskUsage() {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            exec('df -h /', (error, stdout, stderr) => {
                if (error) {
                    resolve({ usage: 0, error: error.message });
                    return;
                }

                try {
                    const lines = stdout.split('\n');
                    const data = lines[1].split(/\s+/);

                    resolve({
                        total: data[1],
                        used: data[2],
                        available: data[3],
                        usage: parseInt(data[4]) || 0
                    });
                } catch (parseError) {
                    resolve({ usage: 0, error: 'Parse error' });
                }
            });
        });
    }

    async getAlerts() {
        const alerts = [];

        try {
            // 로그 파일에서 최근 알림 읽기
            if (fs.existsSync(this.config.logDir)) {
                const alertFiles = fs.readdirSync(this.config.logDir)
                    .filter(file => file.includes('alert') && file.endsWith('.json'))
                    .sort()
                    .slice(-10); // 최근 10개

                for (const file of alertFiles) {
                    const filePath = path.join(this.config.logDir, file);
                    try {
                        const alertData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (alertData.alerts) {
                            alerts.push(...alertData.alerts.map(alert => ({
                                ...alert,
                                timestamp: alertData.timestamp,
                                severity: this.getSeverityFromType(alert.type),
                                title: this.getAlertTitle(alert.type)
                            })));
                        }
                    } catch (parseError) {
                        console.error(`알림 파일 파싱 실패: ${file}`, parseError);
                    }
                }
            }

            // 실시간 시스템 상태 기반 알림 생성
            const systemAlerts = await this.generateSystemAlerts();
            alerts.push(...systemAlerts);

        } catch (error) {
            console.error('알림 로드 실패:', error);
        }

        return alerts.slice(-20); // 최근 20개만 반환
    }

    async generateSystemAlerts() {
        const alerts = [];

        try {
            // 서비스 상태 체크
            const services = await this.getServiceStatus();

            Object.entries(services).forEach(([serviceName, serviceInfo]) => {
                if (serviceInfo.status === 'stopped') {
                    alerts.push({
                        type: 'SERVICE_DOWN',
                        title: '서비스 중지',
                        message: `${serviceName} 서비스가 중지되어 있습니다`,
                        severity: serviceName === 'frontend' ? 'warning' : 'critical',
                        timestamp: new Date().toISOString(),
                        service: serviceName
                    });
                }
            });

            // 시스템 리소스 체크
            const systemInfo = await this.getSystemInfo();

            if (systemInfo.memory.usage > 85) {
                alerts.push({
                    type: 'MEMORY_HIGH',
                    title: '메모리 사용률 높음',
                    message: `메모리 사용률이 ${systemInfo.memory.usage.toFixed(1)}%입니다`,
                    severity: 'warning',
                    timestamp: new Date().toISOString()
                });
            }

            if (systemInfo.cpu.usage > 80) {
                alerts.push({
                    type: 'CPU_HIGH',
                    title: 'CPU 사용률 높음',
                    message: `CPU 사용률이 ${systemInfo.cpu.usage}%입니다`,
                    severity: 'warning',
                    timestamp: new Date().toISOString()
                });
            }

            if (systemInfo.disk.usage > 90) {
                alerts.push({
                    type: 'DISK_HIGH',
                    title: '디스크 사용률 높음',
                    message: `디스크 사용률이 ${systemInfo.disk.usage}%입니다`,
                    severity: 'critical',
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('시스템 알림 생성 실패:', error);
        }

        return alerts;
    }

    getSeverityFromType(type) {
        const severityMap = {
            'CPU_HIGH': 'warning',
            'MEMORY_HIGH': 'warning',
            'DISK_HIGH': 'critical',
            'SERVICE_DOWN': 'critical',
            'RESPONSE_TIME_HIGH': 'warning',
            'ERROR_RATE_HIGH': 'critical'
        };

        return severityMap[type] || 'info';
    }

    getAlertTitle(type) {
        const titleMap = {
            'CPU_HIGH': 'CPU 사용률 높음',
            'MEMORY_HIGH': '메모리 사용률 높음',
            'DISK_HIGH': '디스크 사용률 높음',
            'SERVICE_DOWN': '서비스 중지',
            'RESPONSE_TIME_HIGH': '응답 시간 지연',
            'ERROR_RATE_HIGH': '에러율 높음'
        };

        return titleMap[type] || '시스템 알림';
    }

    getMetrics(hours = 24) {
        const metrics = {
            system: [],
            api: [],
            database: []
        };

        try {
            const metricsFile = path.join(this.config.metricsDir, `metrics-${new Date().toISOString().split('T')[0]}.json`);

            if (fs.existsSync(metricsFile)) {
                const data = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
                const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

                // 시간 필터링
                ['system', 'api', 'database'].forEach(type => {
                    if (data[type]) {
                        metrics[type] = data[type].filter(metric =>
                            new Date(metric.timestamp).getTime() > cutoffTime
                        );
                    }
                });
            }
        } catch (error) {
            console.error('메트릭 로드 실패:', error);
        }

        return metrics;
    }

    async getBackupList() {
        const backups = {
            database: [],
            files: [],
            logs: []
        };

        try {
            for (const type of Object.keys(backups)) {
                const typeDir = path.join(this.config.backupDir, type);

                if (fs.existsSync(typeDir)) {
                    const files = fs.readdirSync(typeDir)
                        .filter(file => file.endsWith('.json'))
                        .map(file => {
                            const filePath = path.join(typeDir, file);
                            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        })
                        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                    backups[type] = files;
                }
            }
        } catch (error) {
            console.error('백업 목록 로드 실패:', error);
        }

        return backups;
    }

    async controlService(service, action) {
        const { exec } = require('child_process');
        const projectDir = path.join(__dirname, '../');

        console.log(`[${new Date().toLocaleTimeString()}] INFO: ${service} 서비스 ${action} 요청`);

        return new Promise((resolve, reject) => {
            let command;

            switch (action) {
                case 'start':
                    if (service === 'database') {
                        command = `sudo systemctl start postgresql`;
                    } else if (service === 'backend') {
                        // 백엔드 시작 시 전체 스택(all) 한 번에 기동
                        command = `cd ${projectDir} && nohup ./start.sh all > /dev/null 2>&1 &`;
                    } else {
                        command = `cd ${projectDir} && nohup ./start.sh ${service} > /dev/null 2>&1 &`;
                    }
                    break;
                case 'stop':
                    if (service === 'database') {
                        command = `sudo systemctl stop postgresql`;
                    } else {
                        command = `pkill -f "${this.getProcessPattern(service)}"`;
                    }
                    break;
                case 'restart':
                    if (service === 'database') {
                        command = `sudo systemctl restart postgresql`;
                    } else {
                        command = `pkill -f "${this.getProcessPattern(service)}" && sleep 3 && cd ${projectDir} && nohup ./start.sh ${service} > /dev/null 2>&1 &`;
                    }
                    break;
                case 'restart_all':
                    // 전체 스택 재시작: stop 후 all
                    command = `cd ${projectDir} && ./start.sh stop && sleep 3 && nohup ./start.sh all > /dev/null 2>&1 &`;
                    break;
                default:
                    reject(new Error(`알 수 없는 액션: ${action}`));
                    return;
            }

            console.log(`[${new Date().toLocaleTimeString()}] INFO: 실행 명령: ${command}`);

            exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
                // stop / restart 시 pkill 대상이 없으면 에러로 보지 않고 "이미 중지됨"으로 취급
                const isPkillNotFound = error && stderr && stderr.toString().includes('no process found');

                if (error && !isPkillNotFound) {
                    console.error(`[${new Date().toLocaleTimeString()}] ERROR: 서비스 제어 실패: ${error.message}`);
                    reject(error);
                } else {
                    console.log(`[${new Date().toLocaleTimeString()}] SUCCESS: ${service} 서비스 ${action} 완료`);
                    resolve({ stdout, stderr, service, action });
                }
            });
        });
    }

    getProcessPattern(service) {
        const patterns = {
            backend: 'node.*server.js',
            frontend: 'react-scripts',
            database: 'postgres',
            watchdog: 'system-watchdog.js'
        };

        return patterns[service] || service;
    }

    async searchLogs(query, options = {}) {
        // LogManager 인스턴스 생성하여 검색
        const logManager = new LogManager();
        return await logManager.searchLogs(query, options);
    }

    async createBackup(type) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(this.config.backupDir, type);

        // 백업 디렉토리 생성
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        switch (type) {
            case 'database':
                return await this.backupDatabase(backupDir, timestamp);
            case 'files':
                return await this.backupFiles(backupDir, timestamp);
            case 'logs':
                return await this.backupLogs(backupDir, timestamp);
            default:
                throw new Error(`알 수 없는 백업 타입: ${type}`);
        }
    }

    async backupDatabase(backupDir, timestamp) {
        const { exec } = require('child_process');
        const backupFile = path.join(backupDir, `database-backup-${timestamp}.sql`);

        return new Promise((resolve, reject) => {
            const command = `pg_dump -h localhost -p 5432 -U postgres -d iot_monitoring > "${backupFile}"`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`데이터베이스 백업 실패: ${error.message}`));
                    return;
                }

                const stats = fs.statSync(backupFile);
                const backupInfo = {
                    type: 'database',
                    timestamp: new Date().toISOString(),
                    filename: path.basename(backupFile),
                    size: stats.size,
                    path: backupFile
                };

                // 백업 정보 저장
                const infoFile = path.join(backupDir, `database-backup-${timestamp}.json`);
                fs.writeFileSync(infoFile, JSON.stringify(backupInfo, null, 2));

                resolve(backupInfo);
            });
        });
    }

    async backupFiles(backupDir, timestamp) {
        const { exec } = require('child_process');
        const backupFile = path.join(backupDir, `files-backup-${timestamp}.tar.gz`);
        const sourceDir = path.join(__dirname, '../');

        return new Promise((resolve, reject) => {
            const command = `tar -czf "${backupFile}" -C "${sourceDir}" --exclude=node_modules --exclude=logs --exclude=backups .`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`파일 백업 실패: ${error.message}`));
                    return;
                }

                const stats = fs.statSync(backupFile);
                const backupInfo = {
                    type: 'files',
                    timestamp: new Date().toISOString(),
                    filename: path.basename(backupFile),
                    size: stats.size,
                    path: backupFile
                };

                // 백업 정보 저장
                const infoFile = path.join(backupDir, `files-backup-${timestamp}.json`);
                fs.writeFileSync(infoFile, JSON.stringify(backupInfo, null, 2));

                resolve(backupInfo);
            });
        });
    }

    async backupLogs(backupDir, timestamp) {
        const { exec } = require('child_process');
        const backupFile = path.join(backupDir, `logs-backup-${timestamp}.tar.gz`);
        const logsDir = this.config.logDir;

        return new Promise((resolve, reject) => {
            if (!fs.existsSync(logsDir)) {
                reject(new Error('로그 디렉토리가 존재하지 않습니다'));
                return;
            }

            const command = `tar -czf "${backupFile}" -C "${path.dirname(logsDir)}" "${path.basename(logsDir)}"`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`로그 백업 실패: ${error.message}`));
                    return;
                }

                const stats = fs.statSync(backupFile);
                const backupInfo = {
                    type: 'logs',
                    timestamp: new Date().toISOString(),
                    filename: path.basename(backupFile),
                    size: stats.size,
                    path: backupFile
                };

                // 백업 정보 저장
                const infoFile = path.join(backupDir, `logs-backup-${timestamp}.json`);
                fs.writeFileSync(infoFile, JSON.stringify(backupInfo, null, 2));

                resolve(backupInfo);
            });
        });
    }

    resolveAlert(alertId) {
        // 알림 해결 로직
        return { resolved: true, timestamp: new Date().toISOString() };
    }

    async performSystemCleanup() {
        console.log('🧹 시스템 정리 시작');

        const results = {
            logsCleared: 0,
            tempFilesRemoved: 0,
            oldBackupsRemoved: 0,
            diskSpaceFreed: 0
        };

        try {
            // 1. 오래된 로그 파일 정리 (7일 이상)
            const logCleanupResult = await this.cleanupOldFiles(this.config.logDir, 7);
            results.logsCleared = logCleanupResult.filesRemoved;
            results.diskSpaceFreed += logCleanupResult.spaceFreed;

            // 2. 임시 파일 정리
            const tempCleanupResult = await this.cleanupTempFiles();
            results.tempFilesRemoved = tempCleanupResult.filesRemoved;
            results.diskSpaceFreed += tempCleanupResult.spaceFreed;

            // 3. 오래된 백업 파일 정리 (30일 이상)
            const backupCleanupResult = await this.cleanupOldFiles(this.config.backupDir, 30);
            results.oldBackupsRemoved = backupCleanupResult.filesRemoved;
            results.diskSpaceFreed += backupCleanupResult.spaceFreed;

            // 4. 시스템 캐시 정리
            await this.cleanSystemCache();

            console.log('✅ 시스템 정리 완료:', results);
            return results;

        } catch (error) {
            console.error('❌ 시스템 정리 실패:', error);
            throw error;
        }
    }

    async cleanupOldFiles(directory, daysOld) {
        const result = { filesRemoved: 0, spaceFreed: 0 };

        if (!fs.existsSync(directory)) {
            return result;
        }

        const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

        try {
            const files = fs.readdirSync(directory);

            for (const file of files) {
                const filePath = path.join(directory, file);
                const stats = fs.statSync(filePath);

                if (stats.mtime.getTime() < cutoffTime) {
                    result.spaceFreed += stats.size;
                    fs.unlinkSync(filePath);
                    result.filesRemoved++;
                    console.log(`삭제됨: ${filePath}`);
                }
            }
        } catch (error) {
            console.error(`파일 정리 실패 (${directory}):`, error);
        }

        return result;
    }

    async cleanupTempFiles() {
        const result = { filesRemoved: 0, spaceFreed: 0 };

        const tempDirs = ['/tmp', '/var/tmp'];

        for (const tempDir of tempDirs) {
            if (fs.existsSync(tempDir)) {
                try {
                    const { exec } = require('child_process');

                    // 1일 이상 된 임시 파일 찾기 및 삭제
                    await new Promise((resolve, reject) => {
                        exec(`find ${tempDir} -type f -name "*.tmp" -mtime +1 -delete`, (error, stdout, stderr) => {
                            if (error) {
                                console.warn(`임시 파일 정리 경고 (${tempDir}):`, error.message);
                            }
                            resolve();
                        });
                    });

                    result.filesRemoved += 1; // 대략적인 수치
                } catch (error) {
                    console.error(`임시 파일 정리 실패 (${tempDir}):`, error);
                }
            }
        }

        return result;
    }

    async cleanSystemCache() {
        try {
            const { exec } = require('child_process');

            // 시스템 캐시 정리 (안전한 명령어만 사용)
            await new Promise((resolve) => {
                exec('sync', (error) => {
                    if (error) {
                        console.warn('시스템 동기화 경고:', error.message);
                    }
                    resolve();
                });
            });

            console.log('시스템 캐시 정리 완료');
        } catch (error) {
            console.error('시스템 캐시 정리 실패:', error);
        }
    }

    async generatePerformanceReport() {
        console.log('📊 성능 리포트 생성 시작');

        try {
            // 실시간 성능 데이터 수집
            const systemInfo = await this.getSystemInfo();
            const services = await this.getServiceStatus();
            const alerts = await this.getAlerts();

            // 성능 메트릭 파일에서 데이터 로드
            let historicalData = {};
            try {
                const metricsFile = path.join(this.config.metricsDir, `metrics-${new Date().toISOString().split('T')[0]}.json`);
                if (fs.existsSync(metricsFile)) {
                    historicalData = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
                }
            } catch (error) {
                console.warn('기존 메트릭 데이터 로드 실패:', error.message);
            }

            // 평균 계산
            const avgCpu = this.calculateAverage(historicalData.system, 'cpu.usage') || systemInfo.cpu.usage;
            const avgMemory = this.calculateAverage(historicalData.system, 'memory.usage') || systemInfo.memory.usage;
            const avgDisk = this.calculateAverage(historicalData.system, 'disk.usage') || systemInfo.disk.usage;

            const report = {
                timestamp: new Date().toISOString(),
                summary: {
                    uptime: systemInfo.uptime,
                    avgCpu: avgCpu || 0,
                    avgMemory: avgMemory || 0,
                    avgDisk: avgDisk || 0,
                    totalAlerts: alerts.length,
                    criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
                    warningAlerts: alerts.filter(a => a.severity === 'warning').length,
                    systemType: 'Raspberry Pi (Cortex-A76)',
                    totalMemory: Math.round(systemInfo.memory.total / (1024 * 1024 * 1024)) + 'GB'
                },
                services: services,
                system: systemInfo,
                alerts: alerts,
                recommendations: this.generateRecommendations(systemInfo, services, alerts)
            };

            // 리포트 파일 저장
            const reportFile = path.join(this.config.logDir, `performance-report-${Date.now()}.json`);
            fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

            console.log('✅ 성능 리포트 생성 완료');
            return { reportFile, summary: report };

        } catch (error) {
            console.error('❌ 성능 리포트 생성 실패:', error);
            throw error;
        }
    }

    calculateAverage(dataArray, path) {
        if (!dataArray || !Array.isArray(dataArray) || dataArray.length === 0) {
            return null;
        }

        const values = dataArray.map(item => {
            const keys = path.split('.');
            let value = item;
            for (const key of keys) {
                if (value && Object.prototype.hasOwnProperty.call(value, key)) {
                    value = value[key];
                } else {
                    value = null;
                    break;
                }
            }
            return typeof value === 'number' ? value : null;
        }).filter(v => v !== null);

        if (values.length === 0) return null;

        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    generateRecommendations(systemInfo, services, alerts) {
        const recommendations = [];

        // 서비스 상태 기반 권장사항
        Object.entries(services).forEach(([serviceName, serviceInfo]) => {
            if (serviceInfo.status === 'stopped') {
                recommendations.push({
                    type: 'service',
                    priority: serviceName === 'frontend' ? 'medium' : 'high',
                    message: `${serviceName} 서비스가 중지되어 있습니다. 재시작을 권장합니다.`,
                    action: `${serviceName} 서비스 재시작`
                });
            }
        });

        // 시스템 리소스 기반 권장사항
        if (systemInfo.memory.usage > 85) {
            recommendations.push({
                type: 'resource',
                priority: 'high',
                message: '메모리 사용률이 높습니다. 불필요한 프로세스를 종료하거나 메모리를 추가하세요.',
                action: '메모리 최적화'
            });
        }

        if (systemInfo.cpu.usage > 80) {
            recommendations.push({
                type: 'resource',
                priority: 'medium',
                message: 'CPU 사용률이 높습니다. 시스템 부하를 확인하세요.',
                action: 'CPU 사용률 모니터링'
            });
        }

        if (systemInfo.disk.usage > 90) {
            recommendations.push({
                type: 'resource',
                priority: 'critical',
                message: '디스크 공간이 부족합니다. 불필요한 파일을 삭제하세요.',
                action: '디스크 정리'
            });
        }

        // 알림 기반 권장사항
        const criticalAlerts = alerts.filter(a => a.severity === 'critical');
        if (criticalAlerts.length > 0) {
            recommendations.push({
                type: 'alert',
                priority: 'critical',
                message: `${criticalAlerts.length}개의 심각한 알림이 있습니다. 즉시 확인이 필요합니다.`,
                action: '알림 확인 및 해결'
            });
        }

        // 기본 권장사항
        if (recommendations.length === 0) {
            recommendations.push({
                type: 'maintenance',
                priority: 'low',
                message: '시스템이 정상적으로 작동하고 있습니다. 정기적인 모니터링을 계속하세요.',
                action: '정기 점검'
            });
        }

        return recommendations;
    }

    async getPerformanceData() {
        try {
            // 최근 성능 데이터 로드
            const metricsFile = path.join(this.config.metricsDir, `metrics-${new Date().toISOString().split('T')[0]}.json`);

            if (fs.existsSync(metricsFile)) {
                const data = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));

                // 최근 1시간 데이터만 반환
                const oneHourAgo = Date.now() - (60 * 60 * 1000);

                return {
                    system: (data.system || []).filter(function (m) { return new Date(m.timestamp).getTime() > oneHourAgo; }),
                    api: (data.api || []).filter(function (m) { return new Date(m.timestamp).getTime() > oneHourAgo; }),
                    database: (data.database || []).filter(function (m) { return new Date(m.timestamp).getTime() > oneHourAgo; })
                };
            }
        } catch (error) {
            console.error('성능 데이터 로드 실패:', error);
        }

        return { system: [], api: [], database: [] };
    }

    async handleClientMessage(ws, data) {
        switch (data.type) {
            case 'getStatus':
                try {
                    const status = await this.getSystemStatus();
                    this.sendToClient(ws, 'status', status);
                } catch (error) {
                    this.sendToClient(ws, 'error', { message: error.message });
                }
                break;
            case 'controlService':
                this.controlService(data.service, data.action)
                    .then(result => this.sendToClient(ws, 'serviceResult', { success: true, result }))
                    .catch(error => this.sendToClient(ws, 'serviceResult', { success: false, error: error.message }));
                break;
            default:
                console.log('알 수 없는 메시지 타입:', data.type);
        }
    }

    sendToClient(ws, type, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type, data }));
        }
    }

    async broadcastStatus() {
        try {
            const status = await this.getSystemStatus();
            this.clients.forEach(client => {
                this.sendToClient(client, 'status', status);
            });
        } catch (error) {
            console.error('상태 브로드캐스트 실패:', error);
        }
    }

    generateDashboardHTML() {
        return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smart Home IoT - 유지보수 센터</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: #0D0D0F;
            min-height: 100vh;
            color: white;
        }
        
        .background-effects {
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 1;
        }
        
        .bg-gradient-1 {
            position: absolute;
            top: 20%;
            left: 10%;
            width: 400px;
            height: 400px;
            background: radial-gradient(circle, rgba(102, 126, 234, 0.08) 0%, transparent 70%);
            border-radius: 50%;
            filter: blur(40px);
        }
        
        .bg-gradient-2 {
            position: absolute;
            bottom: 20%;
            right: 10%;
            width: 300px;
            height: 300px;
            background: radial-gradient(circle, rgba(139, 92, 246, 0.06) 0%, transparent 70%);
            border-radius: 50%;
            filter: blur(40px);
        }
        
        .header {
            position: relative;
            z-index: 10;
            padding: 1.5rem 2rem;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        
        .header-content {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .logo {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 1.5rem;
            font-weight: bold;
            color: white;
        }
        
        .logo i {
            color: #667eea;
        }
        
        .status-indicator {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .connection-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 500;
        }
        
        .connected { 
            background: rgba(16, 185, 129, 0.15); 
            color: #10b981; 
            border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .disconnected { 
            background: rgba(239, 68, 68, 0.15); 
            color: #ef4444; 
            border: 1px solid rgba(239, 68, 68, 0.2);
        }
        
        .container {
            position: relative;
            z-index: 10;
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .dashboard-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 16px;
            padding: 1.5rem;
            transition: all 0.3s ease;
        }
        
        .card:hover {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.1);
        }
        
        .card-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1.5rem;
        }
        
        .card-icon {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1rem;
        }
        
        .system-icon { 
            background: rgba(102, 126, 234, 0.15);
            color: #667eea;
        }
        .service-icon { 
            background: rgba(244, 63, 94, 0.15);
            color: #f43f5e;
        }
        .backup-icon { 
            background: rgba(6, 182, 212, 0.15);
            color: #06b6d4;
        }
        .alert-icon { 
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
        }
        .log-icon { 
            background: rgba(139, 92, 246, 0.15);
            color: #8b5cf6;
        }
        .control-icon { 
            background: rgba(245, 158, 11, 0.15);
            color: #f59e0b;
        }
        
        .card-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: white;
        }
        
        .metric-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
        }
        
        .metric-item {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 1rem;
            border-radius: 12px;
            text-align: center;
        }
        
        .metric-value {
            font-size: 1.4rem;
            font-weight: bold;
            color: white;
            margin-bottom: 0.25rem;
        }
        
        .metric-label {
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.4);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .service-list {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        
        .service-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            transition: all 0.3s ease;
        }
        
        .service-item:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        
        .service-info {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            flex-wrap: nowrap;
        }
        
        .service-text-col {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
        }
        
        .service-status {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        
        .status-running { background: #10b981; }
        .status-stopped { background: #ef4444; }
        .status-unknown { background: rgba(255, 255, 255, 0.3); }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .service-name {
            font-weight: 500;
            color: white;
            font-size: 0.9rem;
            display: inline-flex;
            align-items: center;
        }
        
        .service-state-text {
            font-size: 0.8rem;
            color: rgba(255, 255, 255, 0.7);
            display: inline-flex;
            align-items: center;
            white-space: nowrap;
        }
        
        .service-subtext {
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.55);
            white-space: nowrap;
        }
        
        .service-controls {
            display: flex;
            gap: 0.5rem;
        }
        
        .btn {
            padding: 0.35rem 0.78rem;
            border: none;
            border-radius: 8px;
            font-size: 0.74rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            flex-direction: row;
            align-items: center;
            justify-content: center;
            gap: 0.32rem;
            white-space: nowrap;
            letter-spacing: -0.02em;
        }
        
        .btn:hover {
            transform: translateY(-1px);
        }
        
        .btn-start { 
            background: rgba(16, 185, 129, 0.15); 
            color: #10b981; 
            border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .btn-start:hover { 
            background: rgba(16, 185, 129, 0.25); 
        }
        
        .btn-stop { 
            background: rgba(239, 68, 68, 0.15); 
            color: #ef4444; 
            border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .btn-stop:hover { 
            background: rgba(239, 68, 68, 0.25); 
        }
        
        .btn-restart { 
            background: rgba(245, 158, 11, 0.15); 
            color: #f59e0b; 
            border: 1px solid rgba(245, 158, 11, 0.2);
        }
        .btn-restart:hover { 
            background: rgba(245, 158, 11, 0.25); 
        }
        
        .btn-backup { 
            background: rgba(6, 182, 212, 0.15); 
            color: #06b6d4; 
            border: 1px solid rgba(6, 182, 212, 0.2);
        }
        .btn-backup:hover { 
            background: rgba(6, 182, 212, 0.25); 
        }
        
        .backup-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.75rem;
        }
        
        .backup-item {
            padding: 0.9rem 1rem;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
            text-align: left;
            display: flex;
            flex-direction: column;
            gap: 0.3rem;
        }
        
        .backup-item:hover {
            background: rgba(255, 255, 255, 0.04);
            transform: translateY(-2px);
        }
        
        .backup-item-header {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.95rem;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.95);
            white-space: nowrap;
        }
        
        .backup-item-desc {
            font-size: 0.8rem;
            color: rgba(255, 255, 255, 0.6);
            line-height: 1.4;
        }
        
        .backup-icon-large {
            font-size: 1.3rem;
            color: #06b6d4;
            flex-shrink: 0;
        }
        
        .alert-container {
            max-height: 280px;
            overflow-y: auto;
        }
        
        .alert-item {
            padding: 1rem;
            margin-bottom: 0.75rem;
            border-radius: 12px;
            border-left: 3px solid;
            position: relative;
            background: rgba(255, 255, 255, 0.02);
        }
        
        .alert-info { 
            border-color: #06b6d4; 
            background: rgba(6, 182, 212, 0.05);
        }
        
        .alert-warning { 
            border-color: #f59e0b; 
            background: rgba(245, 158, 11, 0.05);
        }
        
        .alert-critical { 
            border-color: #ef4444; 
            background: rgba(239, 68, 68, 0.05);
        }
        
        .alert-close {
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            background: none;
            border: none;
            font-size: 1.1rem;
            cursor: pointer;
            color: rgba(255, 255, 255, 0.4);
        }
        
        .alert-close:hover {
            color: rgba(255, 255, 255, 0.8);
        }
        
        .log-container {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.05);
            color: #d4d4d4;
            padding: 1.5rem;
            border-radius: 12px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 0.8rem;
            line-height: 1.4;
            max-height: 350px;
            overflow-y: auto;
        }
        
        .log-line {
            margin-bottom: 0.25rem;
            padding: 0.25rem 0;
        }
        
        .log-timestamp {
            color: #569cd6;
        }
        
        .log-level-info { color: #4ec9b0; }
        .log-level-warn { color: #dcdcaa; }
        .log-level-error { color: #f44747; }
        
        .full-width {
            grid-column: 1 / -1;
        }
        
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            color: rgba(255, 255, 255, 0.4);
        }
        
        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-top: 2px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 0.5rem;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .success-message {
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
            border: 1px solid rgba(16, 185, 129, 0.2);
            padding: 1rem;
            border-radius: 8px;
            margin-top: 1rem;
            display: none;
        }
        
        .error-message {
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.2);
            padding: 1rem;
            border-radius: 8px;
            margin-top: 1rem;
            display: none;
        }
        
        .no-alerts {
            text-align: center; 
            color: rgba(255, 255, 255, 0.4); 
            padding: 2rem;
            font-size: 0.9rem;
        }
        
        /* 모달 스타일 */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(5px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .modal-content {
            background: #0D0D0F;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            width: 90%;
            max-width: 800px;
            max-height: 90vh;
            overflow: hidden;
            animation: slideUp 0.3s ease;
        }
        
        @keyframes slideUp {
            from { transform: translateY(50px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        .modal-header {
            padding: 1.5rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .modal-header h2 {
            color: white;
            font-size: 1.3rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .modal-header h2 i {
            color: #667eea;
        }
        
        .modal-close {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.4);
            font-size: 1.5rem;
            cursor: pointer;
            padding: 0.5rem;
            border-radius: 8px;
            transition: all 0.3s ease;
        }
        
        .modal-close:hover {
            color: rgba(255, 255, 255, 0.8);
            background: rgba(255, 255, 255, 0.05);
        }
        
        .modal-body {
            padding: 1.5rem;
            max-height: 60vh;
            overflow-y: auto;
        }
        
        .modal-footer {
            padding: 1.5rem;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            display: flex;
            gap: 1rem;
            justify-content: flex-end;
        }
        
        .report-section {
            margin-bottom: 2rem;
        }
        
        .report-section h3 {
            color: white;
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .report-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
        }
        
        .report-item {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 1rem;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .report-label {
            color: rgba(255, 255, 255, 0.6);
            font-size: 0.85rem;
        }
        
        .report-value {
            color: white;
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        .service-status-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.75rem;
        }
        
        .service-status-item {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 1rem;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .service-name {
            color: white;
            font-size: 0.9rem;
        }
        
        .service-status-badge {
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 500;
        }
        
        .service-status-badge.running {
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
            border: 1px solid rgba(16, 185, 129, 0.2);
        }
        
        .service-status-badge.stopped {
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.2);
        }
        
        .alert-summary {
            display: flex;
            gap: 1rem;
        }
        
        .alert-count {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 1rem;
            border-radius: 12px;
            text-align: center;
            flex: 1;
        }
        
        .alert-count.critical {
            border-color: rgba(239, 68, 68, 0.2);
        }
        
        .alert-count.warning {
            border-color: rgba(245, 158, 11, 0.2);
        }
        
        .alert-count.info {
            border-color: rgba(6, 182, 212, 0.2);
        }
        
        .alert-count .count {
            display: block;
            font-size: 1.5rem;
            font-weight: bold;
            color: white;
        }
        
        .alert-count .label {
            font-size: 0.8rem;
            color: rgba(255, 255, 255, 0.6);
        }
        
        .backup-summary {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        
        .backup-item {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 1rem;
            border-radius: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .backup-type {
            color: white;
            font-size: 0.9rem;
        }
        
        .backup-date {
            color: rgba(255, 255, 255, 0.6);
            font-size: 0.8rem;
        }
        
        .recommendations {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        
        .recommendation-item {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 1rem;
            border-radius: 12px;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            color: rgba(255, 255, 255, 0.8);
            font-size: 0.9rem;
        }
        
        .recommendation-item i {
            color: #667eea;
            font-size: 1rem;
        }
        
        @media (max-width: 1200px) {
            .dashboard-grid {
                grid-template-columns: 1fr 1fr;
            }
        }
        
        @media (max-width: 768px) {
            .dashboard-grid {
                grid-template-columns: 1fr;
            }
            
            .container {
                padding: 1rem;
            }
            
            .header-content {
                flex-direction: column;
                gap: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="background-effects">
        <div class="bg-gradient-1"></div>
        <div class="bg-gradient-2"></div>
    </div>
    
    <div class="header">
        <div class="header-content">
            <div class="logo">
                <i class="fas fa-tools"></i>
                Smart Home IoT - 유지보수 센터
            </div>
            <div class="status-indicator">
                <div id="connection-status" class="connection-status disconnected">
                    <i class="fas fa-circle"></i>
                    연결 중...
                </div>
            </div>
        </div>
    </div>
    
    <div class="container">
        <div class="dashboard-grid">
            <!-- 시스템 상태 -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon system-icon">
                        <i class="fas fa-server"></i>
                    </div>
                    <div class="card-title">시스템 상태</div>
                </div>
                <div class="metric-grid">
                    <div class="metric-item">
                        <div class="metric-value" id="cpu-usage">-</div>
                        <div class="metric-label">CPU 사용률</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-value" id="memory-usage">-</div>
                        <div class="metric-label">메모리 사용률</div>
                    </div>
                                    <div class="metric-item">
                                        <div class="metric-value" id="uptime">-</div>
                                        <div class="metric-label">업타임</div>
                                    </div>
                                    <div class="metric-item">
                                        <div class="metric-value" id="load-avg">-</div>
                                        <div class="metric-label">로드 평균</div>
                                    </div>
                </div>
            </div>
            
            <!-- 서비스 제어 -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon service-icon">
                        <i class="fas fa-cogs"></i>
                    </div>
            <div class="card-title">서비스 제어</div>
                </div>
                <div class="service-list">
                    <div class="service-item">
                        <div class="service-info">
                            <div class="service-status status-unknown" id="backend-status"></div>
                            <div class="service-text-col">
                                <span class="service-name">Backend API</span>
                                <span class="service-subtext" id="backend-status-text">상태 확인 중...</span>
                            </div>
                        </div>
                        <div class="service-controls">
                            <button class="btn btn-start" onclick="controlService('backend', 'start')">
                                <i class="fas fa-play"></i> 시작
                            </button>
                            <button class="btn btn-stop" onclick="controlService('backend', 'stop')">
                                <i class="fas fa-stop"></i> 중지
                            </button>
                            <button class="btn btn-restart" onclick="controlService('backend', 'restart')">
                                <i class="fas fa-redo"></i> 재시작
                            </button>
                        </div>
                    </div>
                    <div class="service-item">
                        <div class="service-info">
                            <div class="service-status status-unknown" id="frontend-status"></div>
                            <div class="service-text-col">
                                <span class="service-name">Frontend</span>
                                <span class="service-subtext" id="frontend-status-text">상태 확인 중...</span>
                            </div>
                        </div>
                        <div class="service-controls">
                            <button class="btn btn-start" onclick="controlService('frontend', 'start')">
                                <i class="fas fa-play"></i> 시작
                            </button>
                            <button class="btn btn-stop" onclick="controlService('frontend', 'stop')">
                                <i class="fas fa-stop"></i> 중지
                            </button>
                            <button class="btn btn-restart" onclick="controlService('frontend', 'restart')">
                                <i class="fas fa-redo"></i> 재시작
                            </button>
                        </div>
                    </div>
                    <div class="service-item">
                        <div class="service-info">
                            <div class="service-status status-unknown" id="database-status"></div>
                            <div class="service-text-col">
                                <span class="service-name">Database</span>
                                <span class="service-subtext" id="database-status-text">상태 확인 중...</span>
                            </div>
                        </div>
                        <div class="service-controls">
                            <button class="btn btn-start" onclick="controlService('database', 'start')">
                                <i class="fas fa-play"></i> 시작
                            </button>
                            <button class="btn btn-stop" onclick="controlService('database', 'stop')">
                                <i class="fas fa-stop"></i> 중지
                            </button>
                            <button class="btn btn-restart" onclick="controlService('database', 'restart')">
                                <i class="fas fa-redo"></i> 재시작
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 백업 관리 -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon backup-icon">
                        <i class="fas fa-database"></i>
                    </div>
                    <div class="card-title">백업 관리</div>
                </div>
                <div class="backup-grid">
                    <div class="backup-item" onclick="createBackup('database')">
                        <div class="backup-item-header">
                            <span class="backup-icon-large"><i class="fas fa-database"></i></span>
                            <span>데이터베이스 백업</span>
                        </div>
                        <div class="backup-item-desc">PostgreSQL 데이터를 SQL 파일로 저장</div>
                    </div>
                    <div class="backup-item" onclick="createBackup('files')">
                        <div class="backup-item-header">
                            <span class="backup-icon-large"><i class="fas fa-file-archive"></i></span>
                            <span>파일 백업</span>
                        </div>
                        <div class="backup-item-desc">프로젝트 소스·설정 파일을 압축</div>
                    </div>
                    <div class="backup-item" onclick="createBackup('logs')">
                        <div class="backup-item-header">
                            <span class="backup-icon-large"><i class="fas fa-file-alt"></i></span>
                            <span>로그 백업</span>
                        </div>
                        <div class="backup-item-desc">최근 로그들을 묶어서 보관</div>
                    </div>
                    <div class="backup-item" onclick="viewBackups()">
                        <div class="backup-item-header">
                            <span class="backup-icon-large"><i class="fas fa-history"></i></span>
                            <span>백업 이력</span>
                        </div>
                        <div class="backup-item-desc">생성된 백업 목록을 확인</div>
                    </div>
                </div>
                <div id="backup-status"></div>
            </div>
            
            <!-- 알림 -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon alert-icon">
                        <i class="fas fa-bell"></i>
                    </div>
                    <div class="card-title">시스템 알림</div>
                </div>
                <div class="alert-container" id="alerts">
                    <div class="loading">
                        <div class="spinner"></div>
                        알림을 로드하는 중...
                    </div>
                </div>
            </div>
            
            <!-- 빠른 작업 -->
            <div class="card">
                <div class="card-header">
                    <div class="card-icon control-icon">
                        <i class="fas fa-tools"></i>
                    </div>
                    <div class="card-title">빠른 작업</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <button class="btn btn-backup" onclick="restartAllServices()">
                        <i class="fas fa-sync-alt"></i> 모든 서비스 재시작
                    </button>
                    <button class="btn btn-backup" onclick="cleanupSystem()">
                        <i class="fas fa-broom"></i> 시스템 정리
                    </button>
                    <button class="btn btn-backup" onclick="generateReport()">
                        <i class="fas fa-chart-line"></i> 성능 리포트 생성
                    </button>
                    <button class="btn btn-backup" onclick="openMainDashboard()">
                        <i class="fas fa-external-link-alt"></i> 메인 대시보드 열기
                    </button>
                </div>
            </div>
            
            <!-- 실시간 로그 -->
            <div class="card full-width">
                <div class="card-header">
                    <div class="card-icon log-icon">
                        <i class="fas fa-terminal"></i>
                    </div>
                    <div class="card-title">실시간 시스템 로그</div>
                </div>
                <div class="log-container" id="logs">
                    <div class="loading">
                        <div class="spinner"></div>
                        로그를 로드하는 중...
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let ws;
        let logBuffer = [];
        const maxLogLines = 100;
        // 현재 알림 목록 (X 버튼 동작을 위해 보관)
        let currentAlerts = [];
        // 사용자가 숨기기로 한 알림 키 집합 (페이지 열려있는 동안 유지)
        const dismissedAlertKeys = new Set();
        
        function connectWebSocket() {
            const connectionStatus = document.getElementById('connection-status');
            
            try {
                // 현재 페이지가 열린 호스트/포트를 그대로 사용 (원격 접속/localhost 모두 대응)
                const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                const wsUrl = wsProtocol + window.location.host;
                ws = new WebSocket(wsUrl);
                
                ws.onopen = function() {
                    console.log('WebSocket 연결됨');
                    connectionStatus.className = 'connection-status connected';
                    connectionStatus.innerHTML = '<i class="fas fa-circle"></i> 연결됨';
                    
                    // 초기 상태 요청
                    ws.send(JSON.stringify({ type: 'getStatus' }));
                    
                    // 로그 스트림 시작
                    startLogStream();
                };
                
                ws.onmessage = function(event) {
                    try {
                        const message = JSON.parse(event.data);
                        handleMessage(message);
                    } catch (error) {
                        console.error('메시지 파싱 오류:', error);
                    }
                };
                
                ws.onclose = function() {
                    console.log('WebSocket 연결 해제됨');
                    connectionStatus.className = 'connection-status disconnected';
                    connectionStatus.innerHTML = '<i class="fas fa-circle"></i> 연결 끊김';
                    
                    // 5초 후 재연결 시도
                    setTimeout(connectWebSocket, 5000);
                };
                
                ws.onerror = function(error) {
                    console.error('WebSocket 오류:', error);
                    connectionStatus.className = 'connection-status disconnected';
                    connectionStatus.innerHTML = '<i class="fas fa-circle"></i> 연결 오류';
                };
                
            } catch (error) {
                console.error('WebSocket 연결 실패:', error);
                connectionStatus.className = 'connection-status disconnected';
                connectionStatus.innerHTML = '<i class="fas fa-circle"></i> 연결 실패';
                setTimeout(connectWebSocket, 5000);
            }
        }
        
        function handleMessage(message) {
            switch (message.type) {
                case 'status':
                    updateStatus(message.data);
                    break;
                case 'serviceResult':
                    handleServiceResult(message.data);
                    break;
                case 'log':
                    addLogLine(message.data);
                    break;
                case 'backupResult':
                    handleBackupResult(message.data);
                    break;
            }
        }
        
        // HTTP 폴링(WS 불안정 시 백업)
        async function pollStatus() {
            const connectionStatus = document.getElementById('connection-status');
            try {
                const res = await fetch('/api/status-lite', { cache: 'no-cache' });
                if (!res.ok) throw new Error('status fetch failed');
                const data = await res.json();
                updateStatus(data);
                // 폴링으로라도 데이터가 오면 연결 상태를 표시
                connectionStatus.className = 'connection-status connected';
                connectionStatus.innerHTML = '<i class="fas fa-circle"></i> 연결됨 (HTTP 폴링)';
            } catch (err) {
                console.error('HTTP 상태 폴링 실패:', err);
                // WS가 알아서 재시도하지만, 폴링 실패 시 연결 상태는 건드리지 않음
            }
        }
        
        function updateStatus(status) {
            // 시스템 정보 업데이트
            if (status.system) {
                const cpu = status.system.cpu ? status.system.cpu.usage.toFixed(1) + '%' : 'N/A';
                const memory = status.system.memory ? status.system.memory.usage.toFixed(1) + '%' : 'N/A';
                const uptime = status.system.uptime ? formatUptime(status.system.uptime) : 'N/A';
                const loadAvg = status.system.loadavg && Array.isArray(status.system.loadavg)
                    ? status.system.loadavg.map(l => l.toFixed(2)).join(' / ')
                    : 'N/A';
                
                document.getElementById('cpu-usage').textContent = cpu;
                document.getElementById('memory-usage').textContent = memory;
                document.getElementById('uptime').textContent = uptime;
                document.getElementById('load-avg').textContent = loadAvg;
                
                // 색상 업데이트 (사용률에 따라)
                // 일부 브라우저(특히 라즈베리파이 기본 브라우저)에서 optional chaining(?.)을
                // 지원하지 않아 스크립트 전체가 죽는 문제가 있어, 안전한 접근 방식으로 변경
                var cpuUsage = status.system.cpu && typeof status.system.cpu.usage === 'number'
                    ? status.system.cpu.usage
                    : 0;
                var memUsage = status.system.memory && typeof status.system.memory.usage === 'number'
                    ? status.system.memory.usage
                    : 0;
                updateMetricColor('cpu-usage', cpuUsage);
                updateMetricColor('memory-usage', memUsage);
            }
            
            // 서비스 상태 업데이트
            if (status.services) {
                updateServiceStatus('backend', status.services.backend);
                updateServiceStatus('frontend', status.services.frontend);
                updateServiceStatus('database', status.services.database);
            }
            
            // 알림 업데이트
            if (status.alerts) {
                updateAlerts(status.alerts);
            }
        }
        
        function updateMetricColor(elementId, value) {
            const element = document.getElementById(elementId);
            if (!element) return;
            
            // 기존 색상 클래스 제거
            element.classList.remove('metric-normal', 'metric-warning', 'metric-critical');
            
            // 사용률에 따른 색상 적용
            if (value < 70) {
                element.style.color = '#10b981'; // 녹색
            } else if (value < 85) {
                element.style.color = '#f59e0b'; // 주황색
            } else {
                element.style.color = '#ef4444'; // 빨간색
            }
        }
        
        function updateServiceStatus(service, status) {
            const statusElement = document.getElementById(service + '-status');
            const textElement = document.getElementById(service + '-status-text');
            
            if (statusElement && status) {
                statusElement.className = 'service-status status-' + (status.status || 'unknown');
            }
            
            if (textElement && status) {
                if (status.status === 'running') {
                    textElement.textContent = '실행 중 (PID ' + (status.pid || '?') + ')';
                } else if (status.status === 'stopped') {
                    textElement.textContent = '중지됨';
                } else {
                    textElement.textContent = '상태 알 수 없음';
                }
            }
        }
        
        function makeAlertKey(alert) {
            // 알림을 유일하게 구분할 수 있는 키 생성
            const type = alert.type || '';
            const message = alert.message || '';
            const ts = alert.timestamp || alert.created_at || '';
            return [type, message, ts].join('|');
        }
        
        function updateAlerts(alerts) {
            const alertsContainer = document.getElementById('alerts');
            
            if (!alerts || alerts.length === 0) {
                alertsContainer.innerHTML = '<div class="no-alerts">활성 알림이 없습니다 ✅</div>';
                return;
            }
            
            // 사용자가 숨기지 않은 알림만 남김
            const sourceAlerts = Array.isArray(alerts) ? alerts : [];
            const visibleAlerts = sourceAlerts.filter(alert => {
                const key = makeAlertKey(alert);
                return !dismissedAlertKeys.has(key);
            });
            
            // 내부 상태로 보관
            currentAlerts = visibleAlerts.slice();
            
            // 최근 5개 알림만 표시
            const recentAlerts = currentAlerts.slice(-5);
            
            alertsContainer.innerHTML = recentAlerts.map((alert, index) => {
                const severity = alert.severity || 'info';
                const title = alert.title || alert.type || '알림';
                const message = alert.message || '내용 없음';
                const timestamp = alert.timestamp ? new Date(alert.timestamp).toLocaleString() : '';
                
                return \`
                    <div class="alert-item alert-\${severity}">
                        <button class="alert-close" onclick="dismissAlert(\${index})">&times;</button>
                        <div style="color: white; font-weight: 500; margin-bottom: 0.5rem;">\${title}</div>
                        <div style="color: rgba(255,255,255,0.8); font-size: 0.85rem; margin-bottom: 0.5rem;">\${message}</div>
                        <small style="color: rgba(255,255,255,0.4); font-size: 0.75rem;">
                            \${timestamp}
                        </small>
                    </div>
                \`;
            }).join('');
        }
        
        function addLogLine(logData) {
            const timestamp = new Date().toLocaleTimeString();
            const level = logData.level || 'INFO';
            const message = logData.message || logData;
            
            logBuffer.push({
                timestamp,
                level,
                message
            });
            
            // 최대 라인 수 제한
            if (logBuffer.length > maxLogLines) {
                logBuffer.shift();
            }
            
            updateLogDisplay();
        }
        
        function updateLogDisplay() {
            const logsContainer = document.getElementById('logs');
            
            if (logBuffer.length === 0) {
                logsContainer.innerHTML = '<div class="loading"><div class="spinner"></div>로그를 기다리는 중...</div>';
                return;
            }
            
            logsContainer.innerHTML = logBuffer.map(log => \`
                <div class="log-line">
                    <span class="log-timestamp">[\${log.timestamp}]</span>
                    <span class="log-level-\${log.level.toLowerCase()}">\${log.level}:</span>
                    \${log.message}
                </div>
            \`).join('');
            
            // 자동 스크롤
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }
        
        function startLogStream() {
            // 실시간 로그 시뮬레이션
            setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    // 시스템 상태 업데이트 요청
                    ws.send(JSON.stringify({ type: 'getStatus' }));
                }
            }, 10000); // 10초마다
            
            // 샘플 로그 추가
            addLogLine({ level: 'INFO', message: '유지보수 대시보드 연결됨' });
            addLogLine({ level: 'INFO', message: '시스템 모니터링 시작' });
        }
        
        function controlService(service, action) {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                showMessage('WebSocket 연결이 필요합니다', 'error');
                return;
            }
            
            addLogLine({ level: 'INFO', message: \`\${service} 서비스 \${action} 요청\` });
            
            ws.send(JSON.stringify({
                type: 'controlService',
                service: service,
                action: action
            }));
        }
        
        function createBackup(type) {
            addLogLine({ level: 'INFO', message: \`\${type} 백업 시작\` });
            
            fetch(\`/api/backups/\${type}\`, { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        showMessage(\`\${type} 백업이 성공적으로 생성되었습니다\`, 'success');
                        addLogLine({ level: 'INFO', message: \`\${type} 백업 완료\` });
                    } else {
                        showMessage(\`백업 실패: \${data.error}\`, 'error');
                        addLogLine({ level: 'ERROR', message: \`\${type} 백업 실패: \${data.error}\` });
                    }
                })
                .catch(error => {
                    showMessage(\`백업 오류: \${error.message}\`, 'error');
                    addLogLine({ level: 'ERROR', message: \`백업 오류: \${error.message}\` });
                });
        }
        
        function restartAllServices() {
            addLogLine({ level: 'INFO', message: '모든 서비스 재시작 시작' });
            
            // 서버 측에서 전체 스택 재시작 (stop + start all)
            controlService('backend', 'restart_all');
        }
        
        function cleanupSystem() {
            addLogLine({ level: 'INFO', message: '시스템 정리 시작' });
            
            fetch('/api/maintenance/cleanup', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        showMessage('시스템 정리가 완료되었습니다', 'success');
                        addLogLine({ level: 'INFO', message: '시스템 정리 완료' });
                    } else {
                        showMessage(\`정리 실패: \${data.error}\`, 'error');
                    }
                })
                .catch(error => {
                    showMessage(\`정리 오류: \${error.message}\`, 'error');
                });
        }
        
        function generateReport() {
            addLogLine({ level: 'INFO', message: '성능 리포트 생성 중' });
            
            fetch('/api/reports/performance', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        showMessage('성능 리포트가 생성되었습니다', 'success');
                        addLogLine({ level: 'INFO', message: '성능 리포트 생성 완료' });
                        
                        // 성능 리포트를 팝업으로 표시
                        showPerformanceReportModal(data.result);
                    } else {
                        showMessage(\`리포트 생성 실패: \${data.error}\`, 'error');
                    }
                })
                .catch(error => {
                    showMessage(\`리포트 오류: \${error.message}\`, 'error');
                });
        }
        
        function showPerformanceReportModal(reportData) {
            // 백엔드에서 반환된 구조 정규화
            // result: { reportFile, summary: { timestamp, summary:{...}, services, system, alerts, recommendations } }
            var report = (reportData && reportData.summary) || reportData || {};
            var summary = (report && report.summary) || {};
            var services = report.services || {};
            var alertsSummary = summary || {};
            
            var systemType = summary.systemType || 'Raspberry Pi';
            var uptimeSeconds = summary.uptime || (report.system && report.system.uptime) || 0;
            var totalMemory;
            if (summary.totalMemory) {
                totalMemory = summary.totalMemory;
            } else if (report.system && report.system.memory && typeof report.system.memory.total === 'number') {
                totalMemory = Math.round(report.system.memory.total / (1024 * 1024 * 1024)) + 'GB';
            } else {
                totalMemory = 'N/A';
            }
            
            var avgCpu;
            if (typeof summary.avgCpu === 'number') {
                avgCpu = summary.avgCpu;
            } else if (report.system && report.system.cpu && typeof report.system.cpu.usage === 'number') {
                avgCpu = report.system.cpu.usage;
            } else {
                avgCpu = 0;
            }
            
            var avgMem;
            if (typeof summary.avgMemory === 'number') {
                avgMem = summary.avgMemory;
            } else if (report.system && report.system.memory && typeof report.system.memory.usage === 'number') {
                avgMem = report.system.memory.usage;
            } else {
                avgMem = 0;
            }
            // 모달 HTML 생성
                            const modalHTML = \`
                <div id="reportModal" class="modal-overlay">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2><i class="fas fa-chart-line"></i> 성능 리포트</h2>
                            <button class="modal-close" onclick="closeReportModal()">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="report-section">
                                <h3>📊 시스템 개요</h3>
                                <div class="report-grid">
                                    <div class="report-item">
                                        <span class="report-label">리포트 생성 시간</span>
                                        <span class="report-value">\${new Date().toLocaleString()}</span>
                                    </div>
                                    <div class="report-item">
                                        <span class="report-label">시스템 타입</span>
                                        <span class="report-value">\${systemType}</span>
                                    </div>
                                    <div class="report-item">
                                        <span class="report-label">시스템 업타임</span>
                                        <span class="report-value">\${formatUptime(uptimeSeconds)}</span>
                                    </div>
                                    <div class="report-item">
                                        <span class="report-label">총 메모리</span>
                                        <span class="report-value">\${totalMemory}</span>
                                    </div>
                                    <div class="report-item">
                                        <span class="report-label">평균 CPU 사용률</span>
                                        <span class="report-value">\${Number.isFinite(avgCpu) ? avgCpu.toFixed(1) : '실시간'}%</span>
                                    </div>
                                    <div class="report-item">
                                        <span class="report-label">평균 메모리 사용률</span>
                                        <span class="report-value">\${Number.isFinite(avgMem) ? avgMem.toFixed(1) : '실시간'}%</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="report-section">
                                <h3>🔧 서비스 상태</h3>
                                <div class="service-status-grid">
                                    \${Object.entries(services).map(([serviceName, serviceInfo]) => \`
                                        <div class="service-status-item">
                                            <span class="service-name">\${serviceName.charAt(0).toUpperCase() + serviceName.slice(1)}</span>
                                            <span class="service-status-badge \${serviceInfo.status}">
                                                \${serviceInfo.status === 'running' ? '실행 중' : '중지됨'}
                                            </span>
                                        </div>
                                    \`).join('')}
                                </div>
                            </div>
                            
                            <div class="report-section">
                                <h3>⚠️ 최근 알림</h3>
                                <div class="alert-summary">
                                    <div class="alert-count critical">
                                        <span class="count">\${alertsSummary.criticalAlerts || 0}</span>
                                        <span class="label">심각</span>
                                    </div>
                                    <div class="alert-count warning">
                                        <span class="count">\${alertsSummary.warningAlerts || 0}</span>
                                        <span class="label">경고</span>
                                    </div>
                                    <div class="alert-count info">
                                        <span class="count">\${(alertsSummary.totalAlerts || 0) - (alertsSummary.criticalAlerts || 0) - (alertsSummary.warningAlerts || 0)}</span>
                                        <span class="label">정보</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="report-section">
                                <h3>💾 백업 상태</h3>
                                <div class="backup-summary">
                                    <div class="backup-item">
                                        <span class="backup-type">데이터베이스</span>
                                        <span class="backup-date">마지막: 오늘</span>
                                    </div>
                                    <div class="backup-item">
                                        <span class="backup-type">파일 시스템</span>
                                        <span class="backup-date">마지막: 어제</span>
                                    </div>
                                    <div class="backup-item">
                                        <span class="backup-type">로그 파일</span>
                                        <span class="backup-date">마지막: 오늘</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="report-section">
                                <h3>📈 권장사항</h3>
                                <div class="recommendations">
                                    \${(reportData.recommendations || []).map(rec => \`
                                        <div class="recommendation-item">
                                            <i class="fas \${getRecommendationIcon(rec.type)}"></i>
                                            <span>\${rec.message}</span>
                                        </div>
                                    \`).join('')}
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-backup" onclick="downloadReport()">
                                <i class="fas fa-download"></i> 리포트 다운로드
                            </button>
                            <button class="btn btn-restart" onclick="closeReportModal()">
                                <i class="fas fa-times"></i> 닫기
                            </button>
                        </div>
                    </div>
                </div>
            \`;
            
            // 모달을 body에 추가
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
        
        function closeReportModal() {
            const modal = document.getElementById('reportModal');
            if (modal) {
                modal.remove();
            }
        }
        
        function downloadReport() {
            // 리포트 다운로드 기능
            const reportContent = document.querySelector('.modal-body').innerText;
            const blob = new Blob([reportContent], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`performance-report-\${new Date().toISOString().split('T')[0]}.txt\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showMessage('리포트가 다운로드되었습니다', 'success');
        }
        
        function openMainDashboard() {
            // 메인 모니터링 대시보드는 프론트엔드(3000)
            window.open('http://localhost:3000', '_blank');
            addLogLine({ level: 'INFO', message: '메인 대시보드 열기' });
        }
        
        function viewBackups() {
            fetch('/api/backups')
                .then(response => response.json())
                .then(data => {
                    console.log('백업 목록:', data);
                    showMessage('백업 목록을 콘솔에서 확인하세요', 'success');
                })
                .catch(error => {
                    showMessage(\`백업 목록 조회 실패: \${error.message}\`, 'error');
                });
        }
        
        function dismissAlert(index) {
            if (!Array.isArray(currentAlerts) || currentAlerts.length === 0) {
                return;
            }
            
            const target = currentAlerts[index];
            if (!target) return;
            
            // 이 알림을 "숨김" 집합에 추가 (이후 상태 업데이트에서도 제외)
            const key = makeAlertKey(target);
            dismissedAlertKeys.add(key);
            
            // 선택된 알림 제거 후 다시 렌더링
            currentAlerts.splice(index, 1);
            updateAlerts(currentAlerts);
            
            addLogLine({ level: 'INFO', message: '알림 숨김: ' + (target.type || target.title || '알림') });
        }
        
        function handleServiceResult(result) {
            if (result.success) {
                showMessage('서비스 제어가 완료되었습니다', 'success');
                addLogLine({ level: 'INFO', message: '서비스 제어 완료' });
            } else {
                showMessage(\`서비스 제어 실패: \${result.error}\`, 'error');
                addLogLine({ level: 'ERROR', message: \`서비스 제어 실패: \${result.error}\` });
            }
        }
        
        function showMessage(message, type) {
            const backupStatus = document.getElementById('backup-status');
            const messageClass = type === 'success' ? 'success-message' : 'error-message';
            
            backupStatus.innerHTML = \`<div class="\${messageClass}" style="display: block;">\${message}</div>\`;
            
            // 3초 후 메시지 숨기기
            setTimeout(() => {
                backupStatus.innerHTML = '';
            }, 3000);
        }
        
        function formatUptime(seconds) {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            
            if (days > 0) {
                return \`\${days}일 \${hours}시간\`;
            } else if (hours > 0) {
                return \`\${hours}시간 \${minutes}분\`;
            } else {
                return \`\${minutes}분\`;
            }
        }
        
        function getRecommendationIcon(type) {
            const iconMap = {
                'service': 'fa-cogs',
                'resource': 'fa-exclamation-triangle',
                'alert': 'fa-bell',
                'maintenance': 'fa-info-circle'
            };
            return iconMap[type] || 'fa-info-circle';
        }
        
        // 초기화
        document.addEventListener('DOMContentLoaded', function() {
            connectWebSocket();
            
            // HTTP 폴링 백업 (10초 간격)
            pollStatus();
            setInterval(pollStatus, 10000);
            
            // 주기적 상태 업데이트
            setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'getStatus' }));
                }
            }, 30000); // 30초마다
        });
    </script>
</body>
</html>
        `;
    }
}

// 스크립트 직접 실행시
if (require.main === module) {
    new MaintenanceDashboard();
}

module.exports = MaintenanceDashboard;