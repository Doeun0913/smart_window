#!/usr/bin/env node
// =====================================================
// 📊 Smart Home IoT 성능 모니터링 시스템
// =====================================================
// 시스템 리소스, 응답 시간, 처리량 등을 모니터링

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');
const WebSocket = require('ws');

class PerformanceMonitor {
    constructor() {
        this.config = {
            monitorInterval: 60000, // 1분마다 수집
            metricsRetention: 7 * 24 * 60, // 7일간 보관 (분 단위)
            thresholds: {
                cpu: 80,        // CPU 사용률 80% 이상
                memory: 85,     // 메모리 사용률 85% 이상
                disk: 90,       // 디스크 사용률 90% 이상
                responseTime: 5000, // 응답시간 5초 이상
                errorRate: 5    // 에러율 5% 이상
            },
            endpoints: [
                'http://localhost:3001/api/health',
                'http://localhost:3001/api/current',
                'http://localhost:3000'
            ],
            logDir: path.join(__dirname, '../logs'),
            metricsDir: path.join(__dirname, '../metrics')
        };
        
        this.metrics = {
            system: [],
            api: [],
            database: []
        };
        
        this.init();
    }
    
    init() {
        // 디렉토리 생성
        [this.config.logDir, this.config.metricsDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
        
        console.log('📊 Performance Monitor 시작됨');
        this.log('info', 'Performance Monitor 초기화 완료');
        
        // 기존 메트릭 로드
        this.loadMetrics();
        
        // 모니터링 시작
        this.startMonitoring();
        
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
        
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
        
        const logFile = path.join(this.config.logDir, `performance-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    }
    
    startMonitoring() {
        setInterval(async () => {
            await this.collectMetrics();
        }, this.config.monitorInterval);
        
        // 즉시 첫 번째 수집 실행
        this.collectMetrics();
    }
    
    async collectMetrics() {
        try {
            const timestamp = new Date().toISOString();
            
            // 시스템 메트릭 수집
            const systemMetrics = await this.collectSystemMetrics();
            systemMetrics.timestamp = timestamp;
            this.metrics.system.push(systemMetrics);
            
            // API 메트릭 수집
            const apiMetrics = await this.collectApiMetrics();
            apiMetrics.timestamp = timestamp;
            this.metrics.api.push(apiMetrics);
            
            // 데이터베이스 메트릭 수집
            const dbMetrics = await this.collectDatabaseMetrics();
            dbMetrics.timestamp = timestamp;
            this.metrics.database.push(dbMetrics);
            
            // 임계값 체크
            this.checkThresholds(systemMetrics, apiMetrics, dbMetrics);
            
            // 메트릭 저장
            this.saveMetrics();
            
            // 오래된 메트릭 정리
            this.cleanupOldMetrics();
            
            this.log('info', '📊 메트릭 수집 완료');
            
        } catch (error) {
            this.log('error', '메트릭 수집 실패', error.message);
        }
    }
    
    async collectSystemMetrics() {
        const metrics = {
            cpu: {
                usage: await this.getCpuUsage(),
                loadAverage: os.loadavg()
            },
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                usage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
            },
            disk: await this.getDiskUsage(),
            network: await this.getNetworkStats(),
            processes: await this.getProcessStats()
        };
        
        return metrics;
    }
    
    async getCpuUsage() {
        return new Promise((resolve) => {
            const startMeasure = this.cpuAverage();
            
            setTimeout(() => {
                const endMeasure = this.cpuAverage();
                const idleDifference = endMeasure.idle - startMeasure.idle;
                const totalDifference = endMeasure.total - startMeasure.total;
                const usage = 100 - ~~(100 * idleDifference / totalDifference);
                resolve(usage);
            }, 1000);
        });
    }
    
    cpuAverage() {
        const cpus = os.cpus();
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
        return new Promise((resolve, reject) => {
            exec('df -h /', (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                
                const lines = stdout.split('\n');
                const data = lines[1].split(/\s+/);
                
                resolve({
                    total: data[1],
                    used: data[2],
                    available: data[3],
                    usage: parseInt(data[4])
                });
            });
        });
    }
    
    async getNetworkStats() {
        return new Promise((resolve, reject) => {
            exec('cat /proc/net/dev', (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                
                const lines = stdout.split('\n');
                const stats = {};
                
                for (let i = 2; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line) {
                        const parts = line.split(/\s+/);
                        const interfaceName = parts[0].replace(':', '');
                        
                        if (interfaceName !== 'lo') { // loopback 제외
                            stats[interfaceName] = {
                                rxBytes: parseInt(parts[1]),
                                txBytes: parseInt(parts[9])
                            };
                        }
                    }
                }
                
                resolve(stats);
            });
        });
    }
    
    async getProcessStats() {
        return new Promise((resolve, reject) => {
            exec('ps aux | grep -E "(node|python)" | grep -v grep', (error, stdout, stderr) => {
                if (error) {
                    resolve([]); // 프로세스가 없을 수 있음
                    return;
                }
                
                const lines = stdout.split('\n').filter(line => line.trim());
                const processes = lines.map(line => {
                    const parts = line.split(/\s+/);
                    return {
                        pid: parts[1],
                        cpu: parseFloat(parts[2]),
                        memory: parseFloat(parts[3]),
                        command: parts.slice(10).join(' ')
                    };
                });
                
                resolve(processes);
            });
        });
    }
    
    async collectApiMetrics() {
        const metrics = {
            endpoints: [],
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0
        };
        
        let totalResponseTime = 0;
        
        for (const endpoint of this.config.endpoints) {
            const startTime = Date.now();
            
            try {
                const response = await axios.get(endpoint, {
                    timeout: 10000,
                    validateStatus: () => true // 모든 상태 코드 허용
                });
                
                const responseTime = Date.now() - startTime;
                totalResponseTime += responseTime;
                
                const endpointMetric = {
                    url: endpoint,
                    status: response.status,
                    responseTime,
                    success: response.status < 400
                };
                
                metrics.endpoints.push(endpointMetric);
                metrics.totalRequests++;
                
                if (endpointMetric.success) {
                    metrics.successfulRequests++;
                } else {
                    metrics.failedRequests++;
                }
                
            } catch (error) {
                const responseTime = Date.now() - startTime;
                
                metrics.endpoints.push({
                    url: endpoint,
                    status: 0,
                    responseTime,
                    success: false,
                    error: error.message
                });
                
                metrics.totalRequests++;
                metrics.failedRequests++;
            }
        }
        
        metrics.averageResponseTime = totalResponseTime / metrics.totalRequests;
        metrics.errorRate = (metrics.failedRequests / metrics.totalRequests) * 100;
        
        return metrics;
    }
    
    async collectDatabaseMetrics() {
        const metrics = {
            connections: 0,
            queries: 0,
            responseTime: 0,
            available: false
        };
        
        try {
            const startTime = Date.now();
            
            // 간단한 쿼리로 DB 상태 확인
            await new Promise((resolve, reject) => {
                exec('psql -h localhost -p 5432 -U postgres -d iot_monitoring -c "SELECT 1;" -t', 
                    (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(stdout);
                        }
                    });
            });
            
            metrics.responseTime = Date.now() - startTime;
            metrics.available = true;
            
            // 연결 수 확인
            const connectionResult = await new Promise((resolve, reject) => {
                exec('psql -h localhost -p 5432 -U postgres -d iot_monitoring -c "SELECT count(*) FROM pg_stat_activity;" -t',
                    (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(stdout.trim());
                        }
                    });
            });
            
            metrics.connections = parseInt(connectionResult) || 0;
            
        } catch (error) {
            metrics.available = false;
            metrics.error = error.message;
        }
        
        return metrics;
    }
    
    checkThresholds(systemMetrics, apiMetrics, dbMetrics) {
        const alerts = [];
        
        // CPU 사용률 체크
        if (systemMetrics.cpu.usage > this.config.thresholds.cpu) {
            alerts.push({
                type: 'CPU_HIGH',
                message: `CPU 사용률이 높습니다: ${systemMetrics.cpu.usage}%`,
                value: systemMetrics.cpu.usage,
                threshold: this.config.thresholds.cpu
            });
        }
        
        // 메모리 사용률 체크
        if (systemMetrics.memory.usage > this.config.thresholds.memory) {
            alerts.push({
                type: 'MEMORY_HIGH',
                message: `메모리 사용률이 높습니다: ${systemMetrics.memory.usage.toFixed(1)}%`,
                value: systemMetrics.memory.usage,
                threshold: this.config.thresholds.memory
            });
        }
        
        // 디스크 사용률 체크
        if (systemMetrics.disk.usage > this.config.thresholds.disk) {
            alerts.push({
                type: 'DISK_HIGH',
                message: `디스크 사용률이 높습니다: ${systemMetrics.disk.usage}%`,
                value: systemMetrics.disk.usage,
                threshold: this.config.thresholds.disk
            });
        }
        
        // API 응답 시간 체크
        if (apiMetrics.averageResponseTime > this.config.thresholds.responseTime) {
            alerts.push({
                type: 'RESPONSE_TIME_HIGH',
                message: `API 응답 시간이 느립니다: ${apiMetrics.averageResponseTime}ms`,
                value: apiMetrics.averageResponseTime,
                threshold: this.config.thresholds.responseTime
            });
        }
        
        // API 에러율 체크
        if (apiMetrics.errorRate > this.config.thresholds.errorRate) {
            alerts.push({
                type: 'ERROR_RATE_HIGH',
                message: `API 에러율이 높습니다: ${apiMetrics.errorRate.toFixed(1)}%`,
                value: apiMetrics.errorRate,
                threshold: this.config.thresholds.errorRate
            });
        }
        
        // 알림 처리
        if (alerts.length > 0) {
            this.handleAlerts(alerts);
        }
    }
    
    handleAlerts(alerts) {
        for (const alert of alerts) {
            this.log('warn', `🚨 ${alert.message}`);
            
            // 알림 파일 저장
            const alertFile = path.join(this.config.logDir, `performance-alert-${Date.now()}.json`);
            fs.writeFileSync(alertFile, JSON.stringify({
                timestamp: new Date().toISOString(),
                alerts
            }, null, 2));
        }
    }
    
    saveMetrics() {
        const metricsFile = path.join(this.config.metricsDir, `metrics-${new Date().toISOString().split('T')[0]}.json`);
        fs.writeFileSync(metricsFile, JSON.stringify(this.metrics, null, 2));
    }
    
    loadMetrics() {
        const today = new Date().toISOString().split('T')[0];
        const metricsFile = path.join(this.config.metricsDir, `metrics-${today}.json`);
        
        if (fs.existsSync(metricsFile)) {
            try {
                this.metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
                this.log('info', '기존 메트릭 로드됨');
            } catch (error) {
                this.log('warn', '메트릭 로드 실패, 새로 시작');
            }
        }
    }
    
    cleanupOldMetrics() {
        const cutoffTime = Date.now() - (this.config.metricsRetention * 60 * 1000);
        
        ['system', 'api', 'database'].forEach(type => {
            this.metrics[type] = this.metrics[type].filter(metric => {
                return new Date(metric.timestamp).getTime() > cutoffTime;
            });
        });
    }
    
    getMetricsSummary(hours = 24) {
        const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
        
        const recentMetrics = {
            system: this.metrics.system.filter(m => new Date(m.timestamp).getTime() > cutoffTime),
            api: this.metrics.api.filter(m => new Date(m.timestamp).getTime() > cutoffTime),
            database: this.metrics.database.filter(m => new Date(m.timestamp).getTime() > cutoffTime)
        };
        
        return {
            system: {
                avgCpu: this.average(recentMetrics.system.map(m => m.cpu.usage)),
                avgMemory: this.average(recentMetrics.system.map(m => m.memory.usage)),
                avgDisk: this.average(recentMetrics.system.map(m => m.disk.usage))
            },
            api: {
                avgResponseTime: this.average(recentMetrics.api.map(m => m.averageResponseTime)),
                avgErrorRate: this.average(recentMetrics.api.map(m => m.errorRate)),
                totalRequests: recentMetrics.api.reduce((sum, m) => sum + m.totalRequests, 0)
            },
            database: {
                avgResponseTime: this.average(recentMetrics.database.map(m => m.responseTime)),
                availability: (recentMetrics.database.filter(m => m.available).length / recentMetrics.database.length) * 100
            }
        };
    }
    
    average(numbers) {
        if (numbers.length === 0) return 0;
        return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
    }
    
    shutdown() {
        this.log('info', '🛑 Performance Monitor 종료 중...');
        this.saveMetrics();
        process.exit(0);
    }
}

// CLI 인터페이스
if (require.main === module) {
    const monitor = new PerformanceMonitor();
    
    const command = process.argv[2];
    
    if (command === 'summary') {
        const hours = parseInt(process.argv[3]) || 24;
        const summary = monitor.getMetricsSummary(hours);
        console.log(JSON.stringify(summary, null, 2));
    }
}

module.exports = PerformanceMonitor;