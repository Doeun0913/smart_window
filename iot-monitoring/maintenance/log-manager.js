#!/usr/bin/env node
// =====================================================
// 📝 Smart Home IoT 로그 관리 시스템
// =====================================================
// 로그 수집, 분석, 로테이션, 압축 및 검색 기능

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const readline = require('readline');
const zlib = require('zlib');

class LogManager {
    constructor() {
        this.config = {
            logDir: path.join(__dirname, '../logs'),
            maxLogSize: 100 * 1024 * 1024, // 100MB
            maxLogFiles: 10,
            retentionDays: 30,
            compressionLevel: 6,
            logSources: {
                backend: {
                    path: path.join(__dirname, '../backend'),
                    patterns: ['*.log', 'npm-debug.log*', 'error.log']
                },
                frontend: {
                    path: path.join(__dirname, '../frontend'),
                    patterns: ['*.log', 'build.log']
                },
                system: {
                    path: '/var/log',
                    patterns: ['syslog', 'auth.log', 'kern.log']
                },
                maintenance: {
                    path: path.join(__dirname, '../logs'),
                    patterns: ['*.log']
                }
            }
        };
        
        this.init();
    }
    
    init() {
        // 로그 디렉토리 생성
        if (!fs.existsSync(this.config.logDir)) {
            fs.mkdirSync(this.config.logDir, { recursive: true });
        }
        
        // 서브 디렉토리 생성
        ['backend', 'frontend', 'system', 'maintenance', 'archived'].forEach(dir => {
            const dirPath = path.join(this.config.logDir, dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
        });
        
        console.log('📝 Log Manager 초기화 완료');
        this.log('info', 'Log Manager 시작됨');
        
        // 프로세스 종료 시 정리
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }
    
    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            component: 'LogManager',
            message,
            data
        };
        
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
        
        // 자체 로그 파일
        const logFile = path.join(this.config.logDir, 'maintenance', `log-manager-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    }
    
    async collectLogs() {
        this.log('info', '📥 로그 수집 시작');
        
        const collectedLogs = {
            backend: [],
            frontend: [],
            system: [],
            maintenance: []
        };
        
        for (const [source, config] of Object.entries(this.config.logSources)) {
            try {
                if (source === 'system' && !this.hasSystemAccess()) {
                    this.log('warn', `시스템 로그 접근 권한 없음: ${source}`);
                    continue;
                }
                
                const logs = await this.findLogFiles(config.path, config.patterns);
                collectedLogs[source] = logs;
                
                // 로그 파일들을 중앙 디렉토리로 복사
                for (const logFile of logs) {
                    await this.copyLogFile(logFile, source);
                }
                
                this.log('info', `${source} 로그 수집 완료: ${logs.length}개 파일`);
                
            } catch (error) {
                this.log('error', `${source} 로그 수집 실패`, error.message);
            }
        }
        
        return collectedLogs;
    }
    
    async findLogFiles(basePath, patterns) {
        const logFiles = [];
        
        if (!fs.existsSync(basePath)) {
            return logFiles;
        }
        
        for (const pattern of patterns) {
            try {
                const command = `find ${basePath} -name "${pattern}" -type f -mtime -7`; // 최근 7일
                const result = await this.executeCommand(command);
                
                if (result.trim()) {
                    const files = result.trim().split('\n');
                    logFiles.push(...files);
                }
            } catch (error) {
                // 파일을 찾지 못한 경우는 무시
            }
        }
        
        return logFiles;
    }
    
    async copyLogFile(sourcePath, category) {
        try {
            const fileName = path.basename(sourcePath);
            const timestamp = new Date().toISOString().split('T')[0];
            const destPath = path.join(this.config.logDir, category, `${timestamp}-${fileName}`);
            
            // 이미 복사된 파일인지 확인
            if (fs.existsSync(destPath)) {
                return;
            }
            
            // 파일 복사
            fs.copyFileSync(sourcePath, destPath);
            
        } catch (error) {
            this.log('error', `로그 파일 복사 실패: ${sourcePath}`, error.message);
        }
    }
    
    async rotateLogs() {
        this.log('info', '🔄 로그 로테이션 시작');
        
        const categories = ['backend', 'frontend', 'system', 'maintenance'];
        
        for (const category of categories) {
            const categoryDir = path.join(this.config.logDir, category);
            
            if (!fs.existsSync(categoryDir)) continue;
            
            const files = fs.readdirSync(categoryDir)
                .map(file => ({
                    name: file,
                    path: path.join(categoryDir, file),
                    stats: fs.statSync(path.join(categoryDir, file))
                }))
                .filter(file => file.stats.isFile())
                .sort((a, b) => b.stats.mtime - a.stats.mtime);
            
            // 크기가 큰 파일들 압축
            for (const file of files) {
                if (file.stats.size > this.config.maxLogSize && !file.name.endsWith('.gz')) {
                    await this.compressLogFile(file.path);
                }
            }
            
            // 오래된 파일들 아카이브
            const filesToArchive = files.slice(this.config.maxLogFiles);
            for (const file of filesToArchive) {
                await this.archiveLogFile(file.path, category);
            }
        }
        
        this.log('info', '✅ 로그 로테이션 완료');
    }
    
    async compressLogFile(filePath) {
        try {
            const compressedPath = `${filePath}.gz`;
            
            if (fs.existsSync(compressedPath)) {
                return; // 이미 압축됨
            }
            
            const readStream = fs.createReadStream(filePath);
            const writeStream = fs.createWriteStream(compressedPath);
            const gzip = zlib.createGzip({ level: this.config.compressionLevel });
            
            await new Promise((resolve, reject) => {
                readStream.pipe(gzip).pipe(writeStream)
                    .on('finish', resolve)
                    .on('error', reject);
            });
            
            // 원본 파일 삭제
            fs.unlinkSync(filePath);
            
            this.log('info', `로그 파일 압축됨: ${path.basename(filePath)}`);
            
        } catch (error) {
            this.log('error', `로그 압축 실패: ${filePath}`, error.message);
        }
    }
    
    async archiveLogFile(filePath, category) {
        try {
            const fileName = path.basename(filePath);
            const archiveDir = path.join(this.config.logDir, 'archived', category);
            
            if (!fs.existsSync(archiveDir)) {
                fs.mkdirSync(archiveDir, { recursive: true });
            }
            
            const archivePath = path.join(archiveDir, fileName);
            
            // 파일 이동
            fs.renameSync(filePath, archivePath);
            
            this.log('info', `로그 파일 아카이브됨: ${fileName}`);
            
        } catch (error) {
            this.log('error', `로그 아카이브 실패: ${filePath}`, error.message);
        }
    }
    
    async cleanupOldLogs() {
        this.log('info', '🧹 오래된 로그 정리 시작');
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
        
        let totalDeleted = 0;
        
        const searchDirs = [
            this.config.logDir,
            path.join(this.config.logDir, 'archived')
        ];
        
        for (const searchDir of searchDirs) {
            totalDeleted += await this.cleanupDirectory(searchDir, cutoffDate);
        }
        
        this.log('info', `✅ 로그 정리 완료: ${totalDeleted}개 파일 삭제`);
    }
    
    async cleanupDirectory(dirPath, cutoffDate) {
        let deletedCount = 0;
        
        if (!fs.existsSync(dirPath)) {
            return deletedCount;
        }
        
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const stats = fs.statSync(itemPath);
            
            if (stats.isDirectory()) {
                deletedCount += await this.cleanupDirectory(itemPath, cutoffDate);
            } else if (stats.mtime < cutoffDate) {
                fs.unlinkSync(itemPath);
                deletedCount++;
                this.log('info', `삭제됨: ${item}`);
            }
        }
        
        return deletedCount;
    }
    
    async searchLogs(query, options = {}) {
        const {
            category = null,
            startDate = null,
            endDate = null,
            level = null,
            limit = 100
        } = options;
        
        this.log('info', `🔍 로그 검색: "${query}"`);
        
        const results = [];
        const searchDirs = category 
            ? [path.join(this.config.logDir, category)]
            : [this.config.logDir];
        
        for (const searchDir of searchDirs) {
            if (!fs.existsSync(searchDir)) continue;
            
            const files = await this.getLogFiles(searchDir, startDate, endDate);
            
            for (const file of files) {
                const matches = await this.searchInFile(file, query, level);
                results.push(...matches);
                
                if (results.length >= limit) {
                    break;
                }
            }
            
            if (results.length >= limit) {
                break;
            }
        }
        
        return results.slice(0, limit);
    }
    
    async getLogFiles(dirPath, startDate, endDate) {
        const files = [];
        
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const item of items) {
            if (item.isDirectory()) {
                const subFiles = await this.getLogFiles(path.join(dirPath, item.name), startDate, endDate);
                files.push(...subFiles);
            } else if (item.name.endsWith('.log') || item.name.endsWith('.log.gz')) {
                const filePath = path.join(dirPath, item.name);
                const stats = fs.statSync(filePath);
                
                // 날짜 필터링
                if (startDate && stats.mtime < new Date(startDate)) continue;
                if (endDate && stats.mtime > new Date(endDate)) continue;
                
                files.push(filePath);
            }
        }
        
        return files.sort((a, b) => {
            const statsA = fs.statSync(a);
            const statsB = fs.statSync(b);
            return statsB.mtime - statsA.mtime; // 최신 파일 먼저
        });
    }
    
    async searchInFile(filePath, query, level) {
        const results = [];
        
        try {
            let readStream;
            
            if (filePath.endsWith('.gz')) {
                readStream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
            } else {
                readStream = fs.createReadStream(filePath);
            }
            
            const rl = readline.createInterface({
                input: readStream,
                crlfDelay: Infinity
            });
            
            let lineNumber = 0;
            
            for await (const line of rl) {
                lineNumber++;
                
                if (line.includes(query)) {
                    try {
                        const logEntry = JSON.parse(line);
                        
                        // 레벨 필터링
                        if (level && logEntry.level !== level.toUpperCase()) {
                            continue;
                        }
                        
                        results.push({
                            file: path.basename(filePath),
                            line: lineNumber,
                            timestamp: logEntry.timestamp,
                            level: logEntry.level,
                            message: logEntry.message,
                            data: logEntry.data
                        });
                        
                    } catch (parseError) {
                        // JSON이 아닌 일반 텍스트 로그
                        results.push({
                            file: path.basename(filePath),
                            line: lineNumber,
                            content: line
                        });
                    }
                }
            }
            
        } catch (error) {
            this.log('error', `파일 검색 실패: ${filePath}`, error.message);
        }
        
        return results;
    }
    
    async generateLogReport(hours = 24) {
        this.log('info', `📊 로그 리포트 생성 (최근 ${hours}시간)`);
        
        const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
        const report = {
            period: `${hours}시간`,
            generated: new Date().toISOString(),
            summary: {
                totalLogs: 0,
                errorCount: 0,
                warningCount: 0,
                infoCount: 0
            },
            categories: {},
            topErrors: [],
            timeline: {}
        };
        
        const categories = ['backend', 'frontend', 'system', 'maintenance'];
        
        for (const category of categories) {
            const categoryDir = path.join(this.config.logDir, category);
            if (!fs.existsSync(categoryDir)) continue;
            
            const categoryReport = await this.analyzeCategoryLogs(categoryDir, cutoffTime);
            report.categories[category] = categoryReport;
            
            // 전체 통계 업데이트
            report.summary.totalLogs += categoryReport.totalLogs;
            report.summary.errorCount += categoryReport.errorCount;
            report.summary.warningCount += categoryReport.warningCount;
            report.summary.infoCount += categoryReport.infoCount;
        }
        
        // 리포트 저장
        const reportFile = path.join(this.config.logDir, `log-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        
        this.log('info', `✅ 로그 리포트 생성 완료: ${path.basename(reportFile)}`);
        
        return report;
    }
    
    async analyzeCategoryLogs(categoryDir, cutoffTime) {
        const analysis = {
            totalLogs: 0,
            errorCount: 0,
            warningCount: 0,
            infoCount: 0,
            files: []
        };
        
        const files = fs.readdirSync(categoryDir)
            .filter(file => file.endsWith('.log') || file.endsWith('.log.gz'))
            .map(file => path.join(categoryDir, file))
            .filter(filePath => {
                const stats = fs.statSync(filePath);
                return stats.mtime > cutoffTime;
            });
        
        for (const filePath of files) {
            const fileAnalysis = await this.analyzeLogFile(filePath);
            analysis.files.push(fileAnalysis);
            
            analysis.totalLogs += fileAnalysis.totalLines;
            analysis.errorCount += fileAnalysis.errorCount;
            analysis.warningCount += fileAnalysis.warningCount;
            analysis.infoCount += fileAnalysis.infoCount;
        }
        
        return analysis;
    }
    
    async analyzeLogFile(filePath) {
        const analysis = {
            file: path.basename(filePath),
            totalLines: 0,
            errorCount: 0,
            warningCount: 0,
            infoCount: 0
        };
        
        try {
            let readStream;
            
            if (filePath.endsWith('.gz')) {
                readStream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
            } else {
                readStream = fs.createReadStream(filePath);
            }
            
            const rl = readline.createInterface({
                input: readStream,
                crlfDelay: Infinity
            });
            
            for await (const line of rl) {
                analysis.totalLines++;
                
                try {
                    const logEntry = JSON.parse(line);
                    
                    switch (logEntry.level) {
                        case 'ERROR':
                            analysis.errorCount++;
                            break;
                        case 'WARN':
                        case 'WARNING':
                            analysis.warningCount++;
                            break;
                        case 'INFO':
                            analysis.infoCount++;
                            break;
                    }
                } catch (parseError) {
                    // JSON이 아닌 경우 텍스트 분석
                    if (line.toLowerCase().includes('error')) {
                        analysis.errorCount++;
                    } else if (line.toLowerCase().includes('warn')) {
                        analysis.warningCount++;
                    } else {
                        analysis.infoCount++;
                    }
                }
            }
            
        } catch (error) {
            this.log('error', `로그 파일 분석 실패: ${filePath}`, error.message);
        }
        
        return analysis;
    }
    
    hasSystemAccess() {
        try {
            fs.accessSync('/var/log', fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
    }
    
    async executeCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    }
    
    shutdown() {
        this.log('info', '🛑 Log Manager 종료 중...');
        process.exit(0);
    }
}

// CLI 인터페이스
if (require.main === module) {
    const logManager = new LogManager();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'collect':
            logManager.collectLogs();
            break;
        case 'rotate':
            logManager.rotateLogs();
            break;
        case 'cleanup':
            logManager.cleanupOldLogs();
            break;
        case 'search':
            const query = process.argv[3];
            if (!query) {
                console.error('검색어를 입력해주세요');
                process.exit(1);
            }
            logManager.searchLogs(query).then(results => {
                console.log(JSON.stringify(results, null, 2));
            });
            break;
        case 'report':
            const hours = parseInt(process.argv[3]) || 24;
            logManager.generateLogReport(hours).then(report => {
                console.log(JSON.stringify(report, null, 2));
            });
            break;
        default:
            console.log('사용법: node log-manager.js [collect|rotate|cleanup|search|report]');
    }
}

module.exports = LogManager;