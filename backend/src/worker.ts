import { Worker, Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as fastCsv from 'fast-csv';
import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';
import { isValid, format, parse } from 'date-fns';
import dotenv from 'dotenv';
import Redis from 'ioredis';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SHARED_OUTPUTS_DIR = path.resolve(__dirname, '../../shared_volume/outputs');
const CHUNK_SIZE = 50000;

fs.mkdirSync(SHARED_OUTPUTS_DIR, { recursive: true });

const redisConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 4 });
const workerOptions = { connection: redisConnection as any };

const getFuzzyVal = (row: any, patterns: RegExp[]): { key: string; val: any } | null => {
    for (const key of Object.keys(row)) {
        const cleanKey = key.trim().toLowerCase();
        for (const pattern of patterns) {
            if (pattern.test(cleanKey)) {
                return { key, val: row[key] };
            }
        }
    }
    return null;
};

const isValEmpty = (val: any): boolean => {
    if (val === null || val === undefined) return true;
    if (typeof val === 'string' && val.trim() === '') return true;
    return false;
};

const parseMessyDate = (dateStr: string): Date | null => {
    dateStr = dateStr.trim();
    if (!dateStr) return null;

    // 1. Try standard JS Date parsing
    let parsed = new Date(dateStr);
    if (isValid(parsed) && !isNaN(parsed.getTime())) {
        return parsed;
    }

    // 2. Try common custom formats using date-fns parse
    const formats = [
        'yyyy-MM-dd',
        'dd/MM/yyyy',
        'MM/dd/yyyy',
        'yyyy/MM/dd',
        'dd-MM-yyyy',
        'MM-dd-yyyy',
        'dd.MM.yyyy',
        'yyyy.MM.dd',
        'yyyy-MM-dd HH:mm:ss',
        'dd/MM/yyyy HH:mm:ss',
        'MM/dd/yyyy HH:mm:ss',
        'yyyy/MM/dd HH:mm:ss',
        'dd-MM-yyyy HH:mm:ss',
        'MM-dd-yyyy HH:mm:ss',
        'yyyy-MM-dd\'T\'HH:mm:ss.SSSxxx',
        'yyyy-MM-dd\'T\'HH:mm:ssxxx',
        'yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'',
        'yyyy-MM-dd\'T\'HH:mm:ss\'Z\''
    ];

    const referenceDate = new Date();
    for (const fmt of formats) {
        try {
            parsed = parse(dateStr, fmt, referenceDate);
            if (isValid(parsed) && !isNaN(parsed.getTime())) {
                return parsed;
            }
        } catch {
            // Ignore format errors
        }
    }

    // 3. Try UNIX timestamp (seconds or milliseconds)
    if (/^\d+$/.test(dateStr)) {
        const num = parseInt(dateStr, 10);
        const dateFromTimestamp = new Date(num < 50000000000 ? num * 1000 : num);
        if (isValid(dateFromTimestamp) && !isNaN(dateFromTimestamp.getTime())) {
            return dateFromTimestamp;
        }
    }

    return null;
};

const processCsvJob = async (job: Job) => {
    const { jobId, filePath } = job.data;
    const jobOutputDir = path.join(SHARED_OUTPUTS_DIR, jobId);
    
    if (!fs.existsSync(filePath)) {
        throw new Error("Input CSV file not found");
    }

    fs.mkdirSync(jobOutputDir, { recursive: true });

    let validRowsCount = 0;
    let totalProcessed = 0;
    let chunkIndex = 1;
    
    let currentCsvStream: fastCsv.CsvFormatterStream<fastCsv.FormatterRow, fastCsv.FormatterRow> | null = null;
    let currentWriteStream: fs.WriteStream | null = null;

    const openNewChunk = (headers: string[]) => {
        if (currentCsvStream) {
            currentCsvStream.end();
        }
        const chunkPath = path.join(jobOutputDir, `chunk_${chunkIndex}.csv`);
        currentWriteStream = fs.createWriteStream(chunkPath, { encoding: 'utf8' });
        currentCsvStream = fastCsv.format({ headers: true });
        currentCsvStream.pipe(currentWriteStream);
        chunkIndex++;
    };

    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
            .pipe(fastCsv.parse({ headers: true, trim: true }))
            .on('error', error => reject(error))
            .on('data', (row: any) => {
                totalProcessed++;

                // 1. Sanitize & Normalize Headers (Crucial for Google Sheets CSVs)
                const cleanRowKeys: any = {};
                for (const key in row) {
                    // This line removes the invisible \uFEFF character and makes everything lowercase
                    const safeKey = key.replace(/^\uFEFF/, '').trim().toLowerCase();
                    cleanRowKeys[safeKey] = row[key];
                }

                // 2. Map the exact columns from your Test Sheet
                const orderId = cleanRowKeys['order id'];
                const productName = cleanRowKeys['product name'];
                const amountRaw = cleanRowKeys['amount'];
                const paymentMethod = cleanRowKeys['payment method'];
                const countryCodeRaw = cleanRowKeys['country code'];
                const phoneRaw = cleanRowKeys['phone'];
                const dateRaw = cleanRowKeys['date'];
                const customerTier = cleanRowKeys['customer tier'];

                // 3. Data Integrity Checks & Rejection Logging
                const amount = parseFloat(amountRaw);
                
                if (!orderId) { console.log("❌ Dropped: Missing Order ID"); return; }
                if (!productName) { console.log(`❌ Dropped [${orderId}]: Missing Product Name`); return; }
                if (!paymentMethod) { console.log(`❌ Dropped [${orderId}]: Missing Payment Method`); return; }
                if (isNaN(amount) || amount < 0) { console.log(`❌ Dropped [${orderId}]: Invalid Amount (${amountRaw})`); return; }
                if (!phoneRaw) { console.log(`❌ Dropped [${orderId}]: Missing Phone`); return; }
                if (!dateRaw) { console.log(`❌ Dropped [${orderId}]: Missing Date`); return; }

                // 4. Dynamic Phone Validation
                let cleanPhone = '';
                // If Country Code is missing, default to IN
                const countryCode = (countryCodeRaw ? countryCodeRaw.toUpperCase().trim() : 'IN') as CountryCode;
                
                // Ensure Indian numbers have a '+' for the parser
                const formattedPhoneRaw = (countryCode === 'IN' && phoneRaw.startsWith('91') && !phoneRaw.startsWith('+')) 
                  ? `+${phoneRaw}` 
                  : phoneRaw;

                const phoneNumber = parsePhoneNumberFromString(formattedPhoneRaw, countryCode);
                
                if (phoneNumber && phoneNumber.isValid()) {
                  cleanPhone = phoneNumber.number as string;
                } else {
                  console.log(`❌ Dropped [${orderId}]: Invalid ${countryCode} Phone Number (${phoneRaw})`);
                  return;
                }

                // 5. Date Standardization
                let cleanDate = '';
                const parsedDate = new Date(dateRaw);
                if (isValid(parsedDate)) {
                    cleanDate = format(parsedDate, "yyyy-MM-dd HH:mm:ss");
                } else {
                    console.log(`❌ Dropped [${orderId}]: Unparseable Date (${dateRaw})`);
                    return; 
                }

                // 6. Reconstruct the clean row
                const cleanRow = {
                  'Order ID': orderId,
                  'Product Name': productName,
                  'Amount': amount.toFixed(2),
                  'Payment Method': paymentMethod,
                  'Country Code': countryCode,
                  'Phone': cleanPhone,
                  'Date': cleanDate,
                  'Customer Tier': customerTier || ''
                };

                // Initialize chunk stream on the first valid row
                if (!currentCsvStream) {
                    const headers = Object.keys(cleanRow);
                    openNewChunk(headers);
                }

                // Write to current chunk stream
                currentCsvStream!.write(cleanRow);
                validRowsCount++;

                if (validRowsCount > 0 && validRowsCount % CHUNK_SIZE === 0) {
                  const headers = Object.keys(cleanRow);
                  openNewChunk(headers);
                }

                if (totalProcessed % 100 === 0) {
                    job.updateProgress({ rows_processed: totalProcessed, valid_rows: validRowsCount });
                }
            })
            .on('end', async () => {
                if (currentCsvStream) {
                    currentCsvStream.end();
                }
                
                await job.updateProgress({ rows_processed: totalProcessed, valid_rows: validRowsCount });

                try {
                    // Dynamically import ES Module 'archiver' using eval to prevent CJS compilation rewrite
                    const archiverModule = await (eval("import('archiver')") as Promise<any>);
                    const ZipArchive = archiverModule.ZipArchive;


                    // Zip all chunks
                    const zipPath = path.join(SHARED_OUTPUTS_DIR, `${jobId}_completed.zip`);
                    const output = fs.createWriteStream(zipPath);
                    const archive = new ZipArchive({ zlib: { level: 9 } });

                    output.on('close', () => {
                        resolve({
                            rows_processed: totalProcessed,
                            valid_rows: validRowsCount,
                        });
                    });

                    archive.on('error', (err) => {
                        reject(err);
                    });

                    archive.pipe(output);
                    archive.directory(jobOutputDir, false);
                    await archive.finalize();
                } catch (err) {
                    reject(err);
                }

            });
    });
};

import { randomUUID } from 'crypto';

const workerId = randomUUID();

// Start ping heartbeat
const startHeartbeat = () => {
  const interval = setInterval(async () => {
    try {
      await redisConnection.zadd('worker:active_pings', Date.now(), workerId);
    } catch (err) {
      console.error('Heartbeat failed:', err);
    }
  }, 2000);

  return () => clearInterval(interval);
};

const stopHeartbeat = startHeartbeat();

const worker = new Worker('csv_processing_jobs', async job => {
    console.log(`Processing job ${job.id}`);
    return await processCsvJob(job);
}, workerOptions);

worker.on('completed', job => {
  console.log(`Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} has failed with ${err.message}`);
});

console.log("Worker is running and waiting for jobs...");

const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, starting graceful shutdown...`);
  stopHeartbeat();
  try {
    await redisConnection.zrem('worker:active_pings', workerId);
    await worker.close();
    await redisConnection.quit();
    console.log('Worker shut down successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Error during graceful shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));


