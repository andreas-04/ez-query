"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import styles from "./chat.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const sessionId = uuidv4();

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${err.error ?? "Request failed"}` },
        ]);
        return;
      }

      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.viewport} ref={viewportRef}>
        {messages.length === 0 && (
          <p className={styles.empty}>
            Ask anything about employees, jobs, payroll, or scheduling.
          </p>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`${styles.bubble} ${styles[msg.role]}`}>
            <div className={styles.content}>{msg.content}</div>
          </div>
        ))}

        {loading && (
          <div className={`${styles.bubble} ${styles.assistant}`}>
            <div className={`${styles.content} ${styles.thinking}`}>
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message otto…"
          rows={1}
          disabled={loading}
          className={styles.textarea}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className={styles.sendBtn}
        >
          Send
        </button>
      </form>
    </div>
  );
}
