import express from 'express';
import multer from 'multer';
import { Queue, QueueEvents } from 'bullmq';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import Redis from 'ioredis';

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Setup directories
const SHARED_UPLOADS_DIR = path.resolve(__dirname, '../../shared_volume/uploads');
const SHARED_OUTPUTS_DIR = path.resolve(__dirname, '../../shared_volume/outputs');
fs.mkdirSync(SHARED_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(SHARED_OUTPUTS_DIR, { recursive: true });

// Setup Multer for streaming uploads to disk
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, SHARED_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const jobId = req.body.jobId || uuidv4();
    req.body.jobId = jobId; // ensure jobId is available later
    cb(null, `${jobId}_${file.originalname}`);
  }
});
const upload = multer({ storage });

// Setup BullMQ
const redisConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 4 });
const queueOptions = { connection: redisConnection as any };
const queue = new Queue('csv_processing_jobs', queueOptions);
const queueEvents = new QueueEvents('csv_processing_jobs', queueOptions);

// HTTP endpoints
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const jobId = req.body.jobId;
  const filePath = req.file.path;

  try {
    await queue.add('process_csv', { jobId, filePath }, { jobId });
    res.status(202).json({ job_id: jobId, message: 'File accepted for processing' });
  } catch (error) {
    console.error("Failed to enqueue job:", error);
    res.status(500).json({ error: 'Failed to enqueue job' });
  }
});

app.get('/status', async (req, res) => {
  try {
    const now = Date.now();
    const threshold = now - 5000; // 5 seconds ago
    // Prune old workers that haven't pinged in 5s
    await redisConnection.zremrangebyscore('worker:active_pings', 0, threshold);
    // Count active workers
    const activeCount = await redisConnection.zcard('worker:active_pings');
    res.json({ workerActive: activeCount > 0 });
  } catch (error) {
    console.error("Failed to fetch workers:", error);
    res.json({ workerActive: false });
  }
});


app.get('/download/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const zipPath = path.join(SHARED_OUTPUTS_DIR, `${jobId}_completed.zip`);
  
  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: 'Output file not found or processing not complete' });
  }
  
  res.download(zipPath, `${jobId}_completed.zip`);
});

const server = http.createServer(app);

// WebSocket setup. To mimic the python version, we listen at /progress/{jobId}
// We'll intercept the upgrade request to extract the jobId
const wss = new WebSocketServer({ noServer: true });
const activeSockets = new Map<string, Set<any>>();

server.on('upgrade', (request, socket, head) => {
  const pathname = request.url;
  if (pathname && pathname.startsWith('/progress/')) {
    const jobId = pathname.split('/')[2];
    if (!jobId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, jobId);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (ws: any, request: any, jobId: string) => {
    if (!activeSockets.has(jobId)) {
        activeSockets.set(jobId, new Set());
    }
    activeSockets.get(jobId)!.add(ws);

    // Initial state hydration from BullMQ
    const job = await queue.getJob(jobId);
    if (job) {
        const isCompleted = await job.isCompleted();
        const isFailed = await job.isFailed();
        const progress: any = job.progress || { rows_processed: 0 };
        
        ws.send(JSON.stringify({
            job_id: jobId,
            status: isCompleted ? 'completed' : isFailed ? 'failed' : 'running',
            rows_processed: progress.rows_processed || 0,
            valid_rows: progress.valid_rows || 0,
            download_url: isCompleted ? `/download/${jobId}` : undefined,
            error: isFailed ? job.failedReason : undefined
        }));
    } else {
        ws.send(JSON.stringify({ job_id: jobId, status: 'connected', rows_processed: 0 }));
    }

    ws.on('close', () => {
        const sockets = activeSockets.get(jobId);
        if (sockets) {
            sockets.delete(ws);
            if (sockets.size === 0) {
                activeSockets.delete(jobId);
            }
        }
    });
});

// Broadcast helper
const broadcastToJob = (jobId: string, data: any) => {
    const sockets = activeSockets.get(jobId);
    if (sockets) {
        const msg = JSON.stringify(data);
        sockets.forEach(ws => ws.send(msg));
    }
};

queueEvents.on('progress', ({ jobId, data }: { jobId: string, data: any }) => {
    // BullMQ progress can be a number or an object
    const progressData = typeof data === 'object' ? data : { rows_processed: data };
    broadcastToJob(jobId, {
        job_id: jobId,
        status: 'running',
        ...progressData
    });
});

queueEvents.on('completed', ({ jobId, returnvalue }) => {
    broadcastToJob(jobId, {
        job_id: jobId,
        status: 'completed',
        download_url: `/download/${jobId}`,
        ...(typeof returnvalue === 'object' && returnvalue !== null ? returnvalue : {})
    });
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
    broadcastToJob(jobId, {
        job_id: jobId,
        status: 'failed',
        error: failedReason
    });
});

server.listen(PORT, () => {
  console.log(`Gateway server listening on port ${PORT}`);
});
