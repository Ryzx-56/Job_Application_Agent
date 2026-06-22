import UploadZone from "@/components/upload-zone";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col justify-center py-12">
      <div className="container mx-auto px-4">
        <header className="text-center mb-10 space-y-2">
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent sm:text-4xl">
            Job Application Agent
          </h1>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            Upload your master CV and set target requirements to trigger the autonomous LangGraph orchestration pipeline.
          </p>
        </header>
        
        {/* Displays the premium drag-and-drop workspace */}
        <UploadZone />
      </div>
    </main>
  );
}