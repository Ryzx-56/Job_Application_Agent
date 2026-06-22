"use client";

import React, { useState, useRef } from "react";
import { Upload, FileText, Briefcase, X, Sparkles, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

export default function UploadZone() {
  // File and input states
  const [file, setFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState<string>("");
  const [isDragging, setIsDragging] = useState<boolean>(false);
  
  // Visual states for top-down testing
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    validateAndSetFile(droppedFile);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      validateAndSetFile(selectedFile);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    if (selectedFile.type !== "application/pdf") {
      toast.error("Invalid file type", {
        description: "Please upload a valid PDF resume file.",
      });
      return;
    }
    // Optional 5MB payload limit check mirroring your future backend logic
    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error("File too large", {
        description: "Resume PDF must be under 5MB.",
      });
      return;
    }
    setFile(selectedFile);
    toast.success("Resume uploaded", {
      description: `${selectedFile.name} staged successfully.`,
    });
  };

  const removeFile = () => {
    setFile(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Mock processing triggers to preview layout changes
  const handleMockAnalyze = () => {
    if (!file) {
      toast.error("Missing Resume", { description: "Please upload your master CV first." });
      return;
    }
    if (!jobDescription.trim()) {
      toast.error("Missing Job Description", { description: "Please paste the target job requirements." });
      return;
    }

    setIsProcessing(true);
    setUploadProgress(10);

    // Simulate pipeline stage step increments
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setIsProcessing(false);
            toast.success("Analysis Complete!", {
              description: "LangGraph pipeline executed successfully.",
            });
          }, 600);
          return 100;
        }
        return prev + 15;
      });
    }, 400);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto p-4">
      {/* Left Column: Input Management workspace */}
      <div className="space-y-6">
        {/* Step 1: Master CV Upload Box */}
        <Card className="border-zinc-800 bg-zinc-950/50 backdrop-blur-sm shadow-xl">
          <CardHeader>
            <CardTitle className="text-xl font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-400" />
              Master CV Input
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Upload your base resume. Our parser uses strict extraction constraints to prevent hallucinations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".pdf"
              className="hidden"
            />
            
            {!file ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center min-h-[180px] ${
                  isDragging
                    ? "border-indigo-500 bg-indigo-950/10 text-indigo-400"
                    : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/30 text-zinc-400"
                }`}
              >
                <div className="p-3 bg-zinc-900 rounded-lg mb-3 border border-zinc-800 group-hover:border-zinc-700">
                  <Upload className="w-6 h-6 text-zinc-300" />
                </div>
                <p className="text-sm font-medium text-zinc-200">
                  Drag & drop your PDF resume here, or <span className="text-indigo-400">browse</span>
                </p>
                <p className="text-xs text-zinc-500 mt-1">Supports PDF format up to 5MB</p>
              </div>
            ) : (
              <div className="flex items-center justify-between p-4 bg-zinc-900/80 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 bg-indigo-950/40 rounded-lg text-indigo-400 border border-indigo-900/50">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium text-zinc-200 truncate">{file.name}</p>
                    <p className="text-xs text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={removeFile}
                  className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                  disabled={isProcessing}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Target Job Description Box */}
        <Card className="border-zinc-800 bg-zinc-950/50 backdrop-blur-sm shadow-xl">
          <CardHeader>
            <CardTitle className="text-xl font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-emerald-400" />
              Target Job Requirements
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Paste the complete raw job text. Messy roles will be cleaned and mapped into weight factors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste responsibilities, skill demands, or company info here..."
              className="w-full min-h-[160px] p-3 text-sm bg-zinc-900 rounded-xl border border-zinc-800 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700 text-zinc-200 placeholder-zinc-600 resize-y transition-colors"
              disabled={isProcessing}
            />
          </CardContent>
        </Card>

        {/* Generate Orchestration Trigger */}
        <Button
          onClick={handleMockAnalyze}
          disabled={isProcessing}
          className="w-full py-6 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium shadow-lg shadow-indigo-950/20 rounded-xl flex items-center justify-center gap-2 text-base transition-all transform active:scale-[0.99]"
        >
          <Sparkles className="w-5 h-5" />
          {isProcessing ? "Orchestrating Agents..." : "Run Tailoring Pipeline"}
        </Button>
      </div>

      {/* Right Column: Visual Stage Loader Dashboard */}
      <div className="flex flex-col justify-between">
        <Card className="border-zinc-800 bg-zinc-950/50 backdrop-blur-sm shadow-xl flex-1 flex flex-col justify-between min-h-[300px]">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Pipeline Status & State Machine Monitoring
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center flex-1 pb-8 px-6">
            {isProcessing ? (
              <div className="w-full space-y-6">
                <div className="space-y-2 text-center">
                  <div className="inline-flex p-3 bg-indigo-950/20 rounded-full text-indigo-400 animate-pulse border border-indigo-950">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-medium text-zinc-200">Processing Multi-Agent Logic</h3>
                  <p className="text-xs text-zinc-400 max-w-xs mx-auto">
                    {uploadProgress < 30 && "Agent 1 & 2: Parsing CV and cleaning text weights..."}
                    {uploadProgress >= 30 && uploadProgress < 60 && "Agent 3: Re-ranking and humanizing custom bullets..."}
                    {uploadProgress >= 60 && uploadProgress < 80 && "Loop Node: Hard-verifying facts against Pydantic schema..."}
                    {uploadProgress >= 80 && "Agent 4, 5 & 6: Compiling final outputs & mapping live matches..."}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono text-zinc-500">
                    <span>STATE_MUTATION</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2 bg-zinc-900" />
                </div>
              </div>
            ) : (
              <div className="text-center space-y-3 max-w-sm">
                <div className="mx-auto w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center text-zinc-600 border border-zinc-800">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-zinc-300">Awaiting Pipeline Parameters</h4>
                  <p className="text-xs text-zinc-500">
                    Load your master CV document and specify target parameters to invoke the LangGraph network graph.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}