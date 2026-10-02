import { useState, useEffect } from "react";
import Header from "./components/Header";
import Footer from "./components/Footer";
import UploadPage from "./pages/UploadPage";
import ChatPage from "./pages/ChatPage";
import { resetWorkspace, getIndexingStatus, getDocuments } from "./api";

export default function App() {
  const [view, setView] = useState<"upload" | "chat">("upload");
  const [activeFileName, setActiveFileName] = useState<string>("");

  useEffect(() => {
    async function checkExisting() {
      try {
        const status = await getIndexingStatus();
        if (status.stage === "complete" && status.chunk_count > 0) {
          const docs = await getDocuments();
          const name = docs.length > 0 ? docs[0].name : "Indexed Documents";
          setActiveFileName(name);
          setView("chat");
        }
      } catch (err) {
        // Backend not ready yet or network idle
      }
    }
    checkExisting();
  }, []);

  function handleFileUploaded(name: string) {
    setActiveFileName(name);
    setView("chat");
  }

  async function handleNewChat() {
    try {
      await resetWorkspace();
    } catch (e) {
      console.error(e);
    }
    setView("upload");
    setActiveFileName("");
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-background text-on-surface antialiased selection:bg-primary/30 selection:text-on-surface">
      <Header onNewChat={handleNewChat} />

      <div className="pt-16 flex-1 flex flex-col">
        {view === "upload" ? (
          <>
            <main className="flex-1 flex items-center justify-center">
              <UploadPage onFileUploaded={handleFileUploaded} />
            </main>
            <Footer />
          </>
        ) : (
          <ChatPage
            onNewUpload={handleNewChat}
            initialFileName={activeFileName}
          />
        )}
      </div>
    </div>
  );
}
