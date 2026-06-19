"use client";

import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Download, Terminal } from 'lucide-react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'completed' | 'error'>('idle');
  const [progress, setProgress] = useState<{ rows_processed: number; valid_rows?: number; error?: string }>({ rows_processed: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  const ws = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, msg]);
  };

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const startPipeline = async () => {
    if (!file) return;
    
    setStatus('uploading');
    setProgress({ rows_processed: 0, valid_rows: 0 });
    setDownloadUrl(null);
    setLogs([`[${new Date().toLocaleTimeString()}] Initiating upload for ${file.name}...`]);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setJobId(data.job_id);
      addLog(`[${new Date().toLocaleTimeString()}] Upload accepted. Job ID: ${data.job_id}`);
      setStatus('processing');
    } catch (err: any) {
      addLog(`[${new Date().toLocaleTimeString()}] ❌ Error: ${err.message}`);
      setStatus('error');
    }
  };

  useEffect(() => {
    if (status === 'processing' && jobId) {
      addLog(`[${new Date().toLocaleTimeString()}] Connecting to WebSocket for real-time progress...`);
      ws.current = new WebSocket(`ws://localhost:8000/progress/${jobId}`);

      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status) {
          setProgress({
            rows_processed: data.rows_processed || 0,
            valid_rows: data.valid_rows || 0,
            error: data.error
          });

          if (data.status === 'completed') {
            setStatus('completed');
            addLog(`[${new Date().toLocaleTimeString()}] ✅ Pipeline complete. Zipping output chunks...`);
            setDownloadUrl(data.download_url || `/download/${jobId}`);
          } else if (data.status === 'failed') {
            setStatus('error');
            addLog(`[${new Date().toLocaleTimeString()}] ❌ Processing failed: ${data.error}`);
          } else if (data.rows_processed > 0 && data.rows_processed % 5000 === 0) {
            addLog(`[${new Date().toLocaleTimeString()}] Processed ${data.rows_processed} rows... Valid: ${data.valid_rows || 0}`);
          }
        }
      };

      ws.current.onclose = () => {
        addLog(`[${new Date().toLocaleTimeString()}] WebSocket connection closed.`);
      };

      return () => {
        ws.current?.close();
      };
    }
  }, [status, jobId]);

  // Calculate percentage dynamically based on file size (assuming average row size of 75 bytes)
  const estimatedTotalRows = file ? Math.max(1, Math.round(file.size / 75)) : 1;
  const progressPercent = status === 'completed'
    ? 100
    : status === 'uploading'
      ? 0
      : Math.min(99, Math.round((progress.rows_processed / estimatedTotalRows) * 100));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-md">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">Data Saab</span>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Worker Node: Online
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        
        {/* Header Section */}
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Data Cleaning Pipeline</h1>
          <p className="text-slate-500">Upload transaction datasets. The system will automatically validate, standardize, and chunk massive files.</p>
        </div>

        {/* Upload Zone */}
        <div 
          className={`relative border-2 border-dashed rounded-xl p-12 transition-all duration-200 ease-in-out flex flex-col items-center justify-center text-center overflow-hidden bg-white
            ${status === 'idle' ? 'border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer' : 'border-slate-200'}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => status === 'idle' && handleFileDrop(e)}
          onClick={() => status === 'idle' && fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".csv"
            onChange={(e) => e.target.files && setFile(e.target.files[0])}
          />
          
          {status === 'idle' && (
            <>
              <div className="bg-slate-100 p-4 rounded-full mb-4">
                <UploadCloud className="w-8 h-8 text-slate-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-1">
                {file ? file.name : "Click or drag CSV file to upload"}
              </h3>
              <p className="text-sm text-slate-500">
                {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Strictly handles .csv files up to 5GB"}
              </p>
              {file && (
                <button 
                  onClick={(e) => { e.stopPropagation(); startPipeline(); }}
                  className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
                >
                  Start Validation Pipeline
                </button>
              )}
            </>
          )}

          {/* Active Processing State */}
          {status !== 'idle' && (
            <div className="w-full max-w-md mx-auto space-y-6 py-4">
              <div className="flex items-center justify-between text-sm font-medium">
                <span className="text-slate-700 flex items-center gap-2">
                  {(status === 'processing' || status === 'uploading') && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
                  {status === 'completed' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                  {status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                  {status === 'uploading' ? 'Uploading to Gateway...' : status === 'processing' ? 'Processing chunks...' : status === 'error' ? 'Pipeline Failed' : 'Pipeline Completed'}
                </span>
                <span className="text-slate-500">{progressPercent}%</span>
              </div>
              
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ease-out ${status === 'completed' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-blue-600'}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Show absolute counts */}
              <div className="grid grid-cols-2 gap-4 text-center text-sm border-t border-slate-100 pt-4">
                <div>
                  <div className="text-slate-500 font-medium">Rows Processed</div>
                  <div className="text-blue-600 font-mono text-lg font-semibold">{progress.rows_processed.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-slate-500 font-medium">Valid Rows Written</div>
                  <div className="text-emerald-600 font-mono text-lg font-semibold">{(progress.valid_rows || 0).toLocaleString()}</div>
                </div>
              </div>

              {status === 'completed' && downloadUrl && (
                <button 
                  onClick={() => {
                    window.location.href = `http://localhost:8000${downloadUrl}`;
                  }}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Download Cleaned Chunks (ZIP)
                </button>
              )}

              {status === 'error' && (
                <button 
                  onClick={() => setStatus('idle')}
                  className="w-full bg-slate-200 hover:bg-slate-300 text-slate-800 px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
                >
                  Reset Dashboard
                </button>
              )}
            </div>
          )}
        </div>

        {/* Live Terminal */}
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
          <div className="bg-slate-50/80 border-b border-slate-200 px-4 py-3 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Worker Telemetry & Logs</h3>
          </div>
          <div 
            ref={terminalRef}
            className="h-64 overflow-y-auto p-4 bg-[#0A0A0A] text-slate-300 font-mono text-sm leading-relaxed"
          >
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">Waiting for pipeline to initiate...</p>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={`py-0.5 ${log.includes('❌') ? 'text-red-400' : log.includes('✅') ? 'text-emerald-400' : ''}`}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
