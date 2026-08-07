"use client";
import React, { useEffect, useMemo, useState, useRef } from "react";
import { getConversationDisplayTitle } from "./chat-utils.mjs";

function formatMessageDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ar-EG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

type Conversation = { id: number; title: string | null; isGroup: boolean; lastMessage: any; unreadCount: number; members: any[] };
type EmployeeOption = { id: number; fullName: string; email: string; phone: string; jobTitle: string | null; department: string | null; departmentId?: number | null };

export default function ChatPanel() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [toasts, setToasts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentUserName, setCurrentUserName] = useState("أنت");
  const evtRef = useRef<EventSource | null>(null);
  const currentUserIdRef = useRef<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const emojiOptions = ["😀", "❤️", "👍", "🎉", "😂", "🙏", "🔥", "🤝"];

  const employeeLookup = useMemo(() => Object.fromEntries(employees.map((employee) => [employee.id, employee])), [employees]);
  const selectedConversation = conversations.find((conversation) => conversation.id === selected) || null;

  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/chat");
      const data = await res.json();
      if (data.ok) {
        setConversations(data.conversations || []);
        const first = data.conversations?.[0];
        if (first && !selectedRef.current) setSelected(first.id);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchConversations();
    fetch("/api/setup?view=employees")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data?.employees) ? data.employees : [];
        setEmployees(list.filter((item: any) => item?.id));
      })
      .catch(() => {});

    try {
      const es = new EventSource("/api/chat/subscribe");
      evtRef.current = es;
      es.addEventListener("message", (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(ev.data);
          if (payload && payload.conversationId) {
            if (selectedRef.current === payload.conversationId) {
              setMessages((m) => [...m, { id: payload.messageId, conversationId: payload.conversationId, senderId: payload.senderId, content: payload.content, createdAt: payload.createdAt }]);
              fetch("/api/chat/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "markSeen", conversationId: payload.conversationId }) }).catch(() => {});
            } else {
              setToasts((t) => [...t, { id: payload.messageId, conversationId: payload.conversationId, content: payload.content, senderId: payload.senderId }]);
              setConversations((list) => list.map((c) => c.id === payload.conversationId ? { ...c, unreadCount: (c.unreadCount || 0) + 1 } : c));
            }
            fetchConversations();
          }
        } catch (e) {}
      });
      es.onerror = () => {};
    } catch (e) {}
    return () => { if (evtRef.current) evtRef.current.close(); };
  }, []);

  useEffect(() => {
    async function subscribePush() {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission === "denied") return;
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const vapidRes = await fetch("/api/chat/push/vapid");
        const vapidData = await vapidRes.json();
        const publicKey = String(vapidData.publicKey || "");
        if (!publicKey) return;
        const toUint8 = (base64String: string) => {
          const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
          const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
          const rawData = atob(base64);
          const outputArray = new Uint8Array(rawData.length);
          for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
          return outputArray;
        };
        const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8(publicKey) });
        await fetch("/api/chat/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      } catch (e) {}
    }
    if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => { if (perm === "granted") subscribePush(); });
    } else if (Notification.permission === "granted") subscribePush();
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
    if (selected) {
      fetch(`/api/chat/messages?conversationId=${selected}`).then((r) => r.json()).then((data) => { if (data.ok) setMessages(data.messages || []); });
      fetch("/api/chat/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "markSeen", conversationId: selected }) }).catch(() => {});
      fetchConversations();
    } else {
      setMessages([]);
    }
  }, [selected]);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.employee?.id) {
          currentUserIdRef.current = Number(data.employee.id);
          setCurrentUserName(data.employee.fullName || "أنت");
        }
      })
      .catch(() => {});
  }, []);

  const send = async () => {
    if (!selected || !text.trim()) return;
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sendMessage", conversationId: selected, content: text }) });
    const data = await res.json();
    if (data.ok && data.message) {
      setMessages((m) => [...m, data.message]);
      setText("");
      fetchConversations();
    }
  };

  const startConversation = async (memberIds: number[], title = "") => {
    const members = Array.from(new Set([...memberIds.filter(Boolean), Number(currentUserIdRef.current || 0)].filter(Boolean)));
    if (!members.length) return;
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createConversation", title: title.trim(), memberIds: members }) });
    const data = await res.json();
    if (data.ok) {
      setCreating(false);
      setNewTitle("");
      setSelectedMembers([]);
      await fetchConversations();
      if (data.id) setSelected(data.id);
    }
  };

  const createConversation = async () => {
    await startConversation(selectedMembers, newTitle);
  };

  const startQuickChat = async (employeeId: number) => {
    if (Number(employeeId) === Number(currentUserIdRef.current)) return;
    await startConversation([employeeId]);
  };

  const toggleMember = (id: number) => {
    setSelectedMembers((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const appendEmoji = (emoji: string) => setText((value) => `${value}${emoji}`);
  const filteredEmployees = employees.filter((employee) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;
    return [employee.fullName, employee.email, employee.phone].some((value) => String(value || "").toLowerCase().includes(query));
  });

  const groupedEmployees = filteredEmployees.reduce<Record<string, EmployeeOption[]>>((groups, employee) => {
    const departmentName = employee.department || "أخرى";
    if (!groups[departmentName]) groups[departmentName] = [];
    groups[departmentName].push(employee);
    return groups;
  }, {});

  return (
    <div style={{ display: "flex", height: "80vh", border: "1px solid #ddd", background: "#fff", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ width: 320, borderRight: "1px solid #eee", overflow: "auto", background: "#fafafa" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>المحادثات</h3>
          <button onClick={() => setCreating((v) => !v)} style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, background: "#fff" }}>+ جديد</button>
        </div>
        {creating && (
          <div style={{ padding: 10, borderBottom: "1px solid #eee", background: "#fff" }}>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="عنوان المحادثة (اختياري)" style={{ width: "100%", padding: 8, marginBottom: 8 }} />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="ابحث عن موظف" style={{ width: "100%", padding: 8, marginBottom: 8 }} />
            <div style={{ fontSize: 12, marginBottom: 6 }}>اختيار الأعضاء</div>
            <div style={{ maxHeight: 140, overflow: "auto" }}>
              {Object.entries(groupedEmployees).map(([departmentName, departmentEmployees]) => (
                <div key={departmentName} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#2f6b5f", marginBottom: 4 }}>{departmentName}</div>
                  {departmentEmployees.map((employee) => (
                    <label key={employee.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0" }}>
                      <input type="checkbox" checked={selectedMembers.includes(employee.id)} onChange={() => toggleMember(employee.id)} />
                      <span>{employee.fullName}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <button onClick={createConversation} style={{ marginTop: 8, width: "100%", padding: "8px 10px", border: "none", background: "#2f6b5f", color: "#fff", borderRadius: 6 }}>إنشاء</button>
          </div>
        )}
        <div style={{ padding: 10, borderBottom: "1px solid #eee", background: "#fff" }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>محادثة سريعة</div>
          <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="ابحث عن موظف" style={{ width: "100%", padding: 8, marginBottom: 8 }} />
          <div style={{ maxHeight: 180, overflow: "auto" }}>
            {Object.entries(groupedEmployees).map(([departmentName, departmentEmployees]) => (
              <div key={departmentName} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2f6b5f", marginBottom: 4 }}>{departmentName}</div>
                {departmentEmployees.map((employee) => (
                  <div key={employee.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
                    <span style={{ fontSize: 13 }}>{employee.fullName}</span>
                    <button onClick={() => void startQuickChat(employee.id)} style={{ border: "1px solid #2f6b5f", background: "#fff", color: "#2f6b5f", padding: "4px 8px", borderRadius: 6 }}>محادثة</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {conversations.map((c) => {
          const title = getConversationDisplayTitle(c, currentUserIdRef.current, employeeLookup);
          return (
            <div key={c.id} style={{ padding: 10, cursor: "pointer", background: selected === c.id ? "#eef6f2" : "transparent", borderBottom: "1px solid #f0f0f0" }} onClick={() => setSelected(c.id)}>
              <div style={{ fontWeight: 600 }}>{title}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{c.lastMessage?.content || ""} {c.unreadCount ? `(${c.unreadCount})` : ""}</div>
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fff" }}>
          <div style={{ fontWeight: 700 }}>{selectedConversation ? getConversationDisplayTitle(selectedConversation, currentUserIdRef.current, employeeLookup) : "اختر محادثة"}</div>
          <div style={{ fontSize: 12, color: "#666" }}>{selectedConversation?.members?.length ? `${selectedConversation.members.length} عضو` : "محادثة"}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{currentUserName}</div>
        </div>
        <div style={{ flex: 1, padding: 12, overflow: "auto" }}>
          {messages.map((m) => {
            const isMine = Number(m.senderId) === Number(currentUserIdRef.current);
            const senderName = isMine ? "أنت" : employeeLookup[Number(m.senderId)]?.fullName || "موظف";
            return (
              <div key={m.id} style={{ marginBottom: 10, display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "80%", textAlign: isMine ? "right" : "left" }}>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4, textAlign: isMine ? "right" : "left" }}>{senderName}</div>
                  <div style={{ background: isMine ? "#2f6b5f" : "#eef6f2", color: isMine ? "#fff" : "#222", padding: "8px 10px", borderRadius: 8, display: "inline-block", borderTopRightRadius: isMine ? 0 : 8, borderTopLeftRadius: isMine ? 8 : 0 }}>{m.content}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4, textAlign: isMine ? "right" : "left" }}>{formatMessageDate(m.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: 10, borderTop: "1px solid #eee", background: "#fff" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {emojiOptions.map((emoji) => (
              <button key={emoji} type="button" onClick={() => appendEmoji(emoji)} style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 6, padding: "4px 6px", cursor: "pointer" }}>{emoji}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }} placeholder="اكتب رسالة..." style={{ flex: 1, padding: 8 }} />
            <button onClick={() => void send()} style={{ padding: "8px 12px", background: "#2f6b5f", color: "#fff", border: "none", borderRadius: 6 }}>إرسال</button>
          </div>
        </div>
      </div>
      <div style={{ position: "fixed", right: 16, top: 80, width: 320 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ background: "#222", color: "#fff", padding: 10, borderRadius: 8, marginBottom: 8, cursor: "pointer" }} onClick={() => { setSelected(t.conversationId); setToasts((s) => s.filter((x) => x.id !== t.id)); }}>
            <div style={{ fontSize: 13 }}>{t.content}</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>من: {t.senderId}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
