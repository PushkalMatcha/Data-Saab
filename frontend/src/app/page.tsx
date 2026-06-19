"use client";

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Download, Terminal, BarChart3, ShieldAlert, Zap } from 'lucide-react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'completed' | 'error'>('idle');
  
  // Telemetry State
  const [progressPercent, setProgressPercent] = useState(0);
  const [metrics, setMetrics] = useState({ total: 0, valid: 0, failed: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  const ws = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, msg]);
  };

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const startPipeline = async () => {
    if (!file) return;
    setStatus('uploading');
    setProgressPercent(0);
    setMetrics({ total: 0, valid: 0, failed: 0 });
    setDownloadUrl(null);
    setLogs([`[System] Initiating secure stream for ${file.name}...`]);

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
      addLog(`[Broker] File accepted. Job ID: ${data.job_id}. Worker nodes scaling up...`);
      setStatus('processing');
    } catch (err: any) {
      addLog(`❌ [System] Error: ${err.message}`);
      setStatus('error');
    }
  };

  useEffect(() => {
    if (status === 'processing' && jobId) {
      addLog(`[System] Connecting to WebSocket for real-time progress...`);
      ws.current = new WebSocket(`ws://localhost:8000/progress/${jobId}`);

      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status) {
          const total = data.rows_processed || 0;
          const valid = data.valid_rows || 0;
          const failed = Math.max(0, total - valid);
          
          setMetrics({ total, valid, failed });

          // Estimate percentage dynamically based on file size (assuming average row size of 75 bytes)
          const estimatedTotalRows = file ? Math.max(1, Math.round(file.size / 75)) : 1;
          const pct = Math.min(99, Math.round((total / estimatedTotalRows) * 100));
          setProgressPercent(pct);

          if (data.status === 'completed') {
            setStatus('completed');
            setProgressPercent(100);
            setMetrics({ total, valid, failed });
            addLog(`✅ Pipeline complete. Chunks successfully zipped.`);
            setDownloadUrl(data.download_url || `/download/${jobId}`);
          } else if (data.status === 'failed') {
            setStatus('error');
            addLog(`❌ Processing failed: ${data.error}`);
          } else if (total > 0 && total % 5000 === 0) {
            addLog(`[Worker] Processed ${total} rows... Valid: ${valid}, Anomalies: ${failed}`);
          }
        }
      };

      ws.current.onclose = () => {
        addLog(`[System] WebSocket connection closed.`);
      };

      return () => {
        ws.current?.close();
      };
    }
  }, [status, jobId]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-blue-200">
      {/* Premium Glassmorphism Navbar */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-1.5 rounded-lg shadow-sm">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600">
              Data Saab
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm font-medium bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-slate-600">Worker Node: Active</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        
        {/* Header */}
        <div className="space-y-2 max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Data Engineering Pipeline</h1>
          <p className="text-slate-500 text-lg">High-throughput validation engine. Drop your raw CSVs below to automatically standardize, clean, and chunk your datasets.</p>
        </div>

        {/* Dynamic Live Metrics Row */}
        <AnimatePresence>
          {status !== 'idle' && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-4"
            >
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                <div className="bg-blue-50 p-3 rounded-lg"><BarChart3 className="w-6 h-6 text-blue-600" /></div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Total Processed</p>
                  <p className="text-2xl font-bold text-slate-900">{metrics.total.toLocaleString()}</p>
                </div>
              </div>
              <div className="bg-white p-5 rounded-xl border border-emerald-100 shadow-sm flex items-center gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-10 -mt-10"></div>
                <div className="bg-emerald-50 p-3 rounded-lg relative z-10"><Zap className="w-6 h-6 text-emerald-600" /></div>
                <div className="relative z-10">
                  <p className="text-sm font-medium text-slate-500">Valid Rows Written</p>
                  <p className="text-2xl font-bold text-emerald-600">{metrics.valid.toLocaleString()}</p>
                </div>
              </div>
              <div className="bg-white p-5 rounded-xl border border-red-100 shadow-sm flex items-center gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-full blur-3xl -mr-10 -mt-10"></div>
                <div className="bg-red-50 p-3 rounded-lg relative z-10"><ShieldAlert className="w-6 h-6 text-red-500" /></div>
                <div className="relative z-10">
                  <p className="text-sm font-medium text-slate-500">Anomalies Dropped</p>
                  <p className="text-2xl font-bold text-red-500">{metrics.failed.toLocaleString()}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          
          {/* Main Processing Area */}
          <div className="lg:col-span-3 space-y-6">
            <motion.div 
              className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center p-12 bg-white overflow-hidden
                ${status === 'idle' ? 'cursor-pointer min-h-[320px]' : 'min-h-[240px]'}
                ${isDragging ? 'border-blue-500 bg-blue-50/50 scale-[1.02]' : 'border-slate-300 hover:border-blue-400'}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => status === 'idle' && handleDrop(e)}
              onClick={() => status === 'idle' && fileInputRef.current?.click()}
              layout
            >
              <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={(e) => e.target.files && setFile(e.target.files[0])} />
              
              <AnimatePresence mode="wait">
                {status === 'idle' ? (
                  <motion.div 
                    key="upload"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-center flex flex-col items-center"
                  >
                    <div className="bg-slate-100 p-4 rounded-full mb-5 shadow-inner">
                      <UploadCloud className="w-8 h-8 text-slate-600" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">
                      {file ? file.name : "Drag & drop your CSV"}
                    </h3>
                    <p className="text-slate-500 mb-6 max-w-sm">
                      {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB ready for validation` : "Enterprise engine strictly handles datasets up to 5GB."}
                    </p>
                    {file && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); startPipeline(); }}
                        className="bg-slate-900 hover:bg-slate-800 text-white px-8 py-3 rounded-lg font-medium transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                      >
                        <Zap className="w-4 h-4" /> Execute Pipeline
                      </button>
                    )}
                  </motion.div>
                ) : (
                  <motion.div 
                    key="processing"
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-md mx-auto"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-semibold text-slate-700 flex items-center gap-2 text-lg">
                        {(status === 'processing' || status === 'uploading') && <Loader2 className="w-5 h-5 animate-spin text-blue-600" />}
                        {status === 'completed' && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                        {status === 'error' && <AlertCircle className="w-6 h-6 text-red-500" />}
                        {status === 'uploading' ? 'Ingesting...' : status === 'processing' ? 'Validating Stream...' : status === 'error' ? 'Pipeline Failed' : 'Pipeline Complete'}
                      </span>
                      <span className="text-slate-500 font-medium text-lg">{progressPercent}%</span>
                    </div>
                    
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner">
                      <motion.div 
                        className={`h-full ${status === 'completed' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-gradient-to-r from-blue-600 to-indigo-600'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ ease: "easeOut", duration: 0.5 }}
                      />
                    </div>

                    {status === 'completed' && downloadUrl && (
                      <motion.button 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                        onClick={() => {
                          window.location.href = `http://localhost:8000${downloadUrl}`;
                        }}
                        className="mt-8 w-full bg-slate-900 hover:bg-slate-800 text-white px-4 py-3.5 rounded-lg font-medium transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                      >
                        <Download className="w-5 h-5" /> Download Cleaned Chunks (.zip)
                      </motion.button>
                    )}

                    {(status === 'completed' || status === 'error') && (
                      <motion.button 
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
                        onClick={() => {
                          setStatus('idle');
                          setFile(null);
                        }}
                        className="mt-3 w-full bg-slate-200 hover:bg-slate-300 text-slate-800 px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
                      >
                        Reset Pipeline
                      </motion.button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>

          {/* Terminal Console */}
          <div className="lg:col-span-2 flex flex-col h-full min-h-[320px]">
            <div className="bg-[#0A0A0A] rounded-2xl overflow-hidden shadow-xl border border-slate-800 flex flex-col h-full">
              <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-semibold tracking-wider text-slate-300 uppercase">Worker Telemetry</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                </div>
              </div>
              
              <div 
                ref={terminalRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed text-slate-300 scroll-smooth"
              >
                {logs.length === 0 ? (
                  <p className="text-slate-600 italic">Awaiting event stream...</p>
                ) : (
                  logs.map((log, index) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      key={index} 
                      className={`py-0.5 ${log.includes('❌') ? 'text-red-400' : log.includes('✅') ? 'text-emerald-400 font-semibold' : ''}`}
                    >
                      {log}
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
