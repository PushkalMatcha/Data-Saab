"use client";

import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, FileArchive, Terminal, Play, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'completed' | 'failed'>('idle');
  const [progress, setProgress] = useState<{ rows_processed: number; valid_rows?: number; error?: string }>({ rows_processed: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const ws = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    // Auto scroll logs
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus('uploading');
    addLog(`Initiating upload for ${file.name}...`);

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Hardcoded for local dev, should be an env var
      const res = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setJobId(data.job_id);
      addLog(`Upload accepted. Job ID: ${data.job_id}`);
      setStatus('processing');
    } catch (err) {
      addLog(`Error: ${err}`);
      setStatus('failed');
    }
  };

  useEffect(() => {
    if (status === 'processing' && jobId) {
      addLog(`Connecting to WebSocket for real-time progress...`);
      ws.current = new WebSocket(`ws://localhost:8000/progress/${jobId}`);

      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status) {
          setProgress(data);
          if (data.status === 'completed') {
            setStatus('completed');
            addLog(`Processing completed. Final rows processed: ${data.rows_processed}`);
          } else if (data.status === 'failed') {
            setStatus('failed');
            addLog(`Processing failed: ${data.error}`);
          } else if (data.rows_processed > 0 && data.rows_processed % 5000 === 0) {
             addLog(`Processed ${data.rows_processed} rows... Valid: ${data.valid_rows || 0}`);
          }
        }
      };

      ws.current.onclose = () => {
        addLog(`WebSocket connection closed.`);
      };

      return () => {
        ws.current?.close();
      };
    }
  }, [status, jobId]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 pb-20">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <CheckCircle className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Data Saab</h1>
        </div>
        <span className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">Enterprise Edition</span>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Actions & Progress */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 transition-all hover:shadow-md">
            <h2 className="text-lg font-semibold mb-1">Data Ingestion</h2>
            <p className="text-slate-500 text-sm mb-6">Upload your massive CSV transaction logs for distributed processing.</p>

            <div 
              onDragOver={(e) => e.preventDefault()} 
              onDrop={handleDrop}
              className={cn(
                "border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center transition-colors cursor-pointer",
                file ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
              )}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <input 
                id="file-upload" 
                type="file" 
                accept=".csv" 
                className="hidden" 
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <UploadCloud className={cn("w-12 h-12 mb-4", file ? "text-indigo-600" : "text-slate-400")} />
              {file ? (
                <>
                  <p className="text-base font-medium text-slate-800">{file.name}</p>
                  <p className="text-sm text-slate-500 mt-1">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                </>
              ) : (
                <>
                  <p className="text-base font-medium text-slate-800">Drag & drop your CSV file here</p>
                  <p className="text-sm text-slate-500 mt-1">or click to browse</p>
                </>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleUpload}
                disabled={!file || status !== 'idle'}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
              >
                {status === 'uploading' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                {status === 'uploading' ? 'Uploading...' : 'Start Processing'}
              </button>
            </div>
          </section>

          {(status === 'processing' || status === 'completed' || status === 'failed') && (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-lg font-semibold">Processing Pipeline</h2>
                  <p className="text-slate-500 text-sm">Job ID: <span className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">{jobId}</span></p>
                </div>
                {status === 'processing' && <span className="flex h-3 w-3 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span></span>}
                {status === 'completed' && <CheckCircle className="w-6 h-6 text-emerald-500" />}
                {status === 'failed' && <AlertCircle className="w-6 h-6 text-red-500" />}
              </div>

              <div className="space-y-4">
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-slate-600">Rows Processed</span>
                  <span className="text-indigo-600 font-mono text-base">{progress.rows_processed.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-slate-600">Valid Rows Written</span>
                  <span className="text-emerald-600 font-mono text-base">{progress.valid_rows?.toLocaleString() || 0}</span>
                </div>
              </div>

              {status === 'completed' && (
                <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row gap-4 items-center justify-between bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                  <div className="flex items-center gap-3">
                    <FileArchive className="w-8 h-8 text-emerald-600" />
                    <div>
                      <p className="font-medium text-emerald-900">Validation Complete</p>
                      <p className="text-sm text-emerald-700">Output chunked and zipped.</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => window.open(`http://localhost:8000${(progress as any).download_url || '/download'}`, '_blank')}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg font-medium shadow-sm transition-colors whitespace-nowrap"
                  >
                    Download Output
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Right Column: Terminal Logs */}
        <div className="lg:col-span-5 flex flex-col">
          <section className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col h-[600px] sticky top-24">
            <div className="bg-slate-950 px-4 py-3 flex items-center gap-2 border-b border-slate-800">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-mono text-slate-400 font-medium uppercase tracking-wider">Worker Node Logs</span>
            </div>
            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs sm:text-sm text-slate-300 space-y-2">
              {logs.length === 0 ? (
                <p className="text-slate-600 italic">Awaiting events...</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="break-words border-b border-slate-800/50 pb-1">
                    <span className="text-emerald-400 mr-2">›</span>
                    {log}
                  </div>
                ))
              )}
              {status === 'processing' && (
                <div className="flex items-center gap-2 mt-4 text-slate-500">
                  <span className="w-2 h-4 bg-slate-500 block animate-pulse"></span> Waiting for next chunk...
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </section>
        </div>

      </main>
    </div>
  );
}
