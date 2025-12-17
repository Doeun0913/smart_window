#!/usr/bin/env node
// =====================================================
// 💾 Smart Home IoT 백업 및 복구 시스템
// =====================================================
// 데이터베이스, 설정 파일, 로그 자동 백업 및 복구

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const archiver = require('archiver');
const cron = require('node-cron');

class BackupSystem {
    constructor() {
        this.config = {
            backupDir: path.join(__dirname, '../backups'),
            retentionDays: 30,
            database: {
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 5432,
                name: process.env.DB_NAME || 'iot_monitoring',
                user: process.env.DB_USER || 'postgres'
            },
            schedules: {
                database: '0 2 * * *',    // 매일 새벽 2시
                files: '0 3 * * 0',       // 매주 일요일 새벽 3시
                logs: '0 1 * * *'         // 매일 새벽 1시
            }
        };
        
        this.init();
    }
    
    init() {
        // 백업 디렉토리 생성
        if (!fs.existsSync(this.config.backupDir)) {
            fs.mkdirSync(this.config.backupDir, { recursive: true });
        }
        
        ['database', 'files', 'logs'].forEach(type => {
            const typeDir = path.join(this.config.backupDir, type);
            if (!fs.existsSync(typeDir)) {
                fs.mkdirSync(typeDir, { recursive: true });
            }
        });
        
        console.log('💾 Backup System 초기화 완료');
        this.log('info', 'Backup System 시작됨');
        
        // 스케줄 설정
        this.setupSchedules();
        
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
        
        // 백업 로그 파일
        const logFile = path.join(this.config.backupDir, `backup-${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    }
    
    setupSchedules() {
        // 데이터베이스 백업 스케줄
        cron.schedule(this.config.schedules.database, async () => {
            this.log('info', '📅 스케줄된 데이터베이스 백업 시작');
            await this.backupDatabase();
        });
        
        // 파일 백업 스케줄
        cron.schedule(this.config.schedules.files, async () => {
            this.log('info', '📅 스케줄된 파일 백업 시작');
            await this.backupFiles();
        });
        
        // 로그 백업 스케줄
        cron.schedule(this.config.schedules.logs, async () => {
            this.log('info', '📅 스케줄된 로그 백업 시작');
            await this.backupLogs();
        });
        
        // 오래된 백업 정리 스케줄 (매일 새벽 4시)
        cron.schedule('0 4 * * *', async () => {
            this.log('info', '📅 오래된 백업 정리 시작');
            await this.cleanupOldBackups();
        });
        
        this.log('info', '⏰ 백업 스케줄 설정 완료');
    }
    
    async backupDatabase() {
        try {
            this.log('info', '🗄️ 데이터베이스 백업 시작');
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(this.config.backupDir, 'database', `db-backup-${timestamp}.sql`);
            
            const command = `pg_dump -h ${this.config.database.host} -p ${this.config.database.port} -U ${this.config.database.user} -d ${this.config.database.name} > ${backupFile}`;
            
            await this.executeCommand(command);
            
            // 백업 파일 압축
            const compressedFile = `${backupFile}.gz`;
            await this.executeCommand(`gzip ${backupFile}`);
            
            // 백업 정보 저장
            const backupInfo = {
                timestamp: new Date().toISOString(),
                type: 'database',
                file: compressedFile,
                size: fs.statSync(compressedFile).size,
                database: this.config.database.name
            };
            
            const infoFile = path.join(this.config.backupDir, 'database', `db-backup-${timestamp}.json`);
            fs.writeFileSync(infoFile, JSON.stringify(backupInfo, null, 2));
            
            this.log('info', `✅ 데이터베이스 백업 완료: ${path.basename(compressedFile)}`);
            return backupInfo;
            
        } catch (error) {
            this.log('error', '❌ 데이터베이스 백업 실패', error.message);
            throw error;
        }
    }
    
    async backupFiles() {
        try {
            this.log('info', '📁 파일 백업 시작');
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(this.config.backupDir, 'files', `files-backup-${timestamp}.zip`);
            
            const projectDir = path.join(__dirname, '../');
            const filesToBackup = [
                'backend/server.js',
                'backend/package.json',
                'backend/.env',
                'frontend/package.json',
                'frontend/src/**/*',
                'database/schema.sql',
                'raspberry-pi/*.py',
                'raspberry-pi/requirements.txt',
                'start.sh',
                '.env.example'
            ];
            
            await this.createZipArchive(projectDir, filesToBackup, backupFile);
            
            // 백업 정보 저장
            const backupInfo = {
                timestamp: new Date().toISOString(),
                type: 'files',
                file: backupFile,
                size: fs.statSync(backupFile).size,
                files: filesToBackup
            };
            
            const infoFile = path.join(this.config.backupDir, 'files', `files-backup-${timestamp}.json`);
            fs.writeFileSync(infoFile, JSON.stringify(backupInfo, null, 2));
            
            this.log('info', `✅ 파일 백업 완료: ${path.basename(backupFile)}`);
            return backupInfo;
            
        } catch (error) {
            this.log('error', '❌ 파일 백업 실패', error.message);
            throw error;
        }
    }
    
    async backupLogs() {
        try {
            this.log('info', '📋 로그 백업 시작');
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(this.config.backupDir, 'logs', `logs-backup-${timestamp}.zip`);
            
            const logsDir = path.join(__dirname, '../logs');
            
            if (!fs.existsSync(logsDir)) {
                this.log('warn', '로그 디렉토리가 존재하지 않음');
                return null;
            }
            
            await this.createZipArchive(logsDir, ['**/*'], backupFile);
            
            // 백업 정보 저장
            const backupInfo = {
                timestamp: new Date().toISOString(),
                type: 'logs',
                file: backupFile,
                size: fs.statSync(backupFile).size
            };
            
            const infoFile = path.join(this.config.backupDir, 'logs', `logs-backup-${timestamp}.json`);
            fs.writeFileSync(infoFile, JSON.stringify(backupInfo, null, 2));
            
            this.log('info', `✅ 로그 백업 완료: ${path.basename(backupFile)}`);
            return backupInfo;
            
        } catch (error) {
            this.log('error', '❌ 로그 백업 실패', error.message);
            throw error;
        }
    }
    
    async createZipArchive(sourceDir, patterns, outputFile) {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(outputFile);
            const archive = archiver('zip', { zlib: { level: 9 } });
            
            output.on('close', () => {
                resolve(archive.pointer());
            });
            
            archive.on('error', (err) => {
                reject(err);
            });
            
            archive.pipe(output);
            
            // 패턴에 따라 파일 추가
            patterns.forEach(pattern => {
                if (pattern.includes('**')) {
                    archive.glob(pattern, { cwd: sourceDir });
                } else {
                    const fullPath = path.join(sourceDir, pattern);
                    if (fs.existsSync(fullPath)) {
                        if (fs.statSync(fullPath).isDirectory()) {
                            archive.directory(fullPath, pattern);
                        } else {
                            archive.file(fullPath, { name: pattern });
                        }
                    }
                }
            });
            
            archive.finalize();
        });
    }
    
    async restoreDatabase(backupFile) {
        try {
            this.log('info', `🔄 데이터베이스 복구 시작: ${backupFile}`);
            
            // 압축 해제
            let sqlFile = backupFile;
            if (backupFile.endsWith('.gz')) {
                sqlFile = backupFile.replace('.gz', '');
                await this.executeCommand(`gunzip -c ${backupFile} > ${sqlFile}`);
            }
            
            // 데이터베이스 복구
            const command = `psql -h ${this.config.database.host} -p ${this.config.database.port} -U ${this.config.database.user} -d ${this.config.database.name} < ${sqlFile}`;
            await this.executeCommand(command);
            
            // 임시 파일 정리
            if (sqlFile !== backupFile) {
                fs.unlinkSync(sqlFile);
            }
            
            this.log('info', '✅ 데이터베이스 복구 완료');
            
        } catch (error) {
            this.log('error', '❌ 데이터베이스 복구 실패', error.message);
            throw error;
        }
    }
    
    async cleanupOldBackups() {
        try {
            this.log('info', '🧹 오래된 백업 정리 시작');
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
            
            let totalDeleted = 0;
            
            for (const backupType of ['database', 'files', 'logs']) {
                const typeDir = path.join(this.config.backupDir, backupType);
                
                if (!fs.existsSync(typeDir)) continue;
                
                const files = fs.readdirSync(typeDir);
                
                for (const file of files) {
                    const filePath = path.join(typeDir, file);
                    const stats = fs.statSync(filePath);
                    
                    if (stats.mtime < cutoffDate) {
                        fs.unlinkSync(filePath);
                        totalDeleted++;
                        this.log('info', `🗑️ 삭제됨: ${file}`);
                    }
                }
            }
            
            this.log('info', `✅ 정리 완료: ${totalDeleted}개 파일 삭제`);
            
        } catch (error) {
            this.log('error', '❌ 백업 정리 실패', error.message);
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
    
    async getBackupList() {
        const backups = {
            database: [],
            files: [],
            logs: []
        };
        
        for (const type of Object.keys(backups)) {
            const typeDir = path.join(this.config.backupDir, type);
            
            if (!fs.existsSync(typeDir)) continue;
            
            const files = fs.readdirSync(typeDir)
                .filter(file => file.endsWith('.json'))
                .map(file => {
                    const filePath = path.join(typeDir, file);
                    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
                })
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            backups[type] = files;
        }
        
        return backups;
    }
    
    shutdown() {
        this.log('info', '🛑 Backup System 종료 중...');
        process.exit(0);
    }
}

// CLI 인터페이스
if (require.main === module) {
    const backup = new BackupSystem();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'database':
            backup.backupDatabase();
            break;
        case 'files':
            backup.backupFiles();
            break;
        case 'logs':
            backup.backupLogs();
            break;
        case 'restore-db':
            const backupFile = process.argv[3];
            if (!backupFile) {
                console.error('백업 파일 경로를 지정해주세요');
                process.exit(1);
            }
            backup.restoreDatabase(backupFile);
            break;
        case 'list':
            backup.getBackupList().then(list => {
                console.log(JSON.stringify(list, null, 2));
            });
            break;
        case 'cleanup':
            backup.cleanupOldBackups();
            break;
        default:
            console.log('사용법: node backup-system.js [database|files|logs|restore-db|list|cleanup]');
    }
}

module.exports = BackupSystem;