"use client";

import { useState } from "react";

export function LoginPage({ onLogin }: { onLogin: (phone: string, password: string) => Promise<void> }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <main className="login-screen" dir="rtl">
      <form
        className="login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onLogin(phone, password);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "تعذر تسجيل الدخول");
            setBusy(false);
          }
        }}
      >
        <div className="login-brand">
          <span>م</span>
          <div>
            <strong>مسار</strong>
            <small>نظام إدارة علاقات العملاء</small>
          </div>
        </div>
        <h1>تسجيل الدخول</h1>
        <p>استخدم رقم موبايل الموظف وكلمة المرور الخاصة به.</p>
        {error && <div className="form-error">{error}</div>}
        <label>
          رقم الموبايل
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="01xxxxxxxxx" required autoFocus />
        </label>
        <label>
          كلمة المرور
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="•••••" required />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "جار الدخول..." : "دخول إلى النظام"}
        </button>
        <small className="login-hint">للموظف الجديد: اسم المستخدم هو رقم موبايله، وكلمة المرور الافتراضية 12345.</small>
      </form>
    </main>
  );
}
